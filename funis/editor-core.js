/* Funis Brase — editor: núcleo (dados, login, lista de funis, barra do editor, salvar/publicar, teste). */
'use strict';
const FR = window.FunnelRuntime;
const HOST = window.FN_HOST || {};
const API = HOST.api || '';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const {esc, clone, uid} = FR;
const attr = esc;
const store = {
  get(k){ try { return localStorage.getItem(k) } catch { return null } },
  set(k, v){ try { localStorage.setItem(k, v); return true } catch { return false } },
  del(k){ try { localStorage.removeItem(k) } catch {} },
  json(k, d){ try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v } catch { return d } },
};
const CODE_KEY = 'funis.code', LOCAL_KEY = 'funis.local.v1', SEED = ['brase-2', 'brase-2-otimizado'];
const fmtInt = n => (+n || 0).toLocaleString('pt-BR');
const fmtPct = (a, b) => b ? (Math.round((a / b) * 1000) / 10).toLocaleString('pt-BR') + '%' : '0%';
const fmtDate = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('pt-BR') };
const fmtDateTime = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'}) };
const slugify = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'funil';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } };

function toast(msg, kind){
  const el = document.createElement('div'); el.className = 'toast' + (kind === 'err' ? ' err' : ''); el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3200);
}
async function copy(text){ try { await navigator.clipboard.writeText(text); toast('Copiado') } catch { prompt('Copie:', text) } }
function download(name, text, type){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type: type || 'application/json'})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500);
}
function publicUrl(slug){
  if (HOST.public) return HOST.public.replace(/\/?$/, '/') + (HOST.public.includes('?') ? '' : '?f=') + slug;
  return new URL('f/?f=' + encodeURIComponent(slug), location.href.split('#')[0]).toString();
}

