// funis-api — back-end do app Funis (funis/index.html e funis/f/index.html).
// Recebe POST {op, ...}. As operações "public.*" são da página do funil; as demais são do editor e exigem o código de
// acesso no cabeçalho x-fn-key: o segredo FUNIS_ACCESS_CODE, se existir, ou o código guardado (sal + hash) em fn_config,
// que a equipe troca pelo editor. Sem nenhum dos dois, o editor fica aberto.
// SUPABASE_DB_URL, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm do Supabase.
import postgres from 'npm:postgres@3.4.5';
import {evalRoles} from './rules.ts';
import {GRAPH_VERSION, SESSION_RE, SLUG_RE, aggregateAccount, aggregateAds, aggregateE2E, aggregatePaths, attributeSpend, brDay, buildPayload, capiEvent, crmLeadFacts, crmLeadRows, crmSpendDoc, crmSpendRows, encodeBody, ifoodSummary, importRow, isBotUA, leadMetrics, merchantIdFrom, mergeSession, mergeWebhook, parseCrm, parseSale, payloadExtras, periodStart, ruleVars, sameKey, sampleSession, sanitizeParams, sanitizeTracking, sha256, slugify, webhookDue, webhookForEditor, type AdSpendRow, type CrmInfo, type CrmLeadFact, type Event, type LeadSettings, type Session, type SpendRow, type Webhook} from './logic.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const sql = postgres(env('SUPABASE_DB_URL'), {prepare: false, max: Number(env('FUNIS_DB_POOL')) || 4, idle_timeout: 20});
const ACCESS_CODE = env('FUNIS_ACCESS_CODE');
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = 'funis';
// App de Restaurantes (Raio-X do iFood no funil). Aberto hoje; se passar a pedir código, use o segredo RESTAURANTES_ACCESS_CODE.
const RS_API = env('RESTAURANTES_API') || 'https://kxabfippeekyxpcgjytx.supabase.co/functions/v1/restaurantes-api';
const RS_KEY = env('RESTAURANTES_ACCESS_CODE');
const SELF_URL = SUPABASE_URL + '/functions/v1/funis-api';
// Central Comercial (CRM). O código de acesso dela fica em fn_config (k = 'crm'), guardado pelo editor.
const CRM_API = env('CRM_API') || 'https://wndgqvkeguampmtmkmhq.supabase.co/functions/v1/crm-api';

class HttpError extends Error { constructor(public status: number, message: string){ super(message) } }
const bad = (message: string, status = 400) => new HttpError(status, message);
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
const CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-fn-key, x-crm-key, authorization, apikey', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '86400'};
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {status, headers: {...CORS, 'content-type': 'application/json; charset=utf-8'}});
const json = (v: unknown) => (sql as any).json(v);
// deno-lint-ignore no-explicit-any
const waitUntil = (p: Promise<unknown>) => { try { (globalThis as any).EdgeRuntime?.waitUntil(p) } catch { /* fora do Supabase: só deixa rodar */ } };

type Row = Record<string, any>;

/* ---------- código de acesso do editor ---------- */
let codeCache: {at: number; v: {salt: string; hash: string} | null} = {at: 0, v: null};
async function storedCode(){
  if (Date.now() - codeCache.at < 30e3) return codeCache.v;
  const [r] = await sql`select v from fn_config where k = 'access'`;
  codeCache = {at: Date.now(), v: r && r.v && r.v.hash ? r.v : null};
  return codeCache.v;
}
async function accessOk(key: string){
  if (ACCESS_CODE) return sameKey(key, ACCESS_CODE);
  const c = await storedCode();
  if (!c) return true;
  return !!key && sameKey(await sha256(c.salt + ':' + key), c.hash);
}
async function setCode(code: string){
  const salt = crypto.randomUUID().replace(/-/g, '');
  await sql`insert into fn_config (k, v) values ('access', ${json({salt, hash: await sha256(salt + ':' + code), at: new Date().toISOString()})})
    on conflict (k) do update set v = excluded.v, updated_at = now()`;
  codeCache = {at: 0, v: null};
}
/* ---------- tentativas erradas do código (bloqueio) ---------- */
// 10 erros do mesmo IP em 15 min: aquele IP fica 15 min sem poder entrar (nem com o código certo).
// 100 erros somados na última hora, de qualquer IP: o editor fica bloqueado para todos até a conta baixar.
// Acertar o código zera o IP. Os erros ficam na tabela fn_auth_fails.
const IP_FAILS = 10, IP_WINDOW = 15, IP_LOCK = 15, ALL_FAILS = 100;
const clientIp = (req: Request) => ((req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '?').slice(0, 64);
async function authState(ip: string){
  const [r] = await sql`
    select (select fails from fn_auth_fails where ip = ${ip}) as fails,
           (select ceil(extract(epoch from locked_until - now()) / 60)::int from fn_auth_fails where ip = ${ip} and locked_until > now()) as wait,
           (select coalesce(sum(fails), 0)::int from fn_auth_fails where window_start > now() - interval '1 hour') as total`;
  return {fails: Number(r.fails) || 0, wait: Number(r.wait) || 0, total: Number(r.total) || 0};
}
async function authFailed(ip: string){
  await sql`
    insert into fn_auth_fails as a (ip, fails, window_start) values (${ip}, 1, now())
    on conflict (ip) do update set
      fails = case when a.window_start < now() - make_interval(mins => ${IP_WINDOW}) then 1 else a.fails + 1 end,
      window_start = case when a.window_start < now() - make_interval(mins => ${IP_WINDOW}) then now() else a.window_start end,
      locked_until = case when (case when a.window_start < now() - make_interval(mins => ${IP_WINDOW}) then 1 else a.fails + 1 end) >= ${IP_FAILS}
                          then now() + make_interval(mins => ${IP_LOCK}) else a.locked_until end`;
}
// Apagar exige repetir o endereço do funil (proteção contra chamada por engano).
function confirmSlug(f: Row, b: Row){ if (String(b.confirm || '') !== f.slug) throw bad('Para apagar, confirme com o endereço do funil.') }

async function funnelById(id: string){
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw bad('Funil não encontrado.', 404);
  const [f] = await sql`select * from fn_funnels where id = ${id}`;
  if (!f) throw bad('Funil não encontrado.', 404);
  return f;
}
const editorView = (f: Row) => ({id: f.id, slug: f.slug, title: f.title, draft: f.draft, published: f.published, published_at: f.published_at, webhook: webhookForEditor(f.webhook), created_at: f.created_at, updated_at: f.updated_at});
async function freeSlug(base: string, except?: string){
  let s = SLUG_RE.test(base) ? base : slugify(base), n = 2;
  const root = s;
  for (;;) {
    const [hit] = except ? await sql`select 1 from fn_funnels where slug = ${s} and id <> ${except}` : await sql`select 1 from fn_funnels where slug = ${s}`;
    if (!hit) return s;
    s = `${root.slice(0, 55)}-${n++}`;
  }
}
const sessionCols = sql(['id', 'created_at', 'updated_at', 'tracking', 'params', 'answers', 'clicks', 'steps', 'last_step', 'interacted', 'completed', 'webhook', 'timeline', 'phone', 'email', 'crm', 'sent']);
const iso = (d: unknown) => d ? new Date(d as string).toISOString() : undefined;
const asSession = (r: Row) => ({...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at)}) as Session;
const leadsOf = (fun: Row | null | undefined) => ((fun && fun.settings && fun.settings.leads) || null) as LeadSettings | null;
const stepTitle = (fun: Row | null | undefined, id: string | null | undefined) => ((fun && fun.steps || []).find((s: Row) => s.id === id) || {}).title || '';
function layerById(fun: Row | null | undefined, id: string){ for (const st of (fun && fun.steps) || []) for (const l of st.layers || []) if (l.id === id) return l; return null }

