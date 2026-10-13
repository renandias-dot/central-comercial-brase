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

/* ================= respostas e variáveis ================= */
// answers: { [layerId]: {step, name, type, value, label, score, values?, labels?} }
function varIndex(funnel, answers){
  const byName = {};
  for (const id in answers || {}) { const a = answers[id]; if (a && a.name) byName[a.name] = a }
  return byName;
}
function totalScore(answers){ let t = 0; for (const id in answers || {}) t += num(answers[id] && answers[id].score); return t }
// {{score}}, {{score.nome}}, {{nome}}, {{value.nome}}, {{label.nome}}, {{url.param}}
function interpolate(text, ctx, opt = {}){
  if (text == null) return '';
  const {answers = {}, params = {}} = ctx || {};
  const names = varIndex(null, answers);
  const enc = opt.html ? esc : (x => x);
  let t = String(text).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    key = stripHtml(key);
    if (key === 'score') return String(totalScore(answers));
    const m = /^(score|value|label|url)\.(.+)$/.exec(key);
    if (m) {
      if (m[1] === 'url') return enc(params[m[2]] || '');
      const a = names[m[2]];
      if (m[1] === 'score') return String(a ? num(a.score) : 0);
      if (!a) return '';
      return enc(m[1] === 'value' ? displayValue(a.value) : (a.label != null ? a.label : displayValue(a.value)));
    }
    const a = names[key];
    if (!a) return '';
    return enc(a.label != null && a.type !== 'field' ? a.label : displayValue(a.value));
  });
  if (t.indexOf('calc(') >= 0) t = replaceCalc(t, opt.fmt);
  return t;
}
const displayValue = v => Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);

