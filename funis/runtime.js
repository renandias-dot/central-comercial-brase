/* Funis Brase — motor dos funis (quiz/funil interativo).
 * Usado pelo editor (funis/index.html) e pela página pública (funis/f/index.html).
 * O formato do funil é o mesmo do InLead (etapas → camadas com content/design/roles),
 * então um funil exportado de lá entra sem conversão manual (veja fromInlead).
 * Sem dependências. No Node (testes) exporta só a parte lógica. */
(function (root, factory){
  const api = factory(typeof document !== 'undefined' ? document : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FunnelRuntime = api;
})(typeof self !== 'undefined' ? self : this, function (doc){
'use strict';

/* ================= utilidades ================= */
const uid = (n = 6) => { const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)]; return s };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const num = (v, d = 0) => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : d };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ENT = {'&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'"};
const decode = s => String(s || '').replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, m => ENT[m]).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const stripHtml = h => decode(String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|h[1-6]|li|div)>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/[\s ]+/g, ' ').trim();
// Texto da opção sem o emoji do começo (para o webhook e as planilhas).
const plainLabel = h => stripHtml(h).replace(/^[^\p{L}\p{N}"“(]+/u, '').trim();
const isUrl = d => typeof d === 'string' && /^(https?:\/\/|mailto:|tel:|whatsapp:|\/\/)/i.test(d.trim());
const fmtNum = n => { if (!isFinite(n)) return '0'; const r = Math.round(n * 100) / 100; return Number.isInteger(r) ? String(r) : String(r).replace('.', ',') };

/* ================= expressões: calc(...) ================= */
// Avaliador aritmético seguro (sem eval): números, + - * / %, parênteses e min/max/round/floor/ceil/abs.
function calcEval(expr){
  const s = String(expr).replace(/,(?=\d)/g, '.');
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++ };
  const FN = {min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs};
  function primary(){
    ws();
    if (s[i] === '(') { i++; const v = sum(); ws(); if (s[i] === ')') i++; return v }
    if (s[i] === '-') { i++; return -primary() }
    if (s[i] === '+') { i++; return primary() }
    const m = /^[a-z]+/i.exec(s.slice(i));
    if (m && FN[m[0].toLowerCase()]) {
      i += m[0].length; ws(); const args = [];
      if (s[i] === '(') { i++; ws(); if (s[i] !== ')') { args.push(sum()); ws(); while (s[i] === ';' || s[i] === '|') { i++; args.push(sum()); ws() } } if (s[i] === ')') i++ }
      return FN[m[0].toLowerCase()](...args.map(Number));
    }
    const n = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (n) { i += n[0].length; return parseFloat(n[0]) }
    // palavra desconhecida (variável sem resposta) vale 0
    const w = /^[^\s()+\-*/%]+/.exec(s.slice(i)); if (w) { i += w[0].length; return 0 }
    i++; return 0;
  }
  function prod(){ let v = primary(); for (;;) { ws(); const o = s[i]; if (o === '*' || o === '/' || o === '%') { i++; const r = primary(); v = o === '*' ? v * r : o === '/' ? (r === 0 ? 0 : v / r) : (r === 0 ? 0 : v % r) } else return v } }
  function sum(){ let v = prod(); for (;;) { ws(); const o = s[i]; if (o === '+' || o === '-') { i++; const r = prod(); v = o === '+' ? v + r : v - r } else return v } }
  const v = sum();
  return isFinite(v) ? v : 0;
}
// Substitui cada calc(...) (com parênteses balanceados) pelo resultado.
function replaceCalc(text, fmt = fmtNum){
  let out = '', i = 0;
  for (;;) {
    const k = text.indexOf('calc(', i);
    if (k < 0) { out += text.slice(i); return out }
    out += text.slice(i, k);
    let depth = 0, j = k + 4;
    for (; j < text.length; j++) { if (text[j] === '(') depth++; else if (text[j] === ')') { depth--; if (depth === 0) break } }
    out += fmt(calcEval(stripHtml(text.slice(k + 5, j))));
    i = j + 1;
  }
}

/* ================= respostas e variáveis (mesmo formato do InLead) ================= */
// answers: { [layerId]: {step, name, type, value, label, score, ids?, responses?} }
// Variáveis, como o InLead guarda: opções → nome = valor(es) unidos por "|", score.nome = soma dos pontos,
// responses.nome = valor de cada opção marcada e "*" nas outras; campo → nome = texto; botão → nome = "clicked";
// parâmetros do link → tracking.<parâmetro>, tracking.screen, tracking.platform.
function buildVars(ctx){
  if (!ctx) return {};
  if (ctx.vars) return ctx.vars;
  const out = {}, answers = ctx.answers || {}, params = ctx.params || {};
  for (const k in params) { out['tracking.' + k] = params[k]; if (/^teste_\w+$/.test(k)) out['teste.' + k.slice(6)] = params[k] }
  if (ctx.screen) out['tracking.screen'] = ctx.screen;
  if (ctx.platform) out['tracking.platform'] = ctx.platform;
  for (const name in ctx.clicks || {}) out[name] = 'clicked';
  let total = 0;
  for (const id in answers) {
    const a = answers[id]; if (!a || !a.name) continue;
    if (a.type === 'options') {
      out[a.name] = Array.isArray(a.value) ? a.value.join('|') : (a.value == null ? '' : String(a.value));
      out['score.' + a.name] = num(a.score);
      if (a.responses != null) out['responses.' + a.name] = a.responses;
      if (a.label != null) out['label.' + a.name] = a.label;
      total += num(a.score);
    } else out[a.name] = Array.isArray(a.value) ? a.value.join('|') : (a.value == null ? '' : String(a.value));
    // dados extras do componente (Raio-X do iFood): nome.avaliacoes, nome.posicao…
    if (a.data) for (const k in a.data) out[a.name + '.' + k] = a.data[k];
  }
  if (!('score' in out)) out.score = total;
  return out;
}
/* ================= teste A/B (funil › settings.ab) ================= */
// Cada visitante cai numa variante fixa, sorteada pelo código dele; vai nos parâmetros como teste_<nome> (relatórios e
// webhook) e nas regras como @teste.<nome>. ?teste_<nome>=<variante> no link força uma variante (para conferir).
const abName = n => String(n == null ? '' : n).trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
const abVariants = t => (Array.isArray(t && t.variants) ? t.variants : String((t && t.variants) || '').split(',')).map(v => String(v).trim()).filter(Boolean);
function abTests(funnel){ return ((funnel && funnel.settings && funnel.settings.ab) || []).filter(t => t && t.enabled !== false && abName(t.name) && abVariants(t).length > 1) }
function hashStr(s){ let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function abAssign(funnel, code, params){
  const out = {};
  for (const t of abTests(funnel)) {
    const name = abName(t.name), k = 'teste_' + name, vs = abVariants(t), forced = params && params[k];
    out[k] = forced && vs.includes(forced) ? forced : vs[hashStr(String(code) + ':' + name) % vs.length];
  }
  return out;
}
function totalScore(answers){ let t = 0; for (const id in answers || {}) t += num(answers[id] && answers[id].score); return t }
// "1.234,56" → 1234.56 (só quando o resultado é número; texto fica como está).
function normVar(v){
  if (typeof v !== 'string') return v;
  const t = v.includes(',') && v.includes('.') ? (v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '')) : v.replace(',', '.');
  return /^[\d+\-*/().\s]+$/.test(t) && t.trim() !== '' && isFinite(Number(t)) ? String(Number(t)) : v;
}
// Conta do InLead: inteiro fica inteiro; com casas decimais, duas casas (74.50).
const fmtCalc = n => Number.isInteger(n) ? String(n) : n.toFixed(2);
const VAR_RE = /\{\{\s*([\w.]*)\s*\}\}|@(\w+(?:\.\w+)*)/g;
// Troca {{nome}} e @nome pelo valor. @ colado em letra, ponto ou @ fica como está (e-mails).
function replaceVars(text, vars, opt = {}){
  if (text == null) return '';
  const enc = opt.html ? esc : (x => x);
  return String(text).replace(/&nbsp;/g, ' ').replace(VAR_RE, (m, br, at, off, src) => {
    if (at !== undefined && /[\w.@]/.test(src[off - 1] || '')) return m;
    let k = br != null ? br : at;
    if (!k) return '';
    if (!(k in vars)) { if (/^url\./.test(k)) k = 'tracking.' + k.slice(4); else if (/^value\./.test(k)) k = k.slice(6) }
    if (k in vars) return enc(normVar(String(vars[k])));
    return opt.missing != null ? opt.missing : '';
  });
}
function interpolate(text, ctx, opt = {}){
  if (text == null) return '';
  let t = replaceVars(text, buildVars(ctx), opt);
  if (t.indexOf('calc(') >= 0) t = replaceCalc(t, opt.fmt || fmtCalc);
  return t;
}
const displayValue = v => Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);

/* ================= regras de exibição (mesma lógica do InLead) ================= */
// roles = [[cond, cond], [cond]] → (cond E cond) OU cond.  cond = {variable, compare, value, number?}
// Os dois lados passam pela troca de variáveis e viram número quando dá.
function calcOrNull(s){
  const t = String(s == null ? '' : s).trim();
  if (!t || !/^[0-9+\-*/().\s]*$/.test(t) || /[+\-*/.]$/.test(t)) return null;
  let p = 0; for (const ch of t) { if (ch === '(') p++; else if (ch === ')' && --p < 0) return null }
  if (p) return null;
  return calcEval(t);
}
function hasValidVariables(s, vars){
  const m = String(s == null ? '' : s).match(/{{[^}]+}}/g);
  if (!m) return true;
  return m.some(x => x.replace(/{{|}}/g, '').trim() in vars);
}
const countIn = (list, x) => typeof list === 'string' && list.trim() ? list.trim().split('|').filter(e => e === String(x)).length : 0;
const percentIn = (list, x) => { const l = String(list == null ? '' : list).trim().split('|'); return l.length ? countIn(String(list), x) / l.length * 100 : 0 };
function evalCond(c, ctx){
  const vars = buildVars(ctx);
  if (!hasValidVariables(c.variable, vars) || !hasValidVariables(c.value, vars)) return false;
  const lv = replaceVars(c.variable, vars), rv = replaceVars(c.value, vars);
  let l = calcOrNull(lv); if (l === null) l = lv;
  let r = calcOrNull(rv); if (r === null) r = rv;
  const i = typeof r === 'string' && r ? r.split(' ').join('|') : r;
  const n = Number(c.number);
  switch (c.compare) {
    case '==': case '=': case 'equals': return l === i;
    case '!=': case '<>': case 'not_equals': return l !== i;
    case '<': return Number(l) < Number(i);
    case '>': return Number(l) > Number(i);
    case '>=': return Number(l) >= Number(i);
    case '<=': return Number(l) <= Number(i);
    case 'includes': case 'contains': return String(l).includes(String(i));
    case 'not_contains': return !String(l).includes(String(i));
    case 'count==': return countIn(String(i), l) === n;
    case 'count>=': return countIn(String(i), l) >= n;
    case 'count<': return countIn(String(i), l) < n;
    case 'percent==': return percentIn(String(i), l) === n;
    case 'percent>': return percentIn(String(i), l) > n;
    case 'percent<': return percentIn(String(i), l) < n;
    case 'empty': return l === '' || l == null;
    case 'not_empty': case 'filled': return !(l === '' || l == null);
    default: return false;
  }
}
function evalRoles(roles, ctx){
  if (!Array.isArray(roles) || !roles.length) return true;
  const vars = buildVars(ctx), c2 = {vars};
  return roles.some(g => !Array.isArray(g) || g.every(c => evalCond(c, c2)));
}
const hasRoles = l => Array.isArray(l.roles) && l.roles.some(g => Array.isArray(g) && g.length);
const ROLE_OPERATORS = [['==', 'igual a'], ['!=', 'diferente de'], ['>', 'maior que'], ['>=', 'maior ou igual que'], ['<', 'menor que'], ['<=', 'menor ou igual que'], ['includes', 'contém'], ['count==', 'aparece exatamente'], ['count>=', 'aparece pelo menos'], ['count<', 'aparece menos de'], ['percent==', 'representa exatamente'], ['percent>', 'representa mais de'], ['percent<', 'representa menos de']];

/* ================= navegação ================= */
// Para onde vai um item (opção, botão, loading): 'next', id de etapa ou URL.
function destinationOf(funnel, item){
  if (!item) return 'next';
  let d = item.destination;
  if ((d == null || d === '') && funnel && funnel.navigation && item.id) d = funnel.navigation[item.id];
  return d == null || d === '' ? 'next' : String(d);
}
// Resolve para {step: índice} | {url} | {end: true}
function resolveDestination(funnel, fromIndex, dest){
  const steps = funnel.steps || [];
  if (isUrl(dest)) return {url: dest.trim()};
  if (dest === 'next' || dest === '' || dest == null) return fromIndex + 1 < steps.length ? {step: fromIndex + 1} : {end: true};
  if (dest === 'back') return {back: true};
  if (dest === 'first') return {step: 0};
  const k = steps.findIndex(s => s.id === dest);
  if (k >= 0) return {step: k};
  // URL sem protocolo (ex.: wa.link/xyz)
  if (/^[\w-]+(\.[\w-]+)+\/?/.test(dest)) return {url: 'https://' + dest};
  return fromIndex + 1 < steps.length ? {step: fromIndex + 1} : {end: true};
}

