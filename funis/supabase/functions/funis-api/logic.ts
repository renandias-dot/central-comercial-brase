// Lógica pura da funis-api (sem banco nem rede), coberta por logic.test.ts.

export type Answer = {step?: string; name?: string; type?: string; title?: string; value?: unknown; label?: string; score?: number; ids?: string[]};
export type Session = {
  id: string; created_at?: string; updated_at?: string;
  tracking: Record<string, string>; answers: Record<string, Answer>; clicks: Record<string, {name?: string; label?: string; at?: string}>;
  steps: string[]; last_step: string | null; interacted: boolean; completed: boolean; webhook?: Record<string, unknown> | null;
};
export type Webhook = {enabled?: boolean; url?: string; token?: string; method?: string; contentType?: string; trigger?: string; component?: string; mapping?: {key?: string; name?: string; mode?: string}[]};
type Funnel = {steps?: {id: string; layers?: {id: string; type: string; content?: Record<string, unknown>}[]}[]};
export type Event = {type?: string; step?: string; layer?: string; name?: string; label?: string; destination?: string; url?: string; answer?: Answer; at?: number};

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const SESSION_RE = /^[A-Za-z0-9_-]{4,40}$/;
const TRACK_KEYS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'utm_id', 'fbclid', 'gclid', 'src', 'sck', 'screen', 'viewport', 'platform', 'userAgent', 'language', 'referrer', 'url'];
export const UTM_KEYS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'utm_id', 'fbclid', 'gclid', 'src', 'sck'];

