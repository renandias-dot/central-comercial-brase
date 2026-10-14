/* Funis Brase — editor: Design, Leads (respostas, resultados, performance) e Configurações. */
'use strict';

/* ================= Design ================= */
const PRESETS = [
  ['Brase', {themeColor: '#a21caf', backgroundColor: '#171717', titleColor: '#f8fafc', contentColor: '#f59e0b'}],
  ['Claro', {themeColor: '#6366f1', backgroundColor: '#ffffff', titleColor: '#0f172a', contentColor: '#475569'}],
  ['Nítido', {themeColor: '#0ea5e9', backgroundColor: '#f8fafc', titleColor: '#020617', contentColor: '#334155'}],
  ['Noite', {themeColor: '#22c55e', backgroundColor: '#0b1120', titleColor: '#f1f5f9', contentColor: '#94a3b8'}],
  ['Quente', {themeColor: '#ea580c', backgroundColor: '#fff7ed', titleColor: '#431407', contentColor: '#9a3412'}],
  ['Elegante', {themeColor: '#d4af37', backgroundColor: '#111111', titleColor: '#fafafa', contentColor: '#d4af37'}],
];
const FONT_OPTS = Object.entries(FR.FONTS).map(([k, v]) => [k, v]);
function renderDesign(main){
  main.innerHTML = `<div class="dsg"><section class="canvas"><div class="dsg-steps"><button class="btn sm icon ghost" data-a="dstep" data-v="-1" aria-label="Etapa anterior">${IC.back}</button><select id="dstep-sel" aria-label="Etapa">${D.steps.map((s, i) => `<option value="${i}"${i === UI.step ? ' selected' : ''}>${i + 1} · ${esc(s.title)}</option>`).join('')}</select><button class="btn sm icon ghost" data-a="dstep" data-v="1" aria-label="Próxima etapa" style="transform:scaleX(-1)">${IC.back}</button></div>
    <div class="phone${UI.device === 'desktop' ? ' desktop' : ''}"><div class="screen" id="screen"></div></div></section>
    <aside class="col props" id="col-props"></aside></div>`;
  $('#dstep-sel').addEventListener('change', e => { UI.step = +e.target.value; refreshCanvas(true) });
  refreshCanvas(true); renderDesignPanel();
}
function renderDesignPanel(){
  const el = $('#col-props'); if (!el) return; wireProps();
  const F = k => 'F:design.' + k, bg = (D.design.background || {}).type || 'none';
  el.innerHTML = `<div class="pbody">
    <div class="psec"><span class="eyebrow">Combinações prontas</span><div class="presets">${PRESETS.map(([n, p], i) => `<button type="button" class="preset" data-a="preset" data-i="${i}"><i><span style="background:${p.backgroundColor}"></span><span style="background:${p.themeColor}"></span><span style="background:${p.contentColor}"></span></i>${esc(n)}</button>`).join('')}</div></div>
    <div class="psec"><span class="eyebrow">Geral</span>${P.seg(F('align'), 'Alinhamento', [['center', 'Centralizado'], ['top', 'Topo']], 'center')}${P.range(F('width'), 'Largura máxima', 320, 760, 10, {unit: ' px', def: 440})}${P.sel(F('elementSize'), 'Dimensão (altura de botões e opções)', [['44px', 'Compacta (44 px)'], ['50px', 'Pequena (50 px)'], ['56px', 'Normal (56 px)'], ['64px', 'Grande (64 px)'], ['72px', 'Enorme (72 px)']], {def: '56px'})}${P.range(F('spacing'), 'Espaçamento entre componentes', 0, 8, 1, {def: 0})}${P.sel(F('rounded'), 'Bordas/Cantos', [['rounded-none', 'Retos'], ['rounded-md', 'Leves'], ['rounded-lg', 'Médios'], ['rounded-xl', 'Arredondados'], ['rounded-2xl', 'Bem arredondados'], ['rounded-3xl', 'Muito arredondados'], ['rounded-full', 'Pílula']], {def: 'rounded-2xl'})}${P.color(F('themeColor'), 'Cor destaque', '#6366f1')}</div>
    <div class="psec"><span class="eyebrow">Cabeçalho</span>${P.seg(F('progress'), 'Barra de progresso', [['bar', 'Mostrar'], ['none', 'Esconder']], 'bar')}${P.media(F('logo.src'), 'Marca/Logo', 'image/*')}${P.seg(F('logo.size'), 'Tamanho do logo', [['small', 'Pequeno'], ['normal', 'Normal'], ['large', 'Grande']], 'normal')}${P.seg(F('logo.position'), 'Posição do logo', [['center', 'Centro'], ['left', 'Esquerda']], 'center')}</div>
    <div class="psec"><span class="eyebrow">Fundo</span>${P.color(F('backgroundColor'), 'Cor de fundo', '#ffffff')}${P.seg(F('background.type'), 'Plano de fundo', [['none', 'Nenhum'], ['image', 'Imagem'], ['gradient', 'Gradiente'], ['effect', 'Efeito'], ['video', 'Vídeo']], 'none', true)}
      ${bg === 'image' ? P.media(F('background.src'), 'Imagem de fundo', 'image/*') + P.range(F('background.opacity'), 'Opacidade', 0.1, 1, 0.05, {def: 1}) : ''}
      ${bg === 'video' ? P.media(F('background.src'), 'Vídeo de fundo (.mp4)', 'video/*', {preview: false}) + P.range(F('background.opacity'), 'Opacidade', 0.1, 1, 0.05, {def: 1}) : ''}
      ${bg === 'gradient' ? P.color(F('background.from'), 'De', D.design.backgroundColor) + P.color(F('background.to'), 'Para', D.design.themeColor) + P.range(F('background.angle'), 'Ângulo', 0, 360, 15, {unit: '°', def: 180}) : ''}
      ${bg === 'effect' ? '<p class="hint">Brilho suave da cor destaque no topo da página.</p>' : ''}</div>
    <div class="psec"><span class="eyebrow">Títulos</span>${P.sel(F('featuredFont'), 'Fonte', FONT_OPTS, {def: 'inter'})}${P.color(F('titleColor'), 'Cor', '#0f172a')}${P.range(F('titleSize'), 'Tamanho', 0, 1, 0.05, {def: 0.5})}</div>
    <div class="psec"><span class="eyebrow">Textos</span>${P.sel(F('contentFont'), 'Fonte', FONT_OPTS, {def: 'inter'})}${P.color(F('contentColor'), 'Cor', '#475569')}${P.range(F('contentSize'), 'Tamanho', 12, 22, 1, {unit: ' px', def: 16})}<p class="hint">Os títulos (H1, H2, H3) usam a cor dos títulos; os parágrafos, a cor dos textos. Trechos pintados no editor de texto mantêm a cor escolhida.</p></div>
  </div>`;
}
Object.assign(ACT, {
  dstep: t => { UI.step = Math.max(0, Math.min(D.steps.length - 1, UI.step + +t.dataset.v)); $('#dstep-sel').value = UI.step; refreshCanvas(true) },
  preset: t => { const p = PRESETS[+t.dataset.i][1]; mutate(d => Object.assign(d.design, p), {canvas: false}); refreshCanvas(true); renderDesignPanel() },
});

