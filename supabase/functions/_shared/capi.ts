// API de Conversões da Meta (eventos de CRM): quando o lead muda de etapa, o evento entra numa fila (crm_capi_events)
// e é enviado ao conjunto de dados da Meta. Segredos: META_CAPI_TOKEN (token do conjunto de dados, gerado no Gerenciador de Eventos),
// opcionais META_CAPI_DATASET (padrão 1696577860982247) e META_CAPI_VERSION (padrão v26.0).
// Configuração no app: Configurações › Meta (documento config/main, campo "capi"): modo desligado / teste / ligado e quais etapas enviam.
import { getDoc, leadHooks, listDocs, sb, type Doc } from './crm.ts';
import { buildEvent, capiCfg, eventKey, eventTimeOf, MAX_AGE_DAYS, shouldEmit, type CapiCfg } from './capi_core.ts';

let TOKEN = Deno.env.get('META_CAPI_TOKEN') ?? '';
const DATASET = Deno.env.get('META_CAPI_DATASET') ?? '1696577860982247';
const VERSION = Deno.env.get('META_CAPI_VERSION') ?? 'v26.0';
let BASE = 'https://graph.facebook.com';
export const capiConfigured = () => !!TOKEN;
export const capiDataset = DATASET;
// O token nunca aparece em mensagem de erro, log nem resposta.
const clean = (s: unknown) => { const t = String(s ?? ''); return TOKEN ? t.split(TOKEN).join('***') : t; };

let CACHE: { at: number; cfg: CapiCfg } | null = null, PIN: CapiCfg | null = null;
export async function loadCfg(force = false): Promise<CapiCfg> {
  if (PIN) return PIN;
  if (!force && CACHE && Date.now() - CACHE.at < 45_000) return CACHE.cfg;
  const doc = await getDoc('config', 'main');
  CACHE = { at: Date.now(), cfg: capiCfg(doc?.capi) };
  return CACHE.cfg;
}
// Só para testes (função temporária de teste): troca token, endereço da Graph API e configuração.
export function _testSetup(o: { token?: string; base?: string; cfg?: unknown }) {
  if (o.token !== undefined) TOKEN = o.token;
  if (o.base) BASE = o.base;
  if (o.cfg !== undefined) PIN = capiCfg(o.cfg);
}

