// Lógica pura da funis-api (sem banco nem rede), coberta por logic.test.ts.
import {evalRoles, type Roles} from './rules.ts';

export type Answer = {step?: string; name?: string; type?: string; title?: string; value?: unknown; label?: string; score?: number; ids?: string[]; responses?: string; data?: Record<string, unknown>};
export type Session = {
  id: string; created_at?: string; updated_at?: string;
  tracking: Record<string, string>; params?: Record<string, string>; answers: Record<string, Answer>; clicks: Record<string, {name?: string; label?: string; at?: string}>;
  steps: string[]; last_step: string | null; interacted: boolean; completed: boolean; webhook?: Record<string, unknown> | null;
  timeline?: [string, number, number?][]; phone?: string | null; email?: string | null;
  crm?: {stage?: string; value?: number; at?: string} | null; sent?: Record<string, unknown>;
};
// Configurações de leitura dos leads (funil › settings.leads): regra de perfil, nota, abandono e repetidos.
export type LeadSettings = {
  icp?: Roles; score?: {when?: Roles; points?: number | string; label?: string}[]; hot?: number | string;
  abandon?: {enabled?: boolean; minutes?: number | string}; dedupeDays?: number | string;
};
export type Webhook = {enabled?: boolean; url?: string; token?: string; method?: string; contentType?: string; trigger?: string; component?: string; mapping?: {key?: string; name?: string; mode?: string}[]};
type Funnel = {steps?: {id: string; layers?: {id: string; type: string; content?: Record<string, unknown>}[]}[]};
export type Event = {type?: string; step?: string; layer?: string; name?: string; label?: string; destination?: string; url?: string; answer?: Answer; at?: number};

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
// Código da loja no iFood: o UUID que aparece no link (…/delivery/cidade-uf/nome/UUID).
export const merchantIdFrom = (t: unknown) => ((String(t ?? '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [''])[0]).toLowerCase();
export const SESSION_RE = /^[A-Za-z0-9_-]{4,40}$/;
const TRACK_KEYS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'utm_id', 'fbclid', 'gclid', 'src', 'sck', 'screen', 'viewport', 'platform', 'userAgent', 'language', 'referrer', 'url', 'fbp', 'fbc'];
export const UTM_KEYS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'utm_id', 'fbclid', 'gclid', 'src', 'sck'];

const str = (v: unknown, max: number) => v == null ? '' : String(v).slice(0, max);
export function slugify(s: string){
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'funil';
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
// Todos os parâmetros da URL do funil (o InLead manda todos no webhook e nos links externos). f/funil é o endereço do funil neste app.
export function sanitizeParams(p: unknown){
  const out: Record<string, string> = {};
  if (!p || typeof p !== 'object') return out;
  for (const [k, v] of Object.entries(p as Record<string, unknown>).slice(0, 40)) {
    if (!/^[\w.\-\[\]]{1,60}$/.test(k) || k === 'f' || k === 'funil' || v == null || typeof v === 'object') continue;
    out[k] = str(v, 500);
  }
  return out;
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
  if (a.responses != null) o.responses = str(a.responses, 2000);
  // dados extras de um componente (ex.: Raio-X do iFood): até 20 campos simples
  if (a.data && typeof a.data === 'object' && !Array.isArray(a.data)) {
    const d: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a.data).slice(0, 20)) if (/^[\w]{1,40}$/.test(k) && (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) d[k] = typeof v === 'string' ? str(v, 300) : v;
    o.data = d;
  }
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
export function mergeSession(cur: Session | null, id: string, events: Event[], tracking: Record<string, string> | null, funnel: Funnel, params?: Record<string, string> | null): Session {
  const s: Session = cur ? {...cur, answers: {...(cur.answers || {})}, clicks: {...(cur.clicks || {})}, steps: [...(cur.steps || [])], tracking: {...(cur.tracking || {})}} :
    {id, tracking: {}, answers: {}, clicks: {}, steps: [], last_step: null, interacted: false, completed: false};
  if (tracking && !Object.keys(s.tracking).length) s.tracking = tracking;
  s.params = {...(cur && cur.params || {})};
  if (params && !Object.keys(s.params).length) s.params = params;
  s.timeline = [...(cur && cur.timeline || [])];
  const valid = new Set(stepIds(funnel));
  for (const ev of events.slice(0, 60)) {
    if (!ev || typeof ev !== 'object') continue;
    const step = str(ev.step, 40);
    if (ev.type === 'step' || ev.type === 'back') {
      if (step && valid.has(step)) {
        if (s.steps[s.steps.length - 1] !== step && s.steps.length < 300) s.steps.push(step);
        s.last_step = step; if (isDeadEnd(funnel, step)) s.completed = true;
        // linha do tempo: [etapa, quando, 1 = voltou] — base dos caminhos e do tempo por etapa
        if (s.timeline.length < 400) s.timeline.push(ev.type === 'back' ? [step, Number(ev.at) || Date.now(), 1] : [step, Number(ev.at) || Date.now()]);
      }
    } else if (ev.type === 'answer' && ev.layer && ev.answer && typeof ev.answer === 'object') {
      if (Object.keys(s.answers).length < 200 || s.answers[ev.layer]) { s.answers[str(ev.layer, 40)] = cleanAnswer(ev.answer, ev); s.interacted = true }
    } else if (ev.type === 'click' && ev.layer) {
      s.clicks[str(ev.layer, 40)] = {name: str(ev.name, 80), label: str(ev.label, 300), at: new Date(Number(ev.at) || Date.now()).toISOString()};
      s.interacted = true;
    } else if (ev.type === 'complete') s.completed = true;
  }
  s.phone = phoneOf(s) || (cur && cur.phone) || null;
  s.email = emailOf(s) || (cur && cur.email) || null;
  return s;
}
/* ---------- telefone e e-mail do lead ---------- */
const DDDS = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
export function normPhone(v: unknown){
  const d = String(v ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d.length >= 8 && d.length <= 15 ? d : '';
}
// Celular brasileiro de verdade: DDD que existe e, com 9 dígitos, começando por 9.
export function validBrPhone(e164: unknown){
  const m = /^55(\d\d)(\d{8,9})$/.exec(String(e164 ?? ''));
  return !!m && DDDS.has(m[1]) && (m[2].length === 8 || m[2][0] === '9');
}
const PHONE_TITLE = /whats|telefone|celular|fone|phone|contato/i;
export function phoneOf(s: Session){
  for (const a of Object.values(s.answers || {})) {
    if (!a || a.type === 'options' || typeof a.value !== 'string') continue;
    const d = a.value.replace(/\D/g, '');
    if ((PHONE_TITLE.test(a.title || '') || /^[\d\s()+\-.]+$/.test(a.value)) && d.length >= 10 && d.length <= 13) return normPhone(d);
  }
  return '';
}
export function emailOf(s: Session){
  for (const a of Object.values(s.answers || {})) if (a && typeof a.value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.value.trim())) return a.value.trim().toLowerCase();
  return '';
}
// O webhook deve sair agora? (uma vez por visitante; o editor pode reenviar.)
export function webhookDue(w: Webhook | null | undefined, prev: Session | null, next: Session, events: Event[]){
  if (!w || !w.enabled || !w.url) return false;
  // já enviado (o envio de "abandono" não conta: quem volta e termina vai de novo, completo); repetido não vai
  const pw = (prev && prev.webhook || null) as {ok?: boolean; kind?: string; skipped?: string} | null;
  if (pw && (pw.skipped || (pw.ok && pw.kind !== 'abandono'))) return false;
  const trig = w.trigger || 'component';
  // Como no InLead: vários componentes separados por vírgula; vale o último com que a pessoa interagiu (botão ou opção).
  if (trig === 'component') { const list = String(w.component || '').split(',').map(x => x.trim()).filter(Boolean); return !!list.length && events.some(e => e && ((e.type === 'click' && (list.includes(String(e.name)) || list.includes(String(e.layer)))) || (e.type === 'answer' && e.answer && list.includes(String(e.answer.name))))) }
  if (trig === 'complete') return next.completed && !(prev && prev.completed);
  if (trig === 'lead') return Object.values(next.answers).some(a => a.type === 'field' && a.value && (/@/.test(String(a.value)) || String(a.value).replace(/\D/g, '').length >= 10));
  return false;
}
const asText = (v: unknown) => Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
// Variáveis do visitante como o InLead monta (módulo 60527/70165): nome = valor (múltipla escolha com |), score.nome,
// responses.nome, campo = texto digitado, botão = "clicked", tracking.<parâmetro>, tracking.screen e tracking.platform.
export function sessionVars(s: Session){
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.params || {})) out['tracking.' + k] = v;
  if (s.tracking && s.tracking.screen) out['tracking.screen'] = s.tracking.screen;
  if (s.tracking && s.tracking.platform) out['tracking.platform'] = s.tracking.platform;
  for (const c of Object.values(s.clicks || {})) if (c && c.name) out[c.name] = 'clicked';
  let total = 0;
  for (const a of Object.values(s.answers || {})) {
    if (!a || !a.name) continue;
    out[a.name] = Array.isArray(a.value) ? a.value.join('|') : a.value == null ? '' : String(a.value);
    if (a.type === 'options') { out['score.' + a.name] = Number(a.score) || 0; total += Number(a.score) || 0; if (a.responses != null) out['responses.' + a.name] = a.responses }
    if (a.data) for (const [k, v] of Object.entries(a.data)) out[a.name + '.' + k] = v;
  }
  if (!('score' in out)) out.score = total;
  return out;
}
// Corpo do webhook igual ao do InLead: {...variáveis, ...parâmetros da URL, code}.
// Extras deste app: os campos do CRM (mapeamento), o endereço do funil, a data e a página.
export function buildPayload(slug: string, s: Session, w: Webhook, extra?: Record<string, unknown>){
  const out: Record<string, unknown> = {...sessionVars(s), ...(s.params || {}), code: s.id};
  // sessões antigas (sem params): as UTMs que ficaram no rastreamento
  for (const k of UTM_KEYS) if (s.tracking && s.tracking[k] && !(k in out)) out[k] = s.tracking[k];
  const byName: Record<string, Answer> = {};
  for (const a of Object.values(s.answers || {})) if (a && a.name) byName[a.name] = a;
  for (const m of w.mapping || []) {
    if (!m || !m.key || !m.name) continue;
    const a = byName[m.name]; if (!a) continue;
    out[m.key] = m.mode === 'value' ? asText(a.value) : (a.type === 'options' ? (a.label || asText(a.value)) : asText(a.value));
  }
  if (extra) Object.assign(out, extra);
  if (!('funil' in out)) out.funil = slug;
  if (!('data' in out)) out.data = s.created_at || new Date().toISOString();
  if (s.tracking && s.tracking.url && !('pagina' in out)) out.pagina = s.tracking.url;
  return out;
}
// Qualificado como no InLead: as respostas passam de 70% do número de etapas (ou a pessoa completou o funil).
export function isQualified(s: Session, totalSteps: number){
  return !!s.completed || Object.keys(s.answers || {}).length + Object.keys(s.clicks || {}).length > 0.7 * Math.max(1, totalSteps);
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
    .replace(/[\s\u00a0]+/g, ' ').trim().replace(/^[^\p{L}\p{N}"“(]+/u, '').trim();
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
    component: str(inc.component, 400),
    mapping: (Array.isArray(inc.mapping) ? inc.mapping : []).slice(0, 40).map(m => ({key: str(m && m.key, 60).trim(), name: str(m && m.name, 80), mode: m && m.mode === 'value' ? 'value' : 'label'})),
  };
  const tok = inc.token == null ? '' : String(inc.token).trim();
  w.token = inc.clearToken ? '' : (tok || (old && old.token) || '');
  if (w.url && !/^https:\/\//i.test(w.url)) throw new Error('O endereço do webhook precisa começar com https://');
  w.updated_at = new Date().toISOString();
  return w;
}

/* ================= leitura dos leads: perfil, nota, abandono ================= */
// Variáveis para as regras: as do InLead + lead.etapas, lead.completo, lead.telefone, lead.telefone_valido e lead.crm.
export function ruleVars(s: Session){
  return {
    ...sessionVars(s),
    'lead.etapas': (s.steps || []).length, 'lead.completo': s.completed ? 'sim' : 'nao',
    'lead.telefone': s.phone ? 'sim' : 'nao', 'lead.telefone_valido': validBrPhone(s.phone) ? 'sim' : 'nao',
    'lead.crm': (s.crm && s.crm.stage) || '',
  } as Record<string, unknown>;
}
// Lead no perfil (regra de perfil) e nota de 0 a 100 (soma dos pontos das regras que valem).
export function leadMetrics(s: Session, ls?: LeadSettings | null){
  const vars = ruleVars(s);
  const icpRules = ls && Array.isArray(ls.icp) && ls.icp.some(g => Array.isArray(g) && g.length) ? ls.icp : null;
  const rules = ls && Array.isArray(ls.score) ? ls.score.filter(r => r && Number(r.points)) : [];
  let score = 0; const reasons: string[] = [];
  for (const r of rules) if (evalRoles(r.when, vars, true)) { score += Number(r.points); if (r.label) reasons.push(r.label) }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const hotMin = Number(ls && ls.hot);
  return {
    icp: icpRules ? evalRoles(icpRules, vars, false) : null,
    score: rules.length ? score : null,
    hot: rules.length && hotMin > 0 ? score >= hotMin : null,
    reasons,
  };
}
// Campos que o webhook ganha com a leitura do lead (só os que estiverem configurados).
export function payloadExtras(s: Session, ls: LeadSettings | null | undefined, kind?: string, stepTitle?: string){
  const m = leadMetrics(s, ls), out: Record<string, unknown> = {};
  if (m.score != null) out.nota_lead = m.score;
  if (m.icp != null) out.lead_no_perfil = m.icp;
  if (m.hot != null) out.lead_quente = m.hot;
  if (s.phone) out.telefone_valido = validBrPhone(s.phone);
  if (kind === 'abandono') { out.abandonou = true; if (stepTitle) out.etapa_abandono = stepTitle }
  return out;
}
// Deixou o WhatsApp e não enviou: depois de X minutos sem novidade, vai como "abandono".
export function abandonDue(s: Session, ls: LeadSettings | null | undefined, now = Date.now()){
  const a = ls && ls.abandon;
  if (!a || !a.enabled || !s.phone || s.webhook) return false;
  const min = Math.max(5, Number(a.minutes) || 15);
  return now - new Date(s.updated_at || 0).getTime() >= min * 60e3;
}

/* ================= vendas (webhook do checkout) ================= */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let t = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!t) return 0;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
}
export type Sale = {event: string; status: 'approved' | 'refunded' | 'pending' | 'canceled' | 'other'; value: number; currency: string; saleId: string; product: string; email: string; phone: string; name: string; utm: Record<string, string>; code: string};
// Lê o aviso de venda de checkouts como Kirvano, Hotmart e Kiwify (cada um manda um formato; pega o que existir).
// O visitante é achado pela marca fn-<código> que o funil põe no link do checkout, ou pelo telefone/e-mail.
// deno-lint-ignore no-explicit-any
export function parseSale(body: any): Sale {
  const raw = body && typeof body === 'object' ? body : {};
  const b = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? {...raw, ...raw.data} : raw;
  const ev = String(b.event ?? b.type ?? b.webhook_event_type ?? '').toUpperCase();
  const st = String(b.status ?? b.sale_status ?? b.order_status ?? b.purchase?.status ?? '').toUpperCase();
  const both = ev + ' ' + st;
  const status = /REFUND|REEMBOLS|CHARGEBACK|ESTORN/.test(both) ? 'refunded'
    : /APPROV|APROVAD|PAID|PAGO|COMPLET/.test(both) ? 'approved'
    : /CANCEL|EXPIR|REFUS|RECUSAD/.test(both) ? 'canceled'
    : /PEND|WAIT|AGUARD|GENERATED|BOLETO|ABANDON|CREATED/.test(both) ? 'pending' : 'other';
  const products = Array.isArray(b.products) ? b.products : [];
  const value = parseMoney(b.total_price ?? b.sale_value ?? b.amount ?? b.price ?? b.value ?? b.purchase?.price?.value ?? b.payment?.amount ?? (products.length ? products.reduce((t: number, p: any) => t + parseMoney(p && p.price), 0) : 0));
  const c = b.customer ?? b.buyer ?? b.client ?? {};
  const utm: Record<string, string> = {};
  for (const src of [b.utm, b.utms, b.tracking, b]) if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) if (/^(utm_\w+|src|sck)$/.test(k) && v != null && typeof v !== 'object' && String(v)) utm[k] = String(v).slice(0, 300);
  const code = (/fn-([A-Za-z0-9_-]{4,40})/.exec(JSON.stringify(raw)) || [])[1] || '';
  return {
    event: ev || st, status, value, currency: String(b.currency ?? b.purchase?.price?.currency_value ?? 'BRL').slice(0, 3).toUpperCase() || 'BRL',
    saleId: String(b.sale_id ?? b.transaction ?? b.purchase?.transaction ?? b.order_id ?? b.id ?? b.checkout_id ?? '').slice(0, 120),
    product: String((products[0] && (products[0].name || products[0].offer_name)) ?? b.product?.name ?? b.product_name ?? '').slice(0, 200),
    email: String(c.email ?? b.email ?? '').trim().toLowerCase().slice(0, 200),
    phone: normPhone(c.phone_number ?? c.phone ?? c.mobile ?? c.checkout_phone ?? b.phone ?? ''),
    name: String(c.name ?? b.name ?? '').slice(0, 200), utm, code,
  };
}

