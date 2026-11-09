// funis-avisos — avisos automáticos nos grupos de WhatsApp da Brase, 24 h por dia, pelo canal Operacional do NicoChat
// (o número do Renan, conexão não oficial). Chamada pelo pg_cron a cada 2 min (op cron.avisos, cabeçalho x-fn-cron).
//   AVISOS - COMERCIAIS: horário sugerido na conversa do SDR (pelo SDR ou pelo lead) e reunião marcada/remarcada na Central.
//   AVISOS - OPERACIONAIS: grupos dos clientes ("BRASE - " e "DI "): sem resposta da Brase, sinal de risco e silêncio longo.
// Configuração em fn_config (k = 'avisos'); estado da última rodada em fn_config (k = 'avisos_state'); fila em fn_avisos
// (id = a chave do evento, então nada sai duas vezes); grupos dos clientes em fn_grupos. Segredos: NICOCHAT_OPS_KEY (canal
// Operacional, lê os grupos e envia) e NICOCHAT_API_KEY (canal do SDR, o mesmo da ponte cron.wa da funis-api).
// SUPABASE_DB_URL já vem do Supabase. Função separada da funis-api para publicar e mexer sem tocar nos funis públicos.
// deno-lint-ignore-file no-explicit-any
import postgres from 'npm:postgres@3.4.5';
import {avClientGroup, avGroupLabel, avGroupState, avHorarioText, avMeetingDue, avReuniaoText, avRiscoText, avSemRespostaText, avSilencioText, avTimeOffers, brIso, grpMsg, leadIndex, nicoTime, type GrpMsg} from './avisos.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const sql = postgres(env('SUPABASE_DB_URL'), {prepare: false, max: 2, idle_timeout: 20});
const NICO_API = (env('NICOCHAT_API') || 'https://app.nicochat.com/api').replace(/\/$/, '');
const SDR_KEY = env('NICOCHAT_API_KEY');
const OPS_KEY = env('NICOCHAT_OPS_KEY');
const CRM_API = env('CRM_API') || 'https://wndgqvkeguampmtmkmhq.supabase.co/functions/v1/crm-api';
const SEND_MAX = 8;        // avisos enviados por rodada; o resto vai na próxima
const READ_MAX = 15;       // grupos dos clientes relidos por rodada
const SDR_READ_MAX = 20;   // conversas do SDR relidas por rodada (só as que a ponte acabou de atualizar)
const SELLERS_TTL = 6 * 3600e3;
type Row = Record<string, any>;
type AvRow = {id: string; canal: 'comercial' | 'operacional'; tipo: string; texto: string};
const json = (v: unknown) => (sql as any).json(v);
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json; charset=utf-8'}});
const sameKey = (a: string, b: string) => { if (!a || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0 };
async function getConf(k: string): Promise<Row> { const [r] = await sql`select v from fn_config where k = ${k}`; return (r && r.v) || {} }
const setConf = (k: string, v: unknown) => sql`insert into fn_config (k, v) values (${k}, ${json(v)}) on conflict (k) do update set v = excluded.v, updated_at = now()`;

async function nico(key: string, path: string, params: Record<string, string | number>){
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`${NICO_API}/${path}?${qs}`, {headers: {authorization: 'Bearer ' + key, accept: 'application/json'}, signal: AbortSignal.timeout(20000)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('O NicoChat respondeu ' + r.status + (j && j.message ? ': ' + String(j.message).slice(0, 200) : ''));
  return j;
}
async function nicoSend(userNs: string, content: string){
  const r = await fetch(`${NICO_API}/subscriber/send-text`, {method: 'POST', headers: {authorization: 'Bearer ' + OPS_KEY, accept: 'application/json', 'content-type': 'application/json'},
    body: JSON.stringify({user_ns: userNs, content}), signal: AbortSignal.timeout(20000)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 'ok') throw new Error('Envio pelo NicoChat falhou (' + r.status + (j && j.message ? ': ' + String(j.message).slice(0, 200) : '') + ')');
}
// Central Comercial (crm-api): o código de acesso fica em fn_config (k = 'crm'), o mesmo que a funis-api usa.
async function crmCall(body: Row){
  const conf = await getConf('crm');
  if (!conf.key) throw new Error('Sem o código de acesso da Central Comercial (fn_config crm).');
  const r = await fetch(conf.url || CRM_API, {method: 'POST', headers: {'content-type': 'application/json', 'x-crm-key': conf.key}, body: JSON.stringify(body), signal: AbortSignal.timeout(40000)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('A Central Comercial respondeu ' + (j.error || 'HTTP ' + r.status));
  return j;
}
async function queue(rows: AvRow[]){
  if (!rows.length) return 0;
  const ins = await sql`insert into fn_avisos ${sql(rows as unknown as Row[], 'id', 'canal', 'tipo', 'texto')} on conflict (id) do nothing returning id`;
  return ins.length;
}
// Nomes da equipe da Central (para "SDR: Fulano" no aviso de reunião), guardados por 6 h.
async function sellersFrom(docs: Row[]){
  const map: Record<string, string> = {};
  for (const d of docs) if (d && d.col === 'sellers' && !d.deleted && d.data && d.data.name) map[String(d.id)] = String(d.data.name);
  await setConf('crm_sellers', {at: new Date().toISOString(), map});
  return map;
}
async function sellers(){
  const c = await getConf('crm_sellers');
  if (c.map && Date.now() - (Date.parse(c.at || '') || 0) < SELLERS_TTL) return c.map as Record<string, string>;
  return await sellersFrom((await crmCall({op: 'load'})).docs || []);
}

// 1. Horário sugerido: relê as conversas do SDR que a ponte (cron.wa) acabou de atualizar e procura mensagem com horário.
async function horarios(c: Row, prev: Row){
  if (c.com && c.com.horarios === false) return {skipped: 'desligado'};
  if (!SDR_KEY) return {skipped: 'sem o segredo NICOCHAT_API_KEY'};
  const flow = String((await getConf('wa')).flow || 'f302947');
  const cursor = prev.waCursor || c.since;
  const rows = await sql`select user_ns, phone_key, updated_at from fn_wa_contacts where flow_ns = ${flow} and updated_at > ${new Date(Date.parse(cursor))} order by updated_at limit ${SDR_READ_MAX}`;
  if (!rows.length) return {read: 0, cursor};
  const found: {phone: string; t: ReturnType<typeof avTimeOffers>[number]}[] = [];
  for (const r of rows) {
    const j = await nico(SDR_KEY, 'subscriber/chat-messages', {user_ns: String(r.user_ns), limit: 30});
    for (const t of avTimeOffers(Array.isArray(j.data) ? j.data : [])) if (t.ts * 1000 >= c.sinceMs) found.push({phone: String(r.phone_key || ''), t});
  }
  let queued = 0;
  const ids = found.map(x => 'horario:' + x.t.mid);
  const known = new Set((ids.length ? await sql`select id from fn_avisos where id = any(${ids})` : []).map((r: Row) => String(r.id)));
  const fresh = found.filter(x => !known.has('horario:' + x.t.mid));
  if (fresh.length) {
    const docs = (await crmCall({op: 'load'})).docs || [];
    await sellersFrom(docs);
    const idx = leadIndex(docs);
    queued = await queue(fresh.map(({phone, t}) => ({id: 'horario:' + t.mid, canal: 'comercial' as const, tipo: t.who === 'sdr' ? 'horario_sdr' : 'horario_lead',
      texto: avHorarioText(t, (idx.get(phone) || {data: null}).data, '')})));
  }
  return {read: rows.length, found: found.length, queued, cursor: new Date(rows[rows.length - 1].updated_at).toISOString()};
}
// 2. Reunião marcada ou remarcada: lê na Central só os documentos que mudaram (com folga de 12 min para esperar o horário).
async function reunioes(c: Row, prev: Row){
  if (c.com && c.com.reunioes === false) return {skipped: 'desligado'};
  const now = Date.now(), cursor = Date.parse(prev.crmCursor || '') || now;
  const since = new Date(Math.max(now - 864e5, Math.min(cursor, now - 12 * 60e3))).toISOString();
  const j = await crmCall({op: 'changes', since});
  const docs: Row[] = j.docs || [];
  if (docs.some(d => d && d.col === 'sellers')) await sellersFrom((await crmCall({op: 'load'})).docs || []);
  const leads = docs.filter(d => d && d.col === 'leads' && !d.deleted && d.data && d.data.stage === 'marcada' && d.data.bookedAt);
  let queued = 0;
  if (leads.length) {
    const sent = (await sql`select id from fn_avisos where id like any(${leads.map(d => `reuniao:${d.id}:%`)})`).map((r: Row) => String(r.id));
    const rows: AvRow[] = [];
    for (const d of leads) {
      const due = avMeetingDue(String(d.id), d.data, sent, c.sinceMs, now);
      if (due) rows.push({id: due.key, canal: 'comercial', tipo: 'reuniao_' + due.kind, texto: avReuniaoText(d.data, due.kind, await sellers())});
    }
    queued = await queue(rows);
  }
  return {docs: docs.length, marcadas: leads.length, queued, cursor: j.cursor || null};
}
// 3. Grupos dos clientes: relê os que tiveram mensagem nova, guarda as últimas 40 mensagens e avalia todos os grupos conhecidos.
async function grupos(c: Row){
  const flow = String(c.flow || 'f316913'), op = c.op || {}, now = Date.now();
  const waitMin = Number(op.semRespostaMin) || 120, quietDays = Number(op.silencioDias) || 5, minGroups = Number(op.equipeGrupos) || 4;
  const contacts: Row[] = [];
  for (let page = 1; page <= 5; page++) {
    const j = await nico(OPS_KEY, 'subscribers', {limit: 100, page, is_last_message_in_last_24h: 'yes'});
    contacts.push(...(Array.isArray(j.data) ? j.data : []));
    if (!j.meta || page >= Number(j.meta.last_page || 1)) break;
  }
  const groups = contacts.filter(x => avClientGroup(x.name));
  const ns = groups.map(x => String(x.user_ns));
  const known = new Map<string, Row>((ns.length ? await sql`select user_ns, last_message_at, facts from fn_grupos where user_ns = any(${ns})` : []).map((r: Row) => [String(r.user_ns), r]));
  const changed = groups.filter(x => { const at = nicoTime(x.last_message_at), k = known.get(String(x.user_ns)); return at > 0 && at > (k && k.last_message_at ? new Date(k.last_message_at).getTime() : 0) })
    .sort((a, b) => nicoTime(a.last_message_at) - nicoTime(b.last_message_at)).slice(0, READ_MAX);
  for (const x of changed) {
    const j = await nico(OPS_KEY, 'subscriber/chat-messages', {user_ns: String(x.user_ns), limit: 100});
    const msgs = (Array.isArray(j.data) ? j.data : []).map(grpMsg).filter(Boolean).sort((a: GrpMsg, b: GrpMsg) => a.ts - b.ts) as GrpMsg[];
    const old = (known.get(String(x.user_ns)) || {}).facts || {};
    const authors = [...new Set([...(old.authors || []), ...msgs.filter(m => !m.own && m.author).map(m => m.author)])].slice(-60);
    const facts = {name: avGroupLabel(x.name), msgs: msgs.slice(-40), authors, firstSeen: old.firstSeen || brIso(now)};
    await sql`insert into fn_grupos (user_ns, flow_ns, nome, last_message_at, facts, updated_at)
      values (${String(x.user_ns)}, ${flow}, ${facts.name}, ${new Date(nicoTime(x.last_message_at))}, ${json(facts)}, now())
      on conflict (user_ns) do update set nome = excluded.nome, last_message_at = excluded.last_message_at, facts = excluded.facts, updated_at = now()`;
  }
  // Equipe: a lista guardada + quem escreve em 4 ou mais grupos de clientes (dono com 3 lojas continua sendo cliente).
  const all = await sql`select user_ns, nome, facts from fn_grupos where flow_ns = ${flow}`;
  const count = new Map<string, number>();
  for (const r of all) for (const a of new Set<string>((r.facts && r.facts.authors) || [])) count.set(a, (count.get(a) || 0) + 1);
  const team = [...(c.team || []), ...[...count].filter(([, n]) => n >= minGroups).map(([a]) => a)], ignore = c.ignore || [];
  const rows: AvRow[] = [];
  for (const r of all) {
    const f = r.facts || {}, name = String(r.nome || f.name || 'Grupo'), st = avGroupState(f.msgs || [], team, ignore);
    if (st.waiting && st.waiting.ts * 1000 >= c.sinceMs && now - st.waiting.ts * 1000 >= waitMin * 60e3)
      rows.push({id: `semresp:${r.user_ns}:${st.waiting.mid}`, canal: 'operacional', tipo: 'sem_resposta', texto: avSemRespostaText(name, st.waiting, now - st.waiting.ts * 1000)});
    // Risco: no máximo um aviso por grupo a cada 6 h (a 1ª mensagem da janela).
    if (op.risco !== false) for (const m of st.risks) if (m.ts * 1000 >= c.sinceMs) rows.push({id: `risco:${r.user_ns}:${Math.floor(m.ts / 21600)}`, canal: 'operacional', tipo: 'risco', texto: avRiscoText(name, m)});
    const ref = st.lastBrase ? st.lastBrase * 1000 : Date.parse(f.firstSeen || '') || now;
    if (now - ref >= quietDays * 864e5) rows.push({id: `silencio:${r.user_ns}:${st.lastBrase || 'nunca'}`, canal: 'operacional', tipo: 'silencio', texto: avSilencioText(name, Math.floor((now - ref) / 864e5))});
  }
  return {contacts: contacts.length, groups: groups.length, read: changed.length, known: all.length, team: team.length, queued: await queue(rows)};
}
// Acha os grupos de aviso pelo nome ("AVISOS - COMERCIAIS" e "AVISOS - OPERACIONAIS") e guarda o id deles na configuração.
async function targets(c: Row){
  const g = {...(c.groups || {})};
  if (g.comercial && g.operacional) return g;
  const j = await nico(OPS_KEY, 'subscribers', {limit: 50, name: 'AVISOS'});
  for (const x of Array.isArray(j.data) ? j.data : []) {
    const n = String(x.name || '').toLowerCase();
    if (!/^g:/.test(n) || !n.includes('avisos')) continue;
    if (!g.comercial && n.includes('comerc')) g.comercial = String(x.user_ns);
    if (!g.operacional && n.includes('operac')) g.operacional = String(x.user_ns);
  }
  await sql`update fn_config set v = jsonb_set(v, '{groups}', ${json(g)}), updated_at = now() where k = 'avisos'`;
  return g;
}
async function send(groups: Row, mode: string){
  if (mode !== 'on') return {sent: 0, pending: Number((await sql`select count(*)::int as n from fn_avisos where sent_at is null and tries < 3`)[0].n)};
  const rows = await sql`select id, canal, texto from fn_avisos where sent_at is null and tries < 3 order by created_at, id limit ${SEND_MAX}`;
  let sent = 0, failed = 0;
  for (const r of rows) {
    const to = groups[r.canal];
    if (!to) { failed++; await sql`update fn_avisos set tries = tries + 1, erro = 'grupo de aviso não encontrado' where id = ${r.id}`; continue }
    try { await nicoSend(String(to), String(r.texto)); sent++; await sql`update fn_avisos set sent_at = now(), erro = null where id = ${r.id}` }
    catch (e) { failed++; await sql`update fn_avisos set tries = tries + 1, erro = ${errText(e).slice(0, 300)} where id = ${r.id}` }
  }
  return {sent, failed};
}
async function run(){
  const c = await getConf('avisos'), mode = c.mode === 'on' || c.mode === 'preview' ? String(c.mode) : 'off';
  if (mode === 'off') return {skipped: 'desligado'};
  const t0 = Date.now(), prev = await getConf('avisos_state');
  if (!OPS_KEY) {
    // Só os nomes dos segredos parecidos (nunca o valor), para achar nome digitado diferente.
    const parecidos = Object.keys(Deno.env.toObject()).filter(k => /nico|ops/i.test(k)).sort();
    const st = {ok: false, at: brIso(t0), mode, error: 'Falta o segredo NICOCHAT_OPS_KEY (chave da API do canal Operacional).', parecidos};
    await setConf('avisos_state', st); return st;
  }
  // 1ª rodada com a chave: grava o início. Nada antes dele vira aviso.
  if (!Date.parse(c.since || '')) { c.since = brIso(t0); await sql`update fn_config set v = jsonb_set(v, '{since}', ${json(c.since)}), updated_at = now() where k = 'avisos'` }
  c.sinceMs = Date.parse(c.since);
  const st: Row = {ok: true, at: brIso(t0), mode, since: c.since};
  const step = async (k: string, fn: () => Promise<Row>) => { try { st[k] = await fn() } catch (e) { st.ok = false; st[k] = {error: errText(e)} } };
  let groups: Row = c.groups || {};
  await step('alvos', async () => { groups = await targets(c); return {comercial: !!groups.comercial, operacional: !!groups.operacional} });
  await step('horarios', () => horarios(c, prev));
  await step('reunioes', () => reunioes(c, prev));
  await step('grupos', () => grupos(c));
  await step('envio', () => send(groups, mode));
  st.waCursor = (st.horarios && st.horarios.cursor) || prev.waCursor || null;
  st.crmCursor = (st.reunioes && st.reunioes.cursor) || prev.crmCursor || null;
  st.ms = Date.now() - t0;
  await setConf('avisos_state', st);
  return st;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return reply(405, {error: 'Use POST.'});
  const cron = await getConf('cron');
  if (!cron.key || !sameKey(req.headers.get('x-fn-cron') || '', String(cron.key))) return reply(401, {error: 'Chave inválida.'});
  let body: Row = {};
  try { body = JSON.parse(await req.text() || '{}') } catch { return reply(400, {error: 'JSON inválido.'}) }
  try {
    if (body.op === 'cron.avisos') return reply(200, await run());
    if (body.op === 'avisos.status') return reply(200, {conf: await getConf('avisos'), state: await getConf('avisos_state')});
    return reply(400, {error: 'Operação desconhecida.'});
  } catch (e) {
    console.error(body.op, e);
    return reply(500, {error: 'Erro interno: ' + errText(e)});
  }
});