/* ================= links externos ================= */
// Link externo leva junto todos os parâmetros da URL atual (UTMs, fbclid…), como no InLead; os do próprio link prevalecem.
function buildRedirect(url, params){
  let u = String(url || '').trim();
  if (!u) return u;
  if (/^(mailto:|tel:|whatsapp:|javascript:)/i.test(u)) return u;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/\//, '');
  const q = u.indexOf('?'), h = u.indexOf('#');
  const hash = h >= 0 ? u.slice(h) : '', base = (q >= 0 ? u.slice(0, q) : (h >= 0 ? u.slice(0, h) : u));
  const own = q >= 0 ? new URLSearchParams(u.slice(q + 1, h >= 0 && h > q ? h : undefined)) : new URLSearchParams();
  const merged = new URLSearchParams();
  for (const k in params || {}) if (!own.has(k) && params[k] != null) merged.set(k, params[k]);
  own.forEach((v, k) => merged.set(k, v));
  const qs = merged.toString();
  return base + (qs ? '?' + qs : '') + hash;
}
// Telefone em formato internacional, só dígitos (55 + DDD + número para números do Brasil).
// Telefone no formato internacional, como o InLead (módulo 38874): com + ou 00 já vem com o país; 10 ou 11 dígitos é Brasil (55).
function toE164(v){
  const t = String(v == null ? '' : v).trim(); if (!t) return '';
  const plus = t.startsWith('+'); let d = t.replace(/\D/g, '');
  const intl = plus || d.startsWith('00'); if (!plus && intl) d = d.slice(2);
  if (!intl) { d = d.replace(/^0/, ''); if (d.length === 10 || d.length === 11) d = '55' + d }
  if (d.startsWith('55')) d = '55' + d.slice(2).replace(/^0/, '');
  return d.length >= 8 && d.length <= 15 ? d : '';
}
const qsOf = o => { const t = Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); return t ? '?' + t : '' };
const domainOf = d => 'https://' + String(d || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
// Modelos de link do botão (os mesmos do InLead). Os campos aceitam variáveis ({{nome}} ou @nome).
const LINK_MODELS = {
  whatsapp: {label: 'WhatsApp', group: 'Chat e mensagens', fields: [['phone', 'Celular', '(11) 99999-9999 ou @telefone'], ['message', 'Mensagem', 'Olá, meu nome é @nome', 'textarea']], build: e => `https://wa.me/${toE164(e.phone)}${qsOf({text: e.message})}`},
  telegram: {label: 'Telegram', group: 'Chat e mensagens', fields: [['username', 'Usuário', 'joao_silva']], build: e => `https://t.me/${e.username}`},
  messenger: {label: 'Messenger', group: 'Chat e mensagens', fields: [['username', 'Usuário / página', 'minhapagina']], build: e => `https://m.me/${e.username}`},
  instagram: {label: 'Instagram Direct', group: 'Chat e mensagens', fields: [['username', 'Usuário', 'brase']], build: e => `https://ig.me/m/${e.username}`},
  calendly: {label: 'Calendly', group: 'Agendamento', fields: [['username', 'Usuário', 'joao'], ['event', 'Evento', 'reuniao-30min'], ['date', 'Data', '2027-03-03']], build: e => `https://calendly.com/${e.username}${e.event ? '/' + e.event : ''}${qsOf({date: e.date})}`},
  calcom: {label: 'Cal.com', group: 'Agendamento', fields: [['username', 'Usuário', 'joao'], ['name', 'Nome', '@nome'], ['email', 'E-mail', '@email'], ['notes', 'Descrição', 'Quero conversar sobre…'], ['event', 'Evento', 'reuniao-30min'], ['date', 'Data', '2027-03-03']], build: e => `https://cal.com/${e.username}${e.event ? '/' + e.event : ''}${qsOf({date: e.date, name: e.name, email: e.email, notes: e.notes})}`},
  tidycal: {label: 'TidyCal', group: 'Agendamento', fields: [['username', 'Usuário', 'joao'], ['name', 'Nome', '@nome'], ['email', 'E-mail', '@email'], ['event', 'Nome do evento', 'reuniao'], ['date', 'Data', '2027-03-03']], build: e => `https://tidycal.com/${e.username}${e.event ? '/' + e.event : ''}${qsOf({'dates[]': e.date, email: e.email, name: e.name})}`},
  googlecalendar: {label: 'Google Agenda', group: 'Agendamento', fields: [['title', 'Título', 'Reunião com a Brase'], ['date', 'Data', '20270303T130000Z/20270303T140000Z'], ['details', 'Detalhes', ''], ['location', 'Local', '']], build: e => `https://calendar.google.com/calendar/render${qsOf({action: 'TEMPLATE', text: e.title, dates: e.date, details: e.details, location: e.location})}`},
  googlemeet: {label: 'Google Meet', group: 'Reuniões', fields: [['code', 'Código da reunião', 'abc-defg-hij']], build: e => `https://meet.google.com/${e.code}`},
  zoom: {label: 'Zoom', group: 'Reuniões', fields: [['meetingId', 'ID da reunião', '12345678901'], ['pwd', 'Senha', '']], build: e => `https://zoom.us/j/${e.meetingId}${qsOf({pwd: e.pwd})}`},
  whereby: {label: 'Whereby', group: 'Reuniões', fields: [['room', 'Sala', 'minha-sala']], build: e => `https://whereby.com/${e.room}`},
  shopify: {label: 'Shopify', group: 'E-commerce e vendas', fields: [['domain', 'Domínio da loja', 'minhaloja.com'], ['products', 'Produtos', '12345:1,67890:2'], ['email', 'E-mail', '@email'], ['coupon', 'Cupom', '']], build: e => `${domainOf(e.domain)}/cart/${e.products}${qsOf({discount: e.coupon, 'checkout[email]': e.email})}`},
  yampi: {label: 'Yampi', group: 'E-commerce e vendas', fields: [['domain', 'Domínio da loja', 'minhaloja.com'], ['products', 'Produtos', 'ABC123'], ['coupon', 'Cupom', '']], build: e => `${domainOf(e.domain)}/r/${e.products}${qsOf({promocode: e.coupon})}`},
  cartpanda: {label: 'Cartpanda', group: 'E-commerce e vendas', fields: [['domain', 'Domínio da loja', 'minhaloja.com'], ['products', 'Produtos', '12345:1'], ['coupon', 'Cupom', '']], build: e => `${domainOf(e.domain)}/checkout/${e.products}${qsOf({sck: e.coupon})}`},
  vtex: {label: 'VTEX', group: 'E-commerce e vendas', fields: [['domain', 'Domínio da loja', 'minhaloja.com'], ['products', 'Produtos (SKU)', '123']], build: e => `${domainOf(e.domain)}/checkout/cart/add${qsOf({sku: e.products})}`},
  woocommerce: {label: 'WooCommerce', group: 'E-commerce e vendas', fields: [['domain', 'Link do checkout', 'minhaloja.com'], ['products', 'Produtos', '12:1,34:2'], ['coupon', 'Cupom', '']], build: e => `${domainOf(e.domain)}/checkout-link/${qsOf({products: e.products, coupon: e.coupon})}`},
  hotmart: {label: 'Hotmart', group: 'Checkout', fields: [['code', 'Código do produto', 'A12345678B'], ['name', 'Nome', '@nome'], ['email', 'E-mail', '@email'], ['phone', 'Celular', '@telefone']], build: e => { const p = toE164(e.phone), br = p.startsWith('55') ? p.slice(2) : p; return `https://pay.hotmart.com/${e.code}${qsOf({email: e.email, name: e.name, phoneac: br.slice(0, 2), phonenumber: br.slice(2)})}` }},
  kirvano: {label: 'Kirvano', group: 'Checkout', fields: [['code', 'Código do produto', '75eef98a-…'], ['name', 'Nome', '@nome'], ['email', 'E-mail', '@email'], ['phone', 'Celular', '@telefone']], build: e => `https://pay.kirvano.com/${e.code}${qsOf({'customer.email': e.email, 'customer.name': e.name, 'customer.phone': toE164(e.phone)})}`},
  kiwify: {label: 'Kiwify', group: 'Checkout', fields: [['code', 'Código do produto', 'AbCdEf'], ['name', 'Nome', '@nome'], ['email', 'E-mail', '@email'], ['phone', 'Celular', '@telefone']], build: e => `https://pay.kiwify.com.br/${e.code}${qsOf({email: e.email, name: e.name, phone: toE164(e.phone).replace(/^55/, '')})}`},
};
// Destino do botão: modelo de link (se houver) ou o destino com as variáveis trocadas.
function buttonHref(content, ctx){
  const m = content && content.model && LINK_MODELS[content.model.type];
  if (m) { const vals = {}; for (const [k] of m.fields) vals[k] = interpolate(String(content.model[k] == null ? '' : content.model[k]), ctx); return m.build(vals) }
  const d = content ? content.destination : '';
  return d && /\{\{|@\w/.test(d) && (isUrl(d) || /\./.test(d)) ? interpolate(d, ctx) : d;
}

/* ================= campos ================= */
const onlyDigits = s => String(s || '').replace(/\D/g, '');
function phoneMask(v){
  let d = onlyDigits(v);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? '(' + d : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
const DDDS = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
function validateField(content, value){
  const v = value == null ? '' : String(value).trim();
  const type = content.type || 'text';
  if (!v) return content.required ? 'Campo obrigatório' : '';
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Digite um e-mail válido';
  if (type === 'phone') {
    // celular brasileiro: DDD que existe e, com 9 dígitos, começando por 9
    const d = onlyDigits(v).replace(/^55(?=\d{10,11}$)/, '');
    if (d.length < 10 || d.length > 11) return 'Digite o celular com DDD';
    if (!DDDS.has(d.slice(0, 2))) return 'Confira o DDD';
    if (d.length === 11 && d[2] !== '9') return 'Confira o número do celular';
  }
  if (type === 'number' && !isFinite(num(v, NaN))) return 'Digite um número';
  if (content.min != null && content.min !== '' && type === 'number' && num(v) < num(content.min)) return 'Valor mínimo: ' + content.min;
  if (content.max != null && content.max !== '' && type === 'number' && num(v) > num(content.max)) return 'Valor máximo: ' + content.max;
  return '';
}

/* ================= importação do InLead ================= */
const LAYER_DROP = ['chosen', 'selected', 'step'];
function fromInlead(input){
  const src = input && input.data && input.data.steps ? input.data : input;
  if (!src || !Array.isArray(src.steps)) throw new Error('JSON sem etapas (steps).');
  const nav = src.navigation || {};
  const fixItem = it => { if (it && it.id && (it.destination == null || it.destination === '') && nav[it.id]) it.destination = nav[it.id]; for (const k of ['chosen', 'selected']) delete it[k]; return it };
  const steps = src.steps.map((s, i) => ({
    id: s.id || uid(), title: s.title || `Etapa ${i + 1}`,
    position: s.position || {x: i * 288, y: 0},
    settings: s.settings || undefined,
    // cabeçalho da etapa (show_logo, show_progress, show_back) e script da etapa, como vêm do InLead
    options: s.options && !Array.isArray(s.options) ? clone(s.options) : undefined,
    script: s.script || undefined,
    layers: (s.layers || []).map(l => {
      const o = clone(l); LAYER_DROP.forEach(k => delete o[k]); delete o['data-type'];
      if (Array.isArray(o.design)) o.design = {};
      o.content = o.content || {};
      if (Array.isArray(o.content.options)) o.content.options.forEach(fixItem);
      if (o.type === 'button' || o.type === 'loading') fixItem(o.content);
      if (Array.isArray(o.content.questions)) o.content.questions.forEach(q => { delete q.chosen; delete q.selected });
      if (Array.isArray(o.roles) && !o.roles.length) delete o.roles;
      return o;
    }),
  }));
  const pixel = {};
  if (src.scripts) { if (src.scripts.facebook) pixel.facebook = String(src.scripts.facebook); if (src.scripts.google) pixel.ga4 = src.scripts.google; if (src.scripts.gtm) pixel.gtm = src.scripts.gtm }
  return {
    schema: 'brase-funil/1',
    title: src.title || 'Funil importado', slug: src.slug || '', description: src.description || '',
    steps, design: Object.assign({}, DEFAULT_DESIGN, clone(src.design || {})),
    settings: {pixel, scripts: {head: '', body: ''}, seo: Array.isArray(src.seo) ? {} : (src.seo || {}), filter: {enabled: !!src.traffic}},
    webhookHint: src.webhook ? {trigger: src.webhook.trigger === 'onClick' ? 'component' : src.webhook.trigger, component: src.webhook.component, method: src.webhook.method, enabled: !!src.webhook.enabled} : null,
    origin: {platform: 'inlead', id: src.id, hash: src.hash, schemaVersion: src.schemaVersion},
  };
}

/* ================= aparência ================= */
const DEFAULT_DESIGN = {
  logo: {type: 'image', src: '', width: 0, height: 0, size: 'normal', position: 'center'},
  themeColor: '#6366f1', contentColor: '#475569', titleColor: '#0f172a', backgroundColor: '#ffffff',
  featuredFont: 'inter', contentFont: 'inter', titleSize: 0.5, contentSize: 16,
  rounded: 'rounded-2xl', elementSize: '56px', align: 'center', width: 440, spacing: 0, progress: 'bar',
  background: {type: 'none'},
};
const FONTS = {
  inter: 'Inter', roboto: 'Roboto', poppins: 'Poppins', montserrat: 'Montserrat', 'open-sans': 'Open Sans', lato: 'Lato',
  nunito: 'Nunito', raleway: 'Raleway', oswald: 'Oswald', 'playfair-display': 'Playfair Display', 'dm-sans': 'DM Sans',
  manrope: 'Manrope', 'plus-jakarta-sans': 'Plus Jakarta Sans', 'space-grotesk': 'Space Grotesk', archivo: 'Archivo', 'bebas-neue': 'Bebas Neue',
};
const fontFamily = k => `"${FONTS[k] || FONTS.inter}", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
function fontsUrl(design){
  const fams = [...new Set([design.featuredFont, design.contentFont].map(k => FONTS[k] || FONTS.inter))];
  return 'https://fonts.googleapis.com/css2?' + fams.map(f => 'family=' + f.replace(/ /g, '+') + ':wght@400;500;600;700;800').join('&') + '&display=swap';
}
const RADIUS = {'rounded-none': '0px', 'rounded-sm': '2px', rounded: '4px', 'rounded-md': '6px', 'rounded-lg': '8px', 'rounded-xl': '12px', 'rounded-2xl': '16px', 'rounded-3xl': '24px', 'rounded-full': '999px'};
function twSize(cls, fallback){
  // h-[1rem], h-4, gap-2, border-[2px]
  const m = /\[([^\]]+)\]/.exec(cls || '');
  if (m) return m[1];
  const n = /-(\d+(?:\.\d+)?)$/.exec(cls || '');
  if (n) return (+n[1] * 0.25) + 'rem';
  return fallback;
}
function hexToRgb(h){
  h = String(h || '').trim();
  let m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(h); if (m) return [+m[1], +m[2], +m[3]];
  h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16); if (!isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const luminance = c => { const [r, g, b] = hexToRgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b };
const contrastText = bg => luminance(bg) > 0.45 ? '#0f172a' : '#ffffff';
function cssVars(design){
  const d = Object.assign({}, DEFAULT_DESIGN, design || {});
  const bg = d.backgroundColor || '#ffffff', dark = luminance(bg) < 0.35;
  const ts = clamp(num(d.titleSize, 0.5), 0, 1);
  return {
    '--fn-theme': d.themeColor, '--fn-theme-ink': contrastText(d.themeColor),
    '--fn-title': d.titleColor, '--fn-content': d.contentColor, '--fn-bg': bg,
    '--fn-card': dark ? 'rgba(255,255,255,.04)' : 'rgba(15,23,42,.03)',
    '--fn-line': dark ? 'rgba(255,255,255,.12)' : 'rgba(15,23,42,.12)',
    '--fn-muted': dark ? 'rgba(255,255,255,.55)' : 'rgba(15,23,42,.55)',
    '--fn-radius': RADIUS[d.rounded] || '16px', '--fn-el': d.elementSize || '56px',
    '--fn-font-title': fontFamily(d.featuredFont), '--fn-font-text': fontFamily(d.contentFont),
    '--fn-size': num(d.contentSize, 16) + 'px', '--fn-h1': (1.5 + ts) + 'em',
    '--fn-width': clamp(num(d.width, 440), 320, 1100) + 'px', '--fn-gap': (1 + num(d.spacing, 0) * 0.25) + 'rem',
  };
}

/* ================= componentes: catálogo (o mesmo do InLead) ================= */
const COMPONENTS = [
  {group: 'Formulário', type: 'field', sub: 'text', title: 'Campo', icon: 'input'},
  {group: 'Formulário', type: 'field', sub: 'email', title: 'E-mail', icon: 'at'},
  {group: 'Formulário', type: 'field', sub: 'phone', title: 'Telefone', icon: 'phone'},
  {group: 'Formulário', type: 'button', title: 'Botão', icon: 'button'},
  {group: 'Formulário', type: 'field', sub: 'number', title: 'Número', icon: 'hash'},
  {group: 'Formulário', type: 'field', sub: 'textarea', title: 'Textarea', icon: 'textarea'},
  {group: 'Formulário', type: 'date', title: 'Data', icon: 'calendar'},
  {group: 'Formulário', type: 'height', title: 'Altura', icon: 'ruler'},
  {group: 'Formulário', type: 'weight', title: 'Peso', icon: 'weight'},
  {group: 'Quiz', type: 'options', sub: 'list', title: 'Opções', icon: 'list'},
  {group: 'Quiz', type: 'options', sub: 'multiple', title: 'Múltipla escolha', icon: 'checks'},
  {group: 'Quiz', type: 'options', sub: 'single', title: 'Escolha única', icon: 'radio'},
  {group: 'Quiz', type: 'options', sub: 'choice', title: 'Sim/Não', icon: 'yesno'},
  {group: 'Quiz', type: 'options', sub: 'video', title: 'Vídeo resposta', icon: 'film'},
  {group: 'Mídia e conteúdo', type: 'text', title: 'Texto', icon: 'text'},
  {group: 'Mídia e conteúdo', type: 'image', title: 'Imagem', icon: 'image'},
  {group: 'Mídia e conteúdo', type: 'video', title: 'Vídeo', icon: 'film'},
  {group: 'Mídia e conteúdo', type: 'audio', title: 'Áudio', icon: 'audio'},
  {group: 'Atenção', type: 'alert', title: 'Alerta', icon: 'alert'},
  {group: 'Atenção', type: 'notification', title: 'Notificação', icon: 'bell'},
  {group: 'Atenção', type: 'timer', title: 'Timer', icon: 'clock'},
  {group: 'Atenção', type: 'loading', title: 'Loading', icon: 'loader'},
  {group: 'Atenção', type: 'metric', title: 'Nível', icon: 'sliders'},
  {group: 'Argumentação', type: 'arguments', title: 'Argumentos', icon: 'bulb'},
  {group: 'Argumentação', type: 'carousel', title: 'Carrossel', icon: 'carousel'},
  {group: 'Argumentação', type: 'quotes', title: 'Depoimentos', icon: 'quote'},
  {group: 'Argumentação', type: 'faq', title: 'FAQ', icon: 'faq'},
  {group: 'Argumentação', type: 'price', title: 'Preço', icon: 'price'},
  {group: 'Argumentação', type: 'compare', title: 'Antes/Depois', icon: 'compare'},
  {group: 'Argumentação', type: 'checklist', title: 'Checklist', icon: 'check'},
  {group: 'Gráficos', type: 'graphics', title: 'Métricas', icon: 'gauge'},
  {group: 'Gráficos', type: 'charts', title: 'Gráficos', icon: 'chart'},
  {group: 'Personalização', type: 'ifood', title: 'Raio-X iFood', icon: 'search'},
  {group: 'Personalização', type: 'script', title: 'HTML/Script', icon: 'code'},
  {group: 'Personalização', type: 'clear', title: 'Espaço', icon: 'space'},
];
const TYPE_TITLE = {text: 'Texto', image: 'Imagem', video: 'Vídeo', audio: 'Áudio', button: 'Botão', options: 'Opções', field: 'Campo', date: 'Data', height: 'Altura', weight: 'Peso', metric: 'Nível', timer: 'Timer', loading: 'Loading', price: 'Preço', faq: 'FAQ', clear: 'Espaço', alert: 'Alerta', notification: 'Notificação', arguments: 'Argumentos', quotes: 'Depoimentos', checklist: 'Checklist', compare: 'Antes/Depois', carousel: 'Carrossel', graphics: 'Métricas', charts: 'Gráficos', script: 'HTML/Script', group: 'Grupo', ifood: 'Raio-X iFood'};
// Tipos que guardam resposta (contam como interação).
const INPUT_TYPES = ['options', 'field', 'date', 'height', 'weight', 'ifood'];
// Nomes antigos deste app → nomes do InLead.
const TYPE_ALIAS = {testimonials: 'quotes', beforeafter: 'compare', stats: 'graphics', chart: 'charts', html: 'script'};
function normalizeLayer(l){
  if (!l) return l;
  const lc = l.content || {};
  if (l.type === 'arguments' && Array.isArray(lc.items) && !lc.arguments) return Object.assign({}, l, {content: Object.assign({}, lc, {items: undefined, cols: lc.cols || (l.design && l.design.grid) || 'grid-cols-1', arguments: lc.items.map(a => ({id: a.id || uid(), image: a.icon ? {type: 'emoji', src: a.icon} : {type: 'image', src: ''}, text: `<h3>${esc(a.title || '')}</h3><p>${esc(a.text || '')}</p>`}))})});
  if (l.type === 'carousel' && Array.isArray(lc.items) && lc.items.some(i => i.caption != null && i.text == null)) return Object.assign({}, l, {content: Object.assign({}, lc, {items: lc.items.map(i => i.caption != null && i.text == null ? Object.assign({}, i, {text: `<p class="ql-align-center">${esc(i.caption)}</p>`, caption: undefined}) : i)})});
  if (!TYPE_ALIAS[l.type]) return l;
  const c = l.content || {}, n = Object.assign({}, l, {type: TYPE_ALIAS[l.type]});
  if (l.type === 'testimonials') n.content = {id: c.id, name: c.name, quotes: (c.items || []).map(t => ({id: t.id || uid(), text: t.text, activity: t.handle, name: t.name, rate: t.stars, image: t.image ? {type: 'image', src: t.image} : undefined}))};
  if (l.type === 'beforeafter') n.content = {id: c.id, name: c.name, first_image: c.before || {type: 'image', src: ''}, secondary_image: c.after || {type: 'image', src: ''}, first_label: c.beforeLabel, secondary_label: c.afterLabel};
  if (l.type === 'stats') n.content = {id: c.id, name: c.name, cols: 'grid-cols-2', graphics: (c.items || []).map(t => ({id: t.id || uid(), type: 'circle', style: 'theme', percent: t.value, legend: `<p class="ql-align-center">${esc(t.label || '')}</p>`}))};
  if (l.type === 'chart') n.content = {id: c.id, name: c.name, type: 'bar', title: c.title, xAxis: (c.items || []).map(i => i.label), datasets: [{id: uid(), title: c.title || 'Conjunto A', datas: (c.items || []).map(i => ({id: uid(), value: i.value}))}]};
  if (l.type === 'html') n.content = {id: c.id, name: c.name, script: c.html};
  return n;
}

function opt(label, value, extra){ return Object.assign({id: uid(), image: {type: 'image', src: null}, score: 0, value, label: `<p>${label}</p>`, destination: 'next'}, extra || {}) }
const INTRO = "<h2 class='ql-align-center'>Qual a questão a ser respondida?</h2><p class='ql-align-center'>Digite aqui uma descrição de ajuda para introduzir o usuário à questão.</p>";
// Camada nova, com o conteúdo padrão de cada componente (o mesmo do InLead).
function newLayer(type, sub){
  const id = uid();
  const L = {id, title: TYPE_TITLE[type] || type, type, design: {basis: 100}, content: {id: uid(), name: uid()}};
  const c = L.content;
  switch (type) {
    case 'text': c.text = "<h1 class='ql-align-center'>Texto informativo</h1><p class='ql-align-center'>Este componente serve para fornecer instruções claras ao usuário. Utilize-o para destacar informações essenciais de forma objetiva e fácil de entender.</p>"; break;
    case 'image': c.image = {type: 'image', src: ''}; c.alt = ''; L.design = {basis: 100, width: 100}; break;
    case 'video': Object.assign(c, {title: '', description: '', video: ''}); L.design = {basis: 100, ratio: 'video'}; break;
    case 'audio': c.audio = {type: 'audio', src: ''}; c.image = {type: 'image', src: ''}; c.sender = ''; L.design = {basis: 100, model: 'whatsapp', theme: 'light'}; break;
    case 'button': Object.assign(c, {name: 'button_' + uid(), type: 'next', label: 'Continuar', destination: 'next', pulse: false, target: false}); L.design = {basis: 100, style: 'theme'}; break;
    case 'field': {
      const s = sub || 'text';
      const T = {text: ['Campo', 'Nome', 'Digite seu nome...', 'field_'], email: ['E-mail', 'E-mail', 'Digite seu e-mail...', 'email_'], phone: ['Telefone', 'Celular', 'Digite seu celular...', 'phone_'], number: ['Número', 'Número', 'Digite um número...', 'number_'], textarea: ['Textarea', 'Mensagem', 'Digite sua mensagem...', 'textarea_']}[s] || ['Campo', 'Campo', '', 'field_'];
      L.title = T[0]; Object.assign(c, {name: T[3] + uid(), title: T[1], placeholder: T[2], type: s, required: true});
      if (s === 'phone') c.mask = 'phone';
      break;
    }
    case 'date': Object.assign(c, {name: 'date_' + uid(), title: 'Data', placeholder: 'Insira uma data...', disablePast: true, required: true}); break;
    case 'height': Object.assign(c, {name: 'height_' + uid(), title: 'Qual a sua altura?', value: 180, type: 'metric', unit: 'cm', min: 140, max: 220}); break;
    case 'weight': Object.assign(c, {name: 'weight_' + uid(), title: 'Qual o seu peso?', value: 70, type: 'metric', unit: 'kg', min: 40, max: 250}); break;
    case 'options': {
      const s = sub || 'list';
      Object.assign(c, {name: (s === 'multiple' ? 'multiple_' : 'options_') + uid(), required: true, introType: 'none', introduction: null});
      L.design = {icon: 'select', iconPosition: 'end', grid: 'grid-cols-1', orientation: 'vertical', order: 'default', transparentImage: true, aspectImage: 'aspect-[1/1]', basis: 100, background: 'contrast', border: 'border-[2px]', shadow: 'shadow-none', gap: 'gap-2'};
      if (s === 'multiple') { Object.assign(c, {multiple: true, type: 'multiple'}); L.design.icon = 'checkbox'; c.options = ['A', 'B', 'C', 'D'].map((v, k) => opt('Opção ' + (k + 1), v, {score: k + 1})) }
      else if (s === 'single') { c.type = 'single'; c.multiple = false; c.options = [opt('Aqui você descreve a primeira opção.', 'A', {score: 1}), opt('Depois você descreve a segunda opção.', 'B', {score: 2}), opt('Caso precise de mais opções é só adicionar.', 'C', {score: 3})] }
      else if (s === 'choice') { c.type = 'choice'; L.design.icon = 'none'; L.design.grid = 'grid-cols-2'; L.design.align = 'center'; c.options = [opt('✅ Sim', 'yes', {score: 1}), opt('🚫 Não', 'no', {score: 2})] }
      else if (s === 'video') { Object.assign(c, {type: 'video', introType: 'video', introduction: '', aspectRatio: 'video'}); c.options = [opt('Aqui você descreve a primeira opção.', 'A', {score: 1}), opt('Depois você descreve a segunda opção.', 'B', {score: 2}), opt('Caso precise de mais opções é só adicionar.', 'C', {score: 3})] }
      else { c.type = 'options'; c.options = ['A', 'B', 'C', 'D'].map((v, k) => opt('Opção ' + (k + 1), v, {score: k + 1})) }
      L.title = {multiple: 'Múltipla escolha', single: 'Escolha única', choice: 'Sim/Não', video: 'Vídeo resposta'}[s] || 'Opções';
      break;
    }
    case 'metric': Object.assign(c, {title: 'Nível', name: 'metric_' + uid(), subtitle: 'Fusce vitae tellus', percent: 75, show_title: true, show_percent: true, show_dot: true}); L.design = {basis: 100, type: 'default', color: 'theme'}; break;
    case 'timer': Object.assign(c, {basedOn: 'time', text: '<p><strong>Resgate agora seu cupom: [time]</strong></p><p>Texto de apoio</p>', time: 300}); L.design = {basis: 100, style: 'black', layout: 'countdown'}; break;
    case 'loading': Object.assign(c, {title: 'Carregando...', name: 'loader_' + uid(), description: "<p class='ql-align-center'>Fusce vitae tellus in risus sagittis condimentum!</p>", seconds: 5, starts: 0, destination: 'next', show_title: true, show_percent: true, show_progress: true}); L.design = {layout: 'default'}; break;
    case 'price': Object.assign(c, {title: '<p><strong>Plano PRO</strong></p>', value: 'R$ 89,90', before: '10% off', after: 'à vista', type: 'redirect', redirect: true, featured: ''}); L.design = {basis: 100, style: 'theme'}; break;
    case 'faq': Object.assign(c, {firstQuestionOpened: true, questions: [{id: uid(), question: 'Qual a primeira dúvida a ser resolvida?', answer: '<p>Este é apenas um texto de exemplo utilizado para ilustrar como a resposta de uma dúvida frequente será exibida nesta seção.</p>'}, {id: uid(), question: 'Descreva outra dúvida a ser resolvida.', answer: '<p>Texto genérico de demonstração. Serve apenas como modelo visual para representar uma resposta real a ser inserida posteriormente.</p>'}]}); L.design = {icon: 'chevron'}; break;
    case 'clear': c.clear = 'h-[1rem]'; L.design = {}; break;
    case 'alert': Object.assign(c, {text: 'Ponto de <b>atenção</b> para o usuário receber um aviso!', icon: {type: 'emoji', value: '⚠️'}}); L.design = {basis: 100, style: 'danger', padding: '16', borderWidth: 1}; break;
    case 'notification': Object.assign(c, {title: '<strong>@1</strong> acabou de se cadastrar via <strong>@2</strong>!', text: 'Corra! Faltam apenas <strong>@3</strong> ofertas disponíveis nessa promoção', position: 'default', duration: 5, interval: 2, variables: [{id: uid(), name: '@1', values: ['Rafael', 'Beatriz', 'Carlos', 'Cláudia']}, {id: uid(), name: '@2', values: ['Instagram', 'Whatsapp', 'Facebook', 'Instagram']}, {id: uid(), name: '@3', values: ['7', '6', '5', '4']}]}); L.design = {basis: 100, style: 'white'}; break;
    case 'arguments': Object.assign(c, {cols: 'grid-cols-2', arguments: [{id: uid(), image: {type: 'image', src: ''}, text: "<h3 class='ql-align-center'>Fusce vitae</h3><p class='ql-align-center'>Tellus in risus sagittis condimentum</p>"}, {id: uid(), image: {type: 'image', src: ''}, text: "<h3 class='ql-align-center'>Fusce vitae</h3><p class='ql-align-center'>Tellus in risus sagittis condimentum</p>"}]}); L.design = {basis: 100, aspectImage: 'aspect-[1/1]', gridCols: 'grid-cols-2', order: 'default'}; break;
    case 'quotes': Object.assign(c, {layout: 'list', quotes: [{id: uid(), text: 'A experiência foi excelente do início ao fim. Atendimento rápido, equipe super atenciosa e resultados acima do esperado. Com certeza recomendaria!', activity: '@rafael.nascimento', name: 'Rafael Nascimento', rate: 5, image: {type: 'image', src: ''}}, {id: uid(), text: 'Fiquei impressionado com a qualidade e o cuidado em cada detalhe. Superou todas as minhas expectativas. Já virei cliente fiel!', activity: '@camila.ferreira', name: 'Camila Ferreira', rate: 5, image: {type: 'image', src: ''}}]}); L.design = {basis: 100, gap: 'gap-2'}; break;
    case 'compare': Object.assign(c, {first_image: {type: 'image', src: ''}, secondary_image: {type: 'image', src: ''}, first_label: 'Antes', secondary_label: 'Depois'}); L.design = {basis: 100, ratio: 'square'}; break;
    case 'carousel': Object.assign(c, {centered: true, spoiler: true, pagination: true, autoplay: true, layout: 'image_text', items: [{id: uid(), image: {type: 'image', src: ''}, text: "<p class='ql-align-center'>Exemplo de descrição</p>"}, {id: uid(), image: {type: 'image', src: ''}, text: "<p class='ql-align-center'>Exemplo de descrição</p>"}]}); L.design = {basis: 100, border: 'border', layout: 'image_text', aspectImage: 'aspect-[1/1]'}; break;
    case 'checklist': c.items = [{id: uid(), text: 'Utilize este <b>checklist</b> para guiar seu <b>usuário</b> por etapas importantes.', icon: {type: 'emoji', value: '✅'}}, {id: uid(), text: 'Perfeito para <b>organizar</b> informações, de forma rápida e visual.', icon: {type: 'emoji', value: '✅'}}, {id: uid(), text: 'Este componente aumenta o engajamento e torna a <b>experiência</b> mais objetiva.', icon: {type: 'emoji', value: '✅'}}]; L.design = {basis: 100}; break;
    case 'graphics': Object.assign(c, {cols: 'grid-cols-2', order: 'default', graphics: [{id: uid(), type: 'bar', style: 'theme', percent: 30, legend: "<p class='ql-align-center'>Fusce vitae tellus in risus sagittis condimentum</p>"}, {id: uid(), type: 'bar', style: 'theme', percent: 30, legend: "<p class='ql-align-center'>Fusce vitae tellus in risus sagittis condimentum</p>"}]}); L.design = {basis: 100}; break;
    case 'charts': Object.assign(c, {type: 'cartesian', datasetCount: 1, xAxis: ['Ontem', 'Hoje', 'Amanhã'], datasets: [{id: uid(), title: 'Conjunto A', datas: [{id: uid(), value: 10, tooltip: ''}, {id: uid(), value: 30, tooltip: 'Você', featured: true}, {id: uid(), value: 90, tooltip: ''}]}, {id: uid(), title: 'Conjunto B', datas: [{id: uid(), value: 20}, {id: uid(), value: 60, tooltip: 'Concorrente', featured: true}, {id: uid(), value: 80}]}]}); L.design = {basis: 100, color: 'gradient-invert', area: true, axisY: true, axisX: true, gridY: true, gridX: true}; break;
    case 'script': c.script = '<div style="text-align:center;padding:12px">Seu HTML aqui</div>'; L.design = {basis: 100}; break;
    // Raio-X: a pessoa cola o link da loja no iFood e vê avaliações, pedidos estimados e a posição na região (app de Restaurantes).
    case 'ifood': Object.assign(c, {name: 'ifood_' + uid(), title: 'Cole o link da sua loja no iFood', placeholder: 'https://www.ifood.com.br/delivery/…', help: 'No app do iFood: abra sua loja, toque em compartilhar e copie o link.', button: 'Ver o Raio-X da minha loja', km: 3, required: false}); L.design = {basis: 100, style: 'theme'}; break;
  }
  return L;
}
function newStep(title, layers){ return {id: uid(), title: title || 'Nova etapa', position: {x: 0, y: 0}, layers: layers || []} }
// Modelos de etapa (como os "Modelos" do InLead).
function stepTemplate(kind){
  const T = (html) => { const l = newLayer('text'); l.content.text = html; return l };
  const btn = label => { const b = newLayer('button'); b.content.label = label; return b };
  const awaiting = (o, patch) => { o.content.awaitSubmit = true; Object.assign(o.design, patch || {}); return o };
  switch (kind) {
    case 'inicial': return newStep('Página inicial', [T('<h1 class="ql-align-center">Título que prende a atenção</h1><p class="ql-align-center">Uma frase que explica o que a pessoa ganha respondendo.</p>'), newLayer('image'), btn('COMEÇAR ➔')]);
    case 'quiz': { const o = awaiting(newLayer('options', 'list'), {background: 'contrast', icon: 'select'}); o.content.introType = 'text'; o.content.introduction = INTRO; o.content.options = [opt('Melhor escolha possível', 'A'), opt('Pode ser útil', 'B'), opt('Não tenho certeza', 'C'), opt('Prefiro outra opção', 'D')]; return newStep('Quiz em lista', [o, btn('Continuar')]) }
    case 'colunas': { const o = awaiting(newLayer('options', 'list'), {grid: 'grid-cols-2'}); o.content.options.forEach(x => { x.image = {type: 'image', src: ''} }); return newStep('Quiz em colunas', [T('<h1 class="ql-align-center">Escolha uma opção</h1>'), o, btn('Continuar')]) }
    case 'multipla': return newStep('Múltipla escolha', [T('<h1 class="ql-align-center">Marque todas que se aplicam</h1>'), newLayer('options', 'multiple'), btn('Continuar')]);
    case 'like': { const o = awaiting(newLayer('options', 'list'), {grid: 'grid-cols-5', icon: 'none', align: 'center'}); o.content.options = ['1', '2', '3', '4', '5'].map(n => opt(n, n, {score: +n})); return newStep('Escala de like', [T('<h2 class="ql-align-center">De 1 a 5, quanto você concorda?</h2>'), o, btn('Continuar')]) }
    case 'formulario': return newStep('Formulário', [T('<h1 class="ql-align-center">Falta pouco!</h1><p class="ql-align-center">Deixe seus dados para receber o resultado.</p>'), newLayer('field', 'text'), newLayer('field', 'email'), newLayer('field', 'phone'), btn('ENVIAR')]);
    case 'captura': return newStep('Captura simples', [T('<h2 class="ql-align-center">Receba no seu WhatsApp</h2>'), newLayer('field', 'phone'), btn('QUERO RECEBER')]);
    case 'grafico': return newStep('Gráfico', [T('<h2 class="ql-align-center">Veja a sua evolução</h2>'), newLayer('charts'), newLayer('graphics'), btn('Continuar')]);
    case 'progresso': return newStep('Progresso', [newLayer('loading')]);
    case 'checkout': return newStep('Pré-checkout', [newLayer('timer'), T('<h1 class="ql-align-center">Oferta especial</h1>'), newLayer('checklist'), newLayer('quotes'), newLayer('price'), btn('QUERO AGORA'), newLayer('faq')]);
    default: return newStep('Nova etapa', []);
  }
}
const STEP_TEMPLATES = [['inicial', 'Página inicial'], ['quiz', 'Quiz em lista'], ['formulario', 'Formulário'], ['captura', 'Captura simples'], ['colunas', 'Quiz em colunas'], ['multipla', 'Múltipla escolha'], ['like', 'Escala de like'], ['grafico', 'Gráfico'], ['progresso', 'Progresso'], ['checkout', 'Pré-checkout'], ['branco', 'Em branco']];

function newFunnel(title){
  const f = {schema: 'brase-funil/1', title: title || 'Novo funil', slug: '', steps: [stepTemplate('inicial'), stepTemplate('quiz'), stepTemplate('formulario')], design: clone(DEFAULT_DESIGN), settings: {pixel: {}, scripts: {head: '', body: ''}, seo: {}, filter: {enabled: false}}};
  f.steps.forEach((s, i) => { s.position = {x: i * 300, y: 0} });
  return f;
}
// Garante ids únicos (camadas, opções, conteúdos) ao duplicar.
function reId(layer){
  const l = clone(layer); l.id = uid();
  if (l.content) { l.content.id = uid(); for (const k of ['options', 'questions', 'items', 'arguments', 'quotes', 'graphics', 'datasets', 'variables']) if (Array.isArray(l.content[k])) l.content[k].forEach(o => { if (o && typeof o === 'object') o.id = uid() }) }
  return l;
}

/* ================= Pontos de navegação de uma etapa (para o Fluxo) ================= */
function outlets(funnel, step){
  const out = [];
  for (const l of step.layers || []) {
    if (!l || l.archived) continue;
    // Como no Fluxo do InLead: múltipla escolha não tem saída por opção (quem avança é o botão).
    if (l.type === 'options') { if (!l.content.multiple) (l.content.options || []).forEach(o => out.push({layer: l, item: o, label: stripHtml(o.label) || o.value || 'Opção', dest: destinationOf(funnel, o)})) }
    else if (l.type === 'button') out.push({layer: l, item: l.content, label: l.content.label || 'Botão', dest: l.content.model && LINK_MODELS[l.content.model.type] ? (buttonHref(l.content, {}) || 'https://') : destinationOf(funnel, l.content)});
    else if (l.type === 'loading') out.push({layer: l, item: l.content, label: 'Ao terminar', dest: destinationOf(funnel, l.content)});
  }
  return out;
}

/* ================= Progresso pelo caminho ================= */
// Quantas etapas ainda faltam, pelo caminho mais curto, até o funil terminar (link externo ou fim). null = sem saída.
// A barra usa isso em vez da posição na lista: num funil com ramos, quem segue o caminho principal vê a barra andar
// de verdade e chegar ao fim na última etapa.
function stepsLeft(funnel, from){
  const steps = (funnel && funnel.steps) || [], seen = new Set([from]);
  let level = [from];
  for (let d = 0; level.length && d <= steps.length; d++) {
    const next = [];
    for (const i of level) {
      const st = steps[i]; if (!st) continue;
      const outs = outlets(funnel, st), dests = outs.length ? outs.map(o => o.dest) : ['next'];
      for (const dest of dests) {
        const to = resolveDestination(funnel, i, dest);
        if (to.url || to.end) return d;
        if (to.step != null && !seen.has(to.step)) { seen.add(to.step); next.push(to.step) }
      }
    }
    level = next;
  }
  return null;
}

/* ================= DOM (navegador) ================= */
if (!doc) return {uid, esc, clone, stripHtml, plainLabel, calcEval, replaceCalc, interpolate, evalRoles, evalCond, destinationOf, resolveDestination, phoneMask, validateField, fromInlead, newLayer, newStep, stepTemplate, newFunnel, reId, outlets, stepsLeft, totalScore, isUrl, cssVars, COMPONENTS, DEFAULT_DESIGN, STEP_TEMPLATES, TYPE_TITLE, buildVars, replaceVars, buildRedirect, toE164, LINK_MODELS, buttonHref, ROLE_OPERATORS, normalizeLayer, INPUT_TYPES, TYPE_ALIAS, abAssign, abTests, abName, abVariants};

const CSS = `
.fnr{--fn-theme:#6366f1;font-family:var(--fn-font-text);font-size:var(--fn-size);color:var(--fn-content);background:var(--fn-bg);position:relative;min-height:100%;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;line-height:1.4;overflow-wrap:break-word}
.fnr *,.fnr *::before,.fnr *::after{box-sizing:border-box}
.fnr-bgx{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}.fnr-bgx img,.fnr-bgx video{width:100%;height:100%;object-fit:cover}
.fnr-page{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;width:100%;max-width:var(--fn-width);margin:0 auto;padding:12px 16px 28px}
.fnr-head{display:grid;grid-template-columns:40px 1fr 40px;align-items:center;min-height:40px;gap:4px}
.fnr-back{width:36px;height:36px;border:0;background:transparent;color:var(--fn-title);opacity:.75;cursor:pointer;border-radius:50%;display:grid;place-items:center;font:inherit;padding:0}
.fnr-back:hover{opacity:1;background:var(--fn-card)}.fnr-back[hidden]{visibility:hidden;display:grid!important}
.fnr-back span{font-size:12px;margin-left:2px}
.fnr-logo{grid-column:2;justify-self:center;display:flex;align-items:center}.fnr-logo img{display:block;height:60px;width:auto;max-width:200px;object-fit:contain}
.fnr-logo.s-small img{height:42px}.fnr-logo.s-large img{height:84px}.fnr-logo.p-left{justify-self:start}
.fnr-progress{grid-column:1/-1;height:7px;border-radius:99px;background:color-mix(in srgb,var(--fn-theme) 18%,transparent);overflow:hidden;margin:10px 0 4px}
.fnr-progress i{display:block;height:100%;background:var(--fn-theme);border-radius:inherit;transition:width .5s cubic-bezier(.22,.8,.3,1)}
/* troca de etapa: só o corpo entra, o cabeçalho (logo, voltar e barra) fica */
.fnr-in{animation:fnr-in .28s cubic-bezier(.22,.8,.3,1) both}.fnr-in-back{animation:fnr-in-back .28s cubic-bezier(.22,.8,.3,1) both}
@keyframes fnr-in{from{opacity:0;transform:translate3d(0,12px,0)}to{opacity:1;transform:none}}@keyframes fnr-in-back{from{opacity:0;transform:translate3d(0,-12px,0)}to{opacity:1;transform:none}}
.fnr-body{flex:1;display:flex;flex-direction:column;padding-top:20px}
.fnr-body.al-center{justify-content:center}
.fnr-layers{display:flex;flex-wrap:wrap;gap:var(--fn-gap) 0;align-content:flex-start;margin:0 -4px}
.fnr-l{padding:0 4px;min-width:0;position:relative}
.fnr-l.is-cond-edit{outline:1px dashed color-mix(in srgb,var(--fn-title) 55%,transparent);outline-offset:2px;border-radius:4px}
.fnr-edit .fnr-l{cursor:pointer}
.fnr-edit .fnr-l:hover{outline:1px solid #3b82f6;outline-offset:2px;border-radius:4px}
.fnr-edit .fnr-l.is-sel{outline:2px solid #2563eb;outline-offset:2px;border-radius:4px}
.fnr-edit .fnr-l .fnr-tag{position:absolute;top:-10px;left:6px;z-index:5;background:#2563eb;color:#fff;font:600 10px/1 system-ui,sans-serif;padding:4px 6px;border-radius:4px;display:none}
.fnr-edit .fnr-l.is-sel .fnr-tag,.fnr-edit .fnr-l:hover .fnr-tag{display:block}
.fnr-edit .fnr-l.is-hidden-edit{opacity:.45}
.fnr-edit .fnr-l.drop-before::before{content:"";position:absolute;left:0;right:0;top:-6px;height:3px;background:#2563eb;border-radius:3px}
.fnr-edit .fnr-l.drop-after::after{content:"";position:absolute;left:0;right:0;bottom:-6px;height:3px;background:#2563eb;border-radius:3px}
.fnr-edit a,.fnr-edit button,.fnr-edit input,.fnr-edit textarea,.fnr-edit iframe{pointer-events:none}
.fnr-rich{color:var(--fn-content)}
.fnr-rich h1,.fnr-rich h2,.fnr-rich h3,.fnr-rich h4{font-family:var(--fn-font-title);color:var(--fn-title);margin:0;line-height:1.18;font-weight:700}
.fnr-rich h1{font-size:var(--fn-h1);font-weight:800;letter-spacing:-.01em}.fnr-rich h2{font-size:calc(var(--fn-h1)*.75)}.fnr-rich h3{font-size:calc(var(--fn-h1)*.62)}.fnr-rich h4{font-size:1.05em}
.fnr-rich p{margin:0}.fnr-rich p:empty,.fnr-rich h1:empty,.fnr-rich h2:empty,.fnr-rich h3:empty{height:.6em}
.fnr-rich ul,.fnr-rich ol{margin:.2em 0;padding-left:1.4em}.fnr-rich a{color:var(--fn-theme)}
.fnr-rich .ql-align-center{text-align:center}.fnr-rich .ql-align-right{text-align:right}.fnr-rich .ql-align-justify{text-align:justify}
.fnr-rich .ql-size-small{font-size:.75em}.fnr-rich .ql-size-large{font-size:1.5em}.fnr-rich .ql-size-huge{font-size:2.5em}
.fnr-rich img{max-width:100%;height:auto}
.fnr-btn{width:100%;min-height:var(--fn-el);border:0;border-radius:var(--fn-radius);background:var(--fn-theme);color:var(--fn-theme-ink);font:600 15px/1.2 var(--fn-font-text);padding:10px 18px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;text-align:center;transition:transform .12s,filter .15s;text-decoration:none}
.fnr-btn:hover{filter:brightness(1.08)}.fnr-btn:active{transform:scale(.985)}
.fnr-btn.st-success{background:#22c55e;color:#fff}.fnr-btn.st-danger{background:#dc2626;color:#fff}.fnr-btn.st-dark{background:#0f172a;color:#fff}.fnr-btn.st-light{background:#fff;color:#0f172a}
.fnr-btn.st-outline{background:transparent;color:var(--fn-theme);box-shadow:inset 0 0 0 2px var(--fn-theme)}
.fnr-btn.st-contrast{background:var(--fn-card);color:var(--fn-title);box-shadow:inset 0 0 0 1px var(--fn-line)}
.fnr-btn.is-pulse{animation:fnr-pulse 1.6s infinite}
.fnr-btn[disabled]{opacity:.6;cursor:wait}
@keyframes fnr-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--fn-theme) 55%,transparent)}70%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}
.fnr-opts{display:grid;gap:var(--fn-ogap,.5rem)}
.fnr-opt{position:relative;display:flex;align-items:center;gap:10px;min-height:var(--fn-el);padding:10px 14px;border-radius:var(--fn-radius);border:var(--fn-obw,2px) solid color-mix(in srgb,var(--fn-theme) 55%,var(--fn-bg));background:color-mix(in srgb,var(--fn-theme) 9%,var(--fn-bg));color:var(--fn-title);cursor:pointer;text-align:left;font:inherit;font-size:.875em;line-height:1.35;width:100%;transition:border-color .15s,background .15s,transform .1s}
.fnr-opts.bg-transparent .fnr-opt{background:transparent}.fnr-opts.bg-solid .fnr-opt{background:var(--fn-theme);color:var(--fn-theme-ink);border-color:var(--fn-theme)}
.fnr-opts.sh .fnr-opt{box-shadow:0 6px 18px -8px rgba(0,0,0,.35)}
.fnr-opt:hover{border-color:var(--fn-theme)}.fnr-opt:active{transform:scale(.99)}
.fnr-opt.is-on{border-color:var(--fn-theme);background:color-mix(in srgb,var(--fn-theme) 26%,var(--fn-bg))}
.fnr-l.has-err .fnr-opt{border-color:#ef4444}
.fnr-opt .fnr-olabel{flex:1;min-width:0}.fnr-opt .fnr-olabel p{margin:0}
.fnr-opt .fnr-oico{flex:none;width:20px;height:20px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--fn-title) 70%,transparent);display:grid;place-items:center}
.fnr-opt .fnr-oico.sq{border-radius:5px}
.fnr-opt.is-on .fnr-oico{border-color:var(--fn-theme);background:var(--fn-theme)}
.fnr-opt.is-on .fnr-oico::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--fn-theme-ink)}
.fnr-opt.is-on .fnr-oico.sq::after{width:10px;height:6px;border-radius:0;background:none;border:2px solid var(--fn-theme-ink);border-top:0;border-right:0;transform:rotate(-45deg) translate(1px,-1px)}
.fnr-opt .fnr-oarrow{flex:none;opacity:.7}
.fnr-opts.ip-start .fnr-opt{flex-direction:row-reverse}
.fnr-opts.has-img .fnr-opt{flex-direction:column;align-items:stretch;padding:8px;text-align:center}
.fnr-opts.has-img .fnr-oimg{width:100%;border-radius:calc(var(--fn-radius) - 6px);overflow:hidden;background:var(--fn-card)}
.fnr-opts.has-img .fnr-oimg img{width:100%;height:100%;object-fit:cover;display:block}
.fnr-opts.has-img .fnr-oico{position:absolute;top:12px;right:12px;background:var(--fn-bg)}
.fnr-opts.center .fnr-opt{justify-content:center;text-align:center}
.fnr-field{display:grid;gap:6px}
.fnr-field label{font-size:12.5px;color:var(--fn-theme);font-weight:500}
.fnr-input{width:100%;min-height:var(--fn-el);border-radius:var(--fn-radius);border:1px solid rgba(15,23,42,.14);background:#fff;color:#0f172a;font:inherit;font-size:16px;padding:10px 14px;outline:none}
.fnr-input::placeholder{color:#94a3b8;font-style:italic}
.fnr-input:focus{border-color:var(--fn-theme);box-shadow:0 0 0 3px color-mix(in srgb,var(--fn-theme) 25%,transparent)}
textarea.fnr-input{min-height:110px;resize:vertical}
.fnr-field .fnr-err{color:#ef4444;font-size:12.5px;min-height:0}
.fnr-field.has-err .fnr-input{border-color:#ef4444}
.fnr-ruler{display:grid;gap:8px;text-align:center}.fnr-ruler output{font:700 2em/1 var(--fn-font-title);color:var(--fn-title)}.fnr-ruler output small{font-size:.45em;color:var(--fn-muted);margin-left:4px}
.fnr-ruler input[type=range]{width:100%;accent-color:var(--fn-theme)}
.fnr-units{display:inline-flex;gap:4px;justify-self:center;background:var(--fn-card);border-radius:99px;padding:3px}.fnr-units button{border:0;background:transparent;color:var(--fn-title);border-radius:99px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer}.fnr-units button.on{background:var(--fn-theme);color:var(--fn-theme-ink)}
.fnr-img{display:flex;justify-content:center}.fnr-img img{display:block;max-width:100%;height:auto;border-radius:var(--fn-iradius,0)}
.fnr-ph{display:grid;place-items:center;min-height:120px;border:1.5px dashed var(--fn-line);border-radius:var(--fn-radius);color:var(--fn-muted);font-size:13px;text-align:center;padding:12px;width:100%}
.fnr-video{position:relative;width:100%;border-radius:var(--fn-radius);overflow:hidden;background:#000}
.fnr-video iframe,.fnr-video video{position:absolute;inset:0;width:100%;height:100%;border:0}
.fnr-audio{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:#202c33;color:#e9edef;position:relative}
.fnr-audio.th-light{background:#fff;color:#111b21;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.fnr-audio .fnr-asend{position:absolute;top:6px;left:14px;font-size:10.5px;opacity:.6}
.fnr-audio .fnr-aplay{flex:none;width:30px;height:30px;border:0;background:transparent;color:inherit;cursor:pointer;display:grid;place-items:center;padding:0;margin-top:8px}
.fnr-audio .fnr-awave{flex:1;display:flex;align-items:center;gap:2px;height:30px;margin-top:8px;position:relative;cursor:pointer}
.fnr-audio .fnr-awave i{flex:1;background:currentColor;opacity:.35;border-radius:2px;min-width:2px}
.fnr-audio .fnr-awave i.on{opacity:1;color:#53bdeb}
.fnr-audio .fnr-atime{position:absolute;bottom:4px;left:52px;font-size:10.5px;opacity:.6}
.fnr-audio .fnr-aav{flex:none;width:46px;height:46px;border-radius:50%;background:#6b7c85;position:relative;overflow:visible;display:grid;place-items:center;color:#fff;font-weight:700}
.fnr-audio .fnr-aav img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.fnr-audio .fnr-aav b{position:absolute;right:-4px;bottom:-2px;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:#53bdeb}
.fnr-audio.md-default{background:var(--fn-card);color:var(--fn-title);box-shadow:inset 0 0 0 1px var(--fn-line)}
.fnr-metric{display:grid;gap:6px}
.fnr-metric .t{font-weight:600;color:var(--fn-title);font-size:.82em}
.fnr-metric .row{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;font-size:.78em}
.fnr-metric .row .s{color:var(--fn-content)}.fnr-metric .row .p{color:var(--fn-title);font-weight:600;white-space:nowrap}
.fnr-metric .bar{position:relative;height:8px;border-radius:99px;background:color-mix(in srgb,var(--fn-title) 18%,transparent)}
.fnr-metric .bar i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,color-mix(in srgb,var(--fn-mc) 55%,transparent),var(--fn-mc));transition:width .8s ease}
.fnr-metric .bar b{position:absolute;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px var(--fn-bg),0 1px 4px rgba(0,0,0,.4);transition:left .8s ease}
.fnr-metric .legs{display:flex;justify-content:space-between;font-size:.7em;color:var(--fn-muted)}
.fnr-timer{display:flex;justify-content:center;align-items:center;gap:6px;--tmr-bg:#0a0a0a;--tmr-ink:#fff;--tmr-line:#0a0a0a}
.fnr-timer .bx{min-width:52px;padding:var(--tmr-pad,10px) calc(var(--tmr-pad,10px) + 4px);border-radius:var(--tmr-radius,var(--fn-radius));background:var(--tmr-bg);color:var(--tmr-ink);border:var(--tmr-bw,1px) solid var(--tmr-line);text-align:center}
.fnr-timer .bx b{display:block;font:700 1.4em/1 var(--fn-font-title)}.fnr-timer .bx small{font-size:10.5px;opacity:.75}
.fnr-timer .sep{color:var(--fn-content);font-weight:700}
.fnr-timer.ly-cards{align-items:flex-start}.fnr-timer.ly-cards .grp{display:grid;justify-items:center;gap:4px}.fnr-timer.ly-cards .dg{display:flex;gap:3px}
.fnr-timer.ly-cards .bx{min-width:30px;padding:var(--tmr-pad,10px) 6px;font:700 1.5em/1 var(--fn-font-title)}.fnr-timer.ly-cards small{font-size:10.5px;color:var(--fn-muted)}.fnr-timer.ly-cards .sep{padding-top:8px}
.fnr-timer.ly-banner{display:flex}.fnr-timer .bn{display:inline-flex;gap:4px;background:var(--tmr-bg);color:var(--tmr-ink);border:var(--tmr-bw,1px) solid var(--tmr-line);border-radius:var(--tmr-radius,var(--fn-radius));padding:var(--tmr-pad,10px) calc(var(--tmr-pad,10px) + 6px)}
.fnr-timer .bn .cl{display:grid;justify-items:center;min-width:2.6em}.fnr-timer .bn b{font:800 1.6em/1.1 var(--fn-font-title)}.fnr-timer .bn small{font-size:10.5px;opacity:.8}.fnr-timer .bn .sp{font:800 1.6em/1.1 var(--fn-font-title)}
.fnr-timer.ly-hero{display:flex}.fnr-timer .hero{display:flex;align-items:stretch;justify-content:center;gap:6px;background:var(--tmr-bg);color:var(--tmr-ink);border:var(--tmr-bw,1px) solid var(--tmr-line);border-radius:var(--tmr-radius,var(--fn-radius));padding:var(--tmr-pad,10px) calc(var(--tmr-pad,10px) + 4px)}
.fnr-timer .hero .hc{display:grid;justify-items:center;gap:4px;min-width:3em}.fnr-timer .hero b{font:800 2.2em/1 var(--fn-font-title)}.fnr-timer .hero small{font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:.06em}
.fnr-timer .hero i{width:1px;background:currentColor;opacity:.25}
.fnr-timerbar{border-radius:var(--tmr-radius,var(--fn-radius));padding:var(--tmr-pad,10px);background:var(--tmr-bg,#000);color:var(--tmr-ink,#fff);border:var(--tmr-bw,1px) solid var(--tmr-line,#000);font-size:.9em}
.fnr-timerbar p,.fnr-timerbar h1,.fnr-timerbar h2,.fnr-timerbar h3{margin:0;color:inherit}
.fnr-loading{display:grid;gap:10px;padding:8px 0}
.fnr-loading .t{font-size:.82em;font-weight:600;color:var(--fn-title)}
.fnr-loading .bar{height:8px;border-radius:99px;background:color-mix(in srgb,var(--fn-title) 18%,transparent);overflow:hidden}
.fnr-loading .bar i{display:block;height:100%;background:var(--fn-theme);border-radius:inherit;width:0}
.fnr-loading .pc{font:700 2.2em/1 var(--fn-font-title);color:var(--fn-title);text-align:center}
.fnr-loading.ly-circle{justify-items:center}.fnr-loading.ly-circle svg{width:120px;height:120px}
.fnr-price{border-radius:var(--fn-radius);overflow:hidden;background:color-mix(in srgb,var(--fn-title) 6%,var(--fn-bg));box-shadow:inset 0 0 0 1px var(--fn-line);cursor:default}
.fnr-price.clickable{cursor:pointer}
.fnr-price .ft{background:var(--fn-theme);color:var(--fn-theme-ink);text-align:center;font-size:.75em;font-weight:600;padding:6px}
.fnr-price.st-success .ft{background:#16a34a;color:#fff}.fnr-price.st-danger .ft{background:#dc2626;color:#fff}
.fnr-price .bd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px}
.fnr-price .ti{color:var(--fn-title);font-size:.95em}.fnr-price .ti p{margin:0}
.fnr-price .vl{background:color-mix(in srgb,var(--fn-title) 10%,var(--fn-bg));border-radius:calc(var(--fn-radius) - 4px);padding:6px 10px;text-align:right;color:var(--fn-title);min-width:96px}
.fnr-price .vl small{display:block;font-size:.62em;opacity:.7}
.fnr-price .vl b{font:800 1.35em/1.1 var(--fn-font-title)}.fnr-price .vl b span{font-size:.55em;margin-right:3px}
.fnr-faq{border-top:1px solid var(--fn-line)}
.fnr-faq details{border-bottom:1px solid var(--fn-line);padding:12px 2px}
.fnr-faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:12px;color:var(--fn-title);font-weight:600;font-size:.86em}
.fnr-faq summary::-webkit-details-marker{display:none}
.fnr-faq summary svg{flex:none;transition:transform .2s;opacity:.8}.fnr-faq details[open] summary svg{transform:rotate(180deg)}
.fnr-faq .an{padding-top:8px;font-size:.82em;color:var(--fn-content)}.fnr-faq .an p{margin:0}
.fnr-alert{display:flex;gap:10px;align-items:flex-start;border-radius:var(--fn-radius);border-style:solid;font-size:.9em}
.fnr-alert .ic{flex:none;font-size:1.15em;line-height:1.2}.fnr-alert .ttl{display:block;margin-bottom:2px}.fnr-alert p{margin:0}
.fnr-ntf-wrap{width:100%}
.fnr-ntf{position:relative;overflow:hidden;border-radius:var(--fn-radius);padding:12px 14px;box-shadow:0 10px 30px -10px rgba(0,0,0,.45);font-size:.86em;opacity:0;transform:translateY(8px);transition:opacity .35s,transform .35s}
.fnr-edit .fnr-ntf,.fnr-ntf.in{opacity:1;transform:none}
.fnr-ntf .t,.fnr-ntf .x{color:inherit}.fnr-ntf .x{opacity:.85;margin-top:2px}.fnr-ntf p{margin:0}
.fnr-ntf .bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:currentColor;opacity:.35;transform-origin:left}
.fnr-live .fnr-ntf-wrap:not(.ps-default),.fnr-preview .fnr-ntf-wrap:not(.ps-default){position:fixed;z-index:50;width:calc(100% - 24px);max-width:20rem;pointer-events:none}
.fnr-preview .fnr-ntf-wrap:not(.ps-default){position:absolute}
@media (min-width:768px){.fnr-live .fnr-ntf-wrap:not(.ps-default){max-width:24rem}}
.fnr-ntf-wrap[class*="ps-top"]{top:12px}.fnr-ntf-wrap[class*="ps-bottom"]{bottom:12px}.fnr-ntf-wrap[class*="ps-center"]{top:50%;transform:translateY(-50%)}
.fnr-ntf-wrap[class*="-left"]{left:12px}.fnr-ntf-wrap[class*="-right"]{right:12px}
.fnr-ntf-wrap.ps-top-middle,.fnr-ntf-wrap.ps-bottom-middle{left:50%;transform:translateX(-50%)}.fnr-ntf-wrap.ps-center-middle{left:50%;transform:translate(-50%,-50%)}
.fnr-args2{display:grid;gap:10px}
.fnr-arg2{display:grid;gap:8px;align-content:start;padding:12px;border-radius:var(--fn-radius);background:var(--fn-card);box-shadow:inset 0 0 0 1px var(--fn-line)}
.fnr-arg2 .em{font-size:2em;line-height:1;text-align:center}.fnr-arg2 .im{border-radius:calc(var(--fn-radius) - 4px);overflow:hidden;background:var(--fn-bg)}.fnr-arg2 .im img{width:100%;height:100%;object-fit:cover;display:block}
.fnr-arg2 h3{font-size:1em!important}.fnr-arg2 p{font-size:.85em}
.fnr-tests{display:grid;gap:10px}
.fnr-test{padding:12px 14px;border-radius:var(--fn-radius);background:var(--fn-card);box-shadow:inset 0 0 0 1px var(--fn-line)}
.fnr-test .hd{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.fnr-test .av{width:36px;height:36px;border-radius:50%;background:color-mix(in srgb,var(--fn-theme) 30%,var(--fn-bg));display:grid;place-items:center;color:var(--fn-title);font-weight:700;overflow:hidden;flex:none}
.fnr-test .av img{width:100%;height:100%;object-fit:cover}
.fnr-test b{display:block;color:var(--fn-title);font-size:.88em}.fnr-test small{color:var(--fn-muted);font-size:.75em}
.fnr-test .st{color:#f59e0b;letter-spacing:1px;font-size:.8em;margin-left:auto}.fnr-test p{margin:0;font-size:.85em}
.fnr-check{display:grid;gap:8px}.fnr-check div{display:flex;gap:10px;align-items:flex-start;color:var(--fn-title);font-size:.92em}.fnr-check div i{font-style:normal;flex:none}
.fnr-ba{position:relative;border-radius:var(--fn-radius);overflow:hidden;user-select:none;touch-action:pan-y;background:var(--fn-card)}
.fnr-ba img{display:block;width:100%;height:auto;pointer-events:none}
.fnr-ba .af{position:absolute;inset:0;clip-path:inset(0 0 0 50%)}.fnr-ba .af img{height:100%;object-fit:cover}
.fnr-ba .hn{position:absolute;top:0;bottom:0;left:50%;width:3px;margin-left:-1.5px;background:#fff;cursor:ew-resize}
.fnr-ba .hn::after{content:"⇆";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:32px;height:32px;border-radius:50%;background:#fff;color:#111;display:grid;place-items:center;font-size:14px}
.fnr-ba .lb{position:absolute;top:8px;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font-size:11px}.fnr-ba .lb.l{left:8px}.fnr-ba .lb.r{right:8px}
.fnr-car{position:relative;overflow:hidden;border-radius:var(--fn-radius)}
.fnr-car .tr{display:flex;transition:transform .45s ease}
.fnr-car .it{flex:0 0 100%;padding:0 4px}.fnr-car.spoil .it{flex-basis:84%}.fnr-car .it img{display:block;width:100%;height:auto}
.fnr-car .card{border-radius:var(--fn-radius);overflow:hidden;background:var(--fn-card);box-shadow:inset 0 0 0 1px var(--fn-line);height:100%}
.fnr-car .card .im{background:var(--fn-bg)}.fnr-car .card .im img{height:100%;object-fit:cover}
.fnr-car .cap{padding:8px 10px;text-align:center;font-size:.82em}
.fnr-car .dots{display:flex;justify-content:center;gap:6px;padding-top:8px}.fnr-car .dots button{width:8px;height:8px;border-radius:50%;border:0;background:var(--fn-line);padding:0;cursor:pointer}.fnr-car .dots button.on{background:var(--fn-theme)}
.fnr-chart2 .tt{font-weight:600;color:var(--fn-title);font-size:.9em;margin-bottom:8px;text-align:center}
.fnr-chart2 svg{display:block;width:100%;height:auto;overflow:visible}
.fnr-chart2 .xs{display:flex;justify-content:space-between;padding:4px 6% 0;font-size:.72em;color:var(--fn-muted)}
.fnr-chart2 .lg{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 14px;padding-top:8px;font-size:.75em;color:var(--fn-title)}
.fnr-chart2 .lg span{display:inline-flex;align-items:center;gap:6px}.fnr-chart2 .lg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.fnr-graphics{display:grid;gap:10px}
.fnr-graphic{display:grid;justify-items:center;align-content:start;gap:8px;text-align:center;padding:10px;border-radius:var(--fn-radius);background:var(--fn-card)}
.fnr-graphic svg{width:84px;height:84px}.fnr-graphic .lg{font-size:.8em;color:var(--fn-title)}
.fnr-graphic .gbar{position:relative;width:46px;height:120px;border-radius:10px;background:color-mix(in srgb,var(--fn-title) 12%,transparent);overflow:hidden;display:flex;align-items:flex-end}
.fnr-graphic .gbar i{display:block;width:100%;border-radius:10px 10px 0 0;transition:height .8s ease}
.fnr-graphic .gbar b{position:absolute;top:6px;left:0;right:0;text-align:center;font-size:.72em;color:var(--fn-title)}
.fnr-vresp{border-radius:var(--fn-radius);overflow:hidden;background:#0a0a0a}
.fnr-vresp .pad{padding:10px}.fnr-vresp .fnr-opt{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.18)}
.fnr-vresp .fnr-vhtml{position:absolute;inset:0}
.fnr-opt .fnr-oemoji{flex:none;font-size:1.35em;line-height:1}
.fnr-opt .fnr-oval{flex:none;min-width:24px;height:24px;padding:0 6px;border-radius:7px;display:grid;place-items:center;background:color-mix(in srgb,var(--fn-theme) 25%,transparent);font-size:.78em;font-weight:700}
.fnr-opt.is-on .fnr-oval{background:var(--fn-theme);color:var(--fn-theme-ink)}
.fnr-html{width:100%}
.fnr-end{display:grid;place-items:center;text-align:center;gap:8px;padding:40px 0;color:var(--fn-title)}
.fnr-consent,.fnr-consent p,.fnr-consent span{font-size:11.5px;line-height:1.35;color:var(--fn-muted)!important;margin:0}
.fnr-help{font-size:11.5px;color:var(--fn-muted)}
.fnr-ifood{display:grid;gap:10px}
.fnr-xray{position:relative;display:grid;gap:10px;padding:14px;border-radius:var(--fn-radius);background:var(--fn-card);box-shadow:inset 0 0 0 1px var(--fn-line);color:var(--fn-content);font-size:.88em}
.fnr-xray .tag{position:absolute;top:8px;right:10px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--fn-muted)}
.fnr-xray .hd{display:flex;gap:10px;align-items:center}.fnr-xray .hd img{width:40px;height:40px;border-radius:10px;object-fit:cover}
.fnr-xray .hd b{display:block;color:var(--fn-title);font-size:1.05em}.fnr-xray .hd small{color:var(--fn-muted)}
.fnr-xray .nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}
.fnr-xray .nums div{padding:8px;border-radius:calc(var(--fn-radius) - 4px);background:color-mix(in srgb,var(--fn-theme) 10%,transparent);text-align:center}
.fnr-xray .nums b{display:block;font:800 1.3em/1.1 var(--fn-font-title);color:var(--fn-title)}.fnr-xray .nums small{font-size:.78em;color:var(--fn-muted)}
.fnr-xray p{margin:0}.fnr-xray p b{color:var(--fn-title)}
@media (prefers-reduced-motion:reduce){.fnr *{animation:none!important;transition:none!important}}
`;
function injectCss(){
  if (doc.getElementById('fnr-css')) return;
  const s = doc.createElement('style'); s.id = 'fnr-css'; s.textContent = CSS; doc.head.appendChild(s);
}

const ICON = {
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>',
  play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  mic: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12z"/></svg>',
};

// Texto rico (HTML do editor Quill): troca &nbsp; por espaço (senão a linha não quebra) e aplica as variáveis.
function rich(html, ctx){
  const h = String(html || '').replace(/&nbsp;| /g, ' ');
  return interpolate(h, ctx, {html: true});
}
function videoSrc(v){
  v = String(v || '').trim(); if (!v) return '';
  const m = /src=["']([^"']+)["']/i.exec(v); if (m) v = m[1];
  v = decode(v);
  let y = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/.exec(v);
  if (y && !/youtube\.com\/embed\//.test(v)) return `https://www.youtube.com/embed/${y[1]}?rel=0&playsinline=1`;
  let vm = /vimeo\.com\/(\d+)/.exec(v); if (vm && !/player\.vimeo/.test(v)) return `https://player.vimeo.com/video/${vm[1]}`;
  return /^https?:\/\//.test(v) ? v : '';
}
const isFileVideo = s => /\.(mp4|webm|ogg|mov)(\?|$)/i.test(s);
const RATIO = {mobile: '9/16', portrait: '4/5', square: '1/1', landscape: '16/9', wide: '21/9'};
function waveHeights(seed, n){ let x = 0; for (const ch of String(seed)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; const out = []; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out.push(25 + (x % 75)) } return out }
const mmss = s => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') };
function ring(pct, label, color){
  const r = 36, c = 2 * Math.PI * r, p = clamp(pct, 0, 100);
  return `<svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--fn-line)" stroke-width="7"/><circle cx="42" cy="42" r="${r}" fill="none" stroke="${color || 'var(--fn-theme)'}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}" transform="rotate(-90 42 42)"/><text x="42" y="47" text-anchor="middle" font-size="16" font-weight="700" fill="var(--fn-title)">${esc(label)}</text></svg>`;
}

/* ----- cores e peças dos componentes (paletas do InLead) ----- */
const NAMED = {danger: '#fb2c36', info: '#2b7fff', success: '#17a34a', warning: '#ffb900', dark: '#0a0a0a', light: '#d1d5dc', black: '#0a0a0a', white: '#ffffff', red: '#fb2c36', blue: '#2b7fff', green: '#17a34a'};
const tone = (hex, k, toward) => `color-mix(in srgb, ${hex} ${k}%, ${toward})`;
function btnStyle(d){
  if (d.style === 'custom') return `background:${esc(d.backgroundColor || 'var(--fn-theme)')};color:${esc(d.color || '#fff')};${d.borderColor ? `box-shadow:inset 0 0 0 ${num(d.borderWidth, 1)}px ${esc(d.borderColor)};` : ''}${d.borderRadiusStyle === 'custom' ? `border-radius:${esc(d.borderRadius || '8px')};` : ''}`;
  if (d.style === 'transparent') return 'background:transparent;color:var(--fn-theme)';
  const hex = NAMED[d.style]; if (!hex) return '';
  return `background:${hex};color:${contrastText(hex)}`;
}
// Paleta suave (alerta, timer): fundo claro, texto escuro e borda do mesmo tom.
function palette(style){
  if (style === 'theme') return {bg: tone('var(--fn-theme)', 14, 'var(--fn-bg)'), ink: 'var(--fn-title)', line: tone('var(--fn-theme)', 40, 'var(--fn-bg)')};
  if (style === 'black' || style === 'dark') return {bg: '#0a0a0a', ink: '#ffffff', line: '#0a0a0a'};
  if (style === 'white') return {bg: '#ffffff', ink: '#111111', line: '#e5e7eb'};
  const hex = NAMED[style] || NAMED.danger;
  return {bg: tone(hex, 14, '#fff'), ink: tone(hex, 80, '#000'), line: tone(hex, 35, '#fff')};
}
const boxStyle = style => { const p = palette(style); return `background:${p.bg};color:${p.ink};border:1px solid ${p.line}` };
// Cores do timer como no InLead (getTimerDefaultColors): [cor, tom do fundo, tom do texto, tom da borda]; qualquer outro estilo é preto.
const SHADE = {50: ['#fff', 8], 100: ['#fff', 16], 200: ['#fff', 32], 600: ['#000', 82], 700: ['#000', 66]};
const shade = (hex, n) => tone(hex, SHADE[n][1], SHADE[n][0]);
const TIMER_COLORS = {danger: ['#fb2c36', 100, 600, 200], info: ['#2b7fff', 100, 600, 200], success: ['#09de5e', 100, 700, 200], warning: ['#ffb900', 50, 600, 100], light: ['#d1d5dc', 100, 700, 200]};
function timerStyle(d){
  d = Object.assign({style: 'black', padding: '10'}, d || {});
  let bg = '#000000', ink = '#ffffff', line = '#000000';
  if (d.style === 'custom') { bg = d.backgroundColor || bg; ink = d.color || ink; line = d.borderColor || line }
  else if (d.style === 'theme') { bg = 'var(--fn-bg)'; ink = 'var(--fn-content)'; line = tone('var(--fn-content)', 18, 'var(--fn-bg)') }
  else if (TIMER_COLORS[d.style]) { const [h, b, t, l] = TIMER_COLORS[d.style]; bg = shade(h, b); ink = shade(h, t); line = shade(h, l) }
  return `--tmr-bg:${esc(bg)};--tmr-ink:${esc(ink)};--tmr-line:${esc(line)};--tmr-pad:${num(d.padding, 10)}px;--tmr-bw:${esc(d.borderWidth || '1px')}${d.borderRadiusStyle === 'custom' ? `;--tmr-radius:${esc(d.borderRadius || '8px')}` : ''}`;
}
function timeParts(secs){ const d = Math.floor(secs / 86400), h = Math.floor(secs % 86400 / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60; const p = n => String(n).padStart(2, '0'); return {days: p(d), hours: p(h), minutes: p(m), seconds: p(s)} }
function timeTypes(secs){ const t = timeParts(secs); return t.days !== '00' ? ['days', 'hours', 'minutes', 'seconds'] : t.hours !== '00' ? ['hours', 'minutes', 'seconds'] : ['minutes', 'seconds'] }
const UNIT = (k, t) => k === 'days' ? (t.days === '01' ? 'dia' : 'dias') : k === 'hours' ? (t.hours === '01' ? 'hora' : 'horas') : k === 'minutes' ? 'min' : 'seg';
const timeText = secs => { const t = timeParts(secs); return timeTypes(secs).map(k => t[k]).join(':') };
// Modelos do timer do InLead: countdown (caixas), cards (um cartão por dígito), banner (faixa) e hero (bloco com divisórias).
function timerHtml(layout, secs){
  const t = timeParts(secs), ks = timeTypes(secs);
  if (layout === 'cards') return ks.map((k, i) => `<div class="grp"><div class="dg">${t[k].split('').map(ch => `<b class="bx">${ch}</b>`).join('')}</div><small>${UNIT(k, t)}</small></div>${i < ks.length - 1 ? '<span class="sep">:</span>' : ''}`).join('');
  if (layout === 'banner') return `<div class="bn">${ks.map((k, i) => `<div class="cl"><b>${t[k]}</b><small>${UNIT(k, t)}</small></div>${i < ks.length - 1 ? '<span class="sp">:</span>' : ''}`).join('')}</div>`;
  if (layout === 'hero') return `<div class="hero">${ks.map((k, i) => `<div class="hc"><b>${t[k]}</b><small>${UNIT(k, t)}</small></div>${i < ks.length - 1 ? '<i></i>' : ''}`).join('')}</div>`;
  return ks.map((k, i) => `<div class="bx"><b>${t[k]}</b><small>${UNIT(k, t)}</small></div>${i < ks.length - 1 ? '<span class="sep">:</span>' : ''}`).join('');
}
const NTF = {white: ['#ffffff', '#111827'], light: ['#52525b', '#ffffff'], danger: ['#fb2c36', '#ffffff'], info: ['#2b7fff', '#ffffff'], success: ['#00c950', '#ffffff'], warning: ['#ffb900', '#111827']};
function ntfStyle(style){ if (style === 'theme') return 'background:var(--fn-theme);color:var(--fn-theme-ink)'; const p = NTF[style] || NTF.white; return `background:${p[0]};color:${p[1]}` }
// Notificação: @1, @2, @3 viram o n-ésimo valor de cada lista.
function notifText(c, n){
  const sub = t => (c.variables || []).reduce((acc, v, k) => acc.split(`@${k + 1}`).join((v.values || [])[n] || ''), String(t || ''));
  return {title: sub(c.title), text: sub(c.text)};
}
function chartHtml(c, d, X){
  const xs = c.xAxis || [], ds = (c.datasets || []).slice(0, Math.max(1, num(c.datasetCount, (c.datasets || []).length) || 1));
  const vals = ds.flatMap(s => (s.datas || []).map(v => num(interpolate(String(v.value), X, {fmt: String}))));
  const max = Math.max(1, ...vals), cols = ['var(--fn-theme)', tone('var(--fn-theme)', 55, 'var(--fn-bg)'), tone('var(--fn-title)', 35, 'var(--fn-bg)')];
  const W = 300, H = 150, pad = 18, n = Math.max(1, xs.length || (ds[0] && ds[0].datas || []).length);
  const xAt = i => n === 1 ? W / 2 : pad + i * (W - 2 * pad) / (n - 1), yAt = v => H - pad - (v / max) * (H - 2 * pad);
  let body = '';
  if (c.type === 'pie') {
    const data = (ds[0] && ds[0].datas || []).map(v => num(v.value)), tot = data.reduce((a, b) => a + b, 0) || 1; let ang = -Math.PI / 2;
    body = data.map((v, i) => { const a2 = ang + v / tot * 2 * Math.PI, large = a2 - ang > Math.PI ? 1 : 0, r = 60, cx = W / 2, cy = H / 2; const p = `M${cx},${cy} L${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a2)},${cy + r * Math.sin(a2)} Z`; ang = a2; return `<path d="${p}" fill="${i ? tone('var(--fn-theme)', Math.max(25, 100 - i * 25), 'var(--fn-bg)') : 'var(--fn-theme)'}" stroke="var(--fn-bg)" stroke-width="2"/>` }).join('');
  } else if (c.type === 'bar') {
    const bw = (W - 2 * pad) / n / Math.max(1, ds.length) * 0.7;
    body = ds.map((s, si) => (s.datas || []).map((v, i) => { const val = num(v.value), x = pad + i * (W - 2 * pad) / n + si * bw + bw * 0.2, y = yAt(val); return `<rect x="${x}" y="${y}" width="${bw}" height="${H - pad - y}" rx="3" fill="${cols[si % 3]}"/>` }).join('')).join('');
  } else {
    body = ds.map((s, si) => { const pts = (s.datas || []).map((v, i) => [xAt(i), yAt(num(v.value))]); if (!pts.length) return ''; const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' ');
      const area = d.area !== false ? `<path d="${line} L${pts[pts.length - 1][0]},${H - pad} L${pts[0][0]},${H - pad} Z" fill="${cols[si % 3]}" opacity=".12"/>` : '';
      const dots = (s.datas || []).map((v, i) => v.hiddenDot ? '' : `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="${v.featured ? 5 : 3}" fill="${cols[si % 3]}" stroke="var(--fn-bg)" stroke-width="2"/>${v.tooltip ? `<text x="${pts[i][0]}" y="${pts[i][1] - 10}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--fn-title)">${esc(v.tooltip)}</text>` : ''}`).join('');
      return `${area}<path d="${line}" fill="none" stroke="${cols[si % 3]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}` }).join('');
  }
  const grid = d.gridY !== false && c.type !== 'pie' ? [0.25, 0.5, 0.75].map(k => `<line x1="${pad}" x2="${W - pad}" y1="${pad + k * (H - 2 * pad)}" y2="${pad + k * (H - 2 * pad)}" stroke="var(--fn-line)"/>`).join('') : '';
  const axis = d.axisX !== false && c.type !== 'pie' ? `<line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" stroke="var(--fn-line)"/>` : '';
  const legend = ds.length > 1 || c.type === 'pie' ? `<div class="lg">${(c.type === 'pie' ? xs : ds.map(s => s.title)).map((t, i) => `<span><i style="background:${c.type === 'pie' ? (i ? tone('var(--fn-theme)', Math.max(25, 100 - i * 25), 'var(--fn-bg)') : 'var(--fn-theme)') : cols[i % 3]}"></i>${esc(t || '')}</span>`).join('')}</div>` : '';
  return `<div class="fnr-chart2">${c.title ? `<div class="tt">${esc(interpolate(c.title, X))}</div>` : ''}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico">${grid}${axis}${body}</svg>${c.type !== 'pie' && xs.length ? `<div class="xs">${xs.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}${legend}</div>`;
}

/* ----- Raio-X do iFood ----- */
const IFOOD_SAMPLE = {nome: 'Sua loja (exemplo)', categoria: 'Lanches', bairro: 'Centro', avaliacoes: 312, pedidos: 624, raio: 3, posicao: 7, total: 24, confiavel: true, lider: 'Loja líder', lider_pedidos: 2480, proxima: 'Loja da frente', falta: 38};
const fmtInt = n => Math.round(num(n)).toLocaleString('pt-BR');
function ifoodCard(d, sample){
  const pos = d.confiavel ? `<div><b>${fmtInt(d.posicao)}º</b><small>de ${fmtInt(d.total)} em ${esc(d.categoria || 'sua categoria')} a ${fmtInt(d.raio)} km</small></div>` : '';
  return `<div class="fnr-xray">${sample ? '<span class="tag">exemplo</span>' : ''}<div class="hd">${d.logo ? `<img src="${esc(d.logo)}" alt="">` : ''}<div><b>${esc(d.nome)}</b><small>${esc([d.categoria, d.bairro].filter(Boolean).join(' · '))}</small></div></div>
    <div class="nums"><div><b>${fmtInt(d.avaliacoes)}</b><small>avaliações</small></div><div><b>${fmtInt(d.pedidos)}</b><small>pedidos estimados</small></div>${pos}</div>
    ${d.falta > 0 && d.proxima ? `<p>Faltam <b>~${fmtInt(d.falta)} pedidos</b> para passar <b>${esc(d.proxima)}</b>.</p>` : ''}
    ${d.confiavel && d.lider ? `<p>A 1ª da região (<b>${esc(d.lider)}</b>) tem ~${fmtInt(d.lider_pedidos)} pedidos.</p>` : ''}</div>`;
}

/* ================= montagem ================= */
function mount(el, funnel, opts){
  injectCss();
  opts = Object.assign({mode: 'live'}, opts || {});
  const R = {
    el, funnel, opts,
    answers: opts.answers ? clone(opts.answers) : {}, clicks: {},
    history: [], index: 0, timers: [], destroyed: false, busy: false,
    params: opts.params || paramsFromUrl(),
  };
  const mode = opts.mode, live = mode === 'live', edit = mode === 'edit';
  const ctx = () => ({answers: R.answers, params: R.params, clicks: R.clicks, screen: typeof screen !== 'undefined' ? screen.width + 'x' + screen.height : '', platform: typeof navigator !== 'undefined' ? navigator.platform || '' : ''});
  const emit = (type, data) => { try { opts.onEvent && opts.onEvent(Object.assign({type, at: Date.now(), vars: buildVars(ctx())}, data || {})) } catch (e) { console.error(e) } };

  function paramsFromUrl(){ const o = {}; try { new URLSearchParams(location.search).forEach((v, k) => { o[k] = v }) } catch (e) {} return o }
  function clearTimers(){ R.timers.forEach(t => { clearInterval(t); clearTimeout(t) }); R.timers = [] }
  function stepAt(i){ return (R.funnel.steps || [])[i] }
  function startIndex(){
    const s = opts.step; if (s == null) return 0;
    if (typeof s === 'number') return clamp(s, 0, Math.max(0, R.funnel.steps.length - 1));
    const k = R.funnel.steps.findIndex(x => x.id === s); return k < 0 ? 0 : k;
  }

  /* ----- respostas ----- */
  function setAnswer(step, layer, data){
    R.answers[layer.id] = Object.assign({step: step.id, name: layer.content && layer.content.name || layer.id, type: layer.type, title: layer.content && (layer.content.title || '') || ''}, data);
    if (live || mode === 'preview') emit('answer', {step: step.id, stepIndex: R.index, layer: layer.id, answer: R.answers[layer.id]});
  }
  function optionAnswer(layer, ids){
    const all = layer.content.options || [], os = all.filter(o => ids.includes(o.id));
    const multiple = !!layer.content.multiple;
    if (!os.length) return null;
    const val = o => o.value != null && o.value !== '' ? String(o.value) : plainLabel(o.label);
    const responses = all.map(o => ids.includes(o.id) ? (o.value != null && o.value !== '' ? String(o.value) : o.score != null ? String(o.score) : plainLabel(o.label)) : '*').join('|');
    return multiple
      ? {value: os.map(val), label: os.map(o => plainLabel(o.label)).join(', '), labels: os.map(o => plainLabel(o.label)), score: os.reduce((t, o) => t + num(o.score), 0), ids, responses}
      : {value: val(os[0]), label: plainLabel(os[0].label), score: num(os[0].score), ids, responses};
  }

  /* ----- renderização de cada componente ----- */
  function renderLayer(layer, step){
    const c = layer.content || {}, d = layer.design || {};
    const X = ctx();
    switch (layer.type) {
      case 'text': return `<div class="fnr-rich">${rich(c.text, X)}</div>`;
      case 'image': {
        const src = c.image && c.image.src;
        if (!src) return edit ? '<div class="fnr-ph">Imagem — escolha o arquivo ou cole o endereço</div>' : '';
        const w = clamp(num(d.width, 100), 10, 100);
        const img = `<img src="${esc(src)}" alt="${esc(c.alt || '')}" loading="lazy" style="width:${w}%;--fn-iradius:${d.rounded ? (RADIUS[d.rounded] || 'var(--fn-radius)') : '0'}">`;
        return `<div class="fnr-img">${c.link && !edit ? `<a href="${esc(c.link)}" target="_blank" rel="noopener" style="display:contents">${img}</a>` : img}</div>`;
      }
      case 'video': {
        const raw = c.video || c.url || '';
        const ratio = RATIO[d.ratio] || '16/9';
        if (isFileVideo(raw)) return `<div class="fnr-video" style="aspect-ratio:${ratio}"><video src="${esc(raw)}" ${d.autoplay ? 'autoplay muted' : ''} controls playsinline preload="metadata"></video></div>`;
        const src = videoSrc(raw);
        if (!src) return edit ? '<div class="fnr-ph">Vídeo — cole o link do YouTube/Vimeo ou o código de incorporação</div>' : '';
        return `<div class="fnr-video" style="aspect-ratio:${ratio}">${edit ? `<div class="fnr-ph" style="position:absolute;inset:0;border:0;color:#fff;background:#111">▶ Vídeo<br><small>${esc(src.slice(0, 60))}</small></div>` : `<iframe src="${esc(src)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`}</div>`;
      }
      case 'audio': {
        const src = c.audio && c.audio.src; const av = c.image && c.image.src;
        if (!src && !edit) return '';
        const bars = waveHeights(layer.id, 34).map(h => `<i style="height:${h}%"></i>`).join('');
        const initials = esc(String(c.sender || '?').trim().slice(0, 1).toUpperCase());
        return `<div class="fnr-audio th-${esc(d.theme || 'dark')} md-${esc(d.model || 'whatsapp')}" data-audio="${esc(src || '')}">
          ${c.sender ? `<span class="fnr-asend">${esc(c.sender)}</span>` : ''}
          <button class="fnr-aplay" type="button" aria-label="Tocar áudio">${ICON.play}</button>
          <div class="fnr-awave">${bars}</div><span class="fnr-atime">00:00</span>
          <div class="fnr-aav">${av ? `<img src="${esc(av)}" alt="">` : initials}<b>${ICON.mic}</b></div>
        </div>`;
      }
      case 'button': {
        const st = d.style || 'theme';
        return `<button type="button" class="fnr-btn st-${esc(st)}${c.pulse ? ' is-pulse' : ''}" data-act="button" style="${btnStyle(d)}">${interpolate(c.label || 'Continuar', X, {html: true})}</button>`;
      }
      case 'options': return renderOptions(layer, step);
      case 'field': return renderField(layer, step);
      case 'metric': {
        const pct = clamp(num(interpolate(String(c.percent == null ? 0 : c.percent), X, {fmt: v => String(v)})), 0, 100);
        const color = d.color && d.color !== 'theme' ? d.color : 'var(--fn-theme)';
        const legends = Array.isArray(c.legends) ? c.legends : (c.legends ? String(c.legends).split('|') : null);
        return `<div class="fnr-metric" style="--fn-mc:${esc(color)}">
          ${c.show_title !== false && c.title ? `<div class="t">${esc(interpolate(c.title, X))}</div>` : ''}
          <div class="row"><span class="s">${esc(interpolate(c.subtitle || '', X))}</span>${c.show_percent !== false ? `<span class="p">${Math.round(pct)}%</span>` : ''}</div>
          <div class="bar"><i style="width:${edit ? pct : 0}%" data-w="${pct}"></i>${c.show_dot !== false ? `<b style="left:${edit ? pct : 0}%" data-l="${pct}"></b>` : ''}</div>
          ${legends && legends.length ? `<div class="legs">${legends.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        </div>`;
      }
      case 'timer': {
        const st = timerStyle(d), lay = d.layout || 'countdown', secs = Math.max(0, num(c.time, 300));
        const target = c.basedOn === 'date' && c.date ? new Date(c.date).getTime() : 0;
        const attrs = `data-timer="${secs}" data-tlayout="${esc(lay)}"${target ? ` data-tdate="${target}"` : ''}`;
        if (lay === 'text') return `<div class="fnr-timerbar fnr-rich" style="${st}" ${attrs} data-ttext="${esc(c.text || '[time]')}">${rich(String(c.text || '[time]').replace('[time]', `<span data-tt>${timeText(secs)}</span>`), X)}</div>`;
        return `<div class="fnr-timer ly-${esc(lay)}" style="${st}" ${attrs}>${timerHtml(lay, target ? Math.max(0, Math.round((target - Date.now()) / 1000)) : secs)}</div>`;
      }
      case 'loading': {
        const start = clamp(num(c.starts, 0), 0, 100), show = edit ? 60 : start;
        if (d.layout === 'circle') return `<div class="fnr-loading ly-circle">${ring(show, show + '%')}${c.show_title !== false ? `<div class="t">${esc(interpolate(c.title || '', X))}</div>` : ''}${c.description && stripHtml(c.description) ? `<div class="fnr-rich">${rich(c.description, X)}</div>` : ''}</div>`;
        return `<div class="fnr-loading">${c.show_percent ? `<div class="pc" data-pc>${show}%</div>` : ''}${c.show_title !== false ? `<div class="t">${esc(interpolate(c.title || '', X))}</div>` : ''}${c.show_progress !== false ? `<div class="bar"><i style="width:${show}%"></i></div>` : ''}${c.description && stripHtml(c.description) ? `<div class="fnr-rich">${rich(c.description, X)}</div>` : ''}</div>`;
      }
      case 'price': {
        const v = String(interpolate(c.value || '', X)); const m = /^(R\$|US\$|\$|€)\s*(.*)$/.exec(v.trim());
        const hex = NAMED[d.style], ft = hex ? ` style="background:${hex};color:${contrastText(hex)}"` : '';
        return `<div class="fnr-price st-${esc(d.style || 'theme')}${c.redirect ? ' clickable' : ''}" data-act="${c.redirect ? 'price' : ''}">
          ${c.featured ? `<div class="ft"${ft}>${esc(interpolate(c.featured, X))}</div>` : ''}
          <div class="bd"><div class="ti fnr-rich">${rich(c.title, X)}</div><div class="vl">${c.before ? `<small>${esc(interpolate(c.before, X))}</small>` : ''}<b>${m ? `<span>${esc(m[1])}</span>${esc(m[2])}` : esc(v)}</b>${c.after ? `<small>${esc(interpolate(c.after, X))}</small>` : ''}</div></div>
        </div>`;
      }
      case 'faq': return `<div class="fnr-faq">${(c.questions || []).map((q, i) => `<details${(c.firstQuestionOpened && i === 0) || (edit && opts.faqOpen) ? ' open' : ''}><summary><span>${esc(interpolate(q.question, X))}</span>${ICON.chev}</summary><div class="an fnr-rich">${rich(q.answer, X)}</div></details>`).join('')}</div>`;
      case 'clear': return `<div style="height:${esc(twSize(c.clear, '1rem'))}"></div>`;
      case 'alert': {
        const st = boxStyle(d.style || 'danger');
        const ic = c.icon && typeof c.icon === 'object' ? c.icon.value : c.icon;
        const icon = ic ? (c.icon && c.icon.type === 'icon' ? ({'triangle-alert': '⚠️', info: 'ℹ️', 'circle-check': '✅', 'circle-x': '⛔', bell: '🔔'}[ic] || '⚠️') : ic) : '';
        return `<div class="fnr-alert" style="${st};padding:${num(d.padding, 16)}px;border-width:${num(d.borderWidth, 1)}px">${icon ? `<span class="ic">${esc(icon)}</span>` : ''}<div>${c.title ? `<b class="ttl">${esc(interpolate(c.title, X))}</b>` : ''}<div class="fnr-rich" style="color:inherit">${rich(c.text, X)}</div></div></div>`;
      }
      case 'notification': {
        const pos = c.position || 'default';
        const first = notifText(c, 0);
        return `<div class="fnr-ntf-wrap ps-${esc(pos)}" data-ntf><div class="fnr-ntf" style="${ntfStyle(d.style)}"${edit ? '' : ' hidden'}><div class="t fnr-rich" style="color:inherit">${rich(first.title, X)}</div><div class="x fnr-rich" style="color:inherit">${rich(first.text, X)}</div><i class="bar"></i></div>${edit && pos !== 'default' ? `<span class="fnr-ph" style="min-height:0;padding:4px 8px;margin-top:4px">fixa: ${esc(pos)}</span>` : ''}</div>`;
      }
      case 'arguments': {
        const items = c.arguments || c.items || [];
        const cols = gridCols(c.cols || d.gridCols || d.grid || 'grid-cols-2');
        const aspect = (/aspect-\[([^\]]+)\]/.exec(d.aspectImage || '') || [])[1] || '1/1';
        return `<div class="fnr-args2" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${items.map(a => `<div class="fnr-arg2">${a.image && a.image.src ? (a.image.type === 'emoji' ? `<div class="em">${esc(a.image.src)}</div>` : `<div class="im" style="aspect-ratio:${aspect}"><img src="${esc(a.image.src)}" alt="" loading="lazy"></div>`) : ''}<div class="fnr-rich">${a.text != null ? rich(a.text, X) : `<h3>${esc(interpolate(a.title || '', X))}</h3><p>${esc(interpolate(a.text || '', X))}</p>`}</div></div>`).join('')}</div>`;
      }
      case 'quotes': {
        const qs = c.quotes || [];
        const card = t => `<div class="fnr-test"><div class="hd"><span class="av">${t.image && t.image.src ? `<img src="${esc(t.image.src)}" alt="">` : esc(String(t.name || '?').slice(0, 1))}</span><div><b>${esc(t.name || '')}</b>${t.activity ? `<small>${esc(t.activity)}</small>` : ''}</div>${t.rate ? `<span class="st">${'★'.repeat(clamp(num(t.rate, 5), 1, 5))}</span>` : ''}</div><div class="fnr-rich" style="font-size:.85em">${rich(t.text, X)}</div></div>`;
        if (c.layout === 'slide' && !edit && qs.length > 1) return `<div class="fnr-car" data-car="1"><div class="tr">${qs.map(t => `<div class="it" style="padding:0 2px">${card(t)}</div>`).join('')}</div></div>`;
        return `<div class="fnr-tests" style="${c.layout === 'grid' ? 'grid-template-columns:1fr 1fr' : ''}">${qs.map(card).join('')}</div>`;
      }
      case 'checklist': return `<div class="fnr-check">${(c.items || []).map(t => { const ic = t.icon && typeof t.icon === 'object' ? t.icon.value : (t.icon || d.icon || '✅'); return `<div><i>${esc(ic || '✅')}</i><span class="fnr-rich" style="color:inherit">${rich(t.text || '', X)}</span></div>` }).join('')}</div>`;
      case 'compare': {
        const b = c.first_image && c.first_image.src, a = c.secondary_image && c.secondary_image.src;
        if (!b || !a) return edit ? '<div class="fnr-ph">Antes/Depois — escolha as duas imagens</div>' : '';
        const ratio = {square: '1/1', video: '16/9', portrait: '3/4', mobile: '9/16'}[d.ratio] || '1/1';
        return `<div class="fnr-ba" data-ba style="aspect-ratio:${ratio}"><img src="${esc(b)}" alt="${esc(c.first_label || 'Antes')}" style="height:100%;object-fit:cover"><div class="af"><img src="${esc(a)}" alt="${esc(c.secondary_label || 'Depois')}"></div>${c.first_label !== '' ? `<span class="lb l">${esc(c.first_label || 'Antes')}</span>` : ''}${c.secondary_label !== '' ? `<span class="lb r">${esc(c.secondary_label || 'Depois')}</span>` : ''}<span class="hn"></span></div>`;
      }
      case 'carousel': {
        const items = (c.items || []).filter(i => (i.image && i.image.src) || i.text || i.caption);
        if (!items.length) return edit ? '<div class="fnr-ph">Carrossel — adicione imagens</div>' : '';
        const aspect = (/aspect-\[([^\]]+)\]/.exec(d.aspectImage || '') || [])[1] || '1/1';
        const layout = c.layout || d.layout || 'image_text';
        return `<div class="fnr-car${c.spoiler ? ' spoil' : ''}" data-car="${c.autoplay === false || d.autoplay === false ? 0 : 1}"><div class="tr">${items.map(i => `<div class="it"><div class="card">${i.image && i.image.src ? `<div class="im" style="aspect-ratio:${aspect}"><img src="${esc(i.image.src)}" alt="" loading="lazy"></div>` : ''}${layout !== 'image' && (i.text || i.caption) ? `<div class="cap fnr-rich">${i.text != null ? rich(i.text, X) : esc(i.caption)}</div>` : ''}</div></div>`).join('')}</div>${items.length > 1 && c.pagination !== false ? `<div class="dots">${items.map((_, k) => `<button type="button" data-dot="${k}"${k ? '' : ' class="on"'} aria-label="Item ${k + 1}"></button>`).join('')}</div>` : ''}</div>`;
      }
      case 'graphics': {
        const gs = c.graphics || [];
        return `<div class="fnr-graphics" style="grid-template-columns:repeat(${gridCols(c.cols || 'grid-cols-2')},minmax(0,1fr))">${gs.map(g => {
          const p = clamp(num(interpolate(String(g.percent == null ? 0 : g.percent), X, {fmt: String})), 0, 100), col = g.style && g.style !== 'theme' ? (NAMED[g.style] || g.style) : 'var(--fn-theme)';
          const viz = g.type === 'circle' || g.type === 'pie' ? ring(p, Math.round(p) + '%', col) : `<div class="gbar"><i style="height:${edit ? p : 0}%;background:${esc(col)}" data-h="${p}"></i><b>${Math.round(p)}%</b></div>`;
          return `<div class="fnr-graphic">${viz}<div class="fnr-rich lg">${rich(g.legend || '', X)}</div></div>`;
        }).join('')}</div>`;
      }
      case 'charts': return chartHtml(c, d, X);
      case 'script': case 'html': {
        const code = c.script != null ? c.script : c.html;
        return edit ? `<div class="fnr-ph">HTML/Script<br><small>${esc(String(code || '').slice(0, 80))}</small></div>` : `<div class="fnr-html" data-html></div>`;
      }
      case 'date': case 'height': case 'weight': return renderField(layer, step);
      case 'ifood': {
        const a = R.answers[layer.id], data = a && a.data ? a.data : (edit || mode === 'preview' && !opts.onIfood ? IFOOD_SAMPLE : null);
        const st = btnStyle(d);
        return `<div class="fnr-ifood"><div class="fnr-field"><label for="f-${esc(layer.id)}">${esc(interpolate(c.title || '', X))}${c.required ? '' : ' <span style="opacity:.6">(opcional)</span>'}</label>
          <input id="f-${esc(layer.id)}" class="fnr-input" data-act="ifood-link" inputmode="url" autocomplete="url" placeholder="${esc(c.placeholder || '')}" value="${esc(a ? displayValue(a.value) : (R.ifoodLink && R.ifoodLink[layer.id]) || '')}">
          ${c.help ? `<small class="fnr-help">${esc(c.help)}</small>` : ''}<div class="fnr-err"></div></div>
          <button type="button" class="fnr-btn st-${esc(d.style || 'theme')}" data-act="ifood" style="${st}">${esc(c.button || 'Ver o Raio-X')}</button>
          <div class="fnr-ifood-res">${data ? ifoodCard(data, data === IFOOD_SAMPLE) : ''}</div></div>`;
      }
      case 'group': return '';
      default: return edit ? `<div class="fnr-ph">Componente “${esc(layer.type)}”</div>` : '';
    }
  }
  const gridCols = g => { const m = /grid-cols-(\d+)/.exec(g || ''); return m ? clamp(+m[1], 1, 6) : 1 };
  function renderOptions(layer, step){
    const c = layer.content, d = layer.design || {};
    const sel = (R.answers[layer.id] && R.answers[layer.id].ids) || [];
    const imgs = (c.options || []).some(o => o.image && o.image.type !== 'emoji' && typeof o.image.src === 'string');
    const icon = d.icon || 'select', multiple = !!c.multiple;
    const aspect = (/aspect-\[([^\]]+)\]/.exec(d.aspectImage || '') || [])[1] || '1/1';
    let list = (c.options || []).slice();
    if ((d.order || c.order) === 'random' && !edit) { list = list.map(o => [Math.random(), o]).sort((a, b) => a[0] - b[0]).map(x => x[1]) }
    if ((d.order || c.order) === 'reverse') list.reverse();
    const video = c.introType === 'video';
    const cls = ['fnr-opts', 'ip-' + (d.iconPosition || 'end'), d.background === 'transparent' ? 'bg-transparent' : d.background === 'solid' ? 'bg-solid' : '', d.shadow && d.shadow !== 'shadow-none' ? 'sh' : '', imgs ? 'has-img' : '', d.align === 'center' ? 'center' : '', video ? 'on-video' : ''].filter(Boolean).join(' ');
    const style = `grid-template-columns:repeat(${gridCols(d.grid || c.cols)},minmax(0,1fr));--fn-ogap:${twSize(d.gap, '.5rem')};--fn-obw:${twSize(d.border, '2px')}`;
    let intro = '';
    if (c.introType === 'text' && c.introduction) intro = `<div class="fnr-rich" style="margin-bottom:10px">${rich(c.introduction, ctx())}</div>`;
    const opts = `<div class="${cls}" style="${style}" role="${multiple ? 'group' : 'radiogroup'}">${list.map(o => {
      const on = sel.includes(o.id);
      const value = o.value != null && o.value !== '' ? o.value : '';
      const ic = icon === 'none' ? '' : icon === 'arrow' ? `<span class="fnr-oarrow">${ICON.arrow}</span>` : icon === 'value' ? `<span class="fnr-oval">${esc(value || '•')}</span>` : `<span class="fnr-oico${multiple || icon === 'checkbox' ? ' sq' : ''}"></span>`;
      const emoji = o.image && o.image.type === 'emoji' && o.image.src ? `<span class="fnr-oemoji">${esc(o.image.src)}</span>` : '';
      const im = imgs ? `<div class="fnr-oimg" style="aspect-ratio:${aspect}">${o.image && o.image.src ? `<img src="${esc(o.image.src)}" alt="" loading="lazy">` : (edit ? '<div class="fnr-ph" style="min-height:0;height:100%;border:0">Imagem</div>' : '')}</div>` : '';
      return `<button type="button" class="fnr-opt${on ? ' is-on' : ''}" data-act="opt" data-oid="${esc(o.id)}" aria-pressed="${on}">${im}${emoji}<span class="fnr-olabel fnr-rich" style="color:inherit">${rich(o.label, ctx())}</span>${ic}</button>`;
    }).join('')}</div>`;
    // Vídeo resposta: o vídeo (código de incorporação) em cima e as opções embaixo, num bloco escuro.
    if (video) {
      const ratio = {video: '16/9', mobile: '9/16', square: '1/1', portrait: '3/4'}[c.aspectRatio || 'video'] || '16/9';
      const src = videoSrc(c.introduction || '');
      const player = edit ? `<div class="fnr-ph" style="position:absolute;inset:0;border:0;color:#fff">▶ Vídeo resposta</div>` : src ? `<iframe src="${esc(src)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>` : `<div class="fnr-vhtml" data-vhtml></div>`;
      return `<div class="fnr-vresp"><div class="fnr-video" style="aspect-ratio:${ratio};border-radius:0">${player}</div><div class="pad">${opts}</div></div>`;
    }
    return intro + opts;
  }
  function renderField(layer){
    const c = layer.content, a = R.answers[layer.id];
    const val = a ? displayValue(a.value) : '';
    const type = layer.type === 'height' || layer.type === 'weight' || layer.type === 'date' ? layer.type : (c.type || 'text');
    const label = c.title ? `<label for="f-${esc(layer.id)}">${esc(interpolate(c.title, ctx()))}${c.required === false ? ' <span style="opacity:.6">(opcional)</span>' : ''}</label>` : '';
    if (type === 'height' || type === 'weight') {
      const min = num(c.min, type === 'height' ? 140 : 40), max = num(c.max, type === 'height' ? 220 : 250);
      const v = a ? num(a.value) : num(c.value, Math.round((min + max) / 2));
      return `<div class="fnr-field">${label}<div class="fnr-ruler"><output>${v}<small>${esc(c.unit || (type === 'height' ? 'cm' : 'kg'))}</small></output><input type="range" id="f-${esc(layer.id)}" min="${min}" max="${max}" value="${v}" data-act="range"></div><div class="fnr-err"></div></div>`;
    }
    const attrs = `id="f-${esc(layer.id)}" class="fnr-input" data-act="field" placeholder="${esc(c.placeholder || '')}" ${c.required ? 'required' : ''}`;
    let input;
    if (type === 'textarea') input = `<textarea ${attrs} maxlength="${num(c.maxlength, 1000)}">${esc(val)}</textarea>`;
    else {
      const t = {email: 'email', phone: 'tel', number: 'number', date: 'date'}[type] || 'text';
      const ac = {email: 'email', phone: 'tel', text: /nome|name/i.test(c.title || '') ? 'name' : 'on'}[type] || 'on';
      const minDate = type === 'date' && c.disablePast ? ` min="${new Date().toISOString().slice(0, 10)}"` : '';
      input = `<input type="${t}" ${attrs} value="${esc(val)}" autocomplete="${ac}"${minDate} ${type === 'phone' ? 'inputmode="tel"' : type === 'number' ? 'inputmode="decimal"' : ''}>`;
    }
    const consent = c.consent ? `<div class="fnr-consent">${rich(c.consent, ctx())}</div>` : '';
    return `<div class="fnr-field">${label}${input}<div class="fnr-err"></div>${consent}</div>`;
  }

  /* ----- etapa ----- */
  // Camadas arquivadas não aparecem; nomes antigos de componentes viram os do InLead.
  function visibleLayers(step){ return (step.layers || []).filter(l => l && !l.archived).map(normalizeLayer).filter(l => edit || evalRoles(l.roles, ctx())) }
  function render(){
    if (R.destroyed) return;
    clearTimers();
    const f = R.funnel, step = stepAt(R.index), d = Object.assign({}, DEFAULT_DESIGN, f.design || {});
    const vars = cssVars(d);
    if (!step) { el.innerHTML = ''; const root = doc.createElement('div'); root.className = 'fnr fnr-' + mode; for (const k in vars) root.style.setProperty(k, vars[k]); root.innerHTML = '<div class="fnr-page"><div class="fnr-end"><b>Funil sem etapas</b></div></div>'; el.appendChild(root); R.root = null; return }
    // Cabeçalho da etapa: step.options do InLead (show_logo, show_progress, show_back) e step.settings deste app.
    const so = step.options || {};
    const ss = Object.assign({showLogo: so.show_logo !== false, showProgress: so.show_progress !== false, showBack: so.show_back !== false, backLabel: so.back_label || ''}, step.settings || {});
    const total = f.steps.length;
    // Barra: no editor, a posição na lista; na página, etapas feitas ÷ (feitas + as que faltam no caminho mais curto).
    let pct = total ? Math.round(((R.index + 1) / total) * 100) : 0;
    if (!edit) {
      const left = stepsLeft(f, R.index), done = R.history.length + 1;
      if (left != null) pct = Math.round(done / (done + left) * 100);
      if (R.dir > 0 && R.pct != null) pct = Math.max(pct, R.pct);
    }
    // Mesma página e mesmo funil: mantém o cabeçalho e troca só o corpo, com a barra deslizando até o novo ponto.
    const reuse = !edit && R.root && R.shellOf === f && el.contains(R.root);
    const fromPct = reuse && R.pct != null ? R.pct : pct;
    const animate = !edit && (R.lastIdx === undefined ? live : R.lastIdx !== R.index);
    const bg = d.background || {};
    let bgx = '', rootBg = '';
    if (bg.type === 'image' && bg.src) bgx = `<div class="fnr-bgx" style="opacity:${num(bg.opacity, 1)}"><img src="${esc(bg.src)}" alt=""></div>`;
    else if (bg.type === 'video' && bg.src) bgx = `<div class="fnr-bgx" style="opacity:${num(bg.opacity, 1)}"><video src="${esc(bg.src)}" autoplay muted loop playsinline></video></div>`;
    else if (bg.type === 'gradient') rootBg = `linear-gradient(${num(bg.angle, 180)}deg, ${bg.from || d.backgroundColor}, ${bg.to || d.themeColor})`;
    else if (bg.type === 'effect') rootBg = `radial-gradient(120% 60% at 50% -10%, color-mix(in srgb, ${d.themeColor} 45%, transparent), transparent 70%), ${d.backgroundColor}`;
    const logo = d.logo && d.logo.src && ss.showLogo ? `<div class="fnr-logo s-${esc(d.logo.size || 'normal')} p-${esc(d.logo.position || 'center')}"><img src="${esc(d.logo.src)}" alt=""></div>` : '<div></div>';
    const canBack = edit ? true : R.history.length > 0;
    const back = ss.showBack ? `<button type="button" class="fnr-back" data-act="back" aria-label="Voltar"${canBack ? '' : ' hidden'}>${ICON.back}${ss.backLabel ? `<span>${esc(ss.backLabel)}</span>` : ''}</button>` : '<div></div>';
    const prog = ss.showProgress && d.progress !== 'none' ? `<div class="fnr-progress"><i style="width:${fromPct}%"></i></div>` : '';
    const layers = visibleLayers(step);
    const head = `<header class="fnr-head">${back}${logo}<div></div>${prog}</header>`;
    const headSig = head.replace(/ style="width:[\d.]+%"/, '').replace(' hidden', '');
    const body = `<main class="fnr-body al-${esc(d.align || 'center')}"><div class="fnr-layers">${layers.map((l, i) => {
      const cond = hasRoles(l), hidden = edit && cond && !evalRoles(l.roles, ctx());
      const basis = clamp(num(l.design && l.design.basis, 100), 10, 100);
      const html = renderLayer(l, step);
      if (!html && !edit) return '';
      return `<div class="fnr-l${edit && cond ? ' is-cond-edit' : ''}${hidden ? ' is-hidden-edit' : ''}${edit && opts.selected === l.id ? ' is-sel' : ''}" data-lid="${esc(l.id)}" data-li="${i}" style="flex:0 0 ${basis}%;max-width:${basis}%"${edit ? ' draggable="true"' : ''}>${edit ? `<span class="fnr-tag">${esc(l.title || TYPE_TITLE[l.type] || l.type)}${cond ? ' · condicional' : ''}</span>` : ''}${html}</div>`;
    }).join('')}</div></main>`;
    let root;
    if (reuse) {
      root = R.root;
      root.querySelectorAll('.fnr-stepjs').forEach(x => x.remove());
      if (R.headSig !== headSig) { const t = doc.createElement('div'); t.innerHTML = head; root.querySelector('.fnr-head').replaceWith(t.firstElementChild) }
      else { const bb = root.querySelector('.fnr-back'); if (bb) bb.hidden = !canBack }
      const t = doc.createElement('div'); t.innerHTML = body; const nb = t.firstElementChild;
      if (animate) nb.classList.add(R.dir < 0 ? 'fnr-in-back' : 'fnr-in');
      root.querySelector('.fnr-body').replaceWith(nb);
    } else {
      el.innerHTML = '';
      root = doc.createElement('div');
      root.className = 'fnr' + (edit ? ' fnr-edit' : '') + ' fnr-' + mode;
      for (const k in vars) root.style.setProperty(k, vars[k]);
      if (rootBg) root.style.background = rootBg;
      root.innerHTML = `${bgx}<div class="fnr-page">${head}${body}</div>`;
      if (animate) { const b = root.querySelector('.fnr-body'); if (b) b.classList.add('fnr-in') }
      el.appendChild(root);
      R.root = root;
    }
    const bar = root.querySelector('.fnr-progress i');
    if (bar && fromPct !== pct) { void bar.offsetWidth; bar.style.width = pct + '%' }
    R.pct = pct; R.headSig = headSig; R.shellOf = edit ? null : f; R.lastIdx = R.index;
    afterRender(step, layers);
    if (!edit) R.timers.push(setTimeout(() => preloadNext(step), 350));
    if (ss.scrollTop !== false && !edit) try { (opts.scrollEl || window).scrollTo({top: 0}) } catch (e) {}
    // Script da etapa (InLead: step.script), só na página publicada.
    if (live && step.script) { const box = doc.createElement('div'); box.hidden = true; box.className = 'fnr-stepjs'; box.innerHTML = String(step.script); root.appendChild(box); box.querySelectorAll('script').forEach(old => { const sc = doc.createElement('script'); for (const a of old.attributes) sc.setAttribute(a.name, a.value); sc.textContent = old.textContent; old.replaceWith(sc) }) }
  }

  /* ----- comportamentos depois de desenhar ----- */
  function afterRender(step, layers){
    const root = R.root;
    if (edit) {
      if (opts.onSelect) root.addEventListener('click', e => { const w = e.target.closest('.fnr-l'); if (w) { e.preventDefault(); opts.onSelect(w.dataset.lid, step.id) } });
      if (opts.onReady) opts.onReady(root, step);
      return;
    }
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    // HTML/Script e vídeo resposta com código de incorporação: insere e executa os <script>
    const runHtml = (box, html) => { box.innerHTML = String(html || ''); box.querySelectorAll('script').forEach(old => { const sc = doc.createElement('script'); for (const a of old.attributes) sc.setAttribute(a.name, a.value); sc.textContent = old.textContent; old.replaceWith(sc) }) };
    root.querySelectorAll('[data-html]').forEach(box => { const lid = box.closest('.fnr-l').dataset.lid, layer = step.layers.find(l => l.id === lid); if (layer) runHtml(box, layer.content.script != null ? layer.content.script : layer.content.html) });
    root.querySelectorAll('[data-vhtml]').forEach(box => { const lid = box.closest('.fnr-l').dataset.lid, layer = step.layers.find(l => l.id === lid); if (layer) runHtml(box, layer.content.introduction) });
    // animações de barras
    requestAnimationFrame(() => setTimeout(() => {
      root.querySelectorAll('.fnr-metric .bar i[data-w]').forEach(i => i.style.width = i.dataset.w + '%');
      root.querySelectorAll('.fnr-metric .bar b[data-l]').forEach(b => b.style.left = b.dataset.l + '%');
      root.querySelectorAll('.fnr-graphic .gbar i[data-h]').forEach(i => i.style.height = i.dataset.h + '%');
    }, 60));
    // timers, como no InLead: por tempo, recomeça cada vez que a etapa abre; por data, conta até a data escolhida
    root.querySelectorAll('[data-timer]').forEach(t => {
      const total = num(t.dataset.timer, 300), lay = t.dataset.tlayout || 'countdown';
      const end = num(t.dataset.tdate, 0) || Date.now() + total * 1000;
      const tick = () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        if (lay === 'text') { const tt = t.querySelector('[data-tt]'); if (tt) tt.textContent = timeText(left) }
        else t.innerHTML = timerHtml(lay, left);
      };
      tick(); R.timers.push(setInterval(tick, 1000));
    });
    // notificação: mostra um aviso por vez, com @1, @2, @3 trocados
    layers.filter(l => l.type === 'notification').forEach(l => {
      const w = root.querySelector(`.fnr-l[data-lid="${l.id}"] [data-ntf]`); if (!w) return;
      const box = w.querySelector('.fnr-ntf'), c = l.content, dur = Math.max(1, num(c.duration, 5)), gap = Math.max(0.1, num(c.interval, 2));
      const total = (c.variables && c.variables[0] && (c.variables[0].values || []).length) || 1;
      let n = 0;
      const show = () => {
        if (n >= total || R.destroyed) return;
        const tx = notifText(c, n);
        box.querySelector('.t').innerHTML = rich(tx.title, ctx()); box.querySelector('.x').innerHTML = rich(tx.text, ctx());
        const bar = box.querySelector('.bar'); bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
        box.hidden = false; box.classList.add('in');
        requestAnimationFrame(() => { bar.style.transition = `transform ${dur}s linear`; bar.style.transform = 'scaleX(0)' });
        R.timers.push(setTimeout(() => { box.classList.remove('in'); R.timers.push(setTimeout(() => { box.hidden = true; n++; R.timers.push(setTimeout(show, gap * 1000)) }, 400)) }, dur * 1000));
      };
      R.timers.push(setTimeout(show, gap * 1000));
    });
    // loading: avança sozinho
    layers.filter(l => l.type === 'loading').forEach(l => {
      const w = root.querySelector(`.fnr-l[data-lid="${l.id}"]`); if (!w) return;
      const c = l.content, secs = Math.max(0.5, num(c.seconds, 3)), start = clamp(num(c.starts, 0), 0, 100);
      const bar = w.querySelector('.bar i'), pc = w.querySelector('[data-pc]'), svg = w.querySelector('svg');
      const t0 = Date.now();
      const iv = setInterval(() => {
        const k = clamp((Date.now() - t0) / (secs * 1000), 0, 1), p = Math.round(start + (100 - start) * k);
        if (bar) bar.style.width = p + '%'; if (pc) pc.textContent = p + '%';
        if (svg) svg.outerHTML = ring(p, p + '%');
        if (k >= 1) { clearInterval(iv); navigate(step, destinationOf(R.funnel, c), {layer: l}) }
      }, 50);
      R.timers.push(iv);
    });
    // áudio
    root.querySelectorAll('[data-audio]').forEach(box => {
      const src = box.dataset.audio; if (!src) return;
      const au = new Audio(); au.preload = 'metadata'; au.src = src;
      const btn = box.querySelector('.fnr-aplay'), bars = [...box.querySelectorAll('.fnr-awave i')], time = box.querySelector('.fnr-atime');
      const paint = () => { const k = au.duration ? au.currentTime / au.duration : 0; const n = Math.round(k * bars.length); bars.forEach((b, i) => b.classList.toggle('on', i < n)); time.textContent = mmss(au.paused && !au.currentTime ? (au.duration || 0) : au.currentTime) };
      au.addEventListener('loadedmetadata', paint); au.addEventListener('timeupdate', paint);
      au.addEventListener('ended', () => { btn.innerHTML = ICON.play; au.currentTime = 0; paint() });
      btn.addEventListener('click', e => { e.stopPropagation(); if (au.paused) { (R.audios || []).forEach(x => { if (x.au !== au && !x.au.paused) { x.au.pause(); x.btn.innerHTML = ICON.play } }); au.play().catch(() => {}); btn.innerHTML = ICON.pause; emit('media', {step: step.id, layer: box.closest('.fnr-l').dataset.lid, action: 'play'}) } else { au.pause(); btn.innerHTML = ICON.play } });
      box.querySelector('.fnr-awave').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); if (au.duration) au.currentTime = au.duration * clamp((e.clientX - r.left) / r.width, 0, 1) });
      R.audios = (R.audios || []).concat({au, btn});
      R.cleanup = (R.cleanup || []).concat(() => { au.pause(); R.audios = [] });
    });
    // antes/depois
    root.querySelectorAll('[data-ba]').forEach(ba => {
      const af = ba.querySelector('.af'), hn = ba.querySelector('.hn');
      const set = x => { const r = ba.getBoundingClientRect(), k = clamp((x - r.left) / r.width, 0, 1) * 100; af.style.clipPath = `inset(0 0 0 ${k}%)`; hn.style.left = k + '%' };
      let drag = false;
      ba.addEventListener('pointerdown', e => { drag = true; ba.setPointerCapture(e.pointerId); set(e.clientX) });
      ba.addEventListener('pointermove', e => { if (drag) set(e.clientX) });
      ba.addEventListener('pointerup', () => { drag = false });
    });
    // carrossel
    root.querySelectorAll('[data-car]').forEach(car => {
      const tr = car.querySelector('.tr'), dots = [...car.querySelectorAll('[data-dot]')], n = tr.children.length; let k = 0;
      // Anda pela largura do item (com "espiada" o item é mais estreito que o carrossel) e centraliza.
      const go = i => { k = (i + n) % n; const it = tr.children[k]; const x = it.offsetLeft - (car.clientWidth - it.offsetWidth) / 2; tr.style.transform = `translateX(${-Math.max(0, Math.min(x, tr.scrollWidth - car.clientWidth))}px)`; dots.forEach((d, j) => d.classList.toggle('on', j === k)) };
      go(0);
      dots.forEach(d => d.addEventListener('click', e => { e.stopPropagation(); go(+d.dataset.dot) }));
      let x0 = null; car.addEventListener('touchstart', e => { x0 = e.touches[0].clientX }, {passive: true});
      car.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(k + (dx < 0 ? 1 : -1)); x0 = null });
      if (car.dataset.car === '1' && n > 1) R.timers.push(setInterval(() => go(k + 1), 3500));
    });
    if (opts.onReady) opts.onReady(root, step);
  }

  /* ----- interação ----- */
  function layerOf(target){ const w = target.closest('.fnr-l'); if (!w) return null; const step = stepAt(R.index); const raw = step.layers.find(l => l.id === w.dataset.lid); return {w, step, layer: raw && normalizeLayer(raw)} }
  function runScript(code){ if (!code || !live) return; try { new Function(code)() } catch (e) { console.warn('Script do componente falhou:', e) } }
  // eventID igual ao que o servidor manda pela API de Conversões (a Meta junta os dois e não conta em dobro)
  function firePixel(ev, key){ if (!ev || !live) return; try { if (window.fbq) window.fbq('track', ev, {}, opts.eventId && key ? {eventID: opts.eventId(key)} : undefined) } catch (e) {} }
  function onClick(e){
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act;
    if (act === 'back') { e.preventDefault(); back(); return }
    const hit = layerOf(t); if (!hit || !hit.layer) return;
    const {step, layer} = hit;
    if (act === 'opt') { e.preventDefault(); chooseOption(step, layer, t.dataset.oid, t); return }
    if (act === 'button') { e.preventDefault(); pressButton(step, layer, t); return }
    if (act === 'ifood') { e.preventDefault(); runIfood(step, layer, hit.w, t); return }
    if (act === 'price') {
      // o cartão de preço aciona o próximo botão da etapa
      const k = step.layers.indexOf(layer), btn = step.layers.slice(k + 1).concat(step.layers.slice(0, k)).find(l => l.type === 'button' && evalRoles(l.roles, ctx()));
      if (btn) { const el2 = R.root.querySelector(`.fnr-l[data-lid="${btn.id}"] .fnr-btn`); pressButton(step, btn, el2) }
    }
  }
  function onInput(e){
    const t = e.target, act = t.dataset && t.dataset.act;
    if (act === 'ifood-link') { const hit = layerOf(t); if (hit) { (R.ifoodLink = R.ifoodLink || {})[hit.layer.id] = t.value; const f = hit.w.querySelector('.fnr-field'); f.classList.remove('has-err'); f.querySelector('.fnr-err').textContent = '' } return }
    if (act !== 'field' && act !== 'range') return;
    const hit = layerOf(t); if (!hit) return;
    const c = hit.layer.content;
    if (act === 'range') { const out = hit.w.querySelector('output'); if (out) out.firstChild.textContent = t.value; R.answers[hit.layer.id] = Object.assign({}, R.answers[hit.layer.id] || {}, {step: hit.step.id, name: c.name || hit.layer.id, type: hit.layer.type, title: c.title || '', value: t.value}); return }
    if (c.type === 'phone' || c.mask === 'phone') { const pos = t.value.length; t.value = phoneMask(t.value); if (t.value.length !== pos) try { t.setSelectionRange(t.value.length, t.value.length) } catch (er) {} }
    R.answers[hit.layer.id] = Object.assign({}, R.answers[hit.layer.id] || {}, {step: hit.step.id, name: c.name || hit.layer.id, type: hit.layer.type, title: c.title || '', value: t.value});
    const f = hit.w.querySelector('.fnr-field'); if (f && f.classList.contains('has-err')) { const msg = validateField(c, t.value); if (!msg) { f.classList.remove('has-err'); f.querySelector('.fnr-err').textContent = '' } }
    // Guarda a resposta válida enquanto a pessoa digita (sem esperar sair do campo): assim o WhatsApp
    // de quem desiste no formulário não se perde (veja "abandono" em Configurações › Leads e dados).
    const lid = hit.layer.id, val = t.value;
    clearTimeout((R.capT = R.capT || {})[lid]);
    if (String(val).trim() && !validateField(Object.assign({}, c, {required: false}), val)) R.capT[lid] = setTimeout(() => {
      if (R.destroyed || !R.answers[lid] || R.answers[lid].value !== val || (R.saved = R.saved || {})[lid] === val) return;
      R.saved[lid] = val; setAnswer(hit.step, hit.layer, {value: c.type === 'phone' ? phoneMask(val) : String(val).trim()});
    }, 1200);
  }
  function onChange(e){
    const t = e.target, act = t.dataset && t.dataset.act; if (act !== 'field' && act !== 'range') return;
    const hit = layerOf(t); if (!hit) return;
    const v = t.value; if (act === 'field' && !String(v).trim()) return;
    (R.saved = R.saved || {})[hit.layer.id] = v;
    setAnswer(hit.step, hit.layer, {value: v});
  }
  function chooseOption(step, layer, oid, el2){
    const c = layer.content, cur = (R.answers[layer.id] && R.answers[layer.id].ids) || [];
    const o = (c.options || []).find(x => x.id === oid); if (!o) return;
    let ids;
    if (c.multiple) { ids = cur.includes(oid) ? cur.filter(x => x !== oid) : cur.concat(oid); if (c.max && ids.length > num(c.max)) ids = ids.slice(-num(c.max)) }
    else ids = [oid];
    const ans = optionAnswer(layer, ids);
    if (ans) setAnswer(step, layer, ans); else delete R.answers[layer.id];
    R.root.querySelectorAll(`.fnr-l[data-lid="${layer.id}"] .fnr-opt`).forEach(b => { const on = ids.includes(b.dataset.oid); b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on) });
    const w = R.root.querySelector(`.fnr-l[data-lid="${layer.id}"]`); if (w) w.classList.remove('has-err');
    runScript(o.script); firePixel(o.pixelEvent, o.id);
    // Como no InLead: na escolha única o funil avança na hora, a não ser que a opção espere o botão (awaitSubmit).
    if (c.multiple || c.awaitSubmit) return;
    const others = visibleLayers(step).filter(l => l.id !== layer.id && INPUT_TYPES.includes(l.type) && needsAnswer(l));
    if (others.length) { validateStep(step); return }
    R.lastInteract = c.name || layer.id;
    R.busy = true;
    R.timers.push(setTimeout(() => { R.busy = false; navigate(step, destinationOf(R.funnel, o), {layer, item: o}) }, 200));
  }
  function needsAnswer(l){
    const a = R.answers[l.id];
    if (l.type === 'options') return l.content.required !== false && !(a && a.ids && a.ids.length);
    if (l.type === 'height' || l.type === 'weight') return false;
    if (l.type === 'ifood') return !!l.content.required && !(a && a.data);
    if (l.type === 'field' || l.type === 'date') return !!validateField(Object.assign({}, l.content, l.type === 'date' ? {type: 'date'} : {}), a ? a.value : '');
    return false;
  }
  // Confere campos e opções obrigatórios da etapa. Devolve true se está tudo certo.
  function validateStep(step){
    let ok = true, first = null;
    for (const l of visibleLayers(step)) {
      const w = R.root.querySelector(`.fnr-l[data-lid="${l.id}"]`); if (!w) continue;
      if (l.type === 'field' || l.type === 'date' || l.type === 'height' || l.type === 'weight') {
        const inp = w.querySelector('[data-act="field"],[data-act="range"]');
        const v = inp ? inp.value : '';
        if (inp && inp.dataset.act === 'range') { if (!R.answers[l.id]) setAnswer(step, l, {value: v}); continue }
        const msg = validateField(l.content, v);
        const box = w.querySelector('.fnr-field'); box.classList.toggle('has-err', !!msg); box.querySelector('.fnr-err').textContent = msg;
        if (msg) { ok = false; first = first || inp } else if (String(v).trim()) setAnswer(step, l, {value: l.content.type === 'phone' ? phoneMask(v) : String(v).trim()});
      } else if (l.type === 'ifood') {
        const link = String((R.ifoodLink && R.ifoodLink[l.id]) || '').trim(), box = w.querySelector('.fnr-field');
        if (needsAnswer(l)) { ok = false; first = first || w.querySelector('input'); box.classList.add('has-err'); box.querySelector('.fnr-err').textContent = link ? 'Toque no botão para analisar a loja' : 'Cole o link da sua loja no iFood' }
        else if (link && !(R.answers[l.id] && R.answers[l.id].data)) setAnswer(step, l, {value: link});
      } else if (l.type === 'options' && needsAnswer(l)) {
        ok = false; w.classList.add('has-err'); first = first || w;
        const box = w.querySelector('.fnr-opts'); if (box && box.animate) box.animate([{transform: 'translateX(0)'}, {transform: 'translateX(-6px)'}, {transform: 'translateX(6px)'}, {transform: 'translateX(0)'}], {duration: 280});
      }
    }
    if (first && first.focus) try { first.focus() } catch (e) {}
    return ok;
  }
  async function runIfood(step, layer, w, btn){
    const link = String((R.ifoodLink && R.ifoodLink[layer.id]) || w.querySelector('input').value || '').trim();
    const box = w.querySelector('.fnr-field'), err = box.querySelector('.fnr-err'), res = w.querySelector('.fnr-ifood-res');
    if (!link) { box.classList.add('has-err'); err.textContent = 'Cole o link da sua loja no iFood'; return }
    if (!opts.onIfood) { res.innerHTML = ifoodCard(IFOOD_SAMPLE, true); return }
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Analisando sua loja…';
    try {
      const d = await opts.onIfood(link, num(layer.content.km, 3));
      if (R.destroyed) return;
      setAnswer(step, layer, {value: link, data: d});
      res.innerHTML = ifoodCard(d);
      box.classList.remove('has-err'); err.textContent = '';
    } catch (e) { box.classList.add('has-err'); err.textContent = (e && e.message) || 'Não consegui analisar essa loja agora.' }
    finally { btn.disabled = false; btn.textContent = label }
  }
  function pressButton(step, layer, btnEl){
    if (R.busy) return;
    const c = layer.content;
    if (!validateStep(step)) return;
    runScript(c.script); firePixel(c.pixelEvent, layer.id);
    if (c.name) R.clicks[c.name] = true;
    R.lastInteract = c.name || layer.id;
    // Destino: modelo de link (WhatsApp, Kirvano…) ou o destino com as variáveis trocadas.
    const href = buttonHref(c, ctx());
    const dest = c.model && c.model.type ? href : (href && href !== c.destination ? href : destinationOf(R.funnel, c));
    emit('click', {step: step.id, stepIndex: R.index, layer: layer.id, name: c.name || layer.id, label: stripHtml(c.label), destination: dest});
    navigate(step, dest, {layer, item: c, button: btnEl});
  }
  const stepIndexOf = id => (R.funnel.steps || []).findIndex(s => s.id === id);
  // Imagens das etapas para onde esta leva: baixadas enquanto a pessoa lê, para a próxima abrir já pronta.
  const IMG_RE = /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/i;
  function preloadNext(step){
    if (R.destroyed || typeof Image === 'undefined') return;
    const seen = R.pre = R.pre || new Set(), i = stepIndexOf(step.id);
    const outs = outlets(R.funnel, step), dests = outs.length ? outs.map(o => o.dest) : ['next'];
    const walk = v => { if (typeof v === 'string') { if (IMG_RE.test(v) && !seen.has(v) && seen.size < 60) { seen.add(v); const im = new Image(); im.decoding = 'async'; im.src = v } } else if (v && typeof v === 'object') for (const k in v) walk(v[k]) };
    for (const dest of dests) { const to = resolveDestination(R.funnel, i, dest); if (to.step != null) walk((R.funnel.steps[to.step] || {}).layers) }
  }
  function navigate(step, dest, info){
    const to = resolveDestination(R.funnel, R.index, dest);
    if (to.back) return back();
    if (to.url) {
      // Como no InLead, o link externo leva todos os parâmetros da URL atual (UTMs, fbclid…).
      let url = buildRedirect(to.url, R.params);
      if (opts.decorateUrl) try { url = opts.decorateUrl(url, info) || url } catch (e) {}
      emit('complete', {step: step.id, stepIndex: R.index, url});
      if (!live) { if (opts.onPreviewRedirect) opts.onPreviewRedirect(url); return }
      const leave = () => { if (info && info.item && info.item.target) window.open(url, '_blank', 'noopener'); else window.location.href = url };
      if (info && info.button) { info.button.disabled = true; R.timers.push(setTimeout(() => { if (info.button) info.button.disabled = false }, 2500)) }
      Promise.resolve(opts.beforeRedirect ? opts.beforeRedirect(url, info) : null).catch(() => {}).then(leave);
      return;
    }
    // Avançar a partir da última etapa conta como fluxo completo (como no InLead).
    if (to.end || R.index === R.funnel.steps.length - 1) emit('complete', {step: step.id, stepIndex: R.index});
    if (to.end) { if (opts.onEnd) opts.onEnd(); return }
    go(to.step, true);
  }
  function go(target, push){
    const k = typeof target === 'number' ? target : stepIndexOf(target);
    if (k < 0 || k >= R.funnel.steps.length) return;
    if (push && k !== R.index) R.history.push(R.index);
    R.dir = 1; R.index = k;
    (R.cleanup || []).forEach(fn => { try { fn() } catch (e) {} }); R.cleanup = [];
    render();
    if (!edit) emit('step', {step: R.funnel.steps[k].id, stepIndex: k, title: R.funnel.steps[k].title, total: R.funnel.steps.length});
  }
  function back(){ if (!R.history.length) return; const k = R.history.pop(); R.dir = -1; R.index = k; (R.cleanup || []).forEach(fn => { try { fn() } catch (e) {} }); R.cleanup = []; render(); emit('back', {step: R.funnel.steps[k].id, stepIndex: k}) }

  R.index = startIndex();
  render();
  if (!edit) emit('step', {step: (stepAt(R.index) || {}).id, stepIndex: R.index, title: (stepAt(R.index) || {}).title, total: R.funnel.steps.length, first: true});
  return {
    get index(){ return R.index }, get answers(){ return R.answers }, get history(){ return R.history.slice() },
    go: id => go(id, true), back, render,
    setFunnel(f, keepIndex){ R.funnel = f; if (!keepIndex) R.index = 0; R.index = clamp(R.index, 0, Math.max(0, f.steps.length - 1)); render() },
    setSelected(id){ opts.selected = id; if (R.root) R.root.querySelectorAll('.fnr-l').forEach(w => w.classList.toggle('is-sel', w.dataset.lid === id)) },
    destroy(){ R.destroyed = true; clearTimers(); (R.cleanup || []).forEach(fn => { try { fn() } catch (e) {} }); el.innerHTML = '' },
  };
}

return {uid, esc, clone, stripHtml, plainLabel, calcEval, replaceCalc, interpolate, evalRoles, evalCond, destinationOf, resolveDestination, phoneMask, validateField, fromInlead, newLayer, newStep, stepTemplate, newFunnel, reId, outlets, stepsLeft, totalScore, isUrl, cssVars, fontsUrl, mount, COMPONENTS, DEFAULT_DESIGN, STEP_TEMPLATES, TYPE_TITLE, FONTS, RADIUS, videoSrc, buildVars, replaceVars, buildRedirect, toE164, LINK_MODELS, buttonHref, ROLE_OPERATORS, normalizeLayer, INPUT_TYPES, TYPE_ALIAS, abAssign, abTests, abName, abVariants};
});