type Resp = { ok: boolean; status: number; body: Doc };
async function post(events: Doc[], testCode: string): Promise<Resp> {
  const body: Doc = { data: events };
  if (testCode) body.test_event_code = testCode;
  const r = await fetch(`${BASE}/${VERSION}/${DATASET}/events`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}
const errMsg = (r: Resp) => clean(r.body?.error?.error_user_msg || r.body?.error?.message || `HTTP ${r.status}`).slice(0, 300);
// Erros de acesso (token inválido/vencido, sem permissão, limite de chamadas): não é culpa do evento, então ele continua na fila.
const isAccess = (r: Resp) => [190, 102, 200, 10, 4, 17, 32, 613].includes(Number(r.body?.error?.code)) || r.status === 401 || r.status === 403 || r.status === 429;

type Row = { event_id: string; payload: Doc; test: boolean; attempts: number };
async function mark(ids: string[], patch: Doc) { if (ids.length) await sb.from('crm_capi_events').update(patch).in('event_id', ids); }

export async function counts() {
  const out: Record<string, number> = { pending: 0, sent: 0, error: 0 };
  for (const s of Object.keys(out)) {
    const { count } = await sb.from('crm_capi_events').select('event_id', { count: 'exact', head: true }).eq('status', s);
    out[s] = count ?? 0;
  }
  return out;
}

// Envia o que está na fila. Eventos de produção só saem com o modo "Ligado"; os de teste só com o modo "Teste" e o código de teste.
export async function flush(limit = 50): Promise<Doc> {
  if (!TOKEN) return { ...(await counts()), bloqueio: 'sem_token' };
  const cfg = await loadCfg(true);
  if (cfg.mode === 'off') return { ...(await counts()), bloqueio: 'desligado' };
  if (cfg.mode === 'on') await sb.from('crm_capi_events').update({ status: 'error', last_error: 'Era um evento de teste e o modo de teste terminou.' }).eq('status', 'pending').eq('test', true);
  const { data, error } = await sb.from('crm_capi_events').select('event_id,payload,test,attempts').eq('status', 'pending').eq('test', cfg.mode === 'test').lt('attempts', 5).order('event_time').limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const out: Doc = { sent: 0, failed: 0, access: null as string | null };
  if (cfg.mode === 'test' && !cfg.testCode) return { ...out, ...(await counts()), bloqueio: 'sem_codigo_de_teste' };
  const testCode = cfg.mode === 'test' ? cfg.testCode : '';
  const sendOne = async (batch: Row[]): Promise<void> => {
    const ids = batch.map(r => r.event_id);
    let r: Resp;
    try { r = await post(batch.map(x => x.payload), testCode); }
    catch (e) { out.access = clean((e as Error).message ?? e); await mark(ids, { last_error: String(out.access).slice(0, 300) }); return; }
    if (r.ok) {
      await mark(ids, { status: 'sent', sent_at: new Date().toISOString(), last_error: null, response: { events_received: r.body.events_received ?? null, fbtrace_id: r.body.fbtrace_id ?? null, messages: r.body.messages ?? [] } });
      out.sent = (out.sent as number) + batch.length; return;
    }
    const msg = errMsg(r);
    if (isAccess(r)) { out.access = msg; await mark(ids, { last_error: msg }); return; }
    if (batch.length > 1) { for (const one of batch) await sendOne([one]); return; } // um evento ruim não pode travar os outros
    const a = batch[0].attempts + 1;
    await sb.from('crm_capi_events').update({ attempts: a, last_error: msg, status: a >= 3 ? 'error' : 'pending', response: { error: r.body?.error ? { code: r.body.error.code, subcode: r.body.error.error_subcode, fbtrace_id: r.body.error.fbtrace_id } : null } }).eq('event_id', batch[0].event_id);
    out.failed = (out.failed as number) + 1;
  };
  for (let i = 0; i < rows.length; i += 25) await sendOne(rows.slice(i, i + 25));
  return { ...out, ...(await counts()) };
}

export async function enqueue(leadId: string, lead: Doc, e: { stage: string; name: string; time: number }, test: boolean) {
  const payload = await buildEvent(lead, leadId, e.stage, e.name, e.time);
  const { data, error } = await sb.from('crm_capi_events').upsert(
    { event_id: eventKey(leadId, e.name, test), lead_id: leadId, event_name: e.name, event_time: e.time, payload, test },
    { onConflict: 'event_id', ignoreDuplicates: true }).select('event_id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

// Chamado a cada gravação de lead (app, webhooks): só enfileira quando a etapa mudou ou o lead foi criado.
export async function onLeadWrite(id: string, before: Doc | null, after: Doc) {
  const cfg = await loadCfg(), e = shouldEmit(cfg, before, after);
  if (!e) return null;
  const test = cfg.mode === 'test';
  if (test && !cfg.testCode) return null; // sem código de teste nada sai (um evento de teste nunca pode ir como produção)
  const queued = await enqueue(id, after, e, test);
  if (queued && TOKEN) await flush(20);
  return queued;
}
const bg = (p: Promise<unknown>) => {
  const q = p.catch(e => console.error('capi:', clean((e as Error).message ?? e)));
  try { (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(q); } catch { /* sem waitUntil */ }
};
leadHooks.before = async id => (await loadCfg()).mode === 'off' ? undefined : await getDoc('leads', id);
leadHooks.after = (id, before, after) => bg(onLeadWrite(id, before, after));

// Leads recentes (até 7 dias, o limite da Meta): enfileira as etapas que cada um atingiu e envia.
export async function backfill(days = MAX_AGE_DAYS) {
  const cfg = await loadCfg(true), test = cfg.mode === 'test';
  if (cfg.mode === 'off') throw new Error('A integração está desligada. Escolha o modo Teste ou Ligado.');
  if (test && !cfg.testCode) throw new Error('No modo Teste, informe o código de teste do Gerenciador de Eventos.');
  const limit = Date.now() / 1000 - Math.min(days, MAX_AGE_DAYS) * 86400 + 600;
  let queued = 0, already = 0;
  for (const { id, data } of await listDocs('leads')) {
    if (data.example) continue;
    const stages = new Set<string>(((data.history as { s?: string }[] | undefined) ?? []).map(h => String(h.s ?? '')));
    if (data.stage) stages.add(String(data.stage));
    for (const stage of stages) {
      const sc = cfg.stages[stage]; if (!sc || !sc.on) continue;
      const hit = ((data.history as { s?: string }[] | undefined) ?? []).some(h => h.s === stage);
      if (!hit && stage !== data.stage) continue;
      const time = eventTimeOf(data, stage);
      if (time < limit) continue;
      if (await enqueue(id, data, { stage, name: sc.name, time }, test)) queued++; else already++;
    }
  }
  const sent = TOKEN ? await flush(500) : null;
  return { queued, already, flush: sent };
}

// Evento de teste com os dados (já em hash) do lead mais recente, enviado ao código de teste do Gerenciador de Eventos.
export async function sendTest() {
  if (!TOKEN) throw new Error('O token da API de Conversões ainda não foi guardado no servidor (segredo META_CAPI_TOKEN).');
  const cfg = await loadCfg(true);
  if (!cfg.testCode) throw new Error('Informe o código de teste (Gerenciador de Eventos › Eventos de teste) e salve.');
  const leads = (await listDocs('leads')).filter(l => !l.data.example && l.data.phone && l.data.createdAt).sort((a, b) => String(b.data.createdAt).localeCompare(String(a.data.createdAt)));
  const l = leads[0]; if (!l) throw new Error('Não há lead para usar no teste.');
  const stage = Object.keys(cfg.stages).find(k => cfg.stages[k].on) ?? 'novo', name = cfg.stages[stage].name;
  const ev = await buildEvent(l.data, l.id, stage, name, Math.floor(Date.now() / 1000));
  const r = await post([ev], cfg.testCode);
  return { ok: r.ok, status: r.status, eventName: name, chaves: Object.keys(ev.user_data as Doc), eventsReceived: r.body.events_received ?? null, fbtraceId: r.body.fbtrace_id ?? r.body?.error?.fbtrace_id ?? null, mensagens: r.body.messages ?? [], erro: r.ok ? null : errMsg(r) };
}

export async function recent(limit = 30) {
  const { data, error } = await sb.from('crm_capi_events').select('event_id,lead_id,event_name,event_time,test,status,attempts,last_error,sent_at,created_at').order('created_at', { ascending: false }).limit(Math.min(limit, 100));
  if (error) throw new Error(error.message);
  return { counts: await counts(), events: data ?? [] };
}