/* ================= regras de exibição ================= */
// roles = [[cond, cond], [cond]] → (cond E cond) OU cond.  cond = {variable: '@nome', compare: '==', value}
function evalCond(c, ctx){
  const names = varIndex(null, ctx.answers);
  const key = String(c.variable || '').replace(/^@/, '').trim();
  let left;
  if (key === 'score') left = totalScore(ctx.answers);
  else if (/^score\./.test(key)) { const a = names[key.slice(6)]; left = a ? num(a.score) : 0 }
  else if (/^url\./.test(key)) left = (ctx.params || {})[key.slice(4)] || '';
  else { const a = names[key]; left = a ? a.value : undefined }
  const right = c.value == null ? '' : String(c.value);
  const list = Array.isArray(left) ? left.map(String) : left == null ? [] : [String(left)];
  const L = list.join(',');
  const both = list.length === 1 && right !== '' && isFinite(+list[0]) && isFinite(+right);
  switch (c.compare) {
    case '==': case '=': case 'equals': return list.includes(right);
    case '!=': case '<>': case 'not_equals': return !list.includes(right);
    case '>': return both && +list[0] > +right;
    case '<': return both && +list[0] < +right;
    case '>=': return both && +list[0] >= +right;
    case '<=': return both && +list[0] <= +right;
    case 'contains': return L.toLowerCase().includes(right.toLowerCase());
    case 'not_contains': return !L.toLowerCase().includes(right.toLowerCase());
    case 'empty': return !list.length || L === '';
    case 'not_empty': case 'filled': return !!list.length && L !== '';
    default: return true;
  }
}
function evalRoles(roles, ctx){
  if (!Array.isArray(roles) || !roles.length) return true;
  const groups = roles.filter(g => Array.isArray(g) && g.length);
  if (!groups.length) return true;
  return groups.some(g => g.every(c => evalCond(c, ctx)));
}
const hasRoles = l => Array.isArray(l.roles) && l.roles.some(g => Array.isArray(g) && g.length);

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
function validateField(content, value){
  const v = value == null ? '' : String(value).trim();
  const type = content.type || 'text';
  if (!v) return content.required ? 'Campo obrigatório' : '';
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Digite um e-mail válido';
  if (type === 'phone') { const d = onlyDigits(v); if (d.length < 10 || d.length > 13) return 'Digite um telefone com DDD' }
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
    webhookHint: src.webhook ? {trigger: src.webhook.trigger, component: src.webhook.component, method: src.webhook.method, enabled: !!src.webhook.enabled} : null,
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

/* ================= componentes: catálogo (para o editor) ================= */
const COMPONENTS = [
  {group: 'Formulário', type: 'field', sub: 'text', title: 'Campo', icon: 'input'},
  {group: 'Formulário', type: 'field', sub: 'email', title: 'E-mail', icon: 'at'},
  {group: 'Formulário', type: 'field', sub: 'phone', title: 'Telefone', icon: 'phone'},
  {group: 'Formulário', type: 'button', title: 'Botão', icon: 'button'},
  {group: 'Formulário', type: 'field', sub: 'number', title: 'Número', icon: 'hash'},
  {group: 'Formulário', type: 'field', sub: 'textarea', title: 'Textarea', icon: 'textarea'},
  {group: 'Formulário', type: 'field', sub: 'date', title: 'Data', icon: 'calendar'},
  {group: 'Formulário', type: 'field', sub: 'height', title: 'Altura', icon: 'ruler'},
  {group: 'Formulário', type: 'field', sub: 'weight', title: 'Peso', icon: 'weight'},
  {group: 'Quiz', type: 'options', sub: 'list', title: 'Opções', icon: 'list'},
  {group: 'Quiz', type: 'options', sub: 'multiple', title: 'Múltipla escolha', icon: 'checks'},
  {group: 'Quiz', type: 'options', sub: 'described', title: 'Escolha única', icon: 'radio'},
  {group: 'Quiz', type: 'options', sub: 'yesno', title: 'Sim/Não', icon: 'yesno'},
  {group: 'Quiz', type: 'options', sub: 'images', title: 'Opções com imagem', icon: 'grid'},
  {group: 'Mídia e conteúdo', type: 'text', title: 'Texto', icon: 'text'},
  {group: 'Mídia e conteúdo', type: 'image', title: 'Imagem', icon: 'image'},
  {group: 'Mídia e conteúdo', type: 'video', title: 'Vídeo', icon: 'film'},
  {group: 'Mídia e conteúdo', type: 'audio', title: 'Áudio', icon: 'audio'},
  {group: 'Mídia e conteúdo', type: 'alert', title: 'Alerta', icon: 'alert'},
  {group: 'Mídia e conteúdo', type: 'timer', title: 'Timer', icon: 'clock'},
  {group: 'Mídia e conteúdo', type: 'loading', title: 'Loading', icon: 'loader'},
  {group: 'Mídia e conteúdo', type: 'metric', title: 'Nível', icon: 'sliders'},
  {group: 'Argumentação', type: 'arguments', title: 'Argumentos', icon: 'bulb'},
  {group: 'Argumentação', type: 'testimonials', title: 'Depoimentos', icon: 'quote'},
  {group: 'Argumentação', type: 'faq', title: 'FAQ', icon: 'faq'},
  {group: 'Argumentação', type: 'price', title: 'Preço', icon: 'price'},
  {group: 'Argumentação', type: 'checklist', title: 'Checklist', icon: 'check'},
  {group: 'Argumentação', type: 'beforeafter', title: 'Antes/Depois', icon: 'compare'},
  {group: 'Argumentação', type: 'carousel', title: 'Carrossel', icon: 'carousel'},
  {group: 'Gráficos', type: 'chart', title: 'Gráfico', icon: 'chart'},
  {group: 'Gráficos', type: 'stats', title: 'Métricas', icon: 'gauge'},
  {group: 'Personalização', type: 'clear', title: 'Espaço', icon: 'space'},
  {group: 'Personalização', type: 'html', title: 'HTML/Script', icon: 'code'},
];
const TYPE_TITLE = {text: 'Texto', image: 'Imagem', video: 'Vídeo', audio: 'Áudio', button: 'Botão', options: 'Opções', field: 'Campo', metric: 'Nível', timer: 'Timer', loading: 'Loading', price: 'Preço', faq: 'FAQ', clear: 'Espaço', alert: 'Alerta', arguments: 'Argumentos', testimonials: 'Depoimentos', checklist: 'Checklist', beforeafter: 'Antes/Depois', carousel: 'Carrossel', chart: 'Gráfico', stats: 'Métricas', html: 'HTML/Script'};
const INPUT_TYPES = ['options', 'field'];

function opt(label, value, extra){ return Object.assign({id: uid(), image: {type: 'image', src: null}, score: 0, value, label: `<p>${label}</p>`, destination: 'next'}, extra || {}) }
// Camada nova, com o conteúdo de exemplo de cada componente.
function newLayer(type, sub){
  const id = uid(), name = (type === 'options' ? 'opcoes_' : '') + uid();
  const L = {id, title: TYPE_TITLE[type] || type, type, design: {basis: 100}, content: {id: uid(), name}};
  const c = L.content;
  switch (type) {
    case 'text': c.text = '<h2 class="ql-align-center">Escreva o seu título aqui</h2><p class="ql-align-center">E um texto de apoio logo abaixo.</p>'; break;
    case 'image': c.image = {type: 'image', src: ''}; c.alt = ''; L.design = {basis: 100, width: 100}; break;
    case 'video': c.video = ''; L.design = {basis: 100, ratio: 'landscape'}; break;
    case 'audio': c.audio = {type: 'audio', src: ''}; c.image = {type: 'image', src: null}; c.sender = 'Seu nome'; L.design = {basis: 100, model: 'whatsapp', theme: 'dark'}; break;
    case 'button': Object.assign(c, {type: 'next', label: 'Continuar', destination: 'next', pulse: false, target: false}); L.design = {basis: 100, style: 'theme'}; break;
    case 'field': {
      const s = sub || 'text';
      const T = {text: ['Qual o seu nome?', 'Digite seu nome...'], email: ['Qual o seu e-mail?', 'seu@email.com'], phone: ['Qual o seu WhatsApp?', '(00) 00000-0000'], number: ['Digite um número', '0'], textarea: ['Conte pra gente', 'Escreva aqui...'], date: ['Qual a data?', ''], height: ['Qual a sua altura?', ''], weight: ['Qual o seu peso?', '']}[s] || ['Campo', ''];
      Object.assign(c, {title: T[0], placeholder: T[1], type: s, required: true});
      if (s === 'phone') c.mask = 'phone';
      if (s === 'height') Object.assign(c, {unit: 'cm', min: 140, max: 220, value: 170});
      if (s === 'weight') Object.assign(c, {unit: 'kg', min: 40, max: 250, value: 70});
      L.title = {email: 'E-mail', phone: 'Telefone', number: 'Número', textarea: 'Textarea', date: 'Data', height: 'Altura', weight: 'Peso'}[s] || 'Campo';
      break;
    }
    case 'options': {
      const s = sub || 'list';
      Object.assign(c, {required: true, introType: 'none', introduction: null, type: 'options', multiple: s === 'multiple'});
      L.design = {icon: s === 'multiple' ? 'checkbox' : 'select', iconPosition: 'end', grid: s === 'images' ? 'grid-cols-2' : 'grid-cols-1', orientation: 'vertical', order: 'default', transparentImage: true, aspectImage: 'aspect-[1/1]', basis: 100, background: 'contrast', border: 'border-[2px]', shadow: 'shadow-none', gap: 'gap-2'};
      if (s === 'yesno') c.options = [opt('✅ Sim', 'sim'), opt('🚫 Não', 'nao')];
      else if (s === 'described') c.options = [opt('<strong>Opção A</strong><br>Aqui você descreve a primeira opção.', 'A'), opt('<strong>Opção B</strong><br>Depois você descreve a segunda opção.', 'B')];
      else if (s === 'images') c.options = [1, 2, 3, 4].map(n => opt('Opção ' + n, String(n), {image: {type: 'image', src: ''}}));
      else c.options = ['A', 'B', 'C', 'D'].map((v, k) => opt('Opção ' + (k + 1), v));
      L.title = {multiple: 'Múltipla escolha', described: 'Escolha única', yesno: 'Sim/Não', images: 'Opções com imagem'}[s] || 'Opções';
      break;
    }
    case 'metric': Object.assign(c, {title: 'Nível', subtitle: 'Descrição do nível', percent: '75', show_title: true, show_percent: true, show_dot: true}); L.design = {basis: 100, type: 'default', color: 'theme'}; break;
    case 'timer': Object.assign(c, {text: '<p class="ql-align-center">Aproveite essa oportunidade: [time]</p>', time: '300'}); L.design = {basis: 100, style: 'danger', layout: 'boxes'}; break;
    case 'loading': Object.assign(c, {title: 'Carregando...', description: '<p></p>', seconds: 3, starts: 0, destination: 'next', show_title: true, show_percent: true, show_progress: true}); L.design = {layout: 'default'}; break;
    case 'price': Object.assign(c, {title: '<p><strong>Nome do produto</strong></p>', value: 'R$ 97', before: '12x de', after: 'ou R$ 97 à vista', featured: '10% off', redirect: true}); L.design = {basis: 100, style: 'theme'}; break;
    case 'faq': Object.assign(c, {firstQuestionOpened: false, questions: [{id: uid(), question: 'Qual a primeira dúvida a ser resolvida?', answer: '<p>Escreva a resposta aqui.</p>'}, {id: uid(), question: 'Descreva outra dúvida a ser resolvida.', answer: '<p>Escreva a resposta aqui.</p>'}]}); L.design = {icon: 'chevron'}; break;
    case 'clear': c.clear = 'h-[1rem]'; L.design = {}; break;
    case 'alert': Object.assign(c, {title: 'Atenção', text: '<p>Escreva aqui o aviso para o visitante.</p>'}); L.design = {basis: 100, style: 'warning'}; break;
    case 'arguments': c.items = [{id: uid(), icon: '⚡', title: 'Argumento 1', text: 'Tellus in risus sagittis condimentum.'}, {id: uid(), icon: '🎯', title: 'Argumento 2', text: 'Fusce vitae tellus.'}]; L.design = {basis: 100, grid: 'grid-cols-1'}; break;
    case 'testimonials': c.items = [{id: uid(), name: 'Rafael Nascimento', handle: '@rafael.nascimento', text: 'Excelente! Recomendo para todo mundo.', image: '', stars: 5}, {id: uid(), name: 'Camila Ferreira', handle: '@camila.ferreira', text: 'Mudou o meu negócio.', image: '', stars: 5}]; L.design = {basis: 100, layout: 'list'}; break;
    case 'checklist': c.items = [{id: uid(), text: 'Primeiro benefício'}, {id: uid(), text: 'Segundo benefício'}, {id: uid(), text: 'Terceiro benefício'}]; L.design = {basis: 100, icon: '✅'}; break;
    case 'beforeafter': Object.assign(c, {before: {type: 'image', src: ''}, after: {type: 'image', src: ''}, beforeLabel: 'Antes', afterLabel: 'Depois'}); L.design = {basis: 100}; break;
    case 'carousel': c.items = [{id: uid(), image: {type: 'image', src: ''}, caption: 'Exemplo de descrição'}, {id: uid(), image: {type: 'image', src: ''}, caption: 'Exemplo de descrição'}]; L.design = {basis: 100, autoplay: true}; break;
    case 'chart': Object.assign(c, {title: 'Gráfico', items: [{id: uid(), label: 'Hoje', value: '30'}, {id: uid(), label: 'Em 30 dias', value: '60'}, {id: uid(), label: 'Em 90 dias', value: '95'}]}); L.design = {basis: 100, type: 'bar'}; break;
    case 'stats': c.items = [{id: uid(), value: '30', suffix: '%', label: 'Métrica'}, {id: uid(), value: '85', suffix: '%', label: 'Outra métrica'}]; L.design = {basis: 100}; break;
    case 'html': c.html = '<div style="text-align:center;padding:12px">Seu HTML aqui</div>'; L.design = {basis: 100}; break;
  }
  return L;
}
function newStep(title, layers){ return {id: uid(), title: title || 'Nova etapa', position: {x: 0, y: 0}, layers: layers || []} }
// Modelos de etapa (como os "Modelos" do InLead).
function stepTemplate(kind){
  const T = (html) => { const l = newLayer('text'); l.content.text = html; return l };
  const btn = label => { const b = newLayer('button'); b.content.label = label; return b };
  switch (kind) {
    case 'inicial': return newStep('Página inicial', [T('<h1 class="ql-align-center">Título que prende a atenção</h1><p class="ql-align-center">Uma frase que explica o que a pessoa ganha respondendo.</p>'), btn('COMEÇAR ➔')]);
    case 'quiz': return newStep('Pergunta', [T('<h1 class="ql-align-center">Qual é a sua pergunta?</h1>'), newLayer('options', 'list')]);
    case 'colunas': { const o = newLayer('options', 'images'); return newStep('Pergunta com imagens', [T('<h1 class="ql-align-center">Escolha uma opção</h1>'), o]) }
    case 'multipla': return newStep('Múltipla escolha', [T('<h1 class="ql-align-center">Marque todas que se aplicam</h1>'), newLayer('options', 'multiple'), btn('Continuar')]);
    case 'like': { const o = newLayer('options', 'list'); o.content.options = ['1', '2', '3', '4', '5'].map(n => opt(n, n, {score: +n})); o.design.grid = 'grid-cols-5'; o.design.icon = 'none'; return newStep('Escala', [T('<h2 class="ql-align-center">De 1 a 5, quanto você concorda?</h2>'), o]) }
    case 'formulario': return newStep('Formulário', [T('<h1 class="ql-align-center">Falta pouco!</h1><p class="ql-align-center">Deixe seus dados para receber o resultado.</p>'), newLayer('field', 'text'), newLayer('field', 'email'), newLayer('field', 'phone'), btn('ENVIAR')]);
    case 'captura': return newStep('Captura simples', [T('<h2 class="ql-align-center">Receba no seu WhatsApp</h2>'), newLayer('field', 'phone'), btn('QUERO RECEBER')]);
    case 'grafico': return newStep('Gráfico', [T('<h2 class="ql-align-center">Veja a sua evolução</h2>'), newLayer('chart'), btn('Continuar')]);
    case 'progresso': return newStep('Carregando', [newLayer('loading')]);
    case 'checkout': return newStep('Pré-checkout', [newLayer('timer'), T('<h1 class="ql-align-center">Oferta especial</h1>'), newLayer('checklist'), newLayer('price'), btn('QUERO AGORA'), newLayer('faq')]);
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
  const l = clone(layer); l.id = uid(); if (l.content) { l.content.id = uid(); if (Array.isArray(l.content.options)) l.content.options.forEach(o => o.id = uid()); if (Array.isArray(l.content.questions)) l.content.questions.forEach(o => o.id = uid()); if (Array.isArray(l.content.items)) l.content.items.forEach(o => o.id = uid()) }
  return l;
}

/* ================= Pontos de navegação de uma etapa (para o Fluxo) ================= */
function outlets(funnel, step){
  const out = [];
  for (const l of step.layers || []) {
    if (l.type === 'options') (l.content.options || []).forEach(o => out.push({layer: l, item: o, label: stripHtml(o.label) || o.value || 'Opção', dest: destinationOf(funnel, o)}));
    else if (l.type === 'button') out.push({layer: l, item: l.content, label: l.content.label || 'Botão', dest: destinationOf(funnel, l.content)});
    else if (l.type === 'loading') out.push({layer: l, item: l.content, label: 'Ao terminar', dest: destinationOf(funnel, l.content)});
  }
  return out;
}

/* ================= DOM (navegador) ================= */
if (!doc) return {uid, esc, clone, stripHtml, plainLabel, calcEval, replaceCalc, interpolate, evalRoles, evalCond, destinationOf, resolveDestination, phoneMask, validateField, fromInlead, newLayer, newStep, stepTemplate, newFunnel, reId, outlets, totalScore, isUrl, cssVars, COMPONENTS, DEFAULT_DESIGN, STEP_TEMPLATES, TYPE_TITLE};

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
.fnr-progress i{display:block;height:100%;background:var(--fn-theme);border-radius:inherit;transition:width .4s ease}
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
.fnr-timer{display:flex;justify-content:center;align-items:center;gap:6px}
.fnr-timer .bx{min-width:52px;padding:8px 6px 6px;border-radius:12px;background:#fee2e2;color:#dc2626;text-align:center}
.fnr-timer .bx b{display:block;font:700 1.4em/1 var(--fn-font-title)}.fnr-timer .bx small{font-size:10.5px;opacity:.75}
.fnr-timer .sep{color:var(--fn-content);font-weight:700}
.fnr-timer.st-theme .bx{background:color-mix(in srgb,var(--fn-theme) 18%,var(--fn-bg));color:var(--fn-theme)}
.fnr-timer.st-warning .bx{background:#fef3c7;color:#b45309}.fnr-timer.st-success .bx{background:#dcfce7;color:#15803d}.fnr-timer.st-dark .bx{background:#0f172a;color:#fff}
.fnr-timerbar{border-radius:var(--fn-radius);padding:10px 14px;background:#dc2626;color:#fff;text-align:center;font-size:.9em}
.fnr-timerbar.st-theme{background:var(--fn-theme);color:var(--fn-theme-ink)}.fnr-timerbar.st-warning{background:#f59e0b;color:#111}.fnr-timerbar.st-success{background:#16a34a}.fnr-timerbar.st-dark{background:#0f172a}
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
.fnr-alert{display:flex;gap:10px;align-items:flex-start;border-radius:var(--fn-radius);padding:12px 14px;background:#fef3c7;color:#78350f;font-size:.9em}
.fnr-alert .ic{flex:none;font-size:1.15em;line-height:1.2}.fnr-alert b{display:block;margin-bottom:2px}.fnr-alert p{margin:0}
.fnr-alert.st-danger{background:#fee2e2;color:#7f1d1d}.fnr-alert.st-info{background:#dbeafe;color:#1e3a8a}.fnr-alert.st-success{background:#dcfce7;color:#14532d}.fnr-alert.st-theme{background:color-mix(in srgb,var(--fn-theme) 16%,var(--fn-bg));color:var(--fn-title)}
.fnr-args{display:grid;gap:10px}
.fnr-arg{display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:var(--fn-radius);background:var(--fn-card);box-shadow:inset 0 0 0 1px var(--fn-line)}
.fnr-arg .ic{flex:none;width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--fn-theme) 18%,transparent);font-size:1.2em}
.fnr-arg b{display:block;color:var(--fn-title);font-size:.92em}.fnr-arg span{font-size:.82em}
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
.fnr-car .it{flex:0 0 100%}.fnr-car .it img{display:block;width:100%;height:auto}
.fnr-car .cap{padding:8px 4px 0;text-align:center;font-size:.82em}
.fnr-car .dots{display:flex;justify-content:center;gap:6px;padding-top:8px}.fnr-car .dots button{width:8px;height:8px;border-radius:50%;border:0;background:var(--fn-line);padding:0;cursor:pointer}.fnr-car .dots button.on{background:var(--fn-theme)}
.fnr-chart .tt{font-weight:600;color:var(--fn-title);font-size:.9em;margin-bottom:10px;text-align:center}
.fnr-chart .bars{display:flex;align-items:flex-end;gap:12px;height:160px;padding:0 6px;border-bottom:1px solid var(--fn-line)}
.fnr-chart .bars div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;gap:4px}
.fnr-chart .bars i{display:block;width:100%;max-width:56px;border-radius:8px 8px 2px 2px;background:var(--fn-theme);transition:height .8s ease}
.fnr-chart .bars div:not(:last-child) i{opacity:.45}
.fnr-chart .bars span{font-size:.75em;color:var(--fn-title);font-weight:600}
.fnr-chart .lbs{display:flex;gap:12px;padding:6px 6px 0}.fnr-chart .lbs span{flex:1;text-align:center;font-size:.72em;color:var(--fn-muted)}
.fnr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}
.fnr-stat{display:grid;justify-items:center;gap:6px;text-align:center;padding:10px;border-radius:var(--fn-radius);background:var(--fn-card)}
.fnr-stat svg{width:84px;height:84px}.fnr-stat span{font-size:.8em;color:var(--fn-title)}
.fnr-html{width:100%}
.fnr-end{display:grid;place-items:center;text-align:center;gap:8px;padding:40px 0;color:var(--fn-title)}
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
function ring(pct, label){
  const r = 36, c = 2 * Math.PI * r, p = clamp(pct, 0, 100);
  return `<svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--fn-line)" stroke-width="7"/><circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--fn-theme)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}" transform="rotate(-90 42 42)"/><text x="42" y="47" text-anchor="middle" font-size="16" font-weight="700" fill="var(--fn-title)">${esc(label)}</text></svg>`;
}

/* ================= montagem ================= */
function mount(el, funnel, opts){
  injectCss();
  opts = Object.assign({mode: 'live'}, opts || {});
  const R = {
    el, funnel, opts,
    answers: opts.answers ? clone(opts.answers) : {},
    history: [], index: 0, timers: [], destroyed: false, busy: false,
    params: opts.params || paramsFromUrl(),
  };
  const mode = opts.mode, live = mode === 'live', edit = mode === 'edit';
  const ctx = () => ({answers: R.answers, params: R.params});
  const emit = (type, data) => { try { opts.onEvent && opts.onEvent(Object.assign({type, at: Date.now()}, data || {})) } catch (e) { console.error(e) } };

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
    const os = (layer.content.options || []).filter(o => ids.includes(o.id));
    const multiple = !!layer.content.multiple;
    if (!os.length) return null;
    return multiple
      ? {value: os.map(o => o.value != null && o.value !== '' ? String(o.value) : plainLabel(o.label)), label: os.map(o => plainLabel(o.label)).join(', '), labels: os.map(o => plainLabel(o.label)), score: os.reduce((t, o) => t + num(o.score), 0), ids}
      : {value: os[0].value != null && os[0].value !== '' ? String(os[0].value) : plainLabel(os[0].label), label: plainLabel(os[0].label), score: num(os[0].score), ids};
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
        return `<button type="button" class="fnr-btn st-${esc(st)}${c.pulse ? ' is-pulse' : ''}" data-act="button">${esc(interpolate(c.label || 'Continuar', X))}</button>`;
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
        const secs = Math.max(0, num(c.time, 300));
        if ((d.layout || 'boxes') === 'text') return `<div class="fnr-timerbar st-${esc(d.style || 'danger')} fnr-rich" data-timer="${secs}">${rich(String(c.text || '[time]').replace('[time]', `<b data-tt>${mmss(secs)}</b>`), X)}</div>`;
        return `<div class="fnr-timer st-${esc(d.style || 'danger')}" data-timer="${secs}"><div class="bx"><b data-tm>${String(Math.floor(secs / 60)).padStart(2, '0')}</b><small>min</small></div><span class="sep">:</span><div class="bx"><b data-ts>${String(secs % 60).padStart(2, '0')}</b><small>seg</small></div></div>`;
      }
      case 'loading': {
        const start = clamp(num(c.starts, 0), 0, 100), show = edit ? 60 : start;
        if (d.layout === 'circle') return `<div class="fnr-loading ly-circle">${ring(show, show + '%')}${c.show_title !== false ? `<div class="t">${esc(interpolate(c.title || '', X))}</div>` : ''}${c.description && stripHtml(c.description) ? `<div class="fnr-rich">${rich(c.description, X)}</div>` : ''}</div>`;
        return `<div class="fnr-loading">${c.show_percent ? `<div class="pc" data-pc>${show}%</div>` : ''}${c.show_title !== false ? `<div class="t">${esc(interpolate(c.title || '', X))}</div>` : ''}${c.show_progress !== false ? `<div class="bar"><i style="width:${show}%"></i></div>` : ''}${c.description && stripHtml(c.description) ? `<div class="fnr-rich">${rich(c.description, X)}</div>` : ''}</div>`;
      }
      case 'price': {
        const v = String(interpolate(c.value || '', X)); const m = /^(R\$|US\$|\$|€)\s*(.*)$/.exec(v.trim());
        return `<div class="fnr-price st-${esc(d.style || 'theme')}${c.redirect ? ' clickable' : ''}" data-act="${c.redirect ? 'price' : ''}">
          ${c.featured ? `<div class="ft">${esc(interpolate(c.featured, X))}</div>` : ''}
          <div class="bd"><div class="ti fnr-rich">${rich(c.title, X)}</div><div class="vl">${c.before ? `<small>${esc(interpolate(c.before, X))}</small>` : ''}<b>${m ? `<span>${esc(m[1])}</span>${esc(m[2])}` : esc(v)}</b>${c.after ? `<small>${esc(interpolate(c.after, X))}</small>` : ''}</div></div>
        </div>`;
      }
      case 'faq': return `<div class="fnr-faq">${(c.questions || []).map((q, i) => `<details${(c.firstQuestionOpened && i === 0) || (edit && opts.faqOpen) ? ' open' : ''}><summary><span>${esc(interpolate(q.question, X))}</span>${ICON.chev}</summary><div class="an fnr-rich">${rich(q.answer, X)}</div></details>`).join('')}</div>`;
      case 'clear': return `<div style="height:${esc(twSize(c.clear, '1rem'))}"></div>`;
      case 'alert': {
        const st = d.style || 'warning', ic = c.icon || {warning: '⚠️', danger: '🚨', info: 'ℹ️', success: '✅', theme: '🔔'}[st] || '⚠️';
        return `<div class="fnr-alert st-${esc(st)}"><span class="ic">${esc(ic)}</span><div>${c.title ? `<b>${esc(interpolate(c.title, X))}</b>` : ''}<div class="fnr-rich" style="color:inherit">${rich(c.text, X)}</div></div></div>`;
      }
      case 'arguments': return `<div class="fnr-args" style="grid-template-columns:repeat(${gridCols(d.grid)},minmax(0,1fr))">${(c.items || []).map(a => `<div class="fnr-arg"><span class="ic">${esc(a.icon || '•')}</span><div><b>${esc(interpolate(a.title || '', X))}</b><span>${esc(interpolate(a.text || '', X))}</span></div></div>`).join('')}</div>`;
      case 'testimonials': return `<div class="fnr-tests">${(c.items || []).map(t => `<div class="fnr-test"><div class="hd"><span class="av">${t.image ? `<img src="${esc(t.image)}" alt="">` : esc(String(t.name || '?').slice(0, 1))}</span><div><b>${esc(t.name || '')}</b>${t.handle ? `<small>${esc(t.handle)}</small>` : ''}</div>${t.stars ? `<span class="st">${'★'.repeat(clamp(num(t.stars, 5), 1, 5))}</span>` : ''}</div><p>${esc(t.text || '')}</p></div>`).join('')}</div>`;
      case 'checklist': return `<div class="fnr-check">${(c.items || []).map(t => `<div><i>${esc(t.icon || d.icon || '✅')}</i><span>${esc(interpolate(t.text || '', X))}</span></div>`).join('')}</div>`;
      case 'beforeafter': {
        const b = c.before && c.before.src, a = c.after && c.after.src;
        if (!b || !a) return edit ? '<div class="fnr-ph">Antes/Depois — escolha as duas imagens</div>' : '';
        return `<div class="fnr-ba" data-ba><img src="${esc(b)}" alt="${esc(c.beforeLabel || 'Antes')}"><div class="af"><img src="${esc(a)}" alt="${esc(c.afterLabel || 'Depois')}"></div><span class="lb l">${esc(c.beforeLabel || 'Antes')}</span><span class="lb r">${esc(c.afterLabel || 'Depois')}</span><span class="hn"></span></div>`;
      }
      case 'carousel': {
        const items = (c.items || []).filter(i => i.image && i.image.src);
        if (!items.length) return edit ? '<div class="fnr-ph">Carrossel — adicione imagens</div>' : '';
        return `<div class="fnr-car" data-car="${d.autoplay === false ? 0 : 1}"><div class="tr">${items.map(i => `<div class="it"><img src="${esc(i.image.src)}" alt="" loading="lazy">${i.caption ? `<div class="cap">${esc(i.caption)}</div>` : ''}</div>`).join('')}</div>${items.length > 1 ? `<div class="dots">${items.map((_, k) => `<button type="button" data-dot="${k}"${k ? '' : ' class="on"'} aria-label="Imagem ${k + 1}"></button>`).join('')}</div>` : ''}</div>`;
      }
      case 'chart': {
        const items = (c.items || []).map(i => ({label: i.label, v: num(interpolate(String(i.value), X, {fmt: v => String(v)}))}));
        const max = Math.max(1, ...items.map(i => i.v));
        return `<div class="fnr-chart">${c.title ? `<div class="tt">${esc(interpolate(c.title, X))}</div>` : ''}<div class="bars">${items.map(i => `<div><span>${fmtNum(i.v)}${esc(c.suffix || '')}</span><i style="height:${edit ? (i.v / max) * 100 : 0}%" data-h="${(i.v / max) * 100}"></i></div>`).join('')}</div><div class="lbs">${items.map(i => `<span>${esc(i.label || '')}</span>`).join('')}</div></div>`;
      }
      case 'stats': return `<div class="fnr-stats">${(c.items || []).map(s => { const v = num(interpolate(String(s.value), X, {fmt: v => String(v)})); return `<div class="fnr-stat">${ring(s.suffix === '%' ? v : clamp(v, 0, 100), fmtNum(v) + (s.suffix || ''))}<span>${esc(s.label || '')}</span></div>` }).join('')}</div>`;
      case 'html': return edit ? `<div class="fnr-ph">HTML/Script<br><small>${esc(String(c.html || '').slice(0, 80))}</small></div>` : `<div class="fnr-html" data-html></div>`;
      default: return edit ? `<div class="fnr-ph">Componente “${esc(layer.type)}”</div>` : '';
    }
  }
  const gridCols = g => { const m = /grid-cols-(\d+)/.exec(g || ''); return m ? clamp(+m[1], 1, 6) : 1 };
  function renderOptions(layer, step){
    const c = layer.content, d = layer.design || {};
    const sel = (R.answers[layer.id] && R.answers[layer.id].ids) || [];
    const imgs = (c.options || []).some(o => o.image && (o.image.src || o.image.src === ''));
    const icon = d.icon || 'select', multiple = !!c.multiple;
    const aspect = (/aspect-\[([^\]]+)\]/.exec(d.aspectImage || '') || [])[1] || '1/1';
    let list = (c.options || []).slice();
    if (d.order === 'random' && !edit) { list = list.map(o => [Math.random(), o]).sort((a, b) => a[0] - b[0]).map(x => x[1]) }
    const cls = ['fnr-opts', 'ip-' + (d.iconPosition || 'end'), d.background === 'transparent' ? 'bg-transparent' : d.background === 'solid' ? 'bg-solid' : '', d.shadow && d.shadow !== 'shadow-none' ? 'sh' : '', imgs ? 'has-img' : '', d.align === 'center' ? 'center' : ''].filter(Boolean).join(' ');
    const style = `grid-template-columns:repeat(${gridCols(d.grid)},minmax(0,1fr));--fn-ogap:${twSize(d.gap, '.5rem')};--fn-obw:${twSize(d.border, '2px')}`;
    const intro = c.introType === 'text' && c.introduction ? `<div class="fnr-rich" style="margin-bottom:10px">${rich(c.introduction, ctx())}</div>` : '';
    return intro + `<div class="${cls}" style="${style}" role="${multiple ? 'group' : 'radiogroup'}">${list.map(o => {
      const on = sel.includes(o.id);
      const ic = icon === 'none' ? '' : icon === 'arrow' ? `<span class="fnr-oarrow">${ICON.arrow}</span>` : `<span class="fnr-oico${multiple || icon === 'checkbox' ? ' sq' : ''}"></span>`;
      const im = imgs ? `<div class="fnr-oimg" style="aspect-ratio:${aspect}">${o.image && o.image.src ? `<img src="${esc(o.image.src)}" alt="" loading="lazy">` : (edit ? '<div class="fnr-ph" style="min-height:0;height:100%;border:0">Imagem</div>' : '')}</div>` : '';
      return `<button type="button" class="fnr-opt${on ? ' is-on' : ''}" data-act="opt" data-oid="${esc(o.id)}" aria-pressed="${on}">${im}<span class="fnr-olabel fnr-rich" style="color:inherit">${rich(o.label, ctx())}</span>${ic}</button>`;
    }).join('')}</div>`;
  }
  function renderField(layer){
    const c = layer.content, a = R.answers[layer.id];
    const val = a ? displayValue(a.value) : '';
    const type = c.type || 'text';
    const label = c.title ? `<label for="f-${esc(layer.id)}">${esc(interpolate(c.title, ctx()))}${c.required ? '' : ' <span style="opacity:.6">(opcional)</span>'}</label>` : '';
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
      input = `<input type="${t}" ${attrs} value="${esc(val)}" autocomplete="${ac}" ${type === 'phone' ? 'inputmode="tel"' : type === 'number' ? 'inputmode="decimal"' : ''}>`;
    }
    return `<div class="fnr-field">${label}${input}<div class="fnr-err"></div></div>`;
  }

  /* ----- etapa ----- */
  function visibleLayers(step){ return (step.layers || []).filter(l => edit || evalRoles(l.roles, ctx())) }
  function render(){
    if (R.destroyed) return;
    clearTimers();
    const f = R.funnel, step = stepAt(R.index), d = Object.assign({}, DEFAULT_DESIGN, f.design || {});
    const vars = cssVars(d);
    el.innerHTML = '';
    const root = doc.createElement('div');
    root.className = 'fnr' + (edit ? ' fnr-edit' : '') + ' fnr-' + mode;
    for (const k in vars) root.style.setProperty(k, vars[k]);
    if (!step) { root.innerHTML = '<div class="fnr-page"><div class="fnr-end"><b>Funil sem etapas</b></div></div>'; el.appendChild(root); return }
    const ss = Object.assign({showLogo: true, showProgress: true, showBack: true}, step.settings || {});
    const total = f.steps.length, pct = total ? Math.round(((R.index + 1) / total) * 100) : 0;
    const bg = d.background || {};
    let bgx = '';
    if (bg.type === 'image' && bg.src) bgx = `<div class="fnr-bgx" style="opacity:${num(bg.opacity, 1)}"><img src="${esc(bg.src)}" alt=""></div>`;
    else if (bg.type === 'video' && bg.src) bgx = `<div class="fnr-bgx" style="opacity:${num(bg.opacity, 1)}"><video src="${esc(bg.src)}" autoplay muted loop playsinline></video></div>`;
    else if (bg.type === 'gradient') root.style.background = `linear-gradient(${num(bg.angle, 180)}deg, ${bg.from || d.backgroundColor}, ${bg.to || d.themeColor})`;
    else if (bg.type === 'effect') root.style.background = `radial-gradient(120% 60% at 50% -10%, color-mix(in srgb, ${d.themeColor} 45%, transparent), transparent 70%), ${d.backgroundColor}`;
    const logo = d.logo && d.logo.src && ss.showLogo ? `<div class="fnr-logo s-${esc(d.logo.size || 'normal')} p-${esc(d.logo.position || 'center')}"><img src="${esc(d.logo.src)}" alt=""></div>` : '<div></div>';
    const canBack = edit ? true : R.history.length > 0;
    const back = ss.showBack ? `<button type="button" class="fnr-back" data-act="back" aria-label="Voltar"${canBack ? '' : ' hidden'}>${ICON.back}${ss.backLabel ? `<span>${esc(ss.backLabel)}</span>` : ''}</button>` : '<div></div>';
    const prog = ss.showProgress && d.progress !== 'none' ? `<div class="fnr-progress"><i style="width:${pct}%"></i></div>` : '';
    const layers = visibleLayers(step);
    root.innerHTML = `${bgx}<div class="fnr-page"><header class="fnr-head">${back}${logo}<div></div>${prog}</header><main class="fnr-body al-${esc(d.align || 'center')}"><div class="fnr-layers">${layers.map((l, i) => {
      const cond = hasRoles(l), hidden = edit && cond && !evalRoles(l.roles, ctx());
      const basis = clamp(num(l.design && l.design.basis, 100), 10, 100);
      const html = renderLayer(l, step);
      if (!html && !edit) return '';
      return `<div class="fnr-l${edit && cond ? ' is-cond-edit' : ''}${hidden ? ' is-hidden-edit' : ''}${edit && opts.selected === l.id ? ' is-sel' : ''}" data-lid="${esc(l.id)}" data-li="${i}" style="flex:0 0 ${basis}%;max-width:${basis}%"${edit ? ' draggable="true"' : ''}>${edit ? `<span class="fnr-tag">${esc(l.title || TYPE_TITLE[l.type] || l.type)}${cond ? ' · condicional' : ''}</span>` : ''}${html}</div>`;
    }).join('')}</div></main></div>`;
    el.appendChild(root);
    R.root = root;
    afterRender(step, layers);
    if (ss.scrollTop !== false && !edit) try { (opts.scrollEl || window).scrollTo({top: 0}) } catch (e) {}
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
    // HTML/Script: insere e executa os <script>
    root.querySelectorAll('[data-html]').forEach(box => {
      const lid = box.closest('.fnr-l').dataset.lid, layer = step.layers.find(l => l.id === lid);
      box.innerHTML = String(layer.content.html || '');
      box.querySelectorAll('script').forEach(old => { const s = doc.createElement('script'); for (const a of old.attributes) s.setAttribute(a.name, a.value); s.textContent = old.textContent; old.replaceWith(s) });
    });
    // animações de barras
    requestAnimationFrame(() => setTimeout(() => {
      root.querySelectorAll('.fnr-metric .bar i[data-w]').forEach(i => i.style.width = i.dataset.w + '%');
      root.querySelectorAll('.fnr-metric .bar b[data-l]').forEach(b => b.style.left = b.dataset.l + '%');
      root.querySelectorAll('.fnr-chart .bars i[data-h]').forEach(i => i.style.height = i.dataset.h + '%');
    }, 60));
    // timers
    root.querySelectorAll('[data-timer]').forEach(t => {
      const lid = t.closest('.fnr-l').dataset.lid, total = num(t.dataset.timer, 300);
      const key = 'fnr-timer:' + (R.funnel.slug || R.funnel.id || '') + ':' + lid;
      let end = 0;
      try { end = live ? num(sessionStorage.getItem(key)) : 0 } catch (e) {}
      if (!end || end < Date.now() - 864e5) { end = Date.now() + total * 1000; try { live && sessionStorage.setItem(key, String(end)) } catch (e) {} }
      const tick = () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        const m = t.querySelector('[data-tm]'), s = t.querySelector('[data-ts]'), tt = t.querySelector('[data-tt]');
        if (m) m.textContent = String(Math.floor(left / 60)).padStart(2, '0');
        if (s) s.textContent = String(left % 60).padStart(2, '0');
        if (tt) tt.textContent = mmss(left);
      };
      tick(); R.timers.push(setInterval(tick, 1000));
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
      const go = i => { k = (i + n) % n; tr.style.transform = `translateX(-${k * 100}%)`; dots.forEach((d, j) => d.classList.toggle('on', j === k)) };
      dots.forEach(d => d.addEventListener('click', e => { e.stopPropagation(); go(+d.dataset.dot) }));
      let x0 = null; car.addEventListener('touchstart', e => { x0 = e.touches[0].clientX }, {passive: true});
      car.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(k + (dx < 0 ? 1 : -1)); x0 = null });
      if (car.dataset.car === '1' && n > 1) R.timers.push(setInterval(() => go(k + 1), 3500));
    });
    if (opts.onReady) opts.onReady(root, step);
  }

  /* ----- interação ----- */
  function layerOf(target){ const w = target.closest('.fnr-l'); if (!w) return null; const step = stepAt(R.index); return {w, step, layer: step.layers.find(l => l.id === w.dataset.lid)} }
  function runScript(code){ if (!code || !live) return; try { new Function(code)() } catch (e) { console.warn('Script do componente falhou:', e) } }
  function firePixel(ev){ if (!ev || !live) return; try { if (window.fbq) window.fbq('track', ev) } catch (e) {} }
  function onClick(e){
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act;
    if (act === 'back') { e.preventDefault(); back(); return }
    const hit = layerOf(t); if (!hit || !hit.layer) return;
    const {step, layer} = hit;
    if (act === 'opt') { e.preventDefault(); chooseOption(step, layer, t.dataset.oid, t); return }
    if (act === 'button') { e.preventDefault(); pressButton(step, layer, t); return }
    if (act === 'price') {
      // o cartão de preço aciona o próximo botão da etapa
      const k = step.layers.indexOf(layer), btn = step.layers.slice(k + 1).concat(step.layers.slice(0, k)).find(l => l.type === 'button' && evalRoles(l.roles, ctx()));
      if (btn) { const el2 = R.root.querySelector(`.fnr-l[data-lid="${btn.id}"] .fnr-btn`); pressButton(step, btn, el2) }
    }
  }
  function onInput(e){
    const t = e.target, act = t.dataset && t.dataset.act; if (act !== 'field' && act !== 'range') return;
    const hit = layerOf(t); if (!hit) return;
    const c = hit.layer.content;
    if (act === 'range') { const out = hit.w.querySelector('output'); if (out) out.firstChild.textContent = t.value; R.answers[hit.layer.id] = Object.assign({}, R.answers[hit.layer.id] || {}, {step: hit.step.id, name: c.name || hit.layer.id, type: 'field', title: c.title || '', value: t.value}); return }
    if (c.type === 'phone' || c.mask === 'phone') { const pos = t.value.length; t.value = phoneMask(t.value); if (t.value.length !== pos) try { t.setSelectionRange(t.value.length, t.value.length) } catch (er) {} }
    R.answers[hit.layer.id] = Object.assign({}, R.answers[hit.layer.id] || {}, {step: hit.step.id, name: c.name || hit.layer.id, type: 'field', title: c.title || '', value: t.value});
    const f = hit.w.querySelector('.fnr-field'); if (f && f.classList.contains('has-err')) { const msg = validateField(c, t.value); if (!msg) { f.classList.remove('has-err'); f.querySelector('.fnr-err').textContent = '' } }
  }
  function onChange(e){
    const t = e.target, act = t.dataset && t.dataset.act; if (act !== 'field' && act !== 'range') return;
    const hit = layerOf(t); if (!hit) return;
    const v = t.value; if (act === 'field' && !String(v).trim()) return;
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
    runScript(o.script); firePixel(o.pixelEvent);
    if (c.multiple) return;
    // Sem botão na etapa: a opção já leva para o destino dela.
    const vis = visibleLayers(step);
    const hasButton = vis.some(l => l.type === 'button');
    const pending = vis.some(l => l !== layer && INPUT_TYPES.includes(l.type) && needsAnswer(l));
    if (!hasButton && !pending) {
      R.busy = true;
      R.timers.push(setTimeout(() => { R.busy = false; navigate(step, destinationOf(R.funnel, o), {layer, item: o}) }, 280));
    }
  }
  function needsAnswer(l){
    const a = R.answers[l.id];
    if (l.type === 'options') return l.content.required !== false && !(a && a.ids && a.ids.length);
    if (l.type === 'field') return !!validateField(l.content, a ? a.value : (l.content.type === 'height' || l.content.type === 'weight' ? l.content.value : ''));
    return false;
  }
  // Confere campos e opções obrigatórios da etapa. Devolve true se está tudo certo.
  function validateStep(step){
    let ok = true, first = null;
    for (const l of visibleLayers(step)) {
      const w = R.root.querySelector(`.fnr-l[data-lid="${l.id}"]`); if (!w) continue;
      if (l.type === 'field') {
        const inp = w.querySelector('[data-act="field"],[data-act="range"]');
        const v = inp ? inp.value : '';
        if (inp && inp.dataset.act === 'range') { if (!R.answers[l.id]) setAnswer(step, l, {value: v}); continue }
        const msg = validateField(l.content, v);
        const box = w.querySelector('.fnr-field'); box.classList.toggle('has-err', !!msg); box.querySelector('.fnr-err').textContent = msg;
        if (msg) { ok = false; first = first || inp } else if (String(v).trim()) setAnswer(step, l, {value: l.content.type === 'phone' ? phoneMask(v) : String(v).trim()});
      } else if (l.type === 'options' && needsAnswer(l)) {
        ok = false; w.classList.add('has-err'); first = first || w;
        const box = w.querySelector('.fnr-opts'); if (box && box.animate) box.animate([{transform: 'translateX(0)'}, {transform: 'translateX(-6px)'}, {transform: 'translateX(6px)'}, {transform: 'translateX(0)'}], {duration: 280});
      }
    }
    if (first && first.focus) try { first.focus() } catch (e) {}
    return ok;
  }
  function pressButton(step, layer, btnEl){
    if (R.busy) return;
    const c = layer.content;
    if (!validateStep(step)) return;
    runScript(c.script); firePixel(c.pixelEvent);
    const dest = destinationOf(R.funnel, c);
    emit('click', {step: step.id, stepIndex: R.index, layer: layer.id, name: c.name || layer.id, label: c.label, destination: dest});
    navigate(step, dest, {layer, item: c, button: btnEl});
  }
  const stepIndexOf = id => (R.funnel.steps || []).findIndex(s => s.id === id);
  function navigate(step, dest, info){
    const to = resolveDestination(R.funnel, R.index, dest);
    if (to.back) return back();
    if (to.url) {
      let url = to.url;
      if (info && info.item && info.item.passUtm) url = withParams(url, R.params);
      emit('complete', {step: step.id, stepIndex: R.index, url});
      if (!live) { if (opts.onPreviewRedirect) opts.onPreviewRedirect(url); return }
      const leave = () => { if (info && info.item && info.item.target) window.open(url, '_blank', 'noopener'); else window.location.href = url };
      if (info && info.button) { info.button.disabled = true; R.timers.push(setTimeout(() => { if (info.button) info.button.disabled = false }, 2500)) }
      Promise.resolve(opts.beforeRedirect ? opts.beforeRedirect(url, info) : null).catch(() => {}).then(leave);
      return;
    }
    if (to.end) { emit('complete', {step: step.id, stepIndex: R.index}); if (opts.onEnd) opts.onEnd(); return }
    go(to.step, true);
  }
  function withParams(url, params){
    try { const u = new URL(url); for (const k in params) if (/^(utm_|fbclid|gclid|src|sck|xcod)/.test(k) && !u.searchParams.has(k)) u.searchParams.set(k, params[k]); return u.toString() } catch (e) { return url }
  }
  function go(target, push){
    const k = typeof target === 'number' ? target : stepIndexOf(target);
    if (k < 0 || k >= R.funnel.steps.length) return;
    if (push && k !== R.index) R.history.push(R.index);
    R.index = k;
    (R.cleanup || []).forEach(fn => { try { fn() } catch (e) {} }); R.cleanup = [];
    render();
    if (!edit) emit('step', {step: R.funnel.steps[k].id, stepIndex: k, title: R.funnel.steps[k].title, total: R.funnel.steps.length});
  }
  function back(){ if (!R.history.length) return; const k = R.history.pop(); R.index = k; (R.cleanup || []).forEach(fn => { try { fn() } catch (e) {} }); R.cleanup = []; render(); emit('back', {step: R.funnel.steps[k].id, stepIndex: k}) }

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

return {uid, esc, clone, stripHtml, plainLabel, calcEval, replaceCalc, interpolate, evalRoles, evalCond, destinationOf, resolveDestination, phoneMask, validateField, fromInlead, newLayer, newStep, stepTemplate, newFunnel, reId, outlets, totalScore, isUrl, cssVars, fontsUrl, mount, COMPONENTS, DEFAULT_DESIGN, STEP_TEMPLATES, TYPE_TITLE, FONTS, RADIUS, videoSrc};
});
