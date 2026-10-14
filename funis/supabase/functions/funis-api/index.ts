// funis-api — back-end do app Funis (funis/index.html e funis/f/index.html).
// Recebe POST {op, ...}. As operações "public.*" são da página do funil (sem código); as demais exigem
// o código da equipe no cabeçalho x-fn-key.
// Segredos: FUNIS_ACCESS_CODE (obrigatório). SUPABASE_DB_URL, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm do Supabase.
import postgres from 'npm:postgres@3.4.5';
import {SESSION_RE, SLUG_RE, buildPayload, encodeBody, mergeSession, mergeWebhook, periodStart, sameKey, sampleSession, sanitizeParams, sanitizeTracking, slugify, webhookDue, webhookForEditor, type Event, type Session, type Webhook} from './logic.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const sql = postgres(env('SUPABASE_DB_URL'), {prepare: false, max: 4, idle_timeout: 20});
const ACCESS_CODE = env('FUNIS_ACCESS_CODE');
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = 'funis';

class HttpError extends Error { constructor(public status: number, message: string){ super(message) } }
const bad = (message: string, status = 400) => new HttpError(status, message);
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
const CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-fn-key, authorization, apikey', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '86400'};
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {status, headers: {...CORS, 'content-type': 'application/json; charset=utf-8'}});
const json = (v: unknown) => (sql as any).json(v);
// deno-lint-ignore no-explicit-any
const waitUntil = (p: Promise<unknown>) => { try { (globalThis as any).EdgeRuntime?.waitUntil(p) } catch { /* fora do Supabase: só deixa rodar */ } };

type Row = Record<string, any>;
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
const sessionCols = sql(['id', 'created_at', 'updated_at', 'tracking', 'params', 'answers', 'clicks', 'steps', 'last_step', 'interacted', 'completed', 'webhook']);

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
async function deliver(f: Row, s: Session){
  const r = await sendWebhook(f.webhook, buildPayload(f.slug, s, f.webhook));
  const mark = {at: new Date().toISOString(), ok: r.ok, status: r.status, error: r.error};
  await sql`update fn_sessions set webhook = ${json(mark)} where funnel_id = ${f.id} and id = ${s.id}`;
  if (!r.ok) console.error('webhook falhou', f.slug, s.id, r.status, r.error);
  return r;
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
    const events: Event[] = Array.isArray(b.events) ? b.events.slice(0, 60) : [];
    const [f] = await sql`select id, slug, published, webhook from fn_funnels where slug = ${slug} and published is not null`;
    if (!f) throw bad('Funil não encontrado.', 404);
    const [cur] = await sql`select ${sessionCols} from fn_sessions where funnel_id = ${f.id} and id = ${sid}`;
    let tracking = null, params = null;
    if (b.tracking && !cur) {
      tracking = sanitizeTracking(b.tracking);
      params = sanitizeParams(b.tracking.params);
      const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '';
      if (ip) tracking.ip = ip.slice(0, 64);
    }
    const next = mergeSession((cur as Session) || null, sid, events, tracking, f.published, params);
    await sql`
      insert into fn_sessions (funnel_id, id, tracking, params, answers, clicks, steps, last_step, interacted, completed)
      values (${f.id}, ${sid}, ${json(next.tracking)}, ${json(next.params || {})}, ${json(next.answers)}, ${json(next.clicks)}, ${next.steps}, ${next.last_step}, ${next.interacted}, ${next.completed})
      on conflict (funnel_id, id) do update set
        tracking = excluded.tracking, params = excluded.params, answers = excluded.answers, clicks = excluded.clicks, steps = excluded.steps,
        last_step = excluded.last_step, interacted = excluded.interacted, completed = excluded.completed, updated_at = now()`;
    if (webhookDue(f.webhook, (cur as Session) || null, next, events)) {
      next.created_at = cur ? new Date(cur.created_at).toISOString() : new Date().toISOString();
      // Espera o envio (o navegador aguarda até 1,5 s antes de redirecionar); se demorar, termina em segundo plano.
      const job = deliver(f, next);
      waitUntil(job);
      await Promise.race([job, new Promise(r => setTimeout(r, 1200))]);
    }
    return {ok: true};
  },
};

/* ---------- operações da equipe (editor) ---------- */
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
  async 'funnels.delete'(b){ await funnelById(b.id); await sql`delete from fn_funnels where id = ${b.id}`; return {ok: true} },
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
    s.created_at = new Date(s.created_at).toISOString();
    return await deliver(f, s as Session);
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
    return {leads, total: c.n};
  },
  async 'leads.stats'(b){
    const f = await funnelById(b.id);
    const total = ((f.published || f.draft || {}).steps || []).length;
    const [r] = await sql`select fn_stats(${b.id}, ${periodStart(String(b.period || 'week'))}, ${total}) as s`;
    return r.s;
  },
  async 'leads.reset'(b){ await funnelById(b.id); await sql`delete from fn_sessions where funnel_id = ${b.id}`; return {ok: true} },
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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: CORS});
  if (req.method !== 'POST') return reply(405, {error: 'Use POST.'});
  let body: Row = {};
  try { body = JSON.parse(await req.text() || '{}') } catch { return reply(400, {error: 'JSON inválido.'}) }
  const op = String(body.op || '');
  try {
    if (PUBLIC[op]) return reply(200, await PUBLIC[op](body, req));
    if (!ACCESS_CODE) return reply(500, {error: 'Falta configurar o segredo FUNIS_ACCESS_CODE.'});
    if (!sameKey(req.headers.get('x-fn-key') ?? '', ACCESS_CODE)) return reply(401, {error: 'Código de acesso inválido.'});
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