/* ---------- webhook ---------- */
async function sendWebhook(w: Webhook, payload: Record<string, unknown>){
  const {body, type} = encodeBody(payload, w.contentType);
  const headers: Record<string, string> = {'content-type': type, 'user-agent': 'Brase-Funis/1'};
  // Como no InLead: o token vai em Authorization (Bearer) e em Api-Token.
  if (w.token) { headers.authorization = 'Bearer ' + w.token; headers['api-token'] = w.token }
  try {
    const r = await fetch(String(w.url), {method: w.method || 'POST', headers, body, signal: AbortSignal.timeout(15000)});
    const text = (await r.text()).slice(0, 4000);
    return {ok: r.ok, status: r.status, body: text, error: r.ok ? null : text.slice(0, 300) || 'HTTP ' + r.status};
  } catch (e) { return {ok: false, status: 0, body: '', error: errText(e)} }
}
// kind: 'lead' (envio normal) ou 'abandono' (deixou o WhatsApp e não enviou).
async function deliver(f: Row, s: Session, kind = 'lead'){
  const ls = leadsOf(f.published || f.draft);
  // Repetidos: o mesmo telefone já enviado nos últimos N dias não vai de novo.
  const days = Number(ls && ls.dedupeDays) || 0;
  if (days > 0 && s.phone) {
    const [dup] = await sql`select id from fn_sessions where funnel_id = ${f.id} and phone = ${s.phone} and id <> ${s.id} and (webhook ->> 'ok') = 'true' and created_at > now() - make_interval(days => ${days}) limit 1`;
    if (dup) {
      const mark = {at: new Date().toISOString(), ok: false, skipped: 'repetido', kind, same: dup.id, phone: s.phone || null};
      await sql`update fn_sessions set webhook = ${json(mark)} where funnel_id = ${f.id} and id = ${s.id}`;
      return {ok: false, status: 0, body: '', error: 'Telefone repetido (já enviado no lead ' + dup.id + ').', skipped: true};
    }
  }
  const extra = payloadExtras(s, ls, kind, kind === 'abandono' ? stepTitle(f.published || f.draft, s.last_step) : '');
  const r = await sendWebhook(f.webhook, buildPayload(f.slug, s, f.webhook, extra));
  // phone: com qual WhatsApp foi (outro número no mesmo visitante vai de novo); resp: o começo da resposta do CRM, para saber o que ele fez.
  const mark = {at: new Date().toISOString(), ok: r.ok, status: r.status, error: r.error, kind, phone: s.phone || null, resp: String(r.body || '').slice(0, 300)};
  await sql`update fn_sessions set webhook = ${json(mark)} where funnel_id = ${f.id} and id = ${s.id}`;
  if (!r.ok) console.error('webhook falhou', f.slug, s.id, r.status, r.error);
  return r;
}

/* ---------- API de Conversões da Meta ---------- */
// Manda os eventos ainda não mandados (o event_id é o mesmo do Pixel do navegador, então a Meta não conta duas vezes).
async function capiSend(f: Row, s: Session, list: {name: string; id: string; value?: number; currency?: string; custom?: Record<string, unknown>}[], record = true){
  const px = (f.published && f.published.settings && f.published.settings.pixel) || {};
  const token = f.secrets && f.secrets.capiToken, pixel = String(px.facebook || '').split(/[\s,;]+/).filter(Boolean)[0];
  if (!px.capi || !token || !pixel || !list.length) return;
  const sent = (s.sent || {}) as Record<string, unknown>;
  const todo = list.filter(e => !sent[e.id]);
  if (!todo.length) return;
  const data = await Promise.all(todo.map(e => capiEvent({...e, s})));
  const body: Record<string, unknown> = {data};
  if (f.secrets.capiTest) body.test_event_code = f.secrets.capiTest;
  let ok = false, status = 0, error = '';
  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixel}/events?access_token=${encodeURIComponent(token)}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)});
    ok = r.ok; status = r.status; if (!ok) error = (await r.text()).slice(0, 300); else await r.body?.cancel();
  } catch (e) { error = errText(e) }
  if (!ok) console.error('capi falhou', f.slug, s.id, status, error);
  if (record) {
    const mark: Record<string, unknown> = {};
    for (const e of todo) mark[e.id] = {at: new Date().toISOString(), ok, status, name: e.name};
    await sql`update fn_sessions set sent = coalesce(sent, '{}'::jsonb) || ${json(mark)} where funnel_id = ${f.id} and id = ${s.id}`;
  }
}

/* ---------- envio de quem abandonou o formulário ---------- */
// Roda no máximo uma vez por minuto por funil, a cada visita ou quando o editor abre os leads (sem agendador).
async function sweep(fid: string){
  try {
    const [f] = await sql`update fn_funnels set swept_at = now() where id = ${fid} and (swept_at is null or swept_at < now() - interval '1 minute') returning id, slug, published, draft, webhook, secrets`;
    if (!f) return;
    const ls = leadsOf(f.published);
    if (!ls || !ls.abandon || !ls.abandon.enabled || !f.webhook || !f.webhook.enabled || !f.webhook.url) return;
    const min = Math.max(5, Number(ls.abandon.minutes) || 15);
    const rows = await sql`
      select ${sessionCols} from fn_sessions
       where funnel_id = ${fid} and phone is not null and webhook is null
         and updated_at < now() - make_interval(mins => ${min}) and updated_at > now() - interval '3 days'
       order by updated_at limit 20`;
    for (const r of rows) await deliver(f, asSession(r), 'abandono');
  } catch (e) { console.error('sweep', fid, errText(e)) }
}

/* ---------- app de Restaurantes ---------- */
async function rsCall(op: string, body: Record<string, unknown>){
  const headers: Record<string, string> = {'content-type': 'application/json'};
  if (RS_KEY) headers['x-rs-key'] = RS_KEY;
  let r: Response;
  try { r = await fetch(RS_API, {method: 'POST', headers, body: JSON.stringify({op, ...body}), signal: AbortSignal.timeout(20000)}) }
  catch { throw bad('O Raio-X está indisponível agora. Tente de novo em instantes.', 502) }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw bad(j.error || 'Não consegui ler essa loja no iFood agora.', r.status === 404 ? 404 : 502);
  return j;
}
// Link curto (compartilhar do app) não tem o código: segue o redirecionamento para achar.
async function resolveMerchant(link: string){
  let id = merchantIdFrom(link);
  if (id || !/^https?:\/\/[^\s]*ifood/i.test(link.trim())) return id;
  try { const r = await fetch(link.trim(), {redirect: 'follow', signal: AbortSignal.timeout(8000)}); id = merchantIdFrom(r.url) || merchantIdFrom((await r.text()).slice(0, 200000)) } catch { /* sem código */ }
  return id;
}