/* ================= ícones ================= */
const I = (p, w = 16) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const IC = {
  build: I('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  flow: I('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a4 4 0 0 1 4 4v5.5"/>'),
  design: I('<circle cx="13.5" cy="6.5" r="1.2"/><circle cx="17.5" cy="10.5" r="1.2"/><circle cx="8.5" cy="7.5" r="1.2"/><circle cx="6.5" cy="12.5" r="1.2"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a6 6 0 0 0 6-6c0-4.9-4.5-8.6-10-8.6z"/>'),
  leads: I('<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7 18a5 5 0 0 1 10 0"/>'),
  gear: I('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  share: I('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>'),
  play: I('<path d="M7 4v16l13-8z"/>'),
  back: I('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  dots: I('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'),
  undo: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: I('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  mobile: I('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  desktop: I('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  copy: I('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  trash: I('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  up: I('<path d="m18 15-6-6-6 6"/>'), down: I('<path d="m6 9 6 6 6-6"/>'),
  x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  ext: I('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  download: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
  upload: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  globe: I('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>'),
  code: I('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
  search: I('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  hook: I('<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>'),
  shield: I('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
  input: I('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10v4"/>'), at: I('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
  phone: I('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
  button: I('<rect x="2" y="7" width="20" height="10" rx="3"/><path d="M8 12h8"/>'), hash: I('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'),
  textarea: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>'), calendar: I('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  ruler: I('<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>'),
  weight: I('<circle cx="12" cy="5" r="3"/><path d="M6.5 8h11l2.5 13H4z"/>'), list: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  checks: I('<path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8"/>'), radio: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>'),
  yesno: I('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>'), grid: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  text: I('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'), image: I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3-3-9 9"/>'),
  film: I('<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>'), audio: I('<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
  alert: I('<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3zM12 9v4M12 17h.01"/>'), clock: I('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  loader: I('<path d="M21 12a9 9 0 1 1-6.2-8.6"/>'), sliders: I('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  bulb: I('<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>'), quote: I('<path d="M3 21c3 0 7-1 7-8V5H3v7h4c0 3-1 5-4 5zM14 21c3 0 7-1 7-8V5h-7v7h4c0 3-1 5-4 5z"/>'),
  faq: I('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>'), price: I('<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8M12 18V6"/>'),
  check: I('<path d="M20 6 9 17l-5-5"/>'), compare: I('<path d="M12 3v18M5 7H3v10h2M19 7h2v10h-2M8 10l-3 2 3 2M16 10l3 2-3 2"/>'),
  carousel: I('<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M2 7v10M22 7v10"/>'), chart: I('<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>'),
  gauge: I('<path d="m12 14 4-4M3.3 19a10 10 0 1 1 17.4 0"/>'), bell: I('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'), space: I('<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>'),
  layout: I('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>'),
};

/* ================= dados: servidor (Supabase) ou local (este navegador) ================= */
let ACCESS = store.get(CODE_KEY) || '';
async function api(op, body){
  let r;
  try { r = await fetch(API, {method: 'POST', headers: {'content-type': 'application/json', 'x-fn-key': ACCESS}, body: JSON.stringify(Object.assign({op}, body || {}))}) }
  catch (e) { throw Object.assign(new Error('Sem conexão com o servidor.'), {code: 'network'}) }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { store.del(CODE_KEY); ACCESS = ''; throw Object.assign(new Error(j.error || 'Código de acesso inválido.'), {code: 'unauthorized'}) }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Erro ' + r.status), {code: r.status, data: j});
  return j;
}
const Local = {
  read(){ return store.json(LOCAL_KEY, null) },
  write(db){ if (!store.set(LOCAL_KEY, JSON.stringify(db))) toast('O navegador não tem espaço para salvar. Exporte o funil (JSON) para não perder.', 'err') },
  async ensure(){
    let db = this.read();
    if (db && db.funnels) return db;
    db = {funnels: {}, leads: {}};
    for (const slug of SEED) {
      try { const r = await fetch(`data/${slug}.json`, {cache: 'no-cache'}); if (r.ok) { const rec = recordFromExport(await r.json()); db.funnels[rec.id] = rec } } catch (e) { console.warn('Sem o arquivo do funil', slug, e) }
    }
    this.write(db); return db;
  },
};
function recordFromExport(x){
  const now = new Date().toISOString();
  return {id: uid(10), slug: x.slug || slugify(x.title), title: x.title || (x.draft && x.draft.title) || 'Funil', draft: x.draft, published: x.published || null, published_at: x.published ? (x.publishedAt || now) : null, webhook: x.webhook || {}, created_at: now, updated_at: now};
}
const DB = {
  mode: API ? 'server' : 'local',
  get server(){ return this.mode === 'server' },
  async list(){
    if (this.server) return (await api('funnels.list')).funnels;
    const db = await Local.ensure();
    return Object.values(db.funnels).map(f => Object.assign(summary(f), {stats: localStats(db, f.id)})).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  },
  async get(id){
    if (this.server) return (await api('funnels.get', {id})).funnel;
    const db = await Local.ensure(); const f = db.funnels[id]; if (!f) throw new Error('Funil não encontrado.'); return clone(f);
  },
  async create(rec){
    if (this.server) return (await api('funnels.create', rec)).funnel;
    const db = await Local.ensure(); const now = new Date().toISOString();
    const f = Object.assign({id: uid(10), webhook: {}, published: null, published_at: null, created_at: now}, rec, {updated_at: now});
    f.slug = uniqueSlug(db, f.slug || slugify(f.title)); db.funnels[f.id] = f; Local.write(db); return clone(f);
  },
  async save(id, patch, base){
    if (this.server) return await api('funnels.save', Object.assign({id, base}, patch));
    const db = await Local.ensure(); const f = db.funnels[id]; if (!f) throw new Error('Funil não encontrado.');
    if (patch.slug && patch.slug !== f.slug) { if (Object.values(db.funnels).some(o => o.id !== id && o.slug === patch.slug)) throw new Error('Já existe um funil com esse endereço.') }
    Object.assign(f, patch, {updated_at: new Date().toISOString()}); Local.write(db); return {updated_at: f.updated_at, slug: f.slug};
  },
  async publish(id){
    if (this.server) return await api('funnels.publish', {id});
    const db = await Local.ensure(); const f = db.funnels[id]; f.published = clone(f.draft); f.published_at = new Date().toISOString(); Local.write(db); return {published_at: f.published_at};
  },
  async unpublish(id){
    if (this.server) return await api('funnels.unpublish', {id});
    const db = await Local.ensure(); const f = db.funnels[id]; f.published = null; f.published_at = null; Local.write(db); return {};
  },
  async remove(id){
    if (this.server) return await api('funnels.delete', {id});
    const db = await Local.ensure(); delete db.funnels[id]; delete db.leads[id]; Local.write(db); return {};
  },
  async saveWebhook(id, webhook){
    if (this.server) return (await api('webhook.save', {id, webhook})).webhook;
    const db = await Local.ensure(); db.funnels[id].webhook = clone(webhook); Local.write(db); return webhook;
  },
  async testWebhook(id){
    if (this.server) return await api('webhook.test', {id});
    throw new Error('O teste do webhook precisa do servidor (Supabase) configurado.');
  },
  async resend(id, session){
    if (this.server) return await api('webhook.resend', {id, session});
    throw new Error('Reenviar precisa do servidor (Supabase) configurado.');
  },
  async leads(id, q){
    if (this.server) return await api('leads.list', Object.assign({id}, q));
    const db = await Local.ensure(); const all = filterPeriod(db.leads[id] || [], q.period).sort((a, b) => q.order === 'old' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));
    return {leads: all.slice(q.offset || 0, (q.offset || 0) + (q.limit || 100)), total: all.length};
  },
  async stats(id, q){
    if (this.server) return await api('leads.stats', Object.assign({id}, q));
    const db = await Local.ensure(); return computeStats(filterPeriod(db.leads[id] || [], q.period), db.funnels[id]);
  },
  async reset(id){
    if (this.server) return await api('leads.reset', {id});
    const db = await Local.ensure(); db.leads[id] = []; Local.write(db); return {};
  },
  async upload(file){
    if (this.server) {
      if (file.size > 15e6) throw new Error('Arquivo maior que 15 MB.');
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(file) });
      return (await api('upload', {name: file.name, type: file.type, data})).url;
    }
    if (file.size > 400e3) throw new Error('No modo local só dá para enviar arquivos de até 400 KB. Cole o endereço (URL) do arquivo ou configure o servidor.');
    return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file) });
  },
  // Respostas dos testes no modo local (aparecem na aba Leads marcadas como teste).
  async recordLocal(id, session){
    if (this.server) return;
    const db = await Local.ensure(); db.leads[id] = db.leads[id] || [];
    const k = db.leads[id].findIndex(s => s.id === session.id);
    if (k >= 0) db.leads[id][k] = session; else db.leads[id].push(session);
    Local.write(db);
  },
};
const summary = f => ({id: f.id, slug: f.slug, title: f.title, updated_at: f.updated_at, published_at: f.published_at, steps: (f.draft && f.draft.steps || []).length, draft: f.draft});
function uniqueSlug(db, s){ let base = slugify(s), k = base, n = 2; while (Object.values(db.funnels).some(f => f.slug === k)) k = `${base}-${n++}`; return k }
const PERIOD_MS = {day: 864e5, week: 7 * 864e5, month: 30 * 864e5};
function filterPeriod(list, p){ const ms = PERIOD_MS[p]; if (!ms) return list.slice(); const t = Date.now() - ms; return list.filter(s => new Date(s.created_at).getTime() >= t) }
function localStats(db, id){ const l = db.leads[id] || []; return {visits: l.length, leads: l.filter(s => s.interacted).length, complete: l.filter(s => s.completed).length} }
// Mesmas contas do servidor (veja funis-api): acessos, leads (interagiram), qualificados (como no InLead: respostas e cliques
// passam de 70% do número de etapas, ou completou), completos.
function computeStats(list, rec){
  const f = rec && (rec.published || rec.draft) || {steps: []}, total = f.steps.length || 1;
  const s = {visits: list.length, leads: 0, qualified: 0, complete: 0, steps: {}, answers: {}, fields: {}, daily: {}};
  for (const x of list) {
    if (x.interacted) s.leads++;
    if (x.completed) s.complete++;
    if (x.completed || Object.keys(x.answers || {}).length + Object.keys(x.clicks || {}).length > 0.7 * total) s.qualified++;
    for (const st of new Set(x.steps || [])) s.steps[st] = (s.steps[st] || 0) + 1;
    for (const lid in x.answers || {}) {
      const a = x.answers[lid];
      if (a.type === 'options') { s.answers[lid] = s.answers[lid] || {}; (Array.isArray(a.value) ? a.value : [a.value]).forEach(v => { s.answers[lid][v] = (s.answers[lid][v] || 0) + 1 }) }
      else s.fields[lid] = (s.fields[lid] || 0) + 1;
    }
    const d = String(x.created_at).slice(0, 10); s.daily[d] = s.daily[d] || {visits: 0, leads: 0, complete: 0};
    s.daily[d].visits++; if (x.interacted) s.daily[d].leads++; if (x.completed) s.daily[d].complete++;
  }
  s.daily = Object.keys(s.daily).sort().map(day => Object.assign({day}, s.daily[day]));
  return s;
}

/* ================= estado do editor ================= */
const UI = {view: 'home', id: null, tab: 'construtor', step: 0, sel: null, device: 'mobile', ptab: 'conteudo', cfg: 'geral', leads: {sub: 'respostas', period: 'week', order: 'new', hideTracking: false, hidden: {}}, flow: null, designStep: 0};
let REC = null;   // registro do funil aberto {id, slug, title, draft, published, published_at, webhook, updated_at}
let D = null;     // REC.draft — o funil em edição
const HIST = {undo: [], redo: [], lastKey: '', lastAt: 0};
const SAVE = {dirty: false, saving: false, err: '', at: null, timer: 0};

function step(){ return D && D.steps[UI.step] }
function layer(){ const s = step(); return s && UI.sel ? s.layers.find(l => l.id === UI.sel) : null }
function snapshot(){ return JSON.stringify({d: D, title: REC.title, slug: REC.slug}) }
// Toda alteração passa por aqui: guarda o desfazer, marca como não salvo e redesenha o necessário.
function mutate(fn, o = {}){
  const key = o.key || '', now = Date.now();
  if (!(key && key === HIST.lastKey && now - HIST.lastAt < 900)) { HIST.undo.push(snapshot()); if (HIST.undo.length > 80) HIST.undo.shift(); HIST.redo = [] }
  HIST.lastKey = key; HIST.lastAt = now;
  fn(D);
  markDirty();
  if (o.render === 'all') renderEditor();
  else { if (o.steps) renderStepsCol(); if (o.props) renderProps(); if (o.canvas !== false) refreshCanvas(); if (o.flow) renderTab() }
}
function undo(){ if (!HIST.undo.length) return; HIST.redo.push(snapshot()); restore(HIST.undo.pop()) }
function redo(){ if (!HIST.redo.length) return; HIST.undo.push(snapshot()); restore(HIST.redo.pop()) }
function restore(s){ const o = JSON.parse(s); D = REC.draft = o.d; REC.title = o.title; REC.slug = o.slug; HIST.lastKey = ''; UI.step = Math.min(UI.step, D.steps.length - 1); if (UI.sel && !layer()) UI.sel = null; markDirty(); renderEditor() }

function markDirty(){ SAVE.dirty = true; SAVE.err = ''; paintSave(); clearTimeout(SAVE.timer); SAVE.timer = setTimeout(save, DB.server ? 2500 : 600) }
async function save(){
  if (!REC || !SAVE.dirty || SAVE.saving) return;
  SAVE.saving = true; paintSave();
  const sent = snapshot();
  try {
    D.title = REC.title; D.slug = REC.slug;
    const r = await DB.save(REC.id, {title: REC.title, slug: REC.slug, draft: D}, REC.updated_at);
    REC.updated_at = r.updated_at; if (r.slug) REC.slug = r.slug;
    SAVE.at = new Date(); SAVE.dirty = snapshot() !== sent;
  } catch (e) {
    SAVE.err = e.code === 409 ? 'Outra pessoa salvou este funil' : e.message;
    if (e.code === 409) conflictDialog();
  } finally { SAVE.saving = false; paintSave(); if (SAVE.dirty && !SAVE.err) { clearTimeout(SAVE.timer); SAVE.timer = setTimeout(save, 1500) } }
}
function paintSave(){
  const el = $('#save-state'); if (!el) return;
  el.className = 'save-state' + (SAVE.err ? ' err' : SAVE.dirty ? ' dirty' : '');
  el.textContent = SAVE.err ? 'Erro ao salvar' : SAVE.saving ? 'Salvando…' : SAVE.dirty ? 'Alterações não salvas' : SAVE.at ? 'Salvo às ' + SAVE.at.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : (DB.server ? 'Salvo' : 'Salvo neste navegador');
  el.title = SAVE.err || '';
}
function conflictDialog(){
  modal(`<h2>Este funil foi alterado em outro lugar</h2><p class="muted">Alguém salvou uma versão mais nova enquanto você editava. Recarregue para ver a versão nova (as suas últimas alterações serão perdidas) ou salve por cima.</p>
    <div class="actions"><button class="btn" data-a="conflict-mine">Salvar a minha por cima</button><button class="btn primary" data-a="conflict-reload">Recarregar a versão nova</button></div>`);
}
addEventListener('beforeunload', e => { if (SAVE.dirty) { save(); e.preventDefault(); e.returnValue = '' } });

/* ================= modais e menus ================= */
function modal(html, cls){
  closeModal();
  const w = document.createElement('div'); w.className = 'modal-wrap'; w.id = 'modal';
  w.innerHTML = `<div class="modal ${cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
  w.addEventListener('mousedown', e => { if (e.target === w) closeModal() });
  document.body.appendChild(w);
  const f = w.querySelector('[autofocus]') || w.querySelector('input,textarea,select'); if (f) setTimeout(() => f.focus(), 30);
  return w.firstChild;
}
function closeModal(){ const m = $('#modal'); if (m) { if (m._cleanup) m._cleanup(); m.remove() } }
function confirmBox(title, text, okLabel, danger){
  return new Promise(res => {
    const m = modal(`<h2>${esc(title)}</h2>${text ? `<p class="muted">${text}</p>` : ''}<div class="actions"><button class="btn" data-x="no">Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-x="ok" autofocus>${esc(okLabel || 'Confirmar')}</button></div>`);
    m.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (!b) return; closeModal(); res(b.dataset.x === 'ok') });
  });
}
function menu(x, y, items){
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.id = 'menu';
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : it.head ? `<div class="eyebrow">${esc(it.head)}</div>` : `<button type="button" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon || ''}${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  m.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; closeMenu(); items[+b.dataset.i].run() });
  setTimeout(() => document.addEventListener('mousedown', closeMenuOutside), 0);
}
function closeMenuOutside(e){ if (!e.target.closest('#menu')) closeMenu() }
function closeMenu(){ const m = $('#menu'); if (m) m.remove(); document.removeEventListener('mousedown', closeMenuOutside) }

/* ================= login ================= */
function loginScreen(msg){
  return new Promise(res => {
    $('#root').innerHTML = `<div class="login"><form class="modal" id="login-form" style="width:min(400px,100%)">
      <div class="brand"><div class="brand-mark">B</div><div><div class="brand-name">Funis</div><div class="brand-sub">Brase</div></div></div>
      <label class="f">Código de acesso<input class="in" type="password" name="code" required autocomplete="current-password" autofocus></label>
      <p class="hint" style="color:var(--crit)">${esc(msg || '')}</p>
      <button class="btn primary" type="submit">Entrar</button></form></div>`;
    $('#login-form').addEventListener('submit', e => { e.preventDefault(); res(new FormData(e.target).get('code').trim()) });
    setTimeout(() => $('#login-form input').focus(), 30);
  });
}
// Sem o segredo FUNIS_ACCESS_CODE no servidor, o editor abre direto; com ele, pede o código.
async function start(){
  if (DB.server) {
    let msg = '', asked = false;
    for (;;) {
      try { await api('ping'); if (ACCESS) store.set(CODE_KEY, ACCESS); break }
      catch (e) {
        if (e.code === 'network') { DB.mode = 'local'; toast('Servidor indisponível: abrindo no modo local.', 'err'); break }
        msg = e.code === 'unauthorized' ? (asked ? 'Código inválido. Confira com o gestor.' : '') : e.message;
        ACCESS = await loginScreen(msg); asked = true;
      }
    }
  }
  addEventListener('hashchange', route);
  route();
}

/* ================= rotas ================= */
async function route(){
  const h = location.hash.replace(/^#\/?/, '').split('/');
  closeMenu();
  if (h[0] === 'f' && h[1]) {
    const tab = ['construtor', 'fluxo', 'design', 'leads', 'config'].includes(h[2]) ? h[2] : 'construtor';
    if (!REC || REC.id !== h[1]) {
      if (REC && SAVE.dirty) await save();
      try { REC = await DB.get(h[1]) } catch (e) { toast(e.message, 'err'); location.hash = '#/'; return }
      D = REC.draft = REC.draft || FR.newFunnel(REC.title);
      if (!Array.isArray(D.steps)) D.steps = [];
      // nomes antigos de componentes (deste app) viram os do InLead
      D.steps.forEach(st => { st.layers = (st.layers || []).map(FR.normalizeLayer) });
      D.design = Object.assign({}, FR.DEFAULT_DESIGN, D.design || {}); D.settings = Object.assign({pixel: {}, scripts: {}, seo: {}, filter: {}}, D.settings || {});
      HIST.undo = []; HIST.redo = []; Object.assign(SAVE, {dirty: false, err: '', at: null});
      Object.assign(UI, {step: 0, sel: null, flow: null, designStep: 0}); LEADS.cache = null;
      loadFonts();
    }
    UI.view = 'editor'; UI.tab = tab; renderEditor();
  } else {
    if (REC && SAVE.dirty) await save();
    UI.view = 'home'; REC = null; D = null; renderHome();
  }
}
const go = (tab) => { location.hash = `#/f/${REC.id}/${tab}` };
function loadFonts(){
  const href = FR.fontsUrl(D.design); if ($(`link[data-fnfont="${CSS.escape(href)}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.dataset.fnfont = href; document.head.appendChild(l);
}

/* ================= lista de funis ================= */
async function renderHome(){
  const root = $('#root');
  root.innerHTML = `<div class="home"><div class="home-top"><div class="brand"><div class="brand-mark">B</div><div><div class="brand-name">Funis</div><div class="brand-sub">Brase</div></div></div>
    <span style="flex:1"></span>${DB.server ? '<span class="chip ok">Conectado ao servidor</span>' : '<span class="chip warn">Modo local</span>'}
    ${DB.server && ACCESS ? `<button class="btn ghost sm" data-a="logout">Sair</button>` : ''}</div>
    <div class="head"><div><h1>Funis</h1><p>Quiz e funis interativos: monte as etapas, publique o link e acompanhe os leads.</p></div>
    <div class="row"><button class="btn" data-a="import">${IC.upload}Importar</button><button class="btn primary" data-a="new-funnel">${IC.plus}Novo funil</button></div></div>
    ${DB.server ? '' : `<div class="banner warn" style="margin-bottom:14px"><span><b>Modo local.</b> O editor guarda tudo neste navegador e a página do funil abre pelo arquivo <code>funis/data/&lt;endereço&gt;.json</code>, sem gravar leads. Para gravar leads e enviar ao CRM, configure o servidor (veja <code>funis/README.md</code>).</span></div>`}
    <div class="cards" id="cards"><div class="empty">Carregando…</div></div></div>`;
  let list;
  try { list = await DB.list() } catch (e) { $('#cards').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return }
  if (!list.length) { $('#cards').innerHTML = `<div class="empty">Nenhum funil ainda. Crie um novo ou importe.${DB.server ? `<br><br><button class="btn primary" data-a="seed-brase">${IC.download}Trazer o BRASE 2 (cópia do InLead)</button>` : ''}</div>`; return }
  $('#cards').innerHTML = list.map(f => `<article class="fcard">
    <div class="thumb" data-a="open" data-id="${attr(f.id)}"><div class="mini" data-mini="${attr(f.id)}"></div></div>
    <div class="bd"><div class="row" style="justify-content:space-between"><h3 title="${attr(f.title)}">${esc(f.title)}</h3>${f.published_at ? '<span class="chip ok">Publicado</span>' : '<span class="chip">Rascunho</span>'}</div>
      <div class="hint">/${esc(f.slug)} · ${f.steps || 0} etapas · editado ${esc(fmtDate(f.updated_at))}</div>
      ${f.stats ? `<div class="stats"><span><b class="num">${fmtInt(f.stats.visits)}</b>acessos</span><span><b class="num">${fmtInt(f.stats.leads)}</b>leads</span><span><b class="num">${fmtInt(f.stats.complete)}</b>completos</span></div>` : ''}</div>
    <div class="ft"><button class="btn sm primary" data-a="open" data-id="${attr(f.id)}">Editar</button>
      <a class="btn sm" href="${attr(publicUrl(f.slug))}" target="_blank" rel="noopener">${IC.ext}Abrir</a>
      <span style="flex:1"></span><button class="btn sm icon ghost" data-a="card-menu" data-id="${attr(f.id)}" aria-label="Mais ações">${IC.dots}</button></div></article>`).join('');
  // miniaturas: a primeira etapa de cada funil
  list.forEach(f => { const box = $(`[data-mini="${CSS.escape(f.id)}"]`); if (box && f.draft && f.draft.steps && f.draft.steps.length) try { FR.mount(box, f.draft, {mode: 'edit'}) } catch (e) {} });
  HOME_LIST = list;
}
let HOME_LIST = [];
function newFunnelDialog(){
  const m = modal(`<h2>Novo funil</h2>
    <label class="f">Nome<input class="in" name="t" placeholder="Ex.: Diagnóstico da loja" autofocus></label>
    <div class="f">Começar com<div class="seg full" id="nf-k"><button type="button" data-k="quiz" aria-pressed="true">Quiz com captura</button><button type="button" data-k="blank" aria-pressed="false">Em branco</button><button type="button" data-k="copy" aria-pressed="false">Cópia do BRASE 2</button></div></div>
    <div class="actions"><button class="btn" data-x="no">Cancelar</button><button class="btn primary" data-x="ok">Criar</button></div>`);
  let kind = 'quiz';
  m.addEventListener('click', async e => {
    const k = e.target.closest('[data-k]'); if (k) { kind = k.dataset.k; $$('#nf-k button').forEach(b => b.setAttribute('aria-pressed', b === k)); return }
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'no') return closeModal();
    const title = m.querySelector('[name=t]').value.trim() || 'Novo funil';
    let draft;
    if (kind === 'blank') { draft = FR.newFunnel(title); draft.steps = [FR.newStep('Etapa 1')] }
    else if (kind === 'copy') { const r = await fetch('data/brase-2.json'); draft = (await r.json()).draft; draft.title = title }
    else draft = FR.newFunnel(title);
    try { const f = await DB.create({title, slug: slugify(title), draft}); closeModal(); location.hash = `#/f/${f.id}/construtor` } catch (er) { toast(er.message, 'err') }
  });
}
function importDialog(){
  const m = modal(`<h2>Importar funil</h2>
    <p class="muted">Aceita o arquivo exportado por este app (botão Exportar) ou o JSON de um funil do InLead.</p>
    <label class="btn" style="justify-self:start">${IC.upload}Escolher arquivo .json<input type="file" accept=".json,application/json" hidden id="imp-file"></label>
    <label class="f">…ou cole o JSON<textarea class="in code" rows="9" id="imp-text" placeholder='{"draft": {...}}  ou  {"response": true, "data": {"steps": [...]}}'></textarea></label>
    <details class="hint"><summary>Como copiar o JSON de um funil do InLead</summary><p style="margin-top:6px">No InLead, abra o funil no editor, aperte F12 › aba Rede (Network), recarregue a página, clique na linha <code>get/&lt;número&gt;</code> e copie a Resposta. Cole aqui.</p></details>
    <div class="actions"><button class="btn" data-x="no">Cancelar</button><button class="btn primary" data-x="ok">Importar</button></div>`);
  m.querySelector('#imp-file').addEventListener('change', async e => { const f = e.target.files[0]; if (f) m.querySelector('#imp-text').value = await f.text() });
  m.addEventListener('click', async e => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'no') return closeModal();
    let j; try { j = JSON.parse(m.querySelector('#imp-text').value) } catch { toast('JSON inválido.', 'err'); return }
    try {
      let rec;
      if (j.draft && j.draft.steps) rec = {title: j.title || j.draft.title, slug: j.slug, draft: j.draft, published: j.published || null, published_at: j.published ? new Date().toISOString() : null, webhook: j.webhook || {}};
      else if ((j.data && j.data.steps) || (j.steps && (j.navigation || j.schemaVersion))) { const d = FR.fromInlead(j); rec = {title: d.title, slug: d.slug, draft: d} }
      else if (j.steps) rec = {title: j.title || 'Funil importado', slug: j.slug, draft: j};
      else throw new Error('Não encontrei as etapas (steps) nesse JSON.');
      const f = await DB.create(rec); closeModal(); toast('Funil importado'); location.hash = `#/f/${f.id}/construtor`;
    } catch (er) { toast(er.message, 'err') }
  });
}
function exportRecord(rec){
  const wh = Object.assign({}, rec.webhook || {}); delete wh.token; if (wh.url) wh.url = String(wh.url).replace(/([?&]token=)[^&]+/i, '$1');
  return {format: 'brase-funil-export/1', exportedAt: new Date().toISOString(), slug: rec.slug, title: rec.title, draft: rec.draft, published: rec.published || null, publishedAt: rec.published_at || null, webhook: wh};
}

/* ================= editor: barra e abas ================= */
function renderEditor(){
  if (!REC) return;
  const tabs = [['construtor', 'Construtor', IC.build], ['fluxo', 'Fluxo', IC.flow], ['design', 'Design', IC.design], ['leads', 'Leads', IC.leads]];
  $('#root').innerHTML = `<div class="ed"><header class="ed-top">
    <div class="ed-title"><a class="btn icon ghost" href="#/" aria-label="Voltar para a lista">${IC.back}</a><div class="t"><b>${esc(REC.title)}</b><small>/${esc(REC.slug)}${REC.published_at ? ' · publicado ' + esc(fmtDateTime(REC.published_at)) : ' · não publicado'}</small></div></div>
    <nav class="tabs">${tabs.map(([k, l, ic]) => `<button class="tab" data-a="tab" data-tab="${k}"${UI.tab === k ? ' aria-current="page"' : ''}>${ic}${l}</button>`).join('')}</nav>
    <div class="ed-act"><span class="save-state" id="save-state"></span>
      <button class="btn icon${UI.tab === 'config' ? ' on' : ''}" data-a="tab" data-tab="config" title="Configurações" aria-label="Configurações">${IC.gear}</button>
      <button class="btn icon" data-a="share" title="Compartilhar" aria-label="Compartilhar">${IC.share}</button>
      <button class="btn icon" data-a="preview" title="Testar o funil" aria-label="Testar o funil">${IC.play}</button>
      <button class="btn" data-a="save-now">Salvar</button>
      <button class="btn dark" data-a="publish">Publicar</button></div></header>
    <main class="ed-main" id="ed-main"></main></div>`;
  paintSave();
  renderTab();
}
function renderTab(){
  const main = $('#ed-main'); if (!main) return;
  if (UI.tab === 'construtor') renderBuilder(main);
  else if (UI.tab === 'fluxo') renderFlow(main);
  else if (UI.tab === 'design') renderDesign(main);
  else if (UI.tab === 'leads') renderLeads(main);
  else if (UI.tab === 'config') renderConfig(main);
}

/* ================= publicar, compartilhar, testar ================= */
async function publishDialog(){
  await save();
  if (SAVE.err) { toast('Salve antes de publicar: ' + SAVE.err, 'err'); return }
  const problems = checkFunnel(D);
  const m = modal(`<h2>Publicar “${esc(REC.title)}”</h2>
    <p class="muted">${REC.published_at ? 'A versão que está no ar desde ' + esc(fmtDateTime(REC.published_at)) + ' será substituída por esta.' : 'O funil vai ficar no ar no endereço abaixo.'}</p>
    <pre class="code">${esc(publicUrl(REC.slug))}</pre>
    ${problems.length ? `<div class="banner warn" style="display:grid;gap:4px"><b>Confira antes:</b>${problems.slice(0, 8).map(p => `<span>• ${esc(p)}</span>`).join('')}</div>` : ''}
    ${DB.server ? '' : `<div class="banner"><span>No modo local, publicar baixa o arquivo <b>${esc(REC.slug)}.json</b>. Coloque-o em <code>funis/data/</code> no GitHub para a página do funil usar a versão nova.</span></div>`}
    <div class="actions">${REC.published_at && DB.server ? '<button class="btn danger" data-x="unpub">Tirar do ar</button><span style="flex:1"></span>' : ''}<button class="btn" data-x="no">Cancelar</button><button class="btn dark" data-x="ok" autofocus>Publicar agora</button></div>`);
  m.addEventListener('click', async e => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'no') return closeModal();
    try {
      if (b.dataset.x === 'unpub') { await DB.unpublish(REC.id); REC.published = null; REC.published_at = null; closeModal(); toast('Funil fora do ar'); renderEditor(); return }
      b.disabled = true;
      const r = await DB.publish(REC.id); REC.published = clone(D); REC.published_at = r.published_at;
      if (!DB.server) download(REC.slug + '.json', JSON.stringify(exportRecord(REC), null, 1) + '\n');
      closeModal(); toast('Publicado!'); renderEditor();
    } catch (er) { b.disabled = false; toast(er.message, 'err') }
  });
}
// Problemas comuns: destino apagado, campo sem nome, nome repetido.
function checkFunnel(f){
  const out = [], ids = new Set(f.steps.map(s => s.id)), names = {};
  f.steps.forEach((s, i) => {
    if (!s.layers.length) out.push(`Etapa ${i + 1} (${s.title}) está vazia.`);
    for (const o of FR.outlets(f, s)) if (o.dest !== 'next' && !ids.has(o.dest) && !FR.isUrl(o.dest) && !/^[\w-]+(\.[\w-]+)+/.test(o.dest)) out.push(`Etapa ${i + 1}: “${o.label.slice(0, 40)}” leva a uma etapa que não existe mais.`);
    for (const l of s.layers) if (FR.INPUT_TYPES.includes(l.type) && !l.archived) { const n = l.content.name; if (!n) out.push(`Etapa ${i + 1}: um componente está sem nome.`); else if (names[n]) out.push(`O nome “${n}” está repetido (etapas ${names[n]} e ${i + 1}).`); else names[n] = i + 1 }
    const hasInput = s.layers.some(l => l.type === 'options' || l.type === 'button' || l.type === 'loading');
    if (!hasInput && i < f.steps.length - 1) out.push(`Etapa ${i + 1} (${s.title}) não tem botão nem opções: o visitante não sai dela.`);
  });
  return out;
}
function shareDialog(){
  const url = publicUrl(REC.slug), u = encodeURIComponent(url), t = encodeURIComponent(REC.title);
  const nets = [['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`], ['X', `https://twitter.com/intent/tweet?url=${u}&text=${t}`], ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`], ['WhatsApp', `https://wa.me/?text=${t}%20${u}`], ['Telegram', `https://t.me/share/url?url=${u}&text=${t}`], ['E-mail', `mailto:?subject=${t}&body=${u}`]];
  modal(`<div class="row" style="justify-content:space-between"><h2>Compartilhar</h2><button class="btn icon ghost" data-a="close-modal" aria-label="Fechar">${IC.x}</button></div>
    ${REC.published_at ? '' : '<div class="banner warn">O funil ainda não foi publicado: o link só funciona depois de Publicar.</div>'}
    <label class="f">Link do funil<div class="row"><input class="in" readonly value="${attr(url)}"><button class="btn" data-a="copy" data-v="${attr(url)}">${IC.copy}Copiar</button><a class="btn" href="${attr(url)}" target="_blank" rel="noopener">${IC.ext}</a></div></label>
    <p class="hint">Os parâmetros do anúncio (utm_source, utm_campaign, fbclid…) podem ir no fim do link: <code>${esc(url)}&amp;utm_source=FB</code>. Eles aparecem na aba Leads e seguem para o CRM.</p>
    <div class="f">Redes sociais<div class="row" style="flex-wrap:wrap">${nets.map(([n, h]) => `<a class="btn sm" href="${attr(h)}" target="_blank" rel="noopener">${esc(n)}</a>`).join('')}</div></div>`);
}
// Teste do funil dentro do editor: as respostas aparecem ao lado; redirecionamentos não saem da página.
function previewDialog(fromStep){
  const m = modal(`<div class="row" style="justify-content:space-between"><h2>Testar o funil</h2><div class="row"><button class="btn sm" data-x="restart">${IC.refresh}Recomeçar</button><button class="btn icon ghost" data-a="close-modal" aria-label="Fechar">${IC.x}</button></div></div>
    <div class="preview"><div class="phone"><div class="screen" id="pv-screen"></div></div><div><div class="eyebrow" style="margin-bottom:8px">Respostas e variáveis</div><div class="pv-log" id="pv-log"><span class="hint">Responda o funil para ver as variáveis, a pontuação e para onde cada botão leva.</span></div></div></div>`, 'wide');
  let ctl, sess;
  const log = [];
  const paint = () => {
    const a = ctl ? ctl.answers : {};
    const rows = Object.values(a).map(x => `<div class="ln"><span class="tag" style="font:11px var(--f-mono)">@${esc(x.name)}</span> <b>${esc(Array.isArray(x.value) ? x.value.join(', ') : x.value)}</b>${x.score ? ` <span class="chip">${esc(String(x.score))} pts</span>` : ''}<div class="hint">${esc(x.label || '')}</div></div>`).join('');
    $('#pv-log').innerHTML = (rows || '') + `<div class="ln"><b>Pontuação total:</b> ${FR.totalScore(a)}</div>` + log.slice(-6).reverse().map(l => `<div class="hint">${esc(l)}</div>`).join('');
  };
  const run = () => {
    if (ctl) ctl.destroy();
    sess = {id: 'teste-' + uid(4), created_at: new Date().toISOString(), tracking: {teste: 'editor', userAgent: navigator.userAgent}, answers: {}, clicks: {}, steps: [], interacted: false, completed: false, test: true};
    log.length = 0;
    // Teste A/B: cada pré-visualização sorteia uma variante, como um visitante novo.
    const ab = FR.abAssign(D, sess.id, {});
    sess.params = ab;
    if (Object.keys(ab).length) log.push('Teste A/B: ' + Object.entries(ab).map(([k, v]) => k.slice(6) + ' = ' + v).join(', ') + ' (▶ de novo para sortear outra)');
    ctl = FR.mount($('#pv-screen'), clone(D), {mode: 'preview', step: fromStep || 0, scrollEl: $('#pv-screen'), params: ab,
      onEvent: ev => {
        if (ev.type === 'step') { sess.steps.push(ev.step) }
        if (ev.type === 'answer') { sess.answers[ev.layer] = ev.answer; sess.interacted = true }
        if (ev.type === 'click') { sess.clicks[ev.layer] = {name: ev.name, label: ev.label, at: new Date().toISOString()}; sess.interacted = true; log.push(`Clique em “${ev.label}” → ${ev.destination}`) }
        if (ev.type === 'complete') sess.completed = true;
        sess.updated_at = new Date().toISOString(); sess.last_step = sess.steps[sess.steps.length - 1];
        DB.recordLocal(REC.id, clone(sess));
        paint();
      },
      onPreviewRedirect: url => { log.push('Iria para: ' + url); paint(); toast('No ar, o visitante iria para: ' + url) },
      onEnd: () => toast('Fim do funil'),
    });
    paint();
  };
  m.addEventListener('click', e => { if (e.target.closest('[data-x="restart"]')) run() });
  run();
  $('#modal')._cleanup = () => ctl && ctl.destroy();
}

/* ================= ações globais ================= */
const ACT = {
  logout: () => { store.del(CODE_KEY); ACCESS = ''; location.hash = '#/'; start() },
  'new-funnel': newFunnelDialog,
  // Primeira vez no servidor: cria o BRASE 2 com o rascunho, a versão publicada e o webhook do arquivo funis/data/brase-2.json.
  'seed-brase': async () => { UI.cfg = 'webhook'; const r = await fetch('data/brase-2.json', {cache: 'no-cache'}); const x = await r.json(); const f = await DB.create({title: x.title, slug: x.slug, draft: x.draft, published: x.published, webhook: x.webhook}); toast('BRASE 2 criado. Falta colar o token do CRM em Configurações › Webhooks.'); location.hash = `#/f/${f.id}/config` },
  import: importDialog,
  open: t => { location.hash = `#/f/${t.dataset.id}/construtor` },
  'card-menu': t => {
    const f = HOME_LIST.find(x => x.id === t.dataset.id); const r = t.getBoundingClientRect();
    menu(r.left - 150, r.bottom + 4, [
      {label: 'Duplicar', icon: IC.copy, run: async () => { const rec = await DB.get(f.id); await DB.create({title: rec.title + ' (cópia)', slug: rec.slug + '-copia', draft: rec.draft, webhook: rec.webhook}); toast('Funil duplicado'); renderHome() }},
      {label: 'Exportar (JSON)', icon: IC.download, run: async () => { const rec = await DB.get(f.id); download(rec.slug + '.json', JSON.stringify(exportRecord(rec), null, 1) + '\n') }},
      {label: 'Copiar link', icon: IC.share, run: () => copy(publicUrl(f.slug))}, '-',
      {label: 'Excluir', icon: IC.trash, danger: true, run: async () => { if (await confirmBox('Excluir “' + f.title + '”?', 'O funil e todos os leads dele serão apagados. Não dá para desfazer.', 'Excluir', true)) { await DB.remove(f.id); toast('Funil excluído'); renderHome() } }},
    ]);
  },
  tab: t => go(t.dataset.tab),
  share: shareDialog,
  preview: () => previewDialog(UI.tab === 'construtor' ? UI.step : 0),
  'save-now': async () => { SAVE.dirty = true; await save(); if (!SAVE.err) toast('Salvo') },
  publish: publishDialog,
  'close-modal': closeModal,
  copy: t => copy(t.dataset.v),
  'conflict-reload': async () => { closeModal(); SAVE.dirty = false; const id = REC.id; REC = null; location.hash = '#/f/' + id + '/' + UI.tab; route() },
  'conflict-mine': async () => { closeModal(); REC.updated_at = null; SAVE.dirty = true; SAVE.err = ''; await save() },
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  const fn = ACT[t.dataset.a]; if (!fn) return;
  e.preventDefault(); Promise.resolve(fn(t, e)).catch(er => { console.error(er); toast(er.message || String(er), 'err') });
});
document.addEventListener('keydown', e => {
  if (UI.view !== 'editor') return;
  const typing = e.target.closest('input,textarea,select,[contenteditable="true"]');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); ACT['save-now']() ; return }
  if (e.key === 'Escape') { if ($('#menu')) closeMenu(); else if ($('#modal')) closeModal() }
  if (typing || $('#modal')) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
  else if (UI.tab === 'construtor' && UI.sel && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeLayer(UI.sel) }
  else if (UI.tab === 'construtor' && UI.sel && mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateLayer(UI.sel) }
});