/* ================= Leads ================= */
const LEADS = {cache: null, loading: false, extra: [], seq: 0};
const TRACK = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'fbclid', 'utm_id', 'screen', 'viewport', 'platform', 'ip', 'userAgent', 'language', 'referrer'];
const PERIODS = [['day', '24 horas'], ['week', '7 dias'], ['month', '30 dias'], ['all', 'Tudo']];
function leadColumns(){
  const out = [];
  D.steps.forEach((s, i) => {
    const cols = s.layers.filter(l => (FR.INPUT_TYPES.includes(l.type) || l.type === 'button') && !l.archived).map(l => ({step: s, i, layer: l, key: l.id, type: l.type, name: l.content.name || l.id, title: l.type === 'button' ? 'Botão' : l.type === 'options' ? 'Opções' : (FR.TYPE_TITLE[l.type] || l.type)}));
    out.push({step: s, i, cols});
  });
  return out;
}
async function loadLeads(more){
  const id = REC.id, q = {period: UI.leads.period, order: UI.leads.order};
  const key = id + '|' + q.period + '|' + q.order;
  if (!more && LEADS.cache && LEADS.cache.key === key && Date.now() - LEADS.cache.at < 60e3) return LEADS.cache;
  const off = more && LEADS.cache ? LEADS.cache.leads.length : 0;
  const [st, ls] = await Promise.all([more ? Promise.resolve(LEADS.cache.stats) : DB.stats(id, q), DB.leads(id, Object.assign({limit: 100, offset: off}, q))]);
  const data = {key, at: Date.now(), stats: st, leads: more ? LEADS.cache.leads.concat(ls.leads) : ls.leads, total: ls.total, sales: (more ? LEADS.cache.sales || [] : []).concat(ls.sales || [])};
  // Se trocaram de período/ordem/funil enquanto carregava, esta resposta é velha: não vira cache.
  if (key === REC.id + '|' + UI.leads.period + '|' + UI.leads.order) LEADS.cache = data;
  return data;
}
async function renderLeads(main){
  const L = UI.leads, my = ++LEADS.seq;
  main.innerHTML = `<div class="leads" id="leads-root"><div class="leads-top">
    <div class="seg">${[['respostas', 'Respostas'], ['resultados', 'Resultados'], ['performance', 'Performance'], ['anuncios', 'Anúncios'], ['caminhos', 'Caminhos']].map(([k, l]) => `<button data-a="lsub" data-v="${k}" aria-pressed="${L.sub === k}">${l}</button>`).join('')}</div>
    <div class="seg">${PERIODS.map(([k, l]) => `<button data-a="lperiod" data-v="${k}" aria-pressed="${L.period === k}">${l}</button>`).join('')}</div>
    <span style="flex:1"></span><button class="btn sm" data-a="lrefresh">${IC.refresh}Atualizar</button><button class="btn sm" data-a="lexport">${IC.download}Exportar leads</button>${DB.server ? `<label class="btn sm" title="Planilha ou JSON do InLead">${IC.upload}Importar do InLead<input type="file" hidden accept=".csv,.json,text/csv,application/json" data-import="inlead" multiple></label>` : ''}<button class="btn sm danger" data-a="lreset">${IC.trash}Resetar dados</button></div>
    ${DB.server ? '' : '<div class="banner" style="margin-bottom:14px">Modo local: aqui aparecem só os testes feitos no botão ▶ deste navegador. Os leads reais aparecem quando o servidor estiver configurado.</div>'}
    <div id="leads-body"><div class="empty">Carregando…</div></div></div>`;
  let data;
  try { data = await loadLeads() } catch (e) { if (my === LEADS.seq && $('#leads-body')) $('#leads-body').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return }
  if (UI.tab !== 'leads' || my !== LEADS.seq) return;
  paintLeads(data);
}
function kpis(st){
  const k = (l, v, s, ic) => `<div class="kpi"><span class="l">${l}</span><span class="v">${v}</span><span class="s">${s}</span></div>`;
  return `<div class="kpis">${k('Visitas e acessos', fmtInt(st.visits), 'Visitantes que acessaram o funil')}${k('Leads adquiridos', fmtInt(st.leads), 'Iniciaram alguma interação')}${k('Taxa de interação', fmtPct(st.leads, st.visits), 'Visitantes que interagiram')}${k('Leads qualificados', fmtInt(st.qualified), 'Responderam mais de 70% das etapas ou completaram')}${k('Fluxos completos', fmtInt(st.complete), 'Chegaram ao fim ou clicaram no link final')}</div>`;
}
function paintLeads(data){
  const body = $('#leads-body'); if (!body) return;
  const st = data.stats || {visits: 0, steps: {}};
  const sub = UI.leads.sub;
  if (sub === 'anuncios' || sub === 'caminhos') {
    body.innerHTML = kpis(st) + '<div id="ins-body"><div class="empty">Carregando…</div></div>';
    (sub === 'anuncios' ? adsHtml() : pathsHtml()).then(h => { const b = $('#ins-body'); if (b && UI.leads.sub === sub) { b.innerHTML = h; wireTips(b) } }).catch(e => { const b = $('#ins-body'); if (b) b.innerHTML = `<div class="empty">${esc(e.message)}</div>` });
    return;
  }
  body.innerHTML = kpis(st) + (sub === 'resultados' ? resultsHtml(st) : sub === 'performance' ? perfHtml(st) : answersHtml(data));
  wireTips(body);
}
function cellOf(lead, c){
  if (c.type === 'button') { const k = lead.clicks && lead.clicks[c.key]; return k ? '<span class="clk">clicou</span>' : '' }
  const a = lead.answers && lead.answers[c.key]; if (!a) return '';
  if (c.type === 'options') return `<span class="tag">${esc(Array.isArray(a.value) ? a.value.join(',') : a.value)}</span>${esc(a.label || '')}${a.score ? ` <span class="hint">${esc(String(a.score))}</span>` : ''}`;
  return esc(Array.isArray(a.value) ? a.value.join(', ') : a.value);
}
function answersHtml(data){
  const groups = leadColumns().filter(g => g.cols.length && !UI.leads.hidden[g.step.id]);
  const st = data.stats || {}, visits = st.visits || 0;
  const track = UI.leads.hideTracking ? [] : TRACK;
  const head1 = `<th class="sticky" colspan="3">Entrada</th>${groups.map(g => `<th class="stp" colspan="${g.cols.length}">${g.i + 1} · ${esc(g.step.title)}<span class="pc">${fmtPct((st.steps || {})[g.step.id] || 0, visits)}</span></th>`).join('')}<th colspan="${insightHead().length}">Leitura</th>${track.length ? `<th colspan="${track.length}">Rastreamento</th>` : ''}`;
  const head2 = `<th class="sticky">#</th><th>[ID] Lead</th><th>Data</th>${groups.map(g => g.cols.map(c => `<th>${esc(c.title)}<span class="nm">${esc(c.name)}</span></th>`).join('')).join('')}${insightHead().map(t => `<th>${t}</th>`).join('')}${track.map(t => `<th>${esc(t)}</th>`).join('')}`;
  const rows = data.leads.map((l, k) => `<tr data-a="lead" data-k="${k}"><td class="sticky">${k + 1}</td><td><span class="tag">${esc(l.id)}</span>${l.test ? '<span class="chip">teste</span>' : ''}</td><td>${esc(fmtDateTime(l.created_at))}</td>${groups.map(g => g.cols.map(c => `<td>${cellOf(l, c)}</td>`).join('')).join('')}${insightCells(l, data).map(v => `<td>${v}</td>`).join('')}${track.map(t => `<td title="${attr((l.tracking || {})[t] || '')}">${esc((l.tracking || {})[t] || '')}</td>`).join('')}</tr>`).join('');
  return `<div class="row" style="margin-bottom:10px;flex-wrap:wrap"><button class="btn sm" data-a="lsteps">${IC.layout}Etapas</button><button class="btn sm" data-a="lcols">Colunas</button><span class="seg"><button data-a="lorder" data-v="new" aria-pressed="${UI.leads.order === 'new'}">Mais recentes</button><button data-a="lorder" data-v="old" aria-pressed="${UI.leads.order === 'old'}">Mais antigos</button></span><span class="hint">${fmtInt(data.total)} registro(s) no período · mostrando ${fmtInt(data.leads.length)} · clique numa linha para ver tudo</span></div>
    ${data.leads.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head1}</tr><tr>${head2}</tr></thead><tbody>${rows}</tbody></table></div>${data.leads.length < data.total ? '<div style="text-align:center;margin-top:10px"><button class="btn" data-a="lmore">Carregar mais</button></div>' : ''}` : '<div class="panel"><div class="empty">Nenhum acesso no período.</div></div>'}`;
}
// Barras horizontais (uma cor só; o valor fica escrito ao lado de cada barra).
function barsHtml(rows, total){
  const max = Math.max(1, ...rows.map(r => r.n));
  return `<div class="bars">${rows.map(r => `<div class="bar-r" data-tip="${attr(r.label)}" data-tipv="${attr(fmtInt(r.n) + ' · ' + fmtPct(r.n, total))}" tabindex="0"><span class="lb" title="${attr(r.label)}">${esc(r.label)}</span><span class="tr"><i style="width:${(r.n / max) * 100}%"></i></span><span class="vl num">${fmtInt(r.n)}<small>${fmtPct(r.n, total)}</small></span></div>`).join('')}</div>`;
}
function resultsHtml(st){
  const blocks = [];
  D.steps.forEach((s, i) => s.layers.forEach(l => {
    if (l.type === 'options') {
      const counts = (st.answers || {})[l.id] || {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const rows = (l.content.options || []).map(o => ({label: FR.plainLabel(o.label) || String(o.value), n: counts[String(o.value != null && o.value !== '' ? o.value : FR.plainLabel(o.label))] || 0}));
      blocks.push(`<section class="panel"><div class="panel-h"><h2>${i + 1} · ${esc(s.title)}</h2><span class="hint">${fmtInt(total)} resposta(s) · <code>${esc(l.content.name || '')}</code></span></div><div class="panel-b">${total ? barsHtml(rows, total) : '<div class="empty">Sem respostas no período.</div>'}</div></section>`);
    } else if (FR.INPUT_TYPES.includes(l.type)) {
      const n = (st.fields || {})[l.id] || 0;
      blocks.push(`<section class="panel"><div class="panel-h"><h2>${i + 1} · ${esc(s.title)}</h2><span class="hint"><code>${esc(l.content.name || '')}</code></span></div><div class="panel-b"><b class="num" style="font-size:22px">${fmtInt(n)}</b> <span class="muted">preencheram “${esc(l.content.title || 'campo')}”</span></div></section>`);
    }
  }));
  return blocks.length ? `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(420px,1fr))">${blocks.join('')}</div>` : '<div class="panel"><div class="empty">Este funil não tem perguntas.</div></div>';
}
function perfHtml(st){
  const visits = st.visits || 0;
  const rows = D.steps.map((s, i) => ({label: `${i + 1} · ${s.title}`, n: (st.steps || {})[s.id] || 0}));
  const metric = UI.leads.metric || 'visits', days = st.daily || [];
  const max = Math.max(1, ...days.map(d => d[metric] || 0));
  const mLabel = {visits: 'Acessos', leads: 'Leads', complete: 'Completos'}[metric];
  return `<div style="display:grid;gap:12px;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)" class="perf">
    <section class="panel"><div class="panel-h"><h2>Quantos chegaram a cada etapa</h2><span class="hint">% sobre os ${fmtInt(visits)} acessos</span></div><div class="panel-b">${barsHtml(rows, visits)}</div></section>
    <section class="panel"><div class="panel-h"><h2>${mLabel} por dia</h2><span class="seg">${[['visits', 'Acessos'], ['leads', 'Leads'], ['complete', 'Completos']].map(([k, l]) => `<button data-a="lmetric" data-v="${k}" aria-pressed="${metric === k}">${l}</button>`).join('')}</span></div><div class="panel-b">
      ${days.length ? `<div class="hint" style="margin-bottom:4px">máx. ${fmtInt(max)}</div><div class="vchart">${days.map(d => `<div class="c" data-tip="${attr(fmtDate(d.day + 'T12:00'))}" data-tipv="${attr(fmtInt(d[metric] || 0) + ' ' + mLabel.toLowerCase())}" tabindex="0"><i style="height:${((d[metric] || 0) / max) * 100}%"></i></div>`).join('')}</div><div class="vaxis"><span>${esc(fmtDate(days[0].day + 'T12:00'))}</span><span>${esc(fmtDate(days[days.length - 1].day + 'T12:00'))}</span></div>
      <details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Ver em tabela</summary><table class="tbl" style="margin-top:6px"><thead><tr><th>Dia</th><th>Acessos</th><th>Leads</th><th>Completos</th></tr></thead><tbody>${days.slice().reverse().map(d => `<tr><td>${esc(fmtDate(d.day + 'T12:00'))}</td><td>${fmtInt(d.visits)}</td><td>${fmtInt(d.leads)}</td><td>${fmtInt(d.complete)}</td></tr>`).join('')}</tbody></table></details>` : '<div class="empty">Sem acessos no período.</div>'}
    </div></section></div>`;
}
// Dica ao passar o mouse (ou focar) numa barra.
function wireTips(root){
  let tip = $('#tip'); if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.id = 'tip'; tip.hidden = true; document.body.appendChild(tip) }
  const show = (el, x, y) => { tip.replaceChildren(); const b = document.createElement('b'); b.textContent = el.dataset.tipv; const s = document.createElement('span'); s.textContent = el.dataset.tip; tip.append(b, s); tip.hidden = false; const r = tip.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - r.width - 8, x + 12) + 'px'; tip.style.top = Math.max(8, y - r.height - 10) + 'px' };
  root.addEventListener('pointermove', e => { const el = e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else tip.hidden = true });
  root.addEventListener('pointerleave', () => { tip.hidden = true });
  root.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top) } });
  root.addEventListener('focusout', () => { tip.hidden = true });
}
function leadDrawer(lead){
  closeDrawer();
  const groups = leadColumns();
  const ans = groups.map(g => { const rows = g.cols.map(c => { const v = cellOf(lead, c); return v ? `<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px"><span class="muted" style="font-size:12px">${esc(c.layer.content.title || c.title)} <code>${esc(c.name)}</code></span><span style="text-align:right">${v}</span></div>` : '' }).join(''); return rows ? `<div><div class="eyebrow" style="margin-bottom:6px">${g.i + 1} · ${esc(g.step.title)}</div><div style="display:grid;gap:6px">${rows}</div></div>` : '' }).join('');
  const tr = Object.entries(lead.tracking || {}).map(([k, v]) => `<div class="row" style="justify-content:space-between;gap:12px;font-size:12.5px"><span class="muted">${esc(k)}</span><span style="text-align:right;word-break:break-all">${esc(v)}</span></div>`).join('');
  const d = document.createElement('aside'); d.className = 'drawer'; d.id = 'drawer';
  d.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="font:800 18px/1.2 var(--f-display)">Lead <span class="tag" style="font:13px var(--f-mono)">${esc(lead.id)}</span></h2><button class="btn icon ghost" data-a="close-drawer" aria-label="Fechar">${IC.x}</button></div>
    <div class="row" style="flex-wrap:wrap">${lead.completed ? '<span class="chip ok">completou</span>' : ''}${lead.interacted ? '<span class="chip acc">interagiu</span>' : '<span class="chip">só acessou</span>'}<span class="hint">entrou ${esc(fmtDateTime(lead.created_at))} · última atividade ${esc(fmtDateTime(lead.updated_at))}</span></div>
    ${lead.webhook && lead.webhook.kind === 'importado' ? `<div class="banner">Importado do InLead em ${esc(fmtDateTime(lead.webhook.at))}. Não foi enviado para o webhook daqui.</div>` : lead.webhook ? `<div class="banner${lead.webhook.ok ? '' : ' warn'}">Webhook: ${lead.webhook.ok ? 'enviado' : 'falhou'} em ${esc(fmtDateTime(lead.webhook.at))}${lead.webhook.status ? ' · HTTP ' + esc(String(lead.webhook.status)) : ''}${lead.webhook.error ? ' · ' + esc(lead.webhook.error) : ''}</div>` : ''}
    ${insightDrawer(lead, LEADS.cache || {})}
    <div style="display:grid;gap:14px">${ans || '<p class="muted">Sem respostas.</p>'}</div>
    <div><div class="eyebrow" style="margin-bottom:6px">Etapas vistas</div><p class="hint">${(lead.steps || []).map(id => { const k = D.steps.findIndex(s => s.id === id); return k >= 0 ? (k + 1) + ' · ' + esc(D.steps[k].title) : esc(id) }).join(' → ') || '—'}</p></div>
    <div><div class="eyebrow" style="margin-bottom:6px">Rastreamento</div><div style="display:grid;gap:4px">${tr || '<span class="hint">—</span>'}</div></div>
    <div class="row" style="flex-wrap:wrap">${DB.server && !lead.test ? `<button class="btn" data-a="lresend" data-id="${attr(lead.id)}">${IC.hook}Reenviar para o webhook</button>` : ''}<button class="btn" data-a="copy" data-v="${attr(JSON.stringify(lead, null, 2))}">${IC.copy}Copiar JSON</button></div>`;
  document.body.appendChild(d);
  setTimeout(() => document.addEventListener('mousedown', drawerOutside), 0);
}
function drawerOutside(e){ if (!e.target.closest('#drawer') && !e.target.closest('#modal')) closeDrawer() }
function closeDrawer(){ const d = $('#drawer'); if (d) d.remove(); document.removeEventListener('mousedown', drawerOutside) }
function csvCell(v){ v = v == null ? '' : String(v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }
async function exportCsv(){
  toast('Preparando a planilha…');
  const all = []; let off = 0;
  for (;;) { const r = await DB.leads(REC.id, {period: UI.leads.period, order: 'old', limit: 1000, offset: off}); all.push(...r.leads); off += r.leads.length; if (!r.leads.length || off >= r.total || off >= 50000) break }
  const groups = leadColumns().filter(g => g.cols.length), cols = groups.flatMap(g => g.cols);
  const head = ['id', 'data'].concat(cols.map(c => `${c.i + 1}. ${c.step.title} · ${c.name}`), ['completou', 'interagiu', 'nota', 'no perfil', 'etiquetas', 'teste a/b', 'whatsapp', 'etapa no crm'], TRACK);
  const plain = (l, c) => { if (c.type === 'button') return l.clicks && l.clicks[c.key] ? 'clicou' : ''; const a = l.answers && l.answers[c.key]; if (!a) return ''; return c.type === 'options' ? (a.label || a.value) : (Array.isArray(a.value) ? a.value.join(', ') : a.value) };
  const lines = [head.map(csvCell).join(';')].concat(all.map(l => [l.id, fmtDateTime(l.created_at)].concat(cols.map(c => plain(l, c)), [l.completed ? 'sim' : 'não', l.interacted ? 'sim' : 'não'], (m => [m.score == null ? '' : m.score, m.icp == null ? '' : m.icp ? 'sim' : 'não', m.tags.join(', '), abOf(l), l.phone || '', (l.crm && l.crm.stage) || ''])(leadInsight(l)), TRACK.map(t => (l.tracking || {})[t] || '')).map(csvCell).join(';')));
  download(`leads-${REC.slug}-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}