/* ---------- operações públicas (página do funil) ---------- */
const PUBLIC: Record<string, (b: Row, req: Request) => Promise<unknown>> = {
  async 'public.funnel'(b){
    const slug = String(b.slug || '').toLowerCase();
    if (!SLUG_RE.test(slug)) throw bad('Funil não encontrado.', 404);
    const [f] = await sql`select id, slug, published from fn_funnels where slug = ${slug} and published is not null`;
    if (!f) throw bad('Funil não encontrado.', 404);
    return {funnel: {...f.published, slug: f.slug}};
  },
  async 'public.track'(b, req){
    const slug = String(b.slug || '').toLowerCase(), sid = String(b.session || '');
    if (!SLUG_RE.test(slug) || !SESSION_RE.test(sid)) throw bad('Dados inválidos.');
    if (isBotUA(req.headers.get('user-agent')) || isBotUA(b.tracking && b.tracking.userAgent)) return {ok: true};
    const events: Event[] = Array.isArray(b.events) ? b.events.slice(0, 60) : [];
    const [f] = await sql`select id, slug, published, webhook, secrets from fn_funnels where slug = ${slug} and published is not null`;
    if (!f) throw bad('Funil não encontrado.', 404);
    const [cur] = await sql`select ${sessionCols} from fn_sessions where funnel_id = ${f.id} and id = ${sid}`;
    let tracking = null, params = null;
    if (b.tracking && !cur) {
      tracking = sanitizeTracking(b.tracking);
      params = sanitizeParams(b.tracking.params);
      const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '';
      if (ip) tracking.ip = ip.slice(0, 64);
    }
    const prev = cur ? asSession(cur) : null;
    const next = mergeSession(prev, sid, events, tracking, f.published, params);
    next.created_at = prev ? prev.created_at : new Date().toISOString();
    await sql`
      insert into fn_sessions (funnel_id, id, tracking, params, answers, clicks, steps, last_step, interacted, completed, timeline, phone, email)
      values (${f.id}, ${sid}, ${json(next.tracking)}, ${json(next.params || {})}, ${json(next.answers)}, ${json(next.clicks)}, ${next.steps}, ${next.last_step}, ${next.interacted}, ${next.completed}, ${json(next.timeline || [])}, ${next.phone || null}, ${next.email || null})
      on conflict (funnel_id, id) do update set
        tracking = excluded.tracking, params = excluded.params, answers = excluded.answers, clicks = excluded.clicks, steps = excluded.steps,
        last_step = excluded.last_step, interacted = excluded.interacted, completed = excluded.completed,
        timeline = excluded.timeline, phone = excluded.phone, email = excluded.email, updated_at = now()`;
    // Eventos da API de Conversões: os de botão/opção configurados no editor e o "LeadQualificado" (regra de perfil).
    const capi: {name: string; id: string}[] = [];
    for (const e of events) {
      if (!e || !e.layer) continue;
      const L = layerById(f.published, String(e.layer)), c = (L && L.content) || {};
      if (e.type === 'click' && c.pixelEvent) capi.push({name: String(c.pixelEvent), id: `${sid}-${e.layer}`});
      if (e.type === 'answer' && e.answer && Array.isArray(e.answer.ids)) for (const oid of e.answer.ids) { const o = (c.options || []).find((x: Row) => x.id === oid); if (o && o.pixelEvent) capi.push({name: String(o.pixelEvent), id: `${sid}-${oid}`}) }
    }
    const px = (f.published.settings && f.published.settings.pixel) || {};
    // "Só quando…" (pixel.icpWhen): espera também essa condição, ex.: o lead no perfil clicar no botão do formulário.
    if (px.icpEvent !== false && leadMetrics(next, leadsOf(f.published)).icp && evalRoles(px.icpWhen, ruleVars(next), true)) capi.push({name: 'LeadQualificado', id: `${sid}-icp`});
    if (capi.length) waitUntil(capiSend(f, next, capi));
    waitUntil(sweep(f.id));
    if (webhookDue(f.webhook, prev, next, events)) {
      // Espera o envio (o navegador aguarda até 1,5 s antes de redirecionar); se demorar, termina em segundo plano.
      const job = deliver(f, next);
      waitUntil(job);
      await Promise.race([job, new Promise(r => setTimeout(r, 1200))]);
    }
    return {ok: true};
  },
};

PUBLIC['public.ifood'] = async (b) => {
  const slug = String(b.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) throw bad('Funil não encontrado.', 404);
  const [f] = await sql`select id from fn_funnels where slug = ${slug} and published is not null`;
  if (!f) throw bad('Funil não encontrado.', 404);
  const id = await resolveMerchant(String(b.link || '').slice(0, 500));
  if (!id) throw bad('Não achei sua loja nesse link. No iFood, abra a loja, toque em compartilhar e cole o link aqui.');
  const km = Math.min(10, Math.max(1, Number(b.km) || 3));
  const sum = ifoodSummary(await rsCall('detail', {id, km}), km);
  if (!sum) throw bad('Não consegui ler essa loja no iFood agora.', 502);
  return {ifood: sum};
};