/* ================= etapas do CRM (Central Comercial) ================= */
const STAGES: [string, RegExp][] = [['novo', /^(novo|lead novo)$/], ['print', /^(print|print enviado)$/], ['qualificando', /^qualificando$/], ['agendando', /^agendando$/],
  ['marcada', /^(marcada|reuniao marcada)$/], ['feita', /^(feita|reuniao feita|reuniao realizada)$/], ['fechado', /^(fechado|ganho|venda|vendido)$/],
  ['perdido', /^perdido$/], ['desqualificado', /^desqualificado$/], ['frio', /^frio$/], ['morno', /^morno$/]];
export function stageId(v: unknown){
  const t = String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return (STAGES.find(([, re]) => re.test(t)) || [''])[0];
}
export const MEETING_STAGES = new Set(['marcada', 'feita', 'fechado']);
// Aceita um lead ou uma lista: {codigo|code, telefone|phone, etapa|stage, valor|value}.
// deno-lint-ignore no-explicit-any
export function parseCrm(body: any){
  const list = Array.isArray(body) ? body : Array.isArray(body && body.leads) ? body.leads : [body];
  return list.slice(0, 2000).map((x: any) => x && typeof x === 'object' ? {
    code: String(x.codigo ?? x.code ?? x.lead_code ?? '').trim().slice(0, 40),
    phone: normPhone(x.telefone ?? x.phone ?? x.whatsapp ?? ''),
    stage: stageId(x.etapa ?? x.stage ?? x.status),
    value: parseMoney(x.valor ?? x.value ?? x.amount ?? 0),
  } : null).filter((x: any) => x && x.stage && (x.code || x.phone));
}