Object.assign(ACT, {
  lsub: t => { UI.leads.sub = t.dataset.v; renderLeads($('#ed-main')) },
  lperiod: t => { UI.leads.period = t.dataset.v; LEADS.cache = null; renderLeads($('#ed-main')) },
  lorder: t => { UI.leads.order = t.dataset.v; LEADS.cache = null; renderLeads($('#ed-main')) },
  lmetric: t => { UI.leads.metric = t.dataset.v; paintLeads(LEADS.cache) },
  lrefresh: () => { LEADS.cache = null; renderLeads($('#ed-main')) },
  lmore: async () => { const d = await loadLeads(true); paintLeads(d) },
  lexport: exportCsv,
  lreset: async () => { if (!(await confirmBox('Resetar os dados deste funil?', 'Todos os acessos e respostas serão apagados. Os leads que já foram para o CRM continuam lá. Não dá para desfazer.', 'Apagar tudo', true))) return; await DB.reset(REC.id, REC.slug); LEADS.cache = null; toast('Dados apagados'); renderLeads($('#ed-main')) },
  lead: t => leadDrawer(LEADS.cache.leads[+t.dataset.k]),
  'close-drawer': closeDrawer,
  lresend: async t => { const r = await DB.resend(REC.id, t.dataset.id); toast(r.ok ? 'Reenviado (HTTP ' + r.status + ')' : 'Falhou: ' + (r.error || 'HTTP ' + r.status), r.ok ? '' : 'err'); LEADS.cache = null },
  lsteps: t => { const r = t.getBoundingClientRect(); menu(r.left, r.bottom + 4, [{head: 'Mostrar etapas'}].concat(leadColumns().filter(g => g.cols.length).map(g => ({label: (UI.leads.hidden[g.step.id] ? '☐ ' : '☑ ') + (g.i + 1) + ' · ' + g.step.title, run: () => { UI.leads.hidden[g.step.id] = !UI.leads.hidden[g.step.id]; paintLeads(LEADS.cache); ACT.lsteps($('[data-a="lsteps"]')) }})))) },
  lcols: t => { const r = t.getBoundingClientRect(); menu(r.left, r.bottom + 4, [{label: (UI.leads.hideTracking ? '☐ ' : '☑ ') + 'Colunas de rastreamento (UTM, aparelho, IP)', run: () => { UI.leads.hideTracking = !UI.leads.hideTracking; paintLeads(LEADS.cache) }}]) },
});