/* ---------- operações da equipe (editor) ---------- */
async function integrations(f: Row){
  let sec = f.secrets || {};
  if (!sec.hookKey) { sec = {...sec, hookKey: crypto.randomUUID().replace(/-/g, '')}; await sql`update fn_funnels set secrets = ${json(sec)} where id = ${f.id}` }
  const hook = (h: string) => `${SELF_URL}?hook=${h}&id=${f.id}&key=${sec.hookKey}`;
  return {capiTokenSet: !!sec.capiToken, capiTest: sec.capiTest || '', adsTokenSet: !!sec.adsToken, adsAccount: sec.adsAccount || '', saleUrl: hook('sale'), crmUrl: hook('crm')};
}
const sinceOf = (b: Row) => periodStart(String(b.period || 'week'));
async function periodSessions(fid: string, since: Date){
  return (await sql`select ${sessionCols} from fn_sessions where funnel_id = ${fid} and created_at >= ${since} order by created_at desc limit 20000`).map(asSession);
}
async function upsertSpend(fid: string, rows: SpendRow[], source: string){
  const clean = rows.slice(0, 20000).map(r => {
    const s = (v: unknown, n = 200) => v == null ? '' : String(v).trim().slice(0, n);
    const row = {funnel_id: fid, day: s(r.day, 10), campaign_id: s(r.campaign_id, 40), campaign_name: s(r.campaign_name), adset_id: s(r.adset_id, 40), adset_name: s(r.adset_name), ad_id: s(r.ad_id, 40), ad_name: s(r.ad_name), spend: Number(r.spend) || 0, source, k: ''};
    row.k = row.ad_id || row.adset_id || row.campaign_id || row.ad_name || row.adset_name || row.campaign_name;
    return row;
  }).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && r.k);
  for (let i = 0; i < clean.length; i += 500) {
    const part = clean.slice(i, i + 500);
    await sql`insert into fn_spend ${sql(part, 'funnel_id', 'day', 'k', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'spend', 'source')}
      on conflict (funnel_id, day, k) do update set spend = excluded.spend, campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name,
        adset_id = excluded.adset_id, adset_name = excluded.adset_name, ad_id = excluded.ad_id, ad_name = excluded.ad_name, source = excluded.source`;
  }
  return clean.length;
}
/* ---------- Meta: gasto da conta por anúncio e por dia (fn_ad_spend), dividido entre os funis na leitura ---------- */
// Várias fontes (Graph API, Central Comercial, rotina com o MCP da Meta): cada número fica com o maior valor visto,
// porque o dia de hoje chega incompleto e só cresce até fechar.
async function upsertAdSpend(rows: AdSpendRow[], source: string){
  const s = (v: unknown, n = 200) => v == null ? '' : String(v).trim().slice(0, n);
  const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const uniq = new Map<string, Row>();
  for (const r of rows.slice(0, 20000)) {
    const row = {day: s(r.day, 10), ad_id: s(r.ad_id, 40), ad_name: s(r.ad_name), adset_id: s(r.adset_id, 40), adset_name: s(r.adset_name), campaign_id: s(r.campaign_id, 40), campaign_name: s(r.campaign_name),
      spend: Math.max(0, Math.round((Number(r.spend) || 0) * 100) / 100), impressions: n(r.impressions), clicks: n(r.clicks), link_clicks: n(r.link_clicks), lpv: n(r.lpv), meta_leads: n(r.meta_leads), source: s(source, 20)};
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.day) && /^\d{6,}$/.test(row.ad_id)) uniq.set(row.day + '|' + row.ad_id, row);
  }
  const clean = [...uniq.values()];
  for (let i = 0; i < clean.length; i += 500) {
    await sql`insert into fn_ad_spend ${sql(clean.slice(i, i + 500), 'day', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'spend', 'impressions', 'clicks', 'link_clicks', 'lpv', 'meta_leads', 'source')}
      on conflict (day, ad_id) do update set
        source = case when excluded.spend >= fn_ad_spend.spend then excluded.source else fn_ad_spend.source end,
        spend = greatest(fn_ad_spend.spend, excluded.spend), impressions = greatest(fn_ad_spend.impressions, excluded.impressions), clicks = greatest(fn_ad_spend.clicks, excluded.clicks),
        link_clicks = greatest(fn_ad_spend.link_clicks, excluded.link_clicks), lpv = greatest(fn_ad_spend.lpv, excluded.lpv), meta_leads = greatest(fn_ad_spend.meta_leads, excluded.meta_leads),
        ad_name = coalesce(nullif(excluded.ad_name, ''), fn_ad_spend.ad_name), adset_id = coalesce(nullif(excluded.adset_id, ''), fn_ad_spend.adset_id), adset_name = coalesce(nullif(excluded.adset_name, ''), fn_ad_spend.adset_name),
        campaign_id = coalesce(nullif(excluded.campaign_id, ''), fn_ad_spend.campaign_id), campaign_name = coalesce(nullif(excluded.campaign_name, ''), fn_ad_spend.campaign_name), updated_at = now()`;
  }
  return clean.length;
}
// Gasto de um funil: o importado por planilha (fn_spend) + o da conta (fn_ad_spend) dos anúncios que trazem visita para ele.
async function funnelSpend(fid: string, since: Date){
  const day = brDay(since.getTime() ? since : new Date('2000-01-01'));
  const [auto, firsts, manual] = await Promise.all([
    sql`select to_char(day, 'YYYY-MM-DD') as day, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, spend::float as spend, impressions, clicks, link_clicks, lpv, meta_leads from fn_ad_spend where day >= ${day}::date`,
    sql`select funnel_id::text as funnel_id, ad_id, to_char(min(created_at at time zone 'America/Sao_Paulo') + interval '12 hours', 'YYYY-MM-DD') as first_day,
               to_char(min(created_at at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as first_seen
          from (select funnel_id, created_at, substring(coalesce(nullif(params ->> 'utm_content', ''), tracking ->> 'utm_content') from '\\|\\s*(\\d{6,})\\s*$') as ad_id from fn_sessions) s
         where ad_id is not null group by 1, 2`,
    sql`select to_char(day, 'YYYY-MM-DD') as day, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend::float as spend from fn_spend where funnel_id = ${fid} and day >= ${day}::date`,
  ]);
  const mine = attributeSpend(auto as unknown as AdSpendRow[], firsts as unknown as {funnel_id: string; ad_id: string; first_day: string; first_seen: string}[], fid);
  const taken = new Set(manual.map(r => r.day + '|' + r.ad_id));
  return [...(manual as unknown as SpendRow[]), ...mine.filter(r => !taken.has(r.day + '|' + r.ad_id))];
}
async function metaStatus(){
  const [r] = await sql`select to_char(max(day), 'YYYY-MM-DD') as last_day, max(updated_at) as updated_at, count(*)::int as rows from fn_ad_spend`;
  return {lastDay: r.last_day, updatedAt: r.updated_at, rows: r.rows};
}
// Busca na Graph API com o token guardado num funil (Configurações › Pixel/Scripts) e grava na conta toda.
async function metaPull(token: string, account: string, since: string, until: string){
  const fields = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions';
  let url = `https://graph.facebook.com/${GRAPH_VERSION}/act_${account}/insights?level=ad&fields=${fields}&time_increment=1&limit=500&time_range=${encodeURIComponent(JSON.stringify({since, until}))}&access_token=${encodeURIComponent(token)}`;
  const rows: AdSpendRow[] = [];
  for (let page = 0; url && page < 40; page++) {
    const r = await fetch(url, {signal: AbortSignal.timeout(20000)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw bad('A Meta recusou: ' + ((j.error && j.error.message) || 'HTTP ' + r.status), 502);
    for (const x of j.data || []) {
      const act = (k: string) => Number(((x.actions || []).find((a: Row) => a.action_type === k) || {}).value) || 0;
      rows.push({day: x.date_start, campaign_id: x.campaign_id, campaign_name: x.campaign_name, adset_id: x.adset_id, adset_name: x.adset_name, ad_id: x.ad_id, ad_name: x.ad_name, spend: Number(x.spend) || 0,
        impressions: Number(x.impressions) || 0, clicks: Number(x.clicks) || 0, link_clicks: Number(x.inline_link_clicks) || 0, lpv: act('landing_page_view'), meta_leads: act('lead') || act('offsite_conversion.fb_pixel_lead')});
    }
    url = j.paging && j.paging.next;
  }
  return {rows: await upsertAdSpend(rows, 'api'), spend: Math.round(rows.reduce((t, x) => t + x.spend, 0) * 100) / 100};
}

/* ---------- Central Comercial: etapa, agendamento, reunião e venda de cada lead ---------- */
async function getConf(k: string){ const [r] = await sql`select v from fn_config where k = ${k}`; return (r && r.v) || {} }
const setConf = (k: string, v: unknown) => sql`insert into fn_config (k, v) values (${k}, ${json(v)}) on conflict (k) do update set v = excluded.v, updated_at = now()`;
// Liga cada lead da Central à visita: pelo código do visitante (o mesmo do webhook) ou, sem ele, pelo WhatsApp (a visita mais recente).
async function applyCrmLeads(leads: {code: string; phone: string; crm: CrmInfo}[]){
  if (!leads.length) return {matched: 0, changed: 0};
  const [r] = await sql`
    with x as (select * from jsonb_to_recordset(${json(leads)}) as x(code text, phone text, crm jsonb)),
    m as (
      select distinct on (x.code, x.phone) s.funnel_id, s.id, x.crm
        from x join fn_sessions s on (x.code <> '' and s.id = x.code) or (x.phone <> '' and s.phone = x.phone)
       order by x.code, x.phone, (x.code <> '' and s.id = x.code) desc, s.created_at desc),
    u as (update fn_sessions s set crm = m.crm from m where s.funnel_id = m.funnel_id and s.id = m.id and s.crm is distinct from m.crm returning s.id)
    select (select count(*) from m)::int as matched, (select count(*) from u)::int as changed`;
  return r as {matched: number; changed: number};
}
async function crmSync(){
  const conf = await getConf('crm');
  if (!conf.key) throw bad('Guarde o código de acesso da Central Comercial em Configurações › Integrações.');
  const t0 = Date.now();
  try {
    const r = await fetch(conf.url || CRM_API, {method: 'POST', headers: {'content-type': 'application/json', 'x-crm-key': conf.key}, body: JSON.stringify({op: 'load'}), signal: AbortSignal.timeout(40000)});
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw bad('A Central Comercial recusou o código de acesso. Guarde o código novo em Configurações › Integrações.', 502);
    if (!r.ok) throw bad('A Central Comercial não respondeu (' + (j.error || 'HTTP ' + r.status) + ').', 502);
    const docs = Array.isArray(j.docs) ? j.docs : [];
    const leads = crmLeadRows(docs), hit = await applyCrmLeads(leads);
    // Cópia enxuta de todos os leads (sem nome nem contato) para a visão da conta inteira; some quem saiu da Central.
    const facts = crmLeadFacts(docs);
    if (facts.length) {
      const started = new Date(t0);
      for (let i = 0; i < facts.length; i += 500) {
        await sql`insert into fn_crm_leads ${sql(facts.slice(i, i + 500) as unknown as Row[], 'id', 'created_at', 'source', 'utm_source', 'campaign_id', 'campaign_name', 'ad_id', 'ad_name', 'stage', 'booked_at', 'met_at', 'closed_at', 'value', 'code', 'owner')}
          on conflict (id) do update set created_at = excluded.created_at, source = excluded.source, utm_source = excluded.utm_source, campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name,
            ad_id = excluded.ad_id, ad_name = excluded.ad_name, stage = excluded.stage, booked_at = excluded.booked_at, met_at = excluded.met_at, closed_at = excluded.closed_at,
            value = excluded.value, code = excluded.code, owner = excluded.owner, synced_at = now()`;
      }
      await sql`delete from fn_crm_leads where synced_at < ${started}`;
    }
    const sp = docs.find((d: Row) => d && d.col === 'meta' && d.id === 'spend'), spendRows = crmSpendRows(sp && sp.data);
    const st = {ok: true, at: new Date().toISOString(), leads: leads.length, ...hit, spendRows: spendRows.length ? await upsertAdSpend(spendRows, 'crm') : 0, spendUpdatedAt: (sp && sp.data && sp.data.updatedAt) || null, ms: Date.now() - t0};
    await setConf('crm_sync', st);
    return st;
  } catch (e) {
    await setConf('crm_sync', {ok: false, at: new Date().toISOString(), error: errText(e)});
    throw e;
  }
}
// A cada 30 min (pg_cron): Central Comercial e, se algum funil tiver o token da Meta, os últimos 3 dias da conta.
async function cronSync(){
  const out: Row = {};
  try { out.crm = (await getConf('crm')).key ? await crmSync() : {skipped: true} } catch (e) { out.crm = {ok: false, error: errText(e)} }
  const accounts = new Map<string, string>();
  for (const f of await sql`select secrets from fn_funnels where secrets ->> 'adsToken' is not null and secrets ->> 'adsAccount' is not null`) accounts.set(f.secrets.adsAccount, f.secrets.adsToken);
  out.meta = [];
  for (const [account, token] of accounts) {
    try { out.meta.push({account, ...(await metaPull(token, account, brDay(Date.now() - 2 * 864e5), brDay(Date.now())))}) } catch (e) { out.meta.push({account, error: errText(e)}) }
  }
  return out;
}
// O gasto que a rotina da Meta manda também vai para a aba Tráfego da Central (documento meta/spend), trocando os dias da remessa.
async function crmPushSpend(rows: AdSpendRow[]){
  const conf = await getConf('crm');
  if (!conf.key) return {skipped: 'sem o código da Central'};
  const call = async (body: Row) => {
    const r = await fetch(conf.url || CRM_API, {method: 'POST', headers: {'content-type': 'application/json', 'x-crm-key': conf.key}, body: JSON.stringify(body), signal: AbortSignal.timeout(40000)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw bad('A Central Comercial respondeu ' + (j.error || 'HTTP ' + r.status), 502);
    return j;
  };
  try {
    const docs = (await call({op: 'load'})).docs || [], sp = docs.find((d: Row) => d && d.col === 'meta' && d.id === 'spend');
    const next = crmSpendDoc(sp && sp.data, rows, new Date().toISOString());
    if (!next) return {skipped: 'nenhuma linha com nome de anúncio'};
    await call({op: 'set', col: 'meta', id: 'spend', data: next.data});
    const st = {ok: true, at: next.data.updatedAt, since: next.since, until: next.until, rows: next.rows, spend: next.spend};
    await setConf('crm_spend', st);
    return st;
  } catch (e) {
    const st = {ok: false, at: new Date().toISOString(), error: errText(e)};
    await setConf('crm_spend', st);
    return st;
  }
}
// Operações de máquina (cron e a rotina diária da Meta): cabeçalho x-fn-cron com a chave guardada em fn_config (k = 'cron').
const MACHINE: Record<string, (b: Row) => Promise<unknown>> = {
  async 'cron.sync'(){ return await cronSync() },
  async 'cron.spend'(b){
    const rows = Array.isArray(b.rows) ? b.rows : [];
    return {rows: await upsertAdSpend(rows, /^[a-z-]{2,20}$/.test(String(b.source)) ? String(b.source) : 'meta'), meta: await metaStatus(), crm: await crmPushSpend(rows)};
  },
};
// Botão "Atualizar investimento" da Central: dispara a rotina da Meta (tarefa agendada do Claude com o conector da Meta)
// pelo gatilho de API dela. O endereço e o token do gatilho ficam em fn_config (k = 'crm_refresh') e nunca voltam para a página.
const FIRE_RE = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]{10,40}\/fire$/;
const REFRESH_GAP = 5 * 60e3;
async function refreshStatus(){
  const c = await getConf('crm_refresh'), push = await getConf('crm_spend');
  return {configured: !!(c.url && c.token), last: c.last || null, push: push.at ? push : null};
}
const CRM_OPS: Record<string, (b: Row) => Promise<unknown>> = {
  async 'crm.refresh.status'(){ return await refreshStatus() },
  async 'crm.refresh'(){
    const c = await getConf('crm_refresh');
    if (!c.url || !c.token) throw bad('O botão ainda não foi ligado: guarde o endereço e o token da rotina em Configurações › Meta.', 409);
    const push = await getConf('crm_spend'), last = c.last || null;
    if (last && Date.now() - Date.parse(last.at) < REFRESH_GAP && !(push.at && push.at > last.at)) return {started: false, running: true, last};
    const r = await fetch(c.url, {method: 'POST', signal: AbortSignal.timeout(20000), headers: {authorization: 'Bearer ' + c.token, 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
      body: JSON.stringify({text: 'Pedido pelo botão "Atualizar investimento" da Central Comercial.'})});
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw bad('O Claude recusou o token da rotina. Gere um token novo na rotina e guarde em Configurações › Meta.', 502);
    if (r.status === 429) throw bad('A rotina já foi disparada muitas vezes nesta hora. Tente de novo mais tarde.', 429);
    if (!r.ok) throw bad('O Claude não aceitou o pedido (' + ((j.error && j.error.message) || 'HTTP ' + r.status) + ').', 502);
    const now = {at: new Date().toISOString(), url: /^https:\/\/claude\.ai\//.test(String(j.claude_code_session_url)) ? j.claude_code_session_url : ''};
    await setConf('crm_refresh', {...c, last: now});
    return {started: true, last: now};
  },
  async 'crm.refresh.config'(b){
    const c = await getConf('crm_refresh');
    if (b.clear) { await setConf('crm_refresh', {last: c.last || null}); return await refreshStatus() }
    const url = String(b.url || '').trim(), token = String(b.token || '').trim();
    if (!FIRE_RE.test(url)) throw bad('O endereço precisa ser o "Fire URL" da rotina (https://api.anthropic.com/v1/claude_code/routines/trig_…/fire).');
    if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(token)) throw bad('O token precisa ser o que a rotina mostrou ao gerar (começa com sk-ant-).');
    await setConf('crm_refresh', {url, token, last: c.last || null});
    return await refreshStatus();
  },
};
async function crmKeyOk(req: Request){
  const k = req.headers.get('x-crm-key') || '';
  if (k.length < 3) return false;
  const c = await getConf('crm');
  return !!c.key && sameKey(k, c.key);
}
async function machineOk(req: Request){
  const k = req.headers.get('x-fn-cron') || '';
  if (k.length < 20) return false;
  const c = await getConf('cron');
  return !!c.key && sameKey(k, c.key);
}

async function applyCrm(fid: string, body: unknown){
  let matched = 0;
  for (const x of parseCrm(body)) {
    const r = await sql`
      update fn_sessions set crm = ${json({stage: x.stage, value: x.value || undefined, at: new Date().toISOString()})}
       where funnel_id = ${fid} and id = (select id from fn_sessions where funnel_id = ${fid} and (${x.code} <> '' and id = ${x.code} or ${x.phone} <> '' and phone = ${x.phone}) order by created_at desc limit 1)
      returning id`;
    matched += r.length;
  }
  return matched;
}
const ops: Record<string, (b: Row) => Promise<unknown>> = {
  async ping(){ return {ok: true} },
  async 'funnels.list'(){
    const rows = await sql`
      select f.id, f.slug, f.title, f.updated_at, f.published_at,
             jsonb_array_length(coalesce(f.draft -> 'steps', '[]'::jsonb)) as steps,
             jsonb_build_object('steps', case when jsonb_array_length(coalesce(f.draft -> 'steps', '[]'::jsonb)) > 0 then jsonb_build_array(f.draft -> 'steps' -> 0) else '[]'::jsonb end,
                                'design', f.draft -> 'design') as draft,
             coalesce(s.visits, 0)::int as visits, coalesce(s.leads, 0)::int as leads, coalesce(s.complete, 0)::int as complete
        from fn_funnels f
        left join (select funnel_id, count(*) as visits, count(*) filter (where interacted) as leads, count(*) filter (where completed) as complete
                     from fn_sessions group by funnel_id) s on s.funnel_id = f.id
       order by f.updated_at desc`;
    return {funnels: rows.map(r => ({...r, stats: {visits: r.visits, leads: r.leads, complete: r.complete}}))};
  },
  async 'funnels.get'(b){ return {funnel: editorView(await funnelById(b.id))} },
  async 'funnels.create'(b){
    const title = String(b.title || 'Novo funil').slice(0, 200);
    const slug = await freeSlug(String(b.slug || slugify(title)));
    if (!b.draft || !Array.isArray(b.draft.steps)) throw bad('Funil sem etapas.');
    const webhook = b.webhook ? mergeWebhook(null, b.webhook) : {};
    const [f] = await sql`
      insert into fn_funnels (slug, title, draft, published, published_at, webhook)
      values (${slug}, ${title}, ${json(b.draft)}, ${b.published ? json(b.published) : null}, ${b.published ? new Date() : null}, ${json(webhook)})
      returning *`;
    return {funnel: editorView(f)};
  },
  async 'funnels.save'(b){
    await funnelById(b.id);
    const slug = b.slug != null ? String(b.slug) : null;
    if (slug != null && !SLUG_RE.test(slug)) throw bad('Endereço inválido: use letras minúsculas, números e hífen.');
    if (slug != null) { const [dup] = await sql`select 1 from fn_funnels where slug = ${slug} and id <> ${b.id}`; if (dup) throw bad('Já existe um funil com esse endereço.') }
    if (b.draft && !Array.isArray(b.draft.steps)) throw bad('Funil sem etapas.');
    const base = b.base ? new Date(b.base) : null;
    const rows = await sql`
      update fn_funnels set
        title = coalesce(${b.title != null ? String(b.title).slice(0, 200) : null}, title),
        slug = coalesce(${slug}, slug),
        draft = coalesce(${b.draft ? json(b.draft) : null}::jsonb, draft),
        updated_at = date_trunc('milliseconds', clock_timestamp())
      where id = ${b.id} and (${base}::timestamptz is null or date_trunc('milliseconds', updated_at) = ${base}::timestamptz)
      returning updated_at, slug`;
    if (!rows.length) throw bad('Outra pessoa salvou este funil enquanto você editava.', 409);
    return {updated_at: rows[0].updated_at, slug: rows[0].slug};
  },
  async 'funnels.publish'(b){
    await funnelById(b.id);
    const [r] = await sql`update fn_funnels set published = draft, published_at = now() where id = ${b.id} returning published_at`;
    return {published_at: r.published_at};
  },
  async 'funnels.unpublish'(b){ await funnelById(b.id); await sql`update fn_funnels set published = null, published_at = null where id = ${b.id}`; return {ok: true} },
  async 'funnels.delete'(b){ const f = await funnelById(b.id); confirmSlug(f, b); await sql`delete from fn_funnels where id = ${b.id}`; return {ok: true} },
  async 'webhook.save'(b){
    const f = await funnelById(b.id);
    let w; try { w = mergeWebhook(f.webhook, b.webhook || {}) } catch (e) { throw bad(errText(e)) }
    await sql`update fn_funnels set webhook = ${json(w)} where id = ${b.id}`;
    return {webhook: webhookForEditor(w)};
  },
  async 'webhook.test'(b){
    const f = await funnelById(b.id);
    if (!f.webhook || !f.webhook.url) throw bad('Preencha e salve o endereço do webhook primeiro.');
    const payload = buildPayload(f.slug, sampleSession(f.published || f.draft), f.webhook);
    return {...(await sendWebhook(f.webhook, payload)), sent: payload};
  },
  async 'webhook.resend'(b){
    const f = await funnelById(b.id);
    if (!f.webhook || !f.webhook.url) throw bad('O webhook não está configurado.');
    const [s] = await sql`select ${sessionCols} from fn_sessions where funnel_id = ${b.id} and id = ${String(b.session || '')}`;
    if (!s) throw bad('Lead não encontrado.', 404);
    return await deliver(f, asSession(s));
  },
  async 'leads.list'(b){
    await funnelById(b.id);
    const since = periodStart(String(b.period || 'week'));
    const limit = Math.min(1000, Math.max(1, Number(b.limit) || 100)), offset = Math.max(0, Number(b.offset) || 0);
    const old = b.order === 'old';
    const leads = old
      ? await sql`select ${sessionCols} from fn_sessions where funnel_id = ${b.id} and created_at >= ${since} order by created_at asc limit ${limit} offset ${offset}`
      : await sql`select ${sessionCols} from fn_sessions where funnel_id = ${b.id} and created_at >= ${since} order by created_at desc limit ${limit} offset ${offset}`;
    const [c] = await sql`select count(*)::int as n from fn_sessions where funnel_id = ${b.id} and created_at >= ${since}`;
    const ids = leads.map((l: Row) => l.id);
    const sales = ids.length ? await sql`select session_id, status, value::float as value, product, created_at from fn_sales where funnel_id = ${b.id} and session_id = any(${ids})` : [];
    waitUntil(sweep(b.id));
    return {leads, total: c.n, sales};
  },
  async 'leads.stats'(b){
    const f = await funnelById(b.id);
    const total = ((f.published || f.draft || {}).steps || []).length;
    const [r] = await sql`select fn_stats(${b.id}, ${periodStart(String(b.period || 'week'))}, ${total}) as s`;
    return r.s;
  },
  async 'integrations.get'(b){ return integrations(await funnelById(b.id)) },
  async 'integrations.save'(b){
    const f = await funnelById(b.id), sec = {...(f.secrets || {})}, inc = b.integrations || {};
    if (typeof inc.capiToken === 'string' && inc.capiToken.trim()) sec.capiToken = inc.capiToken.trim();
    if (inc.clearCapiToken) delete sec.capiToken;
    if (typeof inc.capiTest === 'string') sec.capiTest = inc.capiTest.trim().slice(0, 40);
    if (typeof inc.adsToken === 'string' && inc.adsToken.trim()) sec.adsToken = inc.adsToken.trim();
    if (inc.clearAdsToken) delete sec.adsToken;
    if (typeof inc.adsAccount === 'string') sec.adsAccount = inc.adsAccount.replace(/\D/g, '').slice(0, 30);
    if (inc.newHookKey) delete sec.hookKey;
    await sql`update fn_funnels set secrets = ${json(sec)} where id = ${b.id}`;
    return integrations({...f, secrets: sec});
  },
  async 'leads.ads'(b){
    const f = await funnelById(b.id), since = sinceOf(b);
    waitUntil(sweep(f.id));
    const [sessions, sales, spend] = await Promise.all([
      periodSessions(f.id, since),
      sql`select session_id, status, value::float as value from fn_sales where funnel_id = ${f.id} and created_at >= ${since}`,
      funnelSpend(f.id, since),
    ]);
    const settings = (b.settings || leadsOf(f.draft) || leadsOf(f.published)) as LeadSettings;
    return aggregateAds(sessions, {level: String(b.level || 'ad'), settings, submitNames: String((f.webhook && f.webhook.component) || '').split(',').map(x => x.trim()), sales: sales as unknown as {session_id: string; status: string; value: number}[], spend});
  },
  // Ponta a ponta: Meta (gasto, impressões, cliques) → funil (visitas, envios) → Central Comercial (agendou, fez reunião, fechou).
  async 'leads.e2e'(b){
    const f = await funnelById(b.id), since = sinceOf(b), day = brDay(since.getTime() ? since : new Date('2000-01-01'));
    waitUntil(sweep(f.id));
    const [meta, conf, crm, [acc]] = await Promise.all([metaStatus(), getConf('crm'), getConf('crm_sync'),
      sql`select coalesce(sum(spend), 0)::float as spend from fn_ad_spend where day >= ${day}::date`]);
    const sources = {meta: {...meta, accountSpend: Math.round(acc.spend * 100) / 100}, crm: {configured: !!conf.key, ...crm}};
    // Conta inteira: todos os funis, todo o gasto da Meta e os leads da Central pela data em que entraram lá.
    if (b.scope === 'account') {
      const [sessions, sales, spend, leads, hooks] = await Promise.all([
        sql`select ${sessionCols} from fn_sessions where created_at >= ${since} order by created_at desc limit 50000`.then(r => r.map(asSession)),
        sql`select session_id, status, value::float as value from fn_sales where created_at >= ${since}`,
        sql`select to_char(day, 'YYYY-MM-DD') as day, ad_id, spend::float as spend, impressions, clicks, link_clicks, lpv, meta_leads from fn_ad_spend where day >= ${day}::date`,
        sql`select id, created_at, source, utm_source, campaign_id, campaign_name, ad_id, ad_name, stage, booked_at, met_at, closed_at, value::float as value, code, owner from fn_crm_leads where created_at >= ${since}`,
        sql`select webhook ->> 'component' as c from fn_funnels`,
      ]);
      const submitNames = hooks.flatMap((h: Row) => String(h.c || '').split(',').map(x => x.trim())).filter(Boolean);
      const facts = leads.map((l: Row) => ({...l, created_at: iso(l.created_at) || null, booked_at: iso(l.booked_at) || null, met_at: iso(l.met_at) || null, closed_at: iso(l.closed_at) || null})) as unknown as CrmLeadFact[];
      return {scope: 'account', ...aggregateAccount(sessions, facts, spend as unknown as SpendRow[], {submitNames, sales: sales as unknown as {session_id: string; status: string; value: number}[]}), sources};
    }
    const [sessions, sales, spend, [fp]] = await Promise.all([
      periodSessions(f.id, since),
      sql`select session_id, status, value::float as value from fn_sales where funnel_id = ${f.id} and created_at >= ${since}`,
      funnelSpend(f.id, since),
      sql`select min(created_at) as at from fn_sessions where funnel_id = ${f.id} and coalesce(nullif(params ->> 'utm_content', ''), tracking ->> 'utm_content') ~ '\\|\\s*\\d{6,}\\s*$'`,
    ]);
    const settings = (b.settings || leadsOf(f.draft) || leadsOf(f.published)) as LeadSettings;
    const rep = aggregateE2E(sessions, spend, {settings, submitNames: String((f.webhook && f.webhook.component) || '').split(',').map(x => x.trim()), sales: sales as unknown as {session_id: string; status: string; value: number}[]});
    return {scope: 'funnel', ...rep, firstPaid: fp && fp.at ? brDay(fp.at) : null, sources};
  },
  async 'crm.config'(b){
    let conf = await getConf('crm');
    if (b.clear) conf = {};
    else if (typeof b.key === 'string' && b.key.trim()) conf = {...conf, key: b.key.trim().slice(0, 200)};
    if (typeof b.url === 'string' && /^https:\/\/[\w.-]+\//.test(b.url.trim())) conf = {...conf, url: b.url.trim().slice(0, 300)};
    if (b.clear || b.key || b.url) await setConf('crm', conf);
    return {configured: !!conf.key, url: conf.url || CRM_API, status: await getConf('crm_sync')};
  },
  async 'crm.sync'(){ return await crmSync() },
  async 'leads.paths'(b){
    const f = await funnelById(b.id);
    const sessions = (await sql`select id, steps, timeline, completed from fn_sessions where funnel_id = ${f.id} and created_at >= ${sinceOf(b)} limit 20000`) as unknown as Session[];
    return aggregatePaths(sessions, ((f.published || f.draft || {}).steps || []).map((s: Row) => ({id: s.id, title: s.title})));
  },
  async 'spend.import'(b){
    const f = await funnelById(b.id);
    if (b.replace) await sql`delete from fn_spend where funnel_id = ${f.id} and source = 'csv'`;
    return {rows: await upsertSpend(f.id, Array.isArray(b.rows) ? b.rows : [], 'csv')};
  },
  async 'spend.clear'(b){ const f = await funnelById(b.id); await sql`delete from fn_spend where funnel_id = ${f.id}`; return {ok: true} },
  async 'spend.sync'(b){
    const f = await funnelById(b.id), sec = f.secrets || {};
    if (!sec.adsToken || !sec.adsAccount) throw bad('Preencha o token e a conta de anúncios em Configurações › Pixel/Scripts.');
    const since = brDay(Math.max(Date.now() - 90 * 864e5, b.since ? new Date(b.since).getTime() : Date.now() - 30 * 864e5));
    const until = brDay(Date.now());
    return {...(await metaPull(sec.adsToken, sec.adsAccount, since, until)), since, until};
  },
  // Leads antigos (InLead): não sobrescreve quem já existe aqui.
  async 'leads.import'(b){
    const f = await funnelById(b.id), fun = f.published || f.draft;
    const rows = (Array.isArray(b.leads) ? b.leads.slice(0, 3000) : []).map((x: unknown) => importRow(x, fun)).filter(Boolean) as Session[];
    let added = 0;
    for (let i = 0; i < rows.length; i += 300) {
      const part = rows.slice(i, i + 300).map(s => ({...s, updated_at: s.created_at}));
      const r = await sql`
        insert into fn_sessions (funnel_id, id, created_at, updated_at, tracking, params, answers, clicks, steps, last_step, interacted, completed, webhook, phone, email)
        select ${f.id}, x.id, x.created_at, x.updated_at, coalesce(x.tracking, '{}'), coalesce(x.params, '{}'), coalesce(x.answers, '{}'), coalesce(x.clicks, '{}'),
               coalesce((select array_agg(v) from jsonb_array_elements_text(x.steps) v), '{}'), x.last_step, x.interacted, x.completed, x.webhook, x.phone, x.email
          from jsonb_to_recordset(${json(part)}) as x(id text, created_at timestamptz, updated_at timestamptz, tracking jsonb, params jsonb, answers jsonb, clicks jsonb,
               steps jsonb, last_step text, interacted boolean, completed boolean, webhook jsonb, phone text, email text)
        on conflict (funnel_id, id) do nothing returning id`;
      added += r.length;
    }
    return {received: Array.isArray(b.leads) ? b.leads.length : 0, valid: rows.length, added};
  },
  async 'crm.import'(b){ const f = await funnelById(b.id); return {matched: await applyCrm(f.id, Array.isArray(b.rows) ? b.rows : [])} },
  async 'leads.reset'(b){ const f = await funnelById(b.id); confirmSlug(f, b); await sql`delete from fn_sessions where funnel_id = ${b.id}`; return {ok: true} },
  // Troca o código de acesso (quem chega aqui já passou pelo código atual). Com o segredo FUNIS_ACCESS_CODE, vale o segredo.
  async 'access.change'(b){
    if (ACCESS_CODE) throw bad('O código está definido no Supabase (segredo FUNIS_ACCESS_CODE); troque por lá.');
    const code = String(b.code || '');
    if (code.length < 12) throw bad('Use pelo menos 12 caracteres.');
    await setCode(code);
    return {ok: true};
  },
  async upload(b){
    if (!SUPABASE_URL || !SERVICE_KEY) throw bad('Armazenamento indisponível.', 500);
    const type = String(b.type || '');
    if (!/^(image|audio|video)\//.test(type)) throw bad('Envie imagem, áudio ou vídeo.');
    const bytes = Uint8Array.from(atob(String(b.data || '')), c => c.charCodeAt(0));
    if (!bytes.length) throw bad('Arquivo vazio.');
    if (bytes.length > 15 * 1024 * 1024) throw bad('Arquivo maior que 15 MB.');
    const ext = (String(b.name || '').match(/\.([a-z0-9]{2,5})$/i) || [, type.split('/')[1] || 'bin'])[1].toLowerCase();
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID().slice(0, 8)}-${slugify(String(b.name || 'arquivo').replace(/\.[^.]+$/, '')).slice(0, 40)}.${ext}`;
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {method: 'POST', headers: {authorization: 'Bearer ' + SERVICE_KEY, apikey: SERVICE_KEY, 'content-type': type, 'x-upsert': 'true', 'cache-control': '31536000'}, body: bytes});
    if (!r.ok) throw bad('Falha ao guardar o arquivo: ' + (await r.text()).slice(0, 200), 502);
    return {url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`};
  },
};

/* ---------- webhooks que chegam: vendas do checkout e etapas do CRM ---------- */
// URL: …/funis-api?hook=sale|crm&id=<funil>&key=<chave>  (em Configurações › Integrações).
async function handleHook(hook: string, url: URL, text: string){
  const id = url.searchParams.get('id') || '', key = url.searchParams.get('key') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return reply(404, {error: 'Funil não encontrado.'});
  const [f] = await sql`select id, slug, published, webhook, secrets from fn_funnels where id = ${id}`;
  if (!f || !f.secrets || !f.secrets.hookKey || !sameKey(key, f.secrets.hookKey)) return reply(401, {error: 'Chave inválida.'});
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {} } catch { body = Object.fromEntries(new URLSearchParams(text)) }
  if (hook === 'crm') return reply(200, {ok: true, matched: await applyCrm(f.id, body)});
  if (hook !== 'sale') return reply(400, {error: 'Webhook desconhecido.'});
  if (!text) return reply(200, {ok: true});
  const sale = parseSale(body);
  const [hit] = sale.code ? await sql`select ${sessionCols} from fn_sessions where funnel_id = ${f.id} and id = ${sale.code}` : [];
  const [byContact] = hit ? [hit] : (sale.phone || sale.email) ? await sql`
    select ${sessionCols} from fn_sessions where funnel_id = ${f.id} and ((${sale.phone} <> '' and phone = ${sale.phone}) or (${sale.email} <> '' and email = ${sale.email}))
     order by created_at desc limit 1` : [];
  const s = byContact ? asSession(byContact) : null;
  const ins = await sql`
    insert into fn_sales (funnel_id, session_id, sale_id, event, status, value, currency, product, email, phone, utm, payload)
    values (${f.id}, ${s ? s.id : null}, ${sale.saleId || null}, ${sale.event.slice(0, 60)}, ${sale.status}, ${sale.value}, ${sale.currency}, ${sale.product}, ${sale.email || null}, ${sale.phone || null}, ${json(sale.utm)}, ${json(body)})
    on conflict (funnel_id, sale_id, status) do nothing returning id`;
  if (ins.length && sale.status === 'approved') {
    const who = s || {id: 'venda-' + (sale.saleId || ins[0].id), tracking: {}, params: {}, answers: {}, clicks: {}, steps: [], last_step: null, interacted: false, completed: false, phone: sale.phone, email: sale.email} as Session;
    waitUntil(capiSend(f, who, [{name: 'Purchase', id: 'venda-' + (sale.saleId || ins[0].id), value: sale.value, currency: sale.currency, custom: sale.product ? {content_name: sale.product} : undefined}], !!s));
  }
  return reply(200, {ok: true, matched: !!s, status: sale.status});
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: CORS});
  const url = new URL(req.url), hook = url.searchParams.get('hook');
  if (hook) { try { return await handleHook(hook, url, req.method === 'POST' ? await req.text() : '') } catch (e) { console.error('hook', hook, e); return reply(500, {error: 'Erro interno.'}) } }
  if (req.method !== 'POST') return reply(405, {error: 'Use POST.'});
  let body: Row = {};
  try { body = JSON.parse(await req.text() || '{}') } catch { return reply(400, {error: 'JSON inválido.'}) }
  const op = String(body.op || '');
  try {
    if (PUBLIC[op]) return reply(200, await PUBLIC[op](body, req));
    if (MACHINE[op]) return (await machineOk(req)) ? reply(200, await MACHINE[op](body)) : reply(401, {error: 'Chave inválida.'});
    const ip = clientIp(req), st = await authState(ip);
    if (st.wait > 0) return reply(429, {error: `Muitas tentativas com o código errado. Tente de novo em ${st.wait} min.`});
    if (st.total >= ALL_FAILS) return reply(429, {error: 'Muitas tentativas com o código errado no momento. Tente de novo mais tarde.'});
    if (CRM_OPS[op]) {
      if (!(await crmKeyOk(req))) { await authFailed(ip); await new Promise(r => setTimeout(r, 400)); return reply(401, {error: 'Código de acesso da Central inválido.'}) }
      if (st.fails) await sql`delete from fn_auth_fails where ip = ${ip}`;
      return reply(200, await CRM_OPS[op](body));
    }
    if (!(await accessOk(req.headers.get('x-fn-key') ?? ''))) { await authFailed(ip); await new Promise(r => setTimeout(r, 400)); return reply(401, {error: 'Código de acesso inválido.'}) }
    if (st.fails) await sql`delete from fn_auth_fails where ip = ${ip}`;
    const fn = ops[op];
    if (!fn) return reply(400, {error: 'Operação desconhecida.'});
    return reply(200, await fn(body));
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, {error: e.message});
    if ((e as {code?: string}).code === '23505') return reply(400, {error: 'Já existe um funil com esse endereço.'});
    console.error(op, e);
    return reply(500, {error: 'Erro interno: ' + errText(e)});
  }
});