/* ================= relatórios: anúncios, caminhos e tempo ================= */
// O link do anúncio usa o modelo da Meta "Nome|ID" (ex.: utm_content=IFood Escondeu|120244276786450151).
export const LEVELS: Record<string, string> = {campaign: 'utm_campaign', adset: 'utm_medium', ad: 'utm_content', placement: 'utm_term', source: 'utm_source'};
export function splitUtm(v: unknown){
  const t = String(v ?? '').trim(), k = t.lastIndexOf('|');
  return k > 0 && /^\d{6,}$/.test(t.slice(k + 1).trim()) ? {name: t.slice(0, k).trim(), id: t.slice(k + 1).trim()} : {name: t, id: ''};
}
export type SpendRow = {day: string; campaign_id?: string; campaign_name?: string; adset_id?: string; adset_name?: string; ad_id?: string; ad_name?: string; spend: number};
type SaleRow = {session_id?: string | null; status: string; value: number};
const SPEND_KEYS: Record<string, [string, string]> = {campaign: ['campaign_id', 'campaign_name'], adset: ['adset_id', 'adset_name'], ad: ['ad_id', 'ad_name']};
export function aggregateAds(sessions: Session[], o: {level?: string; settings?: LeadSettings | null; submitNames?: string[]; sales?: SaleRow[]; spend?: SpendRow[]}){
  const level = LEVELS[o.level || ''] ? o.level as string : 'ad', param = LEVELS[level];
  const submit = new Set((o.submitNames || []).filter(Boolean));
  const salesBy = new Map<string, SaleRow[]>();
  for (const x of o.sales || []) if (x.session_id) { const l = salesBy.get(x.session_id) || []; l.push(x); salesBy.set(x.session_id, l) }
  type Row = {key: string; name: string; id: string; visits: number; started: number; contacts: number; submitted: number; abandoned: number; icp: number; scoreSum: number; scoreN: number; hot: number; meetings: number; won: number; crmRevenue: number; sales: number; salesRevenue: number; refunds: number; spend: number; daily: Record<string, {visits: number; started: number}>};
  const rows = new Map<string, Row>();
  const row = (key: string) => {
    let r = rows.get(key);
    if (!r) { const u = splitUtm(key); r = {key, name: u.name || '(sem ' + param + ')', id: u.id, visits: 0, started: 0, contacts: 0, submitted: 0, abandoned: 0, icp: 0, scoreSum: 0, scoreN: 0, hot: 0, meetings: 0, won: 0, crmRevenue: 0, sales: 0, salesRevenue: 0, refunds: 0, spend: 0, daily: {}}; rows.set(key, r) }
    return r;
  };
  for (const s of sessions) {
    const key = String((s.params && s.params[param]) || (s.tracking && s.tracking[param]) || '');
    const r = row(key), m = leadMetrics(s, o.settings);
    const day = String(s.created_at || '').slice(0, 10);
    r.visits++; if (s.interacted) r.started++;
    const d = r.daily[day] = r.daily[day] || {visits: 0, started: 0}; d.visits++; if (s.interacted) d.started++;
    const wk = s.webhook as {ok?: boolean; kind?: string} | null;
    const sent = Object.values(s.clicks || {}).some(c => c && submit.has(String(c.name))) || !!(wk && wk.ok && wk.kind !== 'abandono' && wk.kind !== 'importado');
    if (s.phone) r.contacts++;
    if (sent) r.submitted++; else if (s.phone) r.abandoned++;
    if (m.icp) r.icp++;
    if (m.score != null) { r.scoreSum += m.score; r.scoreN++ }
    if (m.hot) r.hot++;
    const st = s.crm && s.crm.stage || '';
    if (MEETING_STAGES.has(st)) r.meetings++;
    if (st === 'fechado') { r.won++; r.crmRevenue += Number(s.crm && s.crm.value) || 0 }
    for (const x of salesBy.get(s.id) || []) { if (x.status === 'approved') { r.sales++; r.salesRevenue += Number(x.value) || 0 } else if (x.status === 'refunded') { r.refunds++; r.salesRevenue -= Number(x.value) || 0 } }
  }
  // gasto do Gerenciador de Anúncios (por ID; sem ID, pelo nome)
  const sk = SPEND_KEYS[level];
  if (sk) for (const sp of o.spend || []) {
    const id = String((sp as Record<string, unknown>)[sk[0]] || ''), name = String((sp as Record<string, unknown>)[sk[1]] || '');
    let r = [...rows.values()].find(x => (id && x.id === id) || (!x.id && name && x.name === name));
    if (!r) r = row(id ? `${name}|${id}` : name);
    r.spend += Number(sp.spend) || 0;
  }
  const div = (a: number, b: number) => b ? a / b : null;
  const cost = (a: number, b: number) => a && b ? a / b : null; // sem gasto, custo fica vazio (não R$ 0)
  const list = [...rows.values()].map(r => ({
    key: r.key, name: r.name, id: r.id, visits: r.visits, started: r.started, contacts: r.contacts, submitted: r.submitted, abandoned: r.abandoned,
    icp: r.icp, hot: r.hot, score: r.scoreN ? Math.round(r.scoreSum / r.scoreN) : null, meetings: r.meetings, won: r.won, sales: r.sales, refunds: r.refunds,
    revenue: Math.round((r.salesRevenue + r.crmRevenue) * 100) / 100, spend: Math.round(r.spend * 100) / 100,
    startRate: div(r.started, r.visits), icpRate: div(r.icp, r.started), cpl: cost(r.spend, r.submitted || r.contacts), cpIcp: cost(r.spend, r.icp),
    cpMeeting: cost(r.spend, r.meetings), cpSale: cost(r.spend, r.won + r.sales), roas: div(r.salesRevenue + r.crmRevenue, r.spend),
    daily: Object.keys(r.daily).sort().map(day => ({day, ...r.daily[day]})),
  })).sort((a, b) => b.visits - a.visits || b.spend - a.spend);
  const t = list.reduce((a, r) => { for (const k of ['visits', 'started', 'contacts', 'submitted', 'abandoned', 'icp', 'hot', 'meetings', 'won', 'sales', 'refunds', 'revenue', 'spend'] as const) a[k] = (a[k] || 0) + (r[k] || 0); return a }, {} as Record<string, number>);
  const totals: Record<string, number | null> = {...t, startRate: div(t.started, t.visits), icpRate: div(t.icp, t.started), cpl: cost(t.spend, t.submitted || t.contacts), cpIcp: cost(t.spend, t.icp), cpMeeting: cost(t.spend, t.meetings), cpSale: cost(t.spend, t.won + t.sales), roas: div(t.revenue, t.spend)};
  return {level, param, rows: list, totals};
}
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2 };
// Por etapa: visitantes, quantos pararam ali, tempo mediano até a próxima e quantos voltaram; e as passagens mais comuns.
export function aggregatePaths(sessions: Session[], steps: {id: string; title?: string}[]){
  const per = new Map<string, {visitors: number; exits: number; times: number[]; backs: number}>();
  const tr = new Map<string, number>();
  const get = (id: string) => { let x = per.get(id); if (!x) { x = {visitors: 0, exits: 0, times: [], backs: 0}; per.set(id, x) } return x };
  for (const s of sessions) {
    const tl = (s.timeline && s.timeline.length ? s.timeline : (s.steps || []).map(id => [id, 0] as [string, number])).filter(e => Array.isArray(e) && e[0]);
    if (!tl.length) continue;
    for (const id of new Set(tl.map(e => e[0]))) get(id).visitors++;
    for (let i = 0; i < tl.length - 1; i++) {
      const [a, ta] = tl[i], [b, tb, back] = tl[i + 1];
      if (a === b) continue;
      const dt = (tb - ta) / 1000;
      if (ta && tb && dt > 0 && dt < 1800) get(a).times.push(dt);
      if (back) get(a).backs++;
      tr.set(a + '>' + b, (tr.get(a + '>' + b) || 0) + 1);
    }
    if (!s.completed) get(tl[tl.length - 1][0]).exits++;
  }
  const title = (id: string) => (steps.find(x => x.id === id) || {title: id}).title || id;
  return {
    steps: steps.filter(x => per.has(x.id)).map(x => { const p = per.get(x.id)!; const md = median(p.times); return {id: x.id, title: title(x.id), visitors: p.visitors, exits: p.exits, medianSec: md == null ? null : Math.round(md), backs: p.backs} }),
    transitions: [...tr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => { const [from, to] = k.split('>'); return {from, to, fromTitle: title(from), toTitle: title(to), n} }),
  };
}

