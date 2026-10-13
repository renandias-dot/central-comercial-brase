/* Funis Brase — editor: Fluxo (mapa das etapas e das ligações entre elas). */
'use strict';
const NODE_W = 230;

function renderFlow(main){
  if (!UI.flow) UI.flow = {x: 40, y: 70, z: 0.8, sel: null};
  const needLayout = D.steps.length > 1 && D.steps.every(s => !s.position || (s.position.x === 0 && s.position.y === 0));
  main.innerHTML = `<div class="flow" id="flow"><div class="flow-world" id="flow-world"><svg class="edges" id="flow-edges" width="1" height="1"></svg>${D.steps.map((s, i) => nodeHtml(s, i)).join('')}</div>
    <div class="flow-tools"><button class="btn" data-a="flow-auto">${IC.layout}Auto-organizar</button><button class="btn" data-a="flow-fit">Ver tudo</button><button class="btn" data-a="add-step-flow">${IC.plus}Etapa</button></div>
    <div class="flow-zoom"><button class="btn icon" data-a="flow-zoom" data-v="1.2" aria-label="Aproximar">${IC.plus}</button><button class="btn icon" data-a="flow-zoom" data-v="0.83" aria-label="Afastar">${I('<path d="M5 12h14"/>')}</button></div>
    <div class="flow-tip banner"><span>Arraste a bolinha <b style="color:var(--sel)">●</b> de uma opção ou botão até outra etapa para mudar o destino (ou clique nela). Dois cliques numa etapa abrem no Construtor.</span></div></div>`;
  applyView();
  if (needLayout) autoLayout(); else drawEdges();
  wireFlow();
  if (!UI.flow.fitted) { UI.flow.fitted = true; fitView(true) }
}
function nodeHtml(s, i){
  const p = s.position || {x: i * 300, y: 0};
  const rows = s.layers.map(l => {
    const t = esc(l.title || FR.TYPE_TITLE[l.type] || l.type);
    if (l.type === 'options') return (l.content.options || []).map(o => outRow(i, l, o, FR.stripHtml(o.label) || o.value || 'Opção')).join('') || `<div class="node-l"><span class="lb">${t}</span></div>`;
    if (l.type === 'button') return outRow(i, l, l.content, l.content.label || 'Botão', IC.button);
    if (l.type === 'loading') return outRow(i, l, l.content, 'Loading · ao terminar', IC.loader);
    return `<div class="node-l"><span style="color:var(--muted);display:flex">${IC[iconOf(l)] || ''}</span><span class="lb">${t}</span>${l.roles && l.roles.some(g => g.length) ? '<span class="hint" title="Aparece só com condição">◇</span>' : ''}</div>`;
  }).join('');
  return `<div class="node${UI.flow.sel === s.id ? ' on' : ''}" data-node="${attr(s.id)}" data-i="${i}" style="left:${p.x}px;top:${p.y}px"><span class="in-h"></span>
    <div class="node-h" data-drag="${i}"><span class="n">${i + 1}</span><span class="t" title="${attr(s.title)}">${esc(s.title)}</span></div><div class="node-b">${rows || '<div class="node-l"><span class="lb hint">Etapa vazia</span></div>'}</div></div>`;
}
function outRow(i, l, item, label, icon){
  const dest = FR.destinationOf(D, item), url = FR.isUrl(dest) || (dest !== 'next' && dest !== 'back' && !D.steps.some(s => s.id === dest));
  return `<div class="node-l out" data-out="${i}|${attr(l.id)}|${attr(item.id || '')}">${icon ? `<span style="display:flex;color:var(--sel)">${icon}</span>` : ''}<span class="lb" title="${attr(label)}">${esc(label)}</span>${url ? `<span class="ext" title="${attr(dest)}">↗ link</span>` : ''}<span class="h" data-handle="${i}|${attr(l.id)}|${attr(item.id || '')}"></span></div>`;
}
function applyView(){ const w = $('#flow-world'); if (w) w.style.transform = `translate(${UI.flow.x}px,${UI.flow.y}px) scale(${UI.flow.z})` }
function findItem(key){
  const [i, lid, iid] = key.split('|'); const s = D.steps[+i]; if (!s) return null;
  const l = s.layers.find(x => x.id === lid); if (!l) return null;
  if (l.type === 'options') return {step: s, layer: l, item: (l.content.options || []).find(o => o.id === iid)};
  return {step: s, layer: l, item: l.content};
}
// Desenha as ligações (curvas) entre as saídas e as etapas de destino.
function drawEdges(hl){
  const world = $('#flow-world'), svg = $('#flow-edges'); if (!world || !svg) return;
  const z = UI.flow.z, wr = world.getBoundingClientRect();
  const pos = el => { const r = el.getBoundingClientRect(); return {x: (r.left - wr.left) / z, y: (r.top - wr.top) / z, w: r.width / z, h: r.height / z} };
  const nodes = {}; $$('.node', world).forEach(n => { nodes[n.dataset.node] = pos(n) });
  let maxX = 0, maxY = 0, paths = '';
  $$('[data-out]', world).forEach(row => {
    const it = findItem(row.dataset.out); if (!it || !it.item) return;
    const i = D.steps.indexOf(it.step), dest = FR.destinationOf(D, it.item);
    const to = FR.resolveDestination(D, i, dest); if (to.step == null) return;
    const target = D.steps[to.step], tp = nodes[target.id]; if (!tp) return;
    const rp = pos(row), x1 = rp.x + rp.w + 6, y1 = rp.y + rp.h / 2, x2 = tp.x - 2, y2 = tp.y + 22;
    const dx = Math.max(24, Math.min(160, Math.abs(x2 - x1) * 0.5));
    const back = x2 < x1;
    const d = back ? `M${x1},${y1} C${x1 + 80},${y1} ${x1 + 80},${Math.max(y1, y2) + 80} ${(x1 + x2) / 2},${Math.max(y1, y2) + 80} S${x2 - 80},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    const isNext = dest === 'next';
    const on = hl && (hl === it.step.id || hl === target.id);
    paths += `<path d="${d}" class="${isNext ? 'next' : ''}${on ? ' hl' : ''}" marker-end="url(#fa${on ? 'h' : ''})"/>`;
    maxX = Math.max(maxX, x1, x2); maxY = Math.max(maxY, y1, y2);
  });
  Object.values(nodes).forEach(n => { maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h) });
  svg.setAttribute('width', maxX + 200); svg.setAttribute('height', maxY + 200);
  svg.innerHTML = `<defs><marker id="fa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)"/></marker><marker id="fah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--sel)"/></marker></defs>${paths}<path id="flow-tmp" class="tmp" d=""/>`;
}
// Organiza em colunas pela distância a partir da primeira etapa.
function autoLayout(){
  const n = D.steps.length, depth = new Array(n).fill(-1); depth[0] = 0;
  const q = [0];
  while (q.length) {
    const i = q.shift();
    for (const o of FR.outlets(D, D.steps[i])) { const to = FR.resolveDestination(D, i, o.dest); if (to.step != null && depth[to.step] < 0) { depth[to.step] = depth[i] + 1; q.push(to.step) } }
  }
  let maxD = Math.max(0, ...depth);
  depth.forEach((d, i) => { if (d < 0) depth[i] = ++maxD });
  const heights = {}; $$('#flow-world .node').forEach(el => { heights[el.dataset.node] = el.offsetHeight || 120 });
  const colY = {};
  const pos = D.steps.map((s, i) => { const c = depth[i]; const y = colY[c] || 0; colY[c] = y + (heights[s.id] || 120) + 40; return {x: c * (NODE_W + 90), y} });
  mutate(d => d.steps.forEach((s, i) => { s.position = pos[i] }), {canvas: false});
  $$('#flow-world .node').forEach(el => { const p = pos[+el.dataset.i]; el.style.left = p.x + 'px'; el.style.top = p.y + 'px' });
  drawEdges(UI.flow.sel);
}
// Enquadra todas as etapas. Na primeira abertura, se ficar pequeno demais para ler, começa pela primeira etapa.
function fitView(first){
  const flow = $('#flow'); if (!flow || !D.steps.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  $$('#flow-world .node').forEach(el => { const x = parseFloat(el.style.left), y = parseFloat(el.style.top); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + NODE_W); y1 = Math.max(y1, y + el.offsetHeight) });
  const W = flow.clientWidth, H = flow.clientHeight - 60;
  const z = Math.max(0.25, Math.min(1.1, Math.min((W - 80) / (x1 - x0 || 1), (H - 60) / (y1 - y0 || 1))));
  UI.flow.z = z; UI.flow.x = (W - (x1 - x0) * z) / 2 - x0 * z; UI.flow.y = 60 + (H - (y1 - y0) * z) / 2 - y0 * z;
  if (first && z < 0.55) { const p = D.steps[0].position || {x: 0, y: 0}; UI.flow.z = 0.7; UI.flow.x = 40 - p.x * 0.7; UI.flow.y = Math.max(80, H / 2 - 120) - p.y * 0.7 }
  applyView(); drawEdges(UI.flow.sel);
}
function zoomAt(f, cx, cy){
  const z0 = UI.flow.z, z = Math.max(0.2, Math.min(2, z0 * f));
  UI.flow.x = cx - (cx - UI.flow.x) * (z / z0); UI.flow.y = cy - (cy - UI.flow.y) * (z / z0); UI.flow.z = z;
  applyView(); drawEdges(UI.flow.sel);
}
function setDestination(key, dest){
  const it = findItem(key); if (!it) return;
  mutate(() => { it.item.destination = dest; if (it.layer.type === 'button') it.item.type = FR.isUrl(dest) ? 'redirect' : 'next' }, {canvas: false});
  renderFlow($('#ed-main'));
}
function destMenu(x, y, key){
  const it = findItem(key); if (!it) return;
  const cur = FR.destinationOf(D, it.item);
  menu(x, y, [{head: 'Leva para'}, {label: (cur === 'next' ? '✓ ' : '') + 'Próxima etapa', run: () => setDestination(key, 'next')},
    ...D.steps.map((s, i) => ({label: (cur === s.id ? '✓ ' : '') + `${i + 1} · ${s.title}`, run: () => setDestination(key, s.id)})),
    '-', {label: (FR.isUrl(cur) ? '✓ ' : '') + 'Link externo…', run: () => { const u = prompt('Endereço (https://…)', FR.isUrl(cur) ? cur : 'https://'); if (u && u.trim()) setDestination(key, u.trim()) }}]);
}
function wireFlow(){
  const flow = $('#flow'); if (!flow) return;
  let mode = null, start = null, moved = false;
  flow.addEventListener('wheel', e => { e.preventDefault(); const r = flow.getBoundingClientRect(); if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) zoomAt(e.deltaY < 0 ? 1.1 : 0.91, e.clientX - r.left, e.clientY - r.top); else { UI.flow.x -= e.deltaX; UI.flow.y -= e.deltaY; applyView() } }, {passive: false});
  flow.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.flow-tools,.flow-zoom,.flow-tip')) return;
    const h = e.target.closest('[data-handle]'), head = e.target.closest('[data-drag]'), node = e.target.closest('.node');
    moved = false;
    if (h) { mode = 'link'; start = {key: h.dataset.handle, x: e.clientX, y: e.clientY}; flow.setPointerCapture(e.pointerId); e.preventDefault(); return }
    if (head) { const el = head.closest('.node'); mode = 'node'; start = {el, i: +el.dataset.i, x: e.clientX, y: e.clientY, l: parseFloat(el.style.left), t: parseFloat(el.style.top)}; flow.setPointerCapture(e.pointerId); return }
    if (node) { selectNode(node.dataset.node); return }
    mode = 'pan'; start = {x: e.clientX, y: e.clientY, vx: UI.flow.x, vy: UI.flow.y}; flow.classList.add('panning'); flow.setPointerCapture(e.pointerId);
    selectNode(null);
  });
  flow.addEventListener('pointermove', e => {
    if (!mode) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if (mode === 'pan') { UI.flow.x = start.vx + dx; UI.flow.y = start.vy + dy; applyView() }
    else if (mode === 'node') { start.el.style.left = (start.l + dx / UI.flow.z) + 'px'; start.el.style.top = (start.t + dy / UI.flow.z) + 'px'; drawEdges(UI.flow.sel) }
    else if (mode === 'link' && moved) {
      const wr = $('#flow-world').getBoundingClientRect(), z = UI.flow.z, hEl = $(`[data-handle="${CSS.escape(start.key)}"]`).getBoundingClientRect();
      const x1 = (hEl.left + hEl.width / 2 - wr.left) / z, y1 = (hEl.top + hEl.height / 2 - wr.top) / z, x2 = (e.clientX - wr.left) / z, y2 = (e.clientY - wr.top) / z;
      const tmp = $('#flow-tmp'); if (tmp) tmp.setAttribute('d', `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`);
      $$('.node.drop').forEach(n => n.classList.remove('drop'));
      const over = document.elementFromPoint(e.clientX, e.clientY); const n = over && over.closest('.node'); if (n) n.classList.add('drop');
    }
  });
  const end = e => {
    if (!mode) return;
    const m = mode; mode = null; flow.classList.remove('panning');
    if (m === 'node') {
      if (moved) { const el = start.el, i = start.i, x = Math.round(parseFloat(el.style.left)), y = Math.round(parseFloat(el.style.top)); mutate(d => { d.steps[i].position = {x, y} }, {canvas: false}) }
      else selectNode(start.el.dataset.node);
    } else if (m === 'link') {
      $$('.node.drop').forEach(n => n.classList.remove('drop'));
      const tmp = $('#flow-tmp'); if (tmp) tmp.setAttribute('d', '');
      if (!moved) { destMenu(e.clientX, e.clientY, start.key); return }
      const over = document.elementFromPoint(e.clientX, e.clientY); const n = over && over.closest('.node');
      if (n) setDestination(start.key, n.dataset.node); else destMenu(e.clientX, e.clientY, start.key);
    }
  };
  flow.addEventListener('pointerup', end); flow.addEventListener('pointercancel', end);
  flow.addEventListener('dblclick', e => { const n = e.target.closest('.node'); if (!n) return; UI.step = +n.dataset.i; UI.sel = null; go('construtor') });
}
function selectNode(id){ UI.flow.sel = id; $$('#flow-world .node').forEach(n => n.classList.toggle('on', n.dataset.node === id)); drawEdges(id) }
Object.assign(ACT, {
  'flow-auto': () => autoLayout(),
  'flow-fit': () => fitView(),
  'flow-zoom': t => { const f = $('#flow'); zoomAt(+t.dataset.v, f.clientWidth / 2, f.clientHeight / 2) },
  'add-step-flow': t => { const r = t.getBoundingClientRect(); menu(r.left, r.bottom + 4, [{head: 'Modelos'}].concat(FR.STEP_TEMPLATES.map(([k, l]) => ({label: l, run: () => { const s = FR.stepTemplate(k); const last = D.steps[D.steps.length - 1]; s.position = last ? {x: (last.position || {x: 0}).x + NODE_W + 90, y: (last.position || {y: 0}).y} : {x: 0, y: 0}; mutate(d => d.steps.push(s), {canvas: false}); renderFlow($('#ed-main')) }})))) },
});
addEventListener('resize', debounce(() => { if (UI.tab === 'fluxo') drawEdges(UI.flow && UI.flow.sel) }, 150));