/* ================= Configurações ================= */
const WH = {data: null, dirty: false, id: null};
const CFG_TABS = [['geral', 'Geral', IC.gear], ['dominio', 'Domínio', IC.globe], ['pixel', 'Pixel/Scripts', IC.code], ['seo', 'SEO & Favicon', IC.search], ['webhook', 'Webhooks', IC.hook], ['leads', 'Leads e dados', IC.sliders], ['integracoes', 'Integrações', IC.ext], ['filtro', 'Filtro de tráfego', IC.shield]];
const CRM_KEYS = [['nome', 'Nome da pessoa'], ['empresa', 'Empresa/loja'], ['telefone', 'Telefone/WhatsApp'], ['email', 'E-mail'], ['faturamento', 'Faturamento'], ['dor', 'Dor/problema'], ['estrutura', 'Estrutura/equipe'], ['instagram', 'Instagram'], ['observacoes', 'Observações'], ['responsavel', 'Responsável (SDR)']];
function renderConfig(main){
  if (WH.id !== REC.id) { WH.id = REC.id; WH.data = Object.assign({enabled: false, method: 'POST', contentType: 'JSON', trigger: 'component', mapping: []}, clone(REC.webhook || {})); WH.dirty = false }
  main.innerHTML = `<div class="cfg"><div class="cfg-box"><nav class="cfg-nav">${CFG_TABS.map(([k, l, ic]) => `<button data-a="cfgtab" data-v="${k}"${UI.cfg === k ? ' aria-current="page"' : ''}>${ic}${l}${k === 'webhook' && WH.data.enabled ? '<span class="dot" title="Ativado"></span>' : k === 'filtro' && (D.settings.filter || {}).enabled ? '<span class="dot" title="Ativado"></span>' : ''}</button>`).join('')}</nav><div class="cfg-body" id="col-props"></div></div></div>`;
  renderConfigBody();
}
function namedComponents(){ const out = []; D.steps.forEach((s, i) => s.layers.forEach(l => { if ((FR.INPUT_TYPES.includes(l.type) || l.type === 'button') && l.content.name) out.push({name: l.content.name, type: l.type, label: `${i + 1} · ${s.title} — ${l.type === 'button' ? 'Botão “' + (l.content.label || '') + '”' : l.type === 'options' ? 'Opções' : (l.content.title || 'Campo')}`}) })); return out }
function renderConfigBody(){
  const el = $('#col-props'); if (!el) return; wireProps();
  const S = k => 'F:settings.' + k;
  let h = '';
  switch (UI.cfg) {
    case 'geral': h = `<h2>Geral</h2>${P.text('R:title', 'Título')}<label class="f">Endereço (slug)<div class="row"><span class="hint" style="white-space:nowrap">${esc(publicUrl('').replace(/\?f=$/, '?f='))}</span><input class="in" data-p="R:slug" value="${attr(REC.slug)}"></div><span class="hint">Letras minúsculas, números e hífen. Mudar o endereço quebra os links antigos já divulgados.</span></label>
      <label class="f">Link público<div class="row"><input class="in" readonly value="${attr(publicUrl(REC.slug))}"><button class="btn" data-a="copy" data-v="${attr(publicUrl(REC.slug))}">${IC.copy}Copiar</button></div></label>
      ${P.area('F:description', 'Descrição interna (opcional)', {rows: 2})}
      <div class="row" style="flex-wrap:wrap;padding-top:6px;border-top:1px solid var(--line)"><button class="btn" data-a="cfg-export">${IC.download}Exportar funil (JSON)</button><button class="btn danger" data-a="cfg-delete">${IC.trash}Excluir funil</button></div>
      ${DB.server ? `<div class="psec"><span class="eyebrow">Código de acesso do editor</span><p class="hint">Vale para todos os funis e para toda a equipe. Use uma frase longa ou um gerador de senhas; quem estiver com o código antigo precisa entrar de novo.</p>
        <div class="g2"><label class="f">Novo código<input class="in" type="password" id="acc-new" autocomplete="new-password" placeholder="pelo menos 12 caracteres"></label><label class="f">Repita o novo código<input class="in" type="password" id="acc-new2" autocomplete="new-password"></label></div>
        <div class="row"><button class="btn" data-a="access-change">Trocar código</button></div></div>` : ''}`; break;
    case 'dominio': h = `<h2>Domínio</h2><p class="muted">O funil fica no ar no endereço abaixo, publicado pelo GitHub Pages junto com a Central Comercial.</p><pre class="code">${esc(publicUrl(REC.slug))}</pre>
      <div class="banner" style="display:grid;gap:6px"><b>Para usar um domínio próprio (ex.: diagnostico.brase.com.br)</b><span>1. No GitHub, em Settings › Pages, informe o domínio em “Custom domain”.</span><span>2. No provedor do domínio, crie um registro CNAME apontando para <code>renandias-dot.github.io</code>.</span><span>3. Em <code>funis/index.html</code>, preencha <code>"public"</code> na linha <code>window.FN_HOST</code> com <code>https://seu-dominio/funis/f/</code> para os links do editor usarem o domínio novo.</span></div>
      <p class="hint">Os parâmetros do anúncio vão no fim do link (…&amp;utm_source=FB&amp;utm_campaign=…). Para abrir direto numa etapa, use <code>&amp;step=</code> com o ID da etapa (como no InLead) ou <code>&amp;etapa=3</code> (número da etapa).</p>`; break;
    case 'pixel': h = `<h2>Pixel/Scripts</h2><div class="banner">Códigos que rodam quando a página do funil abre. Para eventos em momentos específicos, use “Evento do Pixel” ou “Script” na aba Avançado de botões e opções.</div>
      ${P.text(S('pixel.facebook'), 'Facebook Pixel ID', {ph: '1234567890', hint: 'Dispara PageView ao abrir. Vários pixels: separe por vírgula.'})}${P.text(S('pixel.ga4'), 'Google Analytics ID', {ph: 'G-XXXXXXXXXX'})}${P.text(S('pixel.gtm'), 'Google Tag Manager ID', {ph: 'GTM-XXXXXX'})}${P.text(S('pixel.gsv'), 'Google Site Verification', {ph: 'XXXXXXXXXXXX'})}
      ${P.area(S('scripts.head'), 'Head', {rows: 6, code: true, ph: 'Digite seu script…'})}${P.area(S('scripts.body'), 'Body', {rows: 6, code: true, ph: 'Digite seu script…'})}<p class="hint">Publique o funil para as mudanças valerem na página.</p>${metaHtml()}`; break;
    case 'leads': h = leadsDataHtml(); break;
    case 'integracoes': h = intHtml(); break;
    case 'seo': h = `<h2>SEO & Favicon</h2>${P.text(S('seo.title'), 'Título da página', {ph: REC.title})}${P.area(S('seo.description'), 'Descrição', {rows: 3})}${P.media(S('seo.image'), 'Imagem de compartilhamento', 'image/*')}${P.media(S('seo.favicon'), 'Favicon', 'image/*')}${P.tog(S('seo.noindex'), 'Não aparecer no Google (noindex)')}`; break;
    case 'webhook': h = webhookHtml(); break;
    case 'filtro': h = `<h2>Filtro de tráfego</h2>${P.tog(S('filter.enabled'), 'Ativar regras de filtro')}<p class="hint">O funil só abre para quem estiver dentro das regras abaixo.</p>
      ${P.tog(S('filter.mobileOnly'), 'Só celular (bloqueia computador)')}${P.tog(S('filter.blockBots'), 'Bloquear robôs e ferramentas de teste')}${P.text(S('filter.requireParams'), 'Exigir um destes parâmetros no link', {ph: 'fbclid, utm_source', hint: 'Ex.: “fbclid” deixa entrar só quem veio de anúncio da Meta.'})}${P.text(S('filter.redirect'), 'Quem não passar vai para (opcional)', {ph: 'https://…'})}`; break;
  }
  el.innerHTML = h;
  if (UI.cfg === 'webhook') paintWebhookState();
}
function webhookHtml(){
  const w = WH.data, comps = namedComponents(), W = k => 'W:' + k;
  const compSel = (p, v, filter) => `<select class="in" data-p="${p}"><option value="">—</option>${comps.filter(filter || (() => true)).map(c => `<option value="${attr(c.name)}"${c.name === v ? ' selected' : ''}>${esc(c.name)} · ${esc(c.label)}</option>`).join('')}${v && !comps.some(c => c.name === v) ? `<option value="${attr(v)}" selected>${esc(v)} (não existe mais)</option>` : ''}</select>`;
  const tokenMasked = w.tokenSet && !w.token;
  return `<div class="row" style="justify-content:space-between;align-items:flex-start;gap:16px"><div><h2>Webhooks</h2><p class="hint" style="margin-top:4px">Envia cada lead em tempo real para outra ferramenta (o CRM da Central Comercial, NicoChat, planilha…).</p></div>${P.tog(W('enabled'), 'Webhook ativado')}</div>
    ${DB.server ? '' : '<div class="banner warn">O envio é feito pelo servidor. No modo local dá para preparar a configuração, mas nada é enviado.</div>'}
    ${P.text(W('url'), 'API URL', {ph: 'https://…'})}
    <label class="f">TOKEN<input class="in" type="password" data-p="W:token" value="${attr(w.token || '')}" placeholder="${tokenMasked ? '•••••••• (guardado no servidor; deixe vazio para manter)' : 'Opcional'}" autocomplete="off"><span class="hint">Vai nos cabeçalhos <code>Authorization: Bearer …</code> e <code>Api-Token</code>, como no InLead. Fica só no servidor: nunca aparece na página do funil.</span></label>
    <div class="g2">${P.sel(W('method'), 'Método', [['POST', 'POST'], ['PUT', 'PUT'], ['PATCH', 'PATCH']])}${P.sel(W('contentType'), 'Content-Type', [['JSON', 'JSON'], ['FORM', 'Formulário (x-www-form-urlencoded)']])}</div>
    <div class="g2" style="align-items:start">${P.sel(W('trigger'), 'Gatilho de envio', [['component', 'Clique em componente'], ['complete', 'Ao completar o funil'], ['lead', 'Ao preencher um telefone ou e-mail']], {hint: ''})}${w.trigger === 'component' ? P.text(W('component'), 'ID/Name do componente', {list: 'wh-comps', ph: 'VT19S2', hint: 'Vários: separe por vírgula. Como no InLead, sai quando a pessoa avança depois de clicar num deles (botão ou opção).'}) + `<datalist id="wh-comps">${comps.map(c => `<option value="${attr(c.name)}">${esc(c.label)}</option>`).join('')}</datalist>` : '<span></span>'}</div>
    <div class="psec"><span class="eyebrow">Campos para o CRM</span><p class="hint">Além de todas as respostas (com a chave = ID/Name de cada componente), o envio leva estes campos com os nomes que o CRM da Central entende.</p>
      ${(w.mapping || []).map((m, i) => `<div class="g3" style="grid-template-columns:1fr 1.6fr 110px auto;align-items:end"><label class="f">Campo<input class="in" data-p="W:mapping.${i}.key" value="${attr(m.key || '')}" list="crm-keys"></label><label class="f">Componente${compSel('W:mapping.' + i + '.name', m.name, c => c.type !== 'button')}</label><label class="f">Enviar<select class="in" data-p="W:mapping.${i}.mode"><option value="label"${m.mode !== 'value' ? ' selected' : ''}>Texto</option><option value="value"${m.mode === 'value' ? ' selected' : ''}>Valor</option></select></label><button class="btn icon ghost" data-a="wh-map-del" data-i="${i}" aria-label="Remover">${IC.trash}</button></div>`).join('')}
      <datalist id="crm-keys">${CRM_KEYS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</datalist>
      <button class="btn sm" data-a="wh-map-add" style="justify-self:start">${IC.plus}Adicionar campo</button></div>
    <div class="psec"><span class="eyebrow">Exemplo de dados</span><pre class="code">${esc(JSON.stringify(sampleWebhook(w), null, 2))}</pre>
      <table class="tbl" style="width:100%"><tbody><tr><td><code>code</code></td><td style="white-space:normal">Código único de cada visitante (o mesmo da aba Leads).</td></tr><tr><td>variáveis</td><td style="white-space:normal">Como no InLead: uma chave por componente (ID/Name) com o valor da resposta (múltipla escolha com <code>|</code>), <code>score.</code> e <code>responses.</code> de cada pergunta, <code>clicked</code> nos botões clicados e <code>tracking.</code> com os parâmetros da URL.</td></tr><tr><td>parâmetros</td><td style="white-space:normal">Todos os parâmetros do link do funil (utm, fbclid…), com o nome original.</td></tr><tr><td>extras</td><td style="white-space:normal">Os campos do CRM acima, <code>funil</code>, <code>data</code> e <code>pagina</code> (só deste app).</td></tr></tbody></table></div>
    <div class="row" style="flex-wrap:wrap;position:sticky;bottom:0;background:var(--surface);padding:10px 0;border-top:1px solid var(--line)"><span id="wh-state" class="hint"></span><span style="flex:1"></span><button class="btn" data-a="wh-test">Testar envio</button><button class="btn primary" data-a="wh-save">Salvar webhook</button></div>`;
}
// Exemplo no mesmo formato do servidor (veja buildPayload em funis-api/logic.ts): {...variáveis, ...parâmetros, code} + extras.
function sampleWebhook(w){
  const params = {utm_source: 'FB', utm_campaign: 'Campanha|120200000000000000', utm_content: 'Anúncio|120200000000000002', fbclid: 'IwAR…'};
  const out = {}, labels = {};
  for (const k in params) out['tracking.' + k] = params[k];
  out['tracking.screen'] = '390x844';
  let total = 0;
  D.steps.forEach(s => s.layers.forEach(l => {
    const n = l.content && l.content.name; if (!n) return;
    if (l.type === 'options') { const o = (l.content.options || [])[0]; if (!o) return; out[n] = String(o.value ?? FR.plainLabel(o.label)); labels[n] = FR.plainLabel(o.label); out['score.' + n] = +o.score || 0; total += +o.score || 0; out['responses.' + n] = (l.content.options || []).map((x, k) => k ? '*' : String(x.value ?? '')).join('|') }
    else if (l.type === 'field') out[n] = {phone: '(21) 90000-0000', email: 'joao@exemplo.com'}[l.content.type] || 'João da Silva';
    else if (FR.INPUT_TYPES.includes(l.type)) out[n] = l.type === 'date' ? '2026-10-14' : String(l.content.value ?? '');
    else if (l.type === 'button' && String(w.component || '').split(',').map(x => x.trim()).includes(n)) out[n] = 'clicked';
  }));
  out.score = total;
  Object.assign(out, params, {code: 'gh4T3d'});
  (w.mapping || []).forEach(m => { if (!m.key || out[m.name] == null) return; out[m.key] = m.mode === 'value' || !(m.name in labels) ? out[m.name] : labels[m.name] });
  Object.assign(out, {funil: REC.slug, data: new Date().toISOString()});
  return out;
}
function findByName(n){ for (const s of D.steps) for (const l of s.layers) if (l.content && l.content.name === n) return l; return null }
function paintWebhookState(){ const el = $('#wh-state'); if (el) el.textContent = WH.dirty ? 'Alterações não salvas' : (REC.webhook && REC.webhook.updated_at ? 'Salvo ' + fmtDateTime(REC.webhook.updated_at) : '') }
Object.assign(ACT, {
  cfgtab: t => { UI.cfg = t.dataset.v; renderConfig($('#ed-main')) },
  'cfg-export': () => download(REC.slug + '.json', JSON.stringify(exportRecord(Object.assign({}, REC, {draft: D})), null, 1) + '\n'),
  'cfg-delete': async () => { if (!(await confirmBox('Excluir “' + REC.title + '”?', 'O funil e todos os leads dele serão apagados. Não dá para desfazer.', 'Excluir', true))) return; await DB.remove(REC.id, REC.slug); SAVE.dirty = false; toast('Funil excluído'); location.hash = '#/' },
  'wh-map-add': () => { WH.data.mapping = WH.data.mapping || []; WH.data.mapping.push({key: '', name: '', mode: 'label'}); WH.dirty = true; renderConfigBody() },
  'wh-map-del': t => { WH.data.mapping.splice(+t.dataset.i, 1); WH.dirty = true; renderConfigBody() },
  'wh-save': async () => { const saved = await DB.saveWebhook(REC.id, WH.data); REC.webhook = clone(saved || WH.data); WH.data = Object.assign({}, WH.data, saved || {}); if (saved && saved.tokenSet) WH.data.token = ''; WH.dirty = false; toast('Webhook salvo'); renderConfig($('#ed-main')) },
  'wh-test': async () => { if (WH.dirty) await ACT['wh-save'](); const r = await DB.testWebhook(REC.id); modal(`<h2>Teste do webhook</h2><p class="${r.ok ? '' : 'muted'}">${r.ok ? '✅ O destino respondeu' : '⚠️ O destino respondeu com erro'}: HTTP ${esc(String(r.status || '—'))}${r.error ? ' · ' + esc(r.error) : ''}</p><div class="f">Enviado<pre class="code">${esc(JSON.stringify(r.sent || {}, null, 2))}</pre></div><div class="f">Resposta<pre class="code">${esc(String(r.body || '').slice(0, 2000))}</pre></div><div class="actions"><button class="btn primary" data-a="close-modal">Fechar</button></div>`) },
});