/* ================= API de Conversões da Meta ================= */
export const GRAPH_VERSION = 'v23.0';
export async function sha256(v: string){
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const firstName = (s: Session) => {
  for (const a of Object.values(s.answers || {})) if (a && typeof a.value === 'string' && /nome/i.test(a.title || '') && !/loja|empresa|restaurante|neg[oó]cio/i.test(a.title || '')) return a.value.trim().split(/\s+/)[0].toLowerCase();
  return '';
};
// Evento no formato da API de Conversões, com os dados do lead em SHA-256 e o mesmo event_id do Pixel do navegador.
export async function capiEvent(o: {name: string; id: string; s: Session; time?: number; value?: number; currency?: string; custom?: Record<string, unknown>}){
  const s = o.s, t = s.tracking || {}, p = s.params || {}, fn = firstName(s);
  const created = new Date(s.created_at || Date.now()).getTime();
  const ud: Record<string, unknown> = {external_id: [await sha256(s.id)]};
  if (s.phone) ud.ph = [await sha256(s.phone)];
  if (s.email) ud.em = [await sha256(s.email)];
  if (fn) ud.fn = [await sha256(fn)];
  if (t.ip) ud.client_ip_address = t.ip;
  if (t.userAgent) ud.client_user_agent = t.userAgent;
  if (t.fbc) ud.fbc = t.fbc; else if (p.fbclid) ud.fbc = `fb.1.${created}.${p.fbclid}`;
  if (t.fbp) ud.fbp = t.fbp;
  const ev: Record<string, unknown> = {event_name: o.name, event_time: Math.floor((o.time || Date.now()) / 1000), event_id: o.id, action_source: 'website', user_data: ud};
  if (t.url) ev.event_source_url = t.url;
  const cd: Record<string, unknown> = {...(o.custom || {})};
  if (o.value != null) { cd.value = o.value; cd.currency = o.currency || 'BRL' }
  if (Object.keys(cd).length) ev.custom_data = cd;
  return ev;
}

/* ================= Raio-X do iFood (dados do app de Restaurantes) ================= */
// Resumo para o funil a partir da ficha da loja: avaliações, pedidos estimados (avaliações × 2, conta do Power Data)
// e posição entre as lojas da mesma categoria no raio. A posição só vale com pelo menos 5 lojas da categoria na base.
// deno-lint-ignore no-explicit-any
export function ifoodSummary(r: any, km: number){
  const m = r && r.merchant; if (!m) return null;
  const mine = Number(m.rating_count) || 0;
  const peers = (Array.isArray(r.nearby) ? r.nearby : []).filter((x: any) => x && x.category === m.category && x.id !== m.id).map((x: any) => ({nome: String(x.name || ''), avaliacoes: Number(x.rating_count) || 0}));
  const all = [...peers, {nome: String(m.name || ''), avaliacoes: mine, me: true}].sort((a, b) => b.avaliacoes - a.avaliacoes);
  const pos = all.findIndex(x => (x as {me?: boolean}).me) + 1, total = all.length;
  const ahead = pos > 1 ? all[pos - 2] : null, leader = all[0];
  return {
    nome: String(m.name || ''), categoria: String(m.category || ''), bairro: String(m.district || ''), cidade: String(m.city || ''), logo: m.logo || '',
    avaliacoes: mine, pedidos: mine * 2, raio: km, posicao: pos, total, confiavel: total >= 5,
    lider: leader && !(leader as {me?: boolean}).me ? leader.nome : '', lider_pedidos: leader ? leader.avaliacoes * 2 : 0,
    proxima: ahead ? ahead.nome : '', falta: ahead ? (ahead.avaliacoes - mine + 1) * 2 : 0,
  };
}

/* ================= importação de leads antigos (InLead) ================= */
// O editor converte a planilha/JSON do InLead para este formato; aqui só limpa e completa.
// Os importados ficam marcados como já enviados ao webhook (o InLead já mandou), para não irem de novo ao CRM.
// deno-lint-ignore no-explicit-any
export function importRow(x: any, funnel: Funnel){
  if (!x || typeof x !== 'object') return null;
  const id = String(x.code || x.id || '').trim();
  if (!SESSION_RE.test(id)) return null;
  const valid = new Set(stepIds(funnel));
  const answers: Record<string, Answer> = {};
  for (const [lid, a] of Object.entries(x.answers || {}).slice(0, 200)) if (a && typeof a === 'object' && /^[\w-]{1,40}$/.test(lid)) answers[lid] = cleanAnswer(a as Answer, {step: (a as Answer).step});
  const clicks: Session['clicks'] = {};
  for (const [lid, c] of Object.entries(x.clicks || {}).slice(0, 100)) if (c && typeof c === 'object' && /^[\w-]{1,40}$/.test(lid)) clicks[lid] = {name: str((c as {name?: string}).name, 80), label: str((c as {label?: string}).label, 300)};
  const created = new Date(x.created_at || Date.now());
  const s: Session = {
    id, created_at: isFinite(created.getTime()) ? created.toISOString() : new Date().toISOString(),
    tracking: sanitizeTracking(x.tracking), params: sanitizeParams(x.params), answers, clicks,
    steps: (Array.isArray(x.steps) ? x.steps : []).map(String).filter((k: string) => valid.has(k)).slice(0, 300),
    last_step: null, interacted: !!(Object.keys(answers).length || Object.keys(clicks).length), completed: !!x.completed,
    webhook: {ok: true, kind: 'importado', at: new Date().toISOString()},
  };
  s.last_step = s.steps[s.steps.length - 1] || null;
  s.phone = phoneOf(s) || null; s.email = emailOf(s) || null;
  return s;
}