const str = (v: unknown, max: number) => v == null ? '' : String(v).slice(0, max);
export function slugify(s: string){
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'funil';
}
export function sameKey(a: string, b: string){
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export function periodStart(p: string, now = Date.now()){
  const ms = ({day: 864e5, week: 7 * 864e5, month: 30 * 864e5} as Record<string, number>)[p];
  return new Date(ms ? now - ms : 0);
}
export function sanitizeTracking(t: Record<string, unknown> | null | undefined){
  const out: Record<string, string> = {};
  if (!t || typeof t !== 'object') return out;
  for (const k of TRACK_KEYS) if (t[k] != null && t[k] !== '') out[k] = str(t[k], k === 'userAgent' || k === 'url' || k === 'referrer' ? 600 : 300);
  return out;
}
function cleanAnswer(a: Answer, ev: Event): Answer {
  const v = Array.isArray(a.value) ? a.value.slice(0, 50).map(x => str(x, 500)) : str(a.value, 2000);
  const o: Answer = {step: str(ev.step || a.step, 40), name: str(a.name, 80), type: str(a.type, 20), value: v};
  if (a.title) o.title = str(a.title, 200);
  if (a.label != null) o.label = str(a.label, 1000);
  if (a.score != null && isFinite(Number(a.score))) o.score = Number(a.score);
  if (Array.isArray(a.ids)) o.ids = a.ids.slice(0, 50).map(x => str(x, 40));
  return o;
}
const stepIds = (f: Funnel) => (f.steps || []).map(s => s.id);
// Etapa final sem saída (sem botão, opção ou loading): chegar nela conta como fluxo completo.
function isDeadEnd(f: Funnel, id: string){
  const steps = f.steps || [], k = steps.findIndex(s => s.id === id);
  if (k < 0 || k !== steps.length - 1) return false;
  return !(steps[k].layers || []).some(l => l.type === 'options' || l.type === 'button' || l.type === 'loading');
}
// Junta os eventos que o navegador mandou na sessão guardada.
export function mergeSession(cur: Session | null, id: string, events: Event[], tracking: Record<string, string> | null, funnel: Funnel): Session {
  const s: Session = cur ? {...cur, answers: {...(cur.answers || {})}, clicks: {...(cur.clicks || {})}, steps: [...(cur.steps || [])], tracking: {...(cur.tracking || {})}} :
    {id, tracking: {}, answers: {}, clicks: {}, steps: [], last_step: null, interacted: false, completed: false};
  if (tracking && !Object.keys(s.tracking).length) s.tracking = tracking;
  const valid = new Set(stepIds(funnel));
  for (const ev of events.slice(0, 60)) {
    if (!ev || typeof ev !== 'object') continue;
    const step = str(ev.step, 40);
    if (ev.type === 'step' || ev.type === 'back') {
      if (step && valid.has(step)) { if (s.steps[s.steps.length - 1] !== step && s.steps.length < 300) s.steps.push(step); s.last_step = step; if (isDeadEnd(funnel, step)) s.completed = true }
    } else if (ev.type === 'answer' && ev.layer && ev.answer && typeof ev.answer === 'object') {
      if (Object.keys(s.answers).length < 200 || s.answers[ev.layer]) { s.answers[str(ev.layer, 40)] = cleanAnswer(ev.answer, ev); s.interacted = true }
    } else if (ev.type === 'click' && ev.layer) {
      s.clicks[str(ev.layer, 40)] = {name: str(ev.name, 80), label: str(ev.label, 300), at: new Date(Number(ev.at) || Date.now()).toISOString()};
      s.interacted = true;
    } else if (ev.type === 'complete') s.completed = true;
  }
  return s;
}
// O webhook deve sair agora? (uma vez por visitante; o editor pode reenviar.)
export function webhookDue(w: Webhook | null | undefined, prev: Session | null, next: Session, events: Event[]){
  if (!w || !w.enabled || !w.url) return false;
  if (prev && prev.webhook && (prev.webhook as {ok?: boolean}).ok) return false;
  const trig = w.trigger || 'component';
  if (trig === 'component') { const c = String(w.component || ''); return !!c && events.some(e => e && e.type === 'click' && (e.name === c || e.layer === c)) }
  if (trig === 'complete') return next.completed && !(prev && prev.completed);
  if (trig === 'lead') return Object.values(next.answers).some(a => a.type === 'field' && a.value && (/@/.test(String(a.value)) || String(a.value).replace(/\D/g, '').length >= 10));
  return false;
}
const asText = (v: unknown) => Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
// Corpo do webhook: código do visitante, uma chave por componente (ID/Name), os campos do CRM e as UTMs.
export function buildPayload(slug: string, s: Session, w: Webhook){
  const out: Record<string, unknown> = {code: s.id, funil: slug};
  const byName: Record<string, Answer> = {};
  for (const a of Object.values(s.answers || {})) {
    if (!a || !a.name) continue;
    byName[a.name] = a;
    if (a.name === 'code' || a.name === 'funil') continue;
    out[a.name] = a.type === 'options' ? (a.label != null && a.label !== '' ? a.label : asText(a.value)) : asText(a.value);
  }
  for (const m of w.mapping || []) {
    if (!m || !m.key || !m.name) continue;
    const a = byName[m.name]; if (!a) continue;
    out[m.key] = m.mode === 'value' ? asText(a.value) : (a.type === 'options' ? (a.label || asText(a.value)) : asText(a.value));
  }
  for (const k of UTM_KEYS) if (s.tracking && s.tracking[k]) out[k] = s.tracking[k];
  out.data = s.created_at || new Date().toISOString();
  if (s.tracking && s.tracking.url) out.pagina = s.tracking.url;
  return out;
}
export function encodeBody(payload: Record<string, unknown>, contentType?: string){
  if (contentType === 'FORM') {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) p.set(k, typeof v === 'object' && v !== null ? JSON.stringify(v) : asText(v));
    return {body: p.toString(), type: 'application/x-www-form-urlencoded'};
  }
  return {body: JSON.stringify(payload), type: 'application/json'};
}
// Sessão de exemplo para o "Testar envio": a primeira opção de cada pergunta e valores fictícios nos campos.
export function sampleSession(f: Funnel): Session {
  const answers: Record<string, Answer> = {};
  for (const st of f.steps || []) for (const l of st.layers || []) {
    const c = (l.content || {}) as Record<string, unknown>;
    if (l.type === 'options') {
      const o = ((c.options || []) as {value?: unknown; label?: string; score?: number}[])[0];
      if (o) answers[l.id] = {step: st.id, name: String(c.name || l.id), type: 'options', value: String(o.value ?? ''), label: plainLabel(String(o.label || '')), score: Number(o.score) || 0};
    } else if (l.type === 'field') {
      const t = String(c.type || 'text');
      answers[l.id] = {step: st.id, name: String(c.name || l.id), type: 'field', title: String(c.title || ''), value: t === 'phone' ? '(21) 90000-0000' : t === 'email' ? 'teste@exemplo.com' : t === 'number' ? '10' : 'Teste do webhook'};
    }
  }
  return {id: 'TESTE1', created_at: new Date().toISOString(), tracking: {utm_source: 'teste'}, answers, clicks: {}, steps: [], last_step: null, interacted: true, completed: false};
}
export function plainLabel(h: string){
  return String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[\s ]+/g, ' ').trim().replace(/^[^\p{L}\p{N}"“(]+/u, '').trim();
}
// O que o editor vê do webhook: tudo, menos o token (só avisa se existe).
export function webhookForEditor(w: Webhook | null | undefined){
  const o: Record<string, unknown> = {...(w || {})};
  o.tokenSet = !!(w && w.token); delete o.token;
  return o;
}
// Junta o webhook novo com o guardado: token vazio mantém o anterior (a não ser que peça para apagar).
export function mergeWebhook(old: Webhook | null | undefined, inc: Webhook & {clearToken?: boolean; tokenSet?: boolean; updated_at?: string}){
  const w: Webhook & {updated_at?: string} = {
    enabled: !!inc.enabled, url: str(inc.url, 2000).trim(), method: ['POST', 'PUT', 'PATCH'].includes(String(inc.method)) ? String(inc.method) : 'POST',
    contentType: inc.contentType === 'FORM' ? 'FORM' : 'JSON', trigger: ['component', 'complete', 'lead'].includes(String(inc.trigger)) ? String(inc.trigger) : 'component',
    component: str(inc.component, 80),
    mapping: (Array.isArray(inc.mapping) ? inc.mapping : []).slice(0, 40).map(m => ({key: str(m && m.key, 60).trim(), name: str(m && m.name, 80), mode: m && m.mode === 'value' ? 'value' : 'label'})),
  };
  const tok = inc.token == null ? '' : String(inc.token).trim();
  w.token = inc.clearToken ? '' : (tok || (old && old.token) || '');
  if (w.url && !/^https:\/\//i.test(w.url)) throw new Error('O endereço do webhook precisa começar com https://');
  w.updated_at = new Date().toISOString();
  return w;
}
