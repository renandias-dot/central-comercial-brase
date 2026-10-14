/* Funis Brase — editor: Construtor (etapas, componentes, celular e propriedades). */
'use strict';
let CANVAS = null; // controle do runtime no celular do Construtor

/* ================= caminhos (data-p="L:content.label") ================= */
function getPath(o, path){ return path.split('.').reduce((a, k) => a == null ? a : a[k], o) }
function setPath(o, path, v){
  const ks = path.split('.'); let a = o;
  for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (a[k] == null || typeof a[k] !== 'object') a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k] }
  a[ks[ks.length - 1]] = v;
}
function scopeObj(scope){
  if (scope === 'L') return layer();
  if (scope === 'S') return step();
  if (scope === 'F') return D;
  if (scope === 'R') return REC;
  if (scope === 'W') return WH.data;
  return null;
}

/* ================= campos do painel ================= */
const P = {
  text: (p, label, o = {}) => { let v = val(p) ?? ''; if (o.t === 'list' && Array.isArray(v)) v = v.join('|'); return `<label class="f">${esc(label)}<input class="in" data-p="${p}" value="${attr(v)}" placeholder="${attr(o.ph || '')}"${o.list ? ` list="${o.list}"` : ''}${o.t ? ` data-t="${o.t}"` : ''}${o.re ? ' data-re="1"' : ''}>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</label>` },
  dt: (p, label) => `<label class="f">${esc(label)}<input class="in" type="datetime-local" data-p="${p}" value="${attr(val(p) ?? '')}"></label>`,
  area: (p, label, o = {}) => `<label class="f">${esc(label)}<textarea class="in${o.code ? ' code' : ''}" rows="${o.rows || 3}" data-p="${p}" placeholder="${attr(o.ph || '')}">${esc(val(p) ?? '')}</textarea>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</label>`,
  num: (p, label, o = {}) => `<label class="f">${esc(label)}<input class="in" type="number" data-p="${p}" data-t="num" value="${attr(val(p) ?? '')}" ${o.min != null ? `min="${o.min}"` : ''} ${o.max != null ? `max="${o.max}"` : ''} step="${o.step || 'any'}">${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</label>`,
  range: (p, label, min, max, stp, o = {}) => { const v = val(p) ?? o.def ?? min; return `<label class="f"><span class="row" style="justify-content:space-between">${esc(label)}<b data-out="${p}" style="color:var(--ink)">${esc(String(v))}${o.unit || ''}</b></span><input type="range" data-p="${p}" data-t="num" min="${min}" max="${max}" step="${stp}" value="${attr(v)}" data-unit="${attr(o.unit || '')}"></label>` },
  sel: (p, label, opts, o = {}) => { const v = val(p) ?? o.def; return `<label class="f">${esc(label)}<select class="in" data-p="${p}"${o.t ? ` data-t="${o.t}"` : ''}>${opts.map(([k, l]) => `<option value="${attr(k)}"${String(v) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</label>` },
  tog: (p, label, o = {}) => { const v = val(p); const on = o.invert ? v === false : (o.defOn ? v !== false : !!v); return `<label class="switch"><input type="checkbox" data-p="${p}" data-t="bool"${o.invert ? ' data-inv="1"' : ''}${on ? ' checked' : ''}> ${esc(label)}</label>` },
  color: (p, label, def) => { const v = val(p) || def || '#000000'; return `<div class="kv"><span>${esc(label)}</span><div class="colorin"><input type="color" data-p="${p}" value="${attr(toHex(v))}"><input type="text" data-p="${p}" value="${attr(v)}" spellcheck="false"></div></div>` },
  seg: (p, label, opts, def, re) => { const v = val(p) ?? def; return `<div class="f">${esc(label)}<div class="seg full" data-segp="${p}"${re ? ' data-re="1"' : ''}>${opts.map(([k, l]) => `<button type="button" data-v="${attr(k)}" aria-pressed="${String(v) === String(k)}">${esc(l)}</button>`).join('')}</div></div>` },
  media: (p, label, accept, o = {}) => { const v = val(p) || ''; return `<div class="f">${esc(label)}${o.preview !== false && v && accept.startsWith('image') ? `<img src="${attr(v)}" alt="" style="max-height:90px;max-width:100%;object-fit:contain;border-radius:6px;background:var(--sunken);justify-self:start">` : ''}<div class="row"><input class="in" data-p="${p}" value="${attr(v)}" placeholder="https://… ou envie um arquivo"><label class="btn icon" title="Enviar arquivo">${IC.upload}<input type="file" hidden accept="${attr(accept)}" data-upload="${p}"></label>${v ? `<button class="btn icon ghost" type="button" data-clear="${p}" title="Remover">${IC.x}</button>` : ''}</div>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</div>` },
  rich: (p, label, o = {}) => `<div class="f">${esc(label)}<div class="rich-wrap">${richBar(o.small)}<div class="rich${o.small ? ' sm' : ''}" contenteditable="true" data-rich="${p}">${String(val(p) || '').replace(/&nbsp;/g, ' ')}</div></div>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</div>`,
  dest: (p, label) => {
    const v = val(p) || 'next', url = FR.isUrl(v) || (!D.steps.some(s => s.id === v) && v !== 'next' && v !== 'back');
    return `<div class="f">${esc(label)}<select class="in" data-dest="${p}"><option value="next"${v === 'next' ? ' selected' : ''}>➜ Próxima etapa</option>${D.steps.map((s, i) => `<option value="${attr(s.id)}"${v === s.id ? ' selected' : ''}>${i + 1} · ${esc(s.title)}</option>`).join('')}<option value="back"${v === 'back' ? ' selected' : ''}>← Etapa anterior</option><option value="__url"${url ? ' selected' : ''}>🔗 Link externo (URL)</option></select>${url ? `<input class="in" data-p="${p}" value="${attr(url ? v : '')}" placeholder="https://wa.me/55…">` : ''}</div>`;
  },
};
function val(p){ const [scope, path] = p.split(':'); const o = scopeObj(scope); return o ? getPath(o, path) : undefined }
function toHex(c){ c = String(c || ''); if (/^#[0-9a-f]{6}$/i.test(c)) return c; if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join(''); const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); if (m) return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join(''); return '#000000' }
const SWATCH = ['#f59e0b', '#ffffff', '#f8fafc', '#a21caf', '#22c55e', '#dc2626', '#3b82f6', '#111827'];
function richBar(small){
  const b = (cmd, label, title, arg) => `<button type="button" data-rcmd="${cmd}"${arg ? ` data-rarg="${attr(arg)}"` : ''} title="${attr(title)}">${label}</button>`;
  return `<div class="rich-bar">${small ? '' : b('formatBlock', 'H1', 'Título grande', 'h1') + b('formatBlock', 'H2', 'Título médio', 'h2') + b('formatBlock', 'H3', 'Subtítulo', 'h3') + b('formatBlock', '¶', 'Parágrafo', 'p')}${b('bold', '<b>B</b>', 'Negrito')}${b('italic', '<i>I</i>', 'Itálico')}${b('underline', '<u>U</u>', 'Sublinhado')}${b('strikeThrough', '<s>S</s>', 'Riscado')}${small ? '' : b('justifyLeft', '⇤', 'Alinhar à esquerda') + b('justifyCenter', '≡', 'Centralizar') + b('justifyRight', '⇥', 'Alinhar à direita')}${SWATCH.map(c => `<button type="button" class="sw" data-rcmd="foreColor" data-rarg="${c}" title="Cor ${c}" style="background:${c}"></button>`).join('')}<button type="button" data-rcmd="colorPick" title="Outra cor">🎨</button>${b('createLink', '🔗', 'Link')}${b('removeFormat', '⌫', 'Limpar formatação')}</div>`;
}

/* ================= coluna das etapas ================= */
function renderBuilder(main){
  main.innerHTML = `<div class="bld"><aside class="col" id="col-steps"></aside><aside class="col" id="col-pal"></aside>
    <section class="canvas" id="canvas"><div class="phone${UI.device === 'desktop' ? ' desktop' : ''}"><div class="screen" id="screen"></div></div>
      <div class="canvas-bar"><button class="btn icon ghost" data-a="undo" title="Desfazer (Ctrl+Z)">${IC.undo}</button><button class="btn icon ghost" data-a="redo" title="Refazer (Ctrl+Shift+Z)">${IC.redo}</button><span class="sep"></span>
      <button class="btn icon ghost${UI.device === 'mobile' ? ' on' : ''}" data-a="device" data-v="mobile" title="Celular">${IC.mobile}</button><button class="btn icon ghost${UI.device === 'desktop' ? ' on' : ''}" data-a="device" data-v="desktop" title="Computador">${IC.desktop}</button><span class="sep"></span>
      <button class="btn sm ghost" data-a="preview-here" title="Testar a partir desta etapa">${IC.play}Testar daqui</button></div></section>
    <aside class="col props" id="col-props"></aside></div>`;
  renderStepsCol(); renderPalette(); refreshCanvas(true); renderProps();
}
function renderStepsCol(){
  const el = $('#col-steps'); if (!el) return;
  el.innerHTML = `<div class="col-h"><span class="eyebrow">Etapas · ${D.steps.length}</span><button class="btn sm" data-a="add-step" title="Nova etapa">${IC.plus}Etapa</button></div>
    <div class="steps-list">${D.steps.map((s, i) => `<div class="step-it${i === UI.step ? ' on' : ''}" data-a="pick-step" data-i="${i}" draggable="true" data-si="${i}"><span class="n">${i + 1}</span><span class="nm" title="${attr(s.title)}">${esc(s.title)}</span><button class="mn" data-a="step-menu" data-i="${i}" aria-label="Ações da etapa">${IC.dots}</button></div>`).join('')}</div>`;
  // arrastar para reordenar
  let from = null;
  $$('.step-it', el).forEach(it => {
    it.addEventListener('dragstart', e => { from = +it.dataset.si; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/fn-step', String(from)) });
    it.addEventListener('dragover', e => { if (from == null) return; e.preventDefault(); const r = it.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2; it.classList.toggle('drop-before', !after); it.classList.toggle('drop-after', after) });
    it.addEventListener('dragleave', () => it.classList.remove('drop-before', 'drop-after'));
    it.addEventListener('drop', e => { e.preventDefault(); const to0 = +it.dataset.si, after = it.classList.contains('drop-after'); it.classList.remove('drop-before', 'drop-after'); if (from == null) return; moveStep(from, to0 + (after ? 1 : 0)); from = null });
    it.addEventListener('dragend', () => { from = null; $$('.step-it', el).forEach(x => x.classList.remove('drop-before', 'drop-after')) });
  });
}
function moveStep(from, to){
  if (to > from) to--; if (to === from) return;
  const cur = D.steps[UI.step];
  mutate(d => { const [s] = d.steps.splice(from, 1); d.steps.splice(to, 0, s) });
  UI.step = D.steps.indexOf(cur); renderStepsCol(); refreshCanvas(true);
}
function addStep(kind, at){
  const s = FR.stepTemplate(kind);
  const pos = at == null ? UI.step + 1 : at;
  const prev = D.steps[pos - 1]; s.position = prev ? {x: (prev.position || {x: 0}).x + 300, y: (prev.position || {y: 0}).y} : {x: 0, y: 0};
  mutate(d => d.steps.splice(pos, 0, s));
  UI.step = pos; UI.sel = null; renderStepsCol(); refreshCanvas(true); renderProps();
}
function stepTemplatesMenu(x, y, at){ menu(x, y, [{head: 'Modelos'}].concat(FR.STEP_TEMPLATES.map(([k, l]) => ({label: l, run: () => addStep(k, at)})))) }

/* ================= paleta ================= */
function renderPalette(){
  const el = $('#col-pal'); if (!el) return;
  const groups = {};
  FR.COMPONENTS.forEach((c, i) => { (groups[c.group] = groups[c.group] || []).push([c, i]) });
  el.innerHTML = Object.keys(groups).map(g => `<div class="pal-g"><span class="eyebrow">${esc(g)}</span>${groups[g].map(([c, i]) => `<button class="pal-it" draggable="true" data-a="add-layer" data-ci="${i}" title="Clique para adicionar ou arraste para o celular">${IC[c.icon] || IC.layout}${esc(c.title)}</button>`).join('')}</div>`).join('');
  $$('.pal-it', el).forEach(b => b.addEventListener('dragstart', e => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/fn-new', b.dataset.ci) }));
}
function insertLayer(ci, index){
  const c = FR.COMPONENTS[ci]; const l = FR.newLayer(c.type, c.sub);
  const s = step(); if (!s) { toast('Crie uma etapa primeiro.', 'err'); return }
  let pos = index;
  if (pos == null) { const k = UI.sel ? s.layers.findIndex(x => x.id === UI.sel) : -1; pos = k >= 0 ? k + 1 : s.layers.length }
  mutate(() => s.layers.splice(pos, 0, l), {canvas: false});
  UI.sel = l.id; UI.ptab = 'conteudo'; refreshCanvas(true); renderProps();
}
function removeLayer(id){
  const s = step(); const k = s.layers.findIndex(l => l.id === id); if (k < 0) return;
  mutate(() => s.layers.splice(k, 1), {canvas: false});
  UI.sel = null; refreshCanvas(true); renderProps(); toast('Componente removido · Ctrl+Z desfaz');
}
function duplicateLayer(id){
  const s = step(); const k = s.layers.findIndex(l => l.id === id); if (k < 0) return;
  const c = FR.reId(s.layers[k]); if (c.content) c.content.name = (c.type === 'options' ? 'opcoes_' : '') + uid();
  mutate(() => s.layers.splice(k + 1, 0, c), {canvas: false});
  UI.sel = c.id; refreshCanvas(true); renderProps();
}
function moveLayer(id, dir){
  const s = step(); const k = s.layers.findIndex(l => l.id === id), j = k + dir; if (k < 0 || j < 0 || j >= s.layers.length) return;
  mutate(() => { const [l] = s.layers.splice(k, 1); s.layers.splice(j, 0, l) }, {canvas: false}); refreshCanvas(true);
}

/* ================= celular ================= */
const refreshCanvasSoon = (() => { let raf = 0; return () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => refreshCanvas()) } })();
function refreshCanvas(full){
  const scr = $('#screen'); if (!scr || !D) return;
  if (!full && CANVAS) { CANVAS.setFunnel(D, true); return }
  if (CANVAS) CANVAS.destroy();
  if (!D.steps.length) { scr.innerHTML = `<div class="empty" style="padding-top:120px">Sem etapas.<br><br><button class="btn primary" data-a="add-step">${IC.plus}Criar etapa</button></div>`; CANVAS = null; return }
  const bld = UI.tab === 'construtor';
  CANVAS = FR.mount(scr, D, {mode: 'edit', step: UI.step, selected: bld ? UI.sel : null, faqOpen: true,
    onSelect: bld ? (id => { UI.sel = id; UI.ptab = 'conteudo'; CANVAS.setSelected(id); renderProps() }) : null,
    onReady: bld ? (root => wireCanvasDnD(root)) : null,
  });
  const ph = $('.phone'); if (ph) ph.style.background = D.design.backgroundColor || '#fff';
}
// Arrastar componentes (reordenar) e soltar componentes novos da paleta.
function wireCanvasDnD(root){
  const s = step(); let dragId = null;
  const clear = () => $$('.fnr-l', root).forEach(w => w.classList.remove('drop-before', 'drop-after'));
  $$('.fnr-l', root).forEach(w => {
    w.addEventListener('dragstart', e => { dragId = w.dataset.lid; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/fn-layer', dragId) });
    w.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); clear(); const r = w.getBoundingClientRect(); w.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before') });
    w.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      const after = w.classList.contains('drop-after'); clear();
      let at = s.layers.findIndex(l => l.id === w.dataset.lid) + (after ? 1 : 0);
      const ci = e.dataTransfer.getData('text/fn-new');
      if (ci !== '') { insertLayer(+ci, at); return }
      const id = e.dataTransfer.getData('text/fn-layer') || dragId; if (!id || id === w.dataset.lid) return;
      const k = s.layers.findIndex(l => l.id === id); if (k < 0) return; if (k < at) at--;
      mutate(() => { const [l] = s.layers.splice(k, 1); s.layers.splice(at, 0, l) }, {canvas: false}); refreshCanvas(true);
    });
    w.addEventListener('dragend', () => { dragId = null; clear() });
  });
  const body = $('.fnr-body', root) || root;
  body.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/fn-new')) e.preventDefault() });
  body.addEventListener('drop', e => { const ci = e.dataTransfer.getData('text/fn-new'); if (ci !== '') { e.preventDefault(); insertLayer(+ci, s.layers.length) } });
}

/* ================= painel de propriedades ================= */
function renderProps(){
  if (UI.tab === 'design') return renderDesignPanel();
  if (UI.tab === 'config') return renderConfigBody();
  const el = $('#col-props'); if (!el) return;
  const s = step(), l = layer();
  wireProps();
  if (!s) { el.innerHTML = ''; return }
  if (!l) { el.innerHTML = stepProps(s); return }
  const tabs = [['conteudo', 'Conteúdo'], ['aparencia', 'Aparência'], ['regras', 'Exibição' + (l.roles && l.roles.some(g => g.length) ? ' •' : '')], ['avancado', 'Avançado']];
  el.innerHTML = `<div class="props-h"><span style="color:var(--sel)">${IC[iconOf(l)] || IC.layout}</span><b>${esc(l.title || FR.TYPE_TITLE[l.type] || l.type)}</b>
      <button class="btn sm icon ghost" data-a="layer-up" title="Subir">${IC.up}</button><button class="btn sm icon ghost" data-a="layer-down" title="Descer">${IC.down}</button>
      <button class="btn sm icon ghost" data-a="layer-dup" title="Duplicar (Ctrl+D)">${IC.copy}</button><button class="btn sm icon ghost" data-a="layer-del" title="Excluir (Delete)">${IC.trash}</button><button class="btn sm icon ghost" data-a="deselect" title="Fechar">${IC.x}</button></div>
    <div class="ptabs">${tabs.map(([k, t]) => `<button type="button" data-a="ptab" data-v="${k}" aria-pressed="${UI.ptab === k}">${t}</button>`).join('')}</div>
    <div class="pbody">${UI.ptab === 'aparencia' ? designProps(l) : UI.ptab === 'regras' ? rolesProps(l) : UI.ptab === 'avancado' ? advancedProps(l) : contentProps(l)}</div>`;
}
function iconOf(l){ const c = FR.COMPONENTS.find(x => x.type === l.type && (!x.sub || x.sub === (l.content.type || (l.content.multiple ? 'multiple' : 'list')))) || FR.COMPONENTS.find(x => x.type === l.type); return c ? c.icon : 'layout' }
function stepProps(s){
  return `<div class="props-h"><b>Etapa ${UI.step + 1}</b><button class="btn sm icon ghost" data-a="step-menu" data-i="${UI.step}" aria-label="Ações da etapa">${IC.dots}</button></div><div class="pbody">
    <div class="psec">${P.text('S:title', 'Título da etapa')}</div>
    <div class="psec"><span class="eyebrow">Cabeçalho</span>${P.tog('S:settings.showLogo', 'Mostrar logo', {defOn: true})}${P.tog('S:settings.showProgress', 'Mostrar progresso', {defOn: true})}${P.tog('S:settings.showBack', 'Mostrar botão voltar', {defOn: true})}${P.text('S:settings.backLabel', 'Texto ao lado da seta (opcional)', {ph: 'Ex.: voltar'})}</div>
    <div class="psec"><span class="eyebrow">Navegação</span>${P.tog('S:settings.scrollTop', 'Voltar ao topo ao abrir a etapa', {defOn: true})}<p class="hint">Como no InLead, escolher uma opção (escolha única) já leva ao destino dela, a não ser que a opção esteja marcada para esperar o botão. Para abrir o funil direto nesta etapa, use <code>?step=${esc(s.id)}</code> no link.</p></div>
    <div class="psec"><span class="eyebrow">Script da etapa</span>${P.area('S:script', 'Roda quando a etapa abre (só na página publicada)', {rows: 4, code: true, ph: '<script>fbq(\'trackCustom\', \'Etapa\')</script>'})}</div>
    <div class="psec"><span class="eyebrow">Componentes desta etapa</span>${s.layers.length ? s.layers.map(l => `<button class="pal-it" data-a="select-layer" data-id="${attr(l.id)}" style="cursor:pointer">${IC[iconOf(l)] || IC.layout}${esc(l.title || FR.TYPE_TITLE[l.type])}${l.roles && l.roles.some(g => g.length) ? ' <span class="chip" style="margin-left:auto">condicional</span>' : ''}</button>`).join('') : '<p class="hint">Clique num componente da coluna ao lado (ou arraste para o celular) para adicionar.</p>'}</div>
    <p class="hint">Atalhos: <kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplica, <kbd>Delete</kbd> exclui o componente selecionado, <kbd>Ctrl</kbd>+<kbd>S</kbd> salva.</p></div>`;
}
const BTN_STYLES = [['theme', 'Cor de destaque'], ['danger', 'Vermelho'], ['info', 'Azul'], ['success', 'Verde'], ['warning', 'Amarelo'], ['dark', 'Escuro'], ['light', 'Claro'], ['transparent', 'Transparente'], ['custom', 'Personalizada']];
const SOFT_STYLES = [['danger', 'Vermelho'], ['info', 'Azul'], ['success', 'Verde'], ['warning', 'Amarelo'], ['light', 'Cinza'], ['black', 'Preto'], ['theme', 'Cores do funil'], ['custom', 'Personalizada']];
const COLS = [['grid-cols-1', '1'], ['grid-cols-2', '2'], ['grid-cols-3', '3']];
const ASPECTS = [['aspect-[1/1]', 'Quadrado'], ['aspect-[4/3]', '4:3'], ['aspect-[3/4]', '3:4'], ['aspect-[16/9]', '16:9'], ['aspect-[9/16]', '9:16']];
const NTF_POS = [['default', 'No lugar do componente'], ['top-middle', 'Fixa · topo, centro'], ['top-left', 'Fixa · topo, esquerda'], ['top-right', 'Fixa · topo, direita'], ['center-middle', 'Fixa · meio da tela'], ['bottom-middle', 'Fixa · embaixo, centro'], ['bottom-left', 'Fixa · embaixo, esquerda'], ['bottom-right', 'Fixa · embaixo, direita']];
const linkOpts = () => [['', 'Etapa ou link (URL)']].concat(Object.entries(FR.LINK_MODELS).map(([k, m]) => [k, m.group + ' · ' + m.label]));
const PIXEL_EVENTS = [['', 'Nenhum'], ['Lead', 'Lead'], ['CompleteRegistration', 'CompleteRegistration'], ['Contact', 'Contact'], ['InitiateCheckout', 'InitiateCheckout'], ['AddToCart', 'AddToCart'], ['ViewContent', 'ViewContent'], ['Schedule', 'Schedule'], ['SubmitApplication', 'SubmitApplication']];
const customColors = (L, d) => d.style === 'custom' ? `<div class="psec" style="padding:0;border:0">${P.color(L('design.backgroundColor'), 'Fundo', '#111111')}${P.color(L('design.color'), 'Texto', '#ffffff')}${P.color(L('design.borderColor'), 'Borda', '#111111')}</div>` : '';
function contentProps(l){
  const c = l.content, L = k => 'L:' + k;
  switch (l.type) {
    case 'text': return `<div class="psec">${P.rich(L('content.text'), 'Texto', {hint: 'Use {{nome}} ou @nome para mostrar uma resposta e calc(…) para contas, como calc({{score.tempo}}+10).'})}${varsHint()}</div>`;
    case 'image': return `<div class="psec">${P.media(L('content.image.src'), 'Imagem', 'image/*')}${P.text(L('content.alt'), 'Texto alternativo')}${P.text(L('content.link'), 'Link ao clicar (opcional)', {ph: 'https://…'})}</div>`;
    case 'video': return `<div class="psec">${P.area(L('content.video'), 'Vídeo', {rows: 4, ph: 'Link do YouTube/Vimeo, arquivo .mp4 ou código <iframe>', hint: 'Cole o link do vídeo ou o código de incorporação.'})}</div>`;
    case 'audio': return `<div class="psec">${P.media(L('content.audio.src'), 'Arquivo de áudio', 'audio/*', {preview: false})}${P.text(L('content.sender'), 'Nome de quem fala')}${P.media(L('content.image.src'), 'Foto (opcional)', 'image/*')}</div>`;
    case 'button': {
      const m = c.model && c.model.type && FR.LINK_MODELS[c.model.type];
      const fields = m ? m.fields.map(([k, lb, ph, t]) => t === 'textarea' ? P.area(L('content.model.' + k), lb, {rows: 3, ph: 'Ex.: ' + ph}) : P.text(L('content.model.' + k), lb, {ph: 'Ex.: ' + ph})).join('') + '<p class="hint">Os campos aceitam variáveis (@nome ou {{nome}}). Telefone vira 55 + DDD + número.</p>' : P.dest(L('content.destination'), 'Ao clicar, vai para');
      const ext = m || FR.isUrl(c.destination || '') || /^[\w-]+(\.[\w-]+)+\//.test(c.destination || '');
      return `<div class="psec">${P.text(L('content.label'), 'Texto do botão')}${P.sel(L('content.model.type'), 'Ação', linkOpts(), {def: ''})}${fields}${ext ? P.tog(L('content.target'), 'Abrir o link em outra aba') + '<p class="hint">Como no InLead, o link leva junto os parâmetros da URL do funil (utm_source, fbclid…).</p>' : ''}${P.tog(L('content.pulse'), 'Animação de pulsar')}<p class="hint">Antes de sair da etapa, o botão confere os campos e opções obrigatórios.</p></div>`;
    }
    case 'options': return optionsProps(l);
    case 'field': {
      const t = c.type || 'text';
      return `<div class="psec">${P.sel(L('content.type'), 'Tipo', [['text', 'Texto'], ['email', 'E-mail'], ['phone', 'Telefone/WhatsApp'], ['number', 'Número'], ['textarea', 'Texto longo']])}${P.text(L('content.title'), 'Pergunta')}${P.text(L('content.placeholder'), 'Texto de exemplo (placeholder)')}${P.tog(L('content.required'), 'Obrigatório')}${t === 'number' ? `<div class="g2">${P.num(L('content.min'), 'Mínimo')}${P.num(L('content.max'), 'Máximo')}</div>` : ''}
        ${P.area(L('content.consent'), 'Texto de consentimento (LGPD, opcional)', {rows: 2, ph: 'Ao informar seu WhatsApp, você aceita receber o diagnóstico e o contato da Brase por lá.', hint: t === 'phone' ? 'Aparece embaixo do campo. Recomendado se for usar o envio de quem abandona o formulário (Configurações › Leads e dados).' : ''})}</div>`;
    }
    case 'date': return `<div class="psec">${P.text(L('content.title'), 'Pergunta')}${P.tog(L('content.required'), 'Obrigatório', {defOn: true})}${P.tog(L('content.disablePast'), 'Não deixar escolher datas passadas')}</div>`;
    case 'height': case 'weight': return `<div class="psec">${P.text(L('content.title'), 'Pergunta')}<div class="g3">${P.num(L('content.min'), 'Mínimo')}${P.num(L('content.max'), 'Máximo')}${P.num(L('content.value'), 'Inicial')}</div>${P.text(L('content.unit'), 'Unidade', {ph: l.type === 'height' ? 'cm' : 'kg'})}</div>`;
    case 'metric': return `<div class="psec">${P.text(L('content.title'), 'Título')}${P.text(L('content.subtitle'), 'Descrição')}${P.text(L('content.percent'), 'Porcentagem (0 a 100)', {hint: 'Número fixo ou conta: calc(({{score.tempo}}+{{score.promo}})/10)'})}${P.text(L('content.legends'), 'Legendas abaixo da barra (opcional)', {ph: 'Baixo|Médio|Alto'})}${P.tog(L('content.show_title'), 'Mostrar título', {defOn: true})}${P.tog(L('content.show_percent'), 'Mostrar porcentagem', {defOn: true})}${P.tog(L('content.show_dot'), 'Mostrar marcador', {defOn: true})}${varsHint()}</div>`;
    case 'timer': {
      const lay = (l.design || {}).layout || 'countdown';
      return `<div class="psec">${P.seg(L('content.basedOn'), 'Contar', [['time', 'Por tempo'], ['date', 'Até uma data']], 'time', true)}${c.basedOn === 'date' ? P.dt(L('content.date'), 'Data e hora final') : P.num(L('content.time'), 'Duração (segundos)', {min: 1})}${lay === 'text' ? P.rich(L('content.text'), 'Texto ([time] mostra o tempo)', {small: true}) : ''}<p class="hint">Como no InLead, a contagem por tempo recomeça cada vez que a etapa abre. Modelo e cores ficam em Aparência.</p></div>`;
    }
    case 'loading': return `<div class="psec">${P.text(L('content.title'), 'Título')}${P.rich(L('content.description'), 'Descrição', {small: true})}<div class="g2">${P.num(L('content.seconds'), 'Duração (s)', {min: 0.5, step: 0.5})}${P.num(L('content.starts'), 'Começa em (%)', {min: 0, max: 99})}</div>${P.dest(L('content.destination'), 'Ao terminar, vai para')}${P.tog(L('content.show_title'), 'Mostrar título', {defOn: true})}${P.tog(L('content.show_progress'), 'Mostrar barra', {defOn: true})}${P.tog(L('content.show_percent'), 'Mostrar porcentagem')}</div>`;
    case 'price': return `<div class="psec">${P.rich(L('content.title'), 'Produto', {small: true})}<div class="g3">${P.text(L('content.before'), 'Antes do preço')}${P.text(L('content.value'), 'Preço')}${P.text(L('content.after'), 'Depois do preço')}</div>${P.text(L('content.featured'), 'Faixa de destaque', {ph: 'Ex.: Tempo limitado!'})}${P.tog(L('content.redirect'), 'Clicar no preço aciona o botão da etapa')}</div>`;
    case 'faq': return `<div class="psec">${listEditor(l, 'questions', 'Pergunta', (q, i) => P.text(L(`content.questions.${i}.question`), 'Pergunta') + P.rich(L(`content.questions.${i}.answer`), 'Resposta', {small: true}))}${P.tog(L('content.firstQuestionOpened'), 'Primeira pergunta aberta')}</div>`;
    case 'clear': return `<div class="psec">${P.sel(L('content.clear'), 'Altura do espaço', [['h-[0.25rem]', 'Mínimo (4 px)'], ['h-[0.5rem]', 'Pequeno (8 px)'], ['h-[1rem]', 'Normal (16 px)'], ['h-[1.5rem]', 'Médio (24 px)'], ['h-[2rem]', 'Grande (32 px)'], ['h-[3rem]', 'Maior (48 px)'], ['h-[5rem]', 'Enorme (80 px)']])}</div>`;
    case 'alert': return `<div class="psec">${P.text(L('content.title'), 'Título (opcional)')}${P.rich(L('content.text'), 'Texto', {small: true})}${P.text(L('content.icon.value'), 'Ícone (emoji)', {ph: 'Ex.: ⚠️'})}</div>`;
    case 'notification': return `<div class="psec">${P.rich(L('content.title'), 'Título', {small: true})}${P.rich(L('content.text'), 'Texto', {small: true})}<p class="hint">Cada aviso troca @1, @2 e @3 pelo próximo valor das listas abaixo (separe com |).</p>${(c.variables || []).map((v, i) => P.text(L(`content.variables.${i}.values`), `Valores de ${v.name || '@' + (i + 1)}`, {t: 'list', ph: 'Rafael|Beatriz|Carlos'})).join('')}<div class="g2">${P.num(L('content.duration'), 'Cada aviso (s)', {min: 1})}${P.num(L('content.interval'), 'Intervalo (s)', {min: 0})}</div>${P.sel(L('content.position'), 'Posição', NTF_POS, {def: 'default'})}</div>`;
    case 'arguments': return `<div class="psec">${P.seg(L('content.cols'), 'Colunas', COLS, 'grid-cols-2')}${listEditor(l, 'arguments', 'Argumento', (a, i) => P.media(L(`content.arguments.${i}.image.src`), 'Imagem (opcional)', 'image/*') + P.rich(L(`content.arguments.${i}.text`), 'Texto', {small: true}))}</div>`;
    case 'quotes': return `<div class="psec">${P.seg(L('content.layout'), 'Modelo', [['list', 'Lista'], ['grid', 'Grade'], ['slide', 'Carrossel']], 'list')}${listEditor(l, 'quotes', 'Depoimento', (t, i) => `<div class="g2">${P.text(L(`content.quotes.${i}.name`), 'Nome')}${P.text(L(`content.quotes.${i}.activity`), '@ ou profissão')}</div>` + P.area(L(`content.quotes.${i}.text`), 'Depoimento', {rows: 3}) + `<div class="g2" style="grid-template-columns:1fr 90px">${P.media(L(`content.quotes.${i}.image.src`), 'Foto', 'image/*', {preview: false})}${P.num(L(`content.quotes.${i}.rate`), 'Estrelas', {min: 0, max: 5})}</div>`)}</div>`;
    case 'checklist': return `<div class="psec">${listEditor(l, 'items', 'Item', (t, i) => `<div class="g2" style="grid-template-columns:70px 1fr">${P.text(L(`content.items.${i}.icon.value`), 'Ícone', {ph: 'Ex.: ✅'})}${P.text(L(`content.items.${i}.text`), 'Texto')}</div>`)}</div>`;
    case 'compare': return `<div class="psec">${P.media(L('content.first_image.src'), 'Imagem de antes', 'image/*')}${P.text(L('content.first_label'), 'Legenda de antes')}${P.media(L('content.secondary_image.src'), 'Imagem de depois', 'image/*')}${P.text(L('content.secondary_label'), 'Legenda de depois')}</div>`;
    case 'carousel': return `<div class="psec">${listEditor(l, 'items', 'Item', (t, i) => P.media(L(`content.items.${i}.image.src`), 'Imagem', 'image/*') + P.rich(L(`content.items.${i}.text`), 'Texto', {small: true}))}${P.seg(L('content.layout'), 'Modelo', [['image_text', 'Imagem e texto'], ['image', 'Só imagem']], 'image_text')}${P.tog(L('content.autoplay'), 'Passar sozinho', {defOn: true})}${P.tog(L('content.pagination'), 'Mostrar bolinhas', {defOn: true})}${P.tog(L('content.spoiler'), 'Mostrar um pedaço do próximo')}</div>`;
    case 'graphics': return `<div class="psec">${P.seg(L('content.cols'), 'Colunas', COLS, 'grid-cols-2')}${listEditor(l, 'graphics', 'Métrica', (g, i) => P.seg(L(`content.graphics.${i}.type`), 'Tipo', [['bar', 'Barra'], ['circle', 'Círculo']], 'bar') + `<div class="g2">${P.text(L(`content.graphics.${i}.percent`), 'Porcentagem', {ph: '30 ou calc(…)'})}${P.sel(L(`content.graphics.${i}.style`), 'Cor', [['theme', 'Destaque'], ['danger', 'Vermelho'], ['info', 'Azul'], ['success', 'Verde'], ['warning', 'Amarelo']], {def: 'theme'})}</div>` + P.rich(L(`content.graphics.${i}.legend`), 'Legenda', {small: true}))}</div>`;
    case 'charts': {
      const xs = c.xAxis || [], n = Math.max(1, Math.min(2, +c.datasetCount || 1));
      return `<div class="psec">${P.text(L('content.title'), 'Título (opcional)')}${P.seg(L('content.type'), 'Tipo', [['cartesian', 'Linha'], ['bar', 'Barras'], ['pie', 'Pizza']], 'cartesian')}${P.text(L('content.xAxis'), 'Rótulos (separe com |)', {t: 'list', ph: 'Ontem|Hoje|Amanhã', re: true})}${P.seg(L('content.datasetCount'), 'Conjuntos de dados', [['1', '1'], ['2', '2']], '1', true)}
        ${(c.datasets || []).slice(0, n).map((ds, i) => `<div class="item"><b class="hint">Conjunto ${i + 1}</b>${P.text(L(`content.datasets.${i}.title`), 'Nome')}${xs.map((x, j) => `<div class="g2">${P.text(L(`content.datasets.${i}.datas.${j}.value`), x || 'Valor ' + (j + 1))}${P.text(L(`content.datasets.${i}.datas.${j}.tooltip`), 'Etiqueta (opcional)')}</div>`).join('')}</div>`).join('')}<p class="hint">Os valores aceitam variáveis e calc(…).</p></div>`;
    }
    case 'ifood': return `<div class="psec">${P.text(L('content.title'), 'Pergunta')}${P.text(L('content.placeholder'), 'Texto de exemplo')}${P.text(L('content.help'), 'Ajuda embaixo do campo')}${P.text(L('content.button'), 'Texto do botão')}${P.num(L('content.km'), 'Raio da comparação (km)', {min: 1, max: 10})}${P.tog(L('content.required'), 'Obrigatório')}
      <p class="hint">A pessoa cola o link da loja no iFood e vê avaliações, pedidos estimados (avaliações × 2) e a posição entre as lojas da mesma categoria no raio, com os dados do app de Restaurantes. A posição só aparece quando a base tem pelo menos 5 lojas da categoria na região; cada loja analisada entra na base.</p>
      <p class="hint">Variáveis para usar no texto e nas regras: <code>{{${esc(c.name || 'ifood')}.avaliacoes}}</code>, <code>.pedidos</code>, <code>.posicao</code>, <code>.total</code>, <code>.categoria</code>, <code>.proxima</code>, <code>.falta</code>, <code>.lider</code>.</p></div>`;
    case 'script': return `<div class="psec">${P.area(L('content.script'), 'HTML / Script', {rows: 12, code: true, hint: 'Roda só na página publicada e no teste. No editor aparece como um bloco.'})}</div>`;
    default: return '<p class="hint">Este componente não tem opções.</p>';
  }
}
function optionsProps(l){
  const c = l.content, L = k => 'L:' + k;
  const hasBtn = step().layers.some(x => x.type === 'button');
  const imgs = (c.options || []).some(o => o.image && o.image.type !== 'emoji' && typeof o.image.src === 'string');
  const auto = !c.multiple && !c.awaitSubmit;
  const intro = c.introType || 'none';
  return `<div class="psec">${P.tog(L('content.multiple'), 'Permitir marcar várias (múltipla escolha)')}${c.multiple ? P.num(L('content.max'), 'Máximo de marcações (vazio = sem limite)', {min: 1}) : P.tog(L('content.awaitSubmit'), 'Esperar o botão para avançar')}${P.tog(L('content.required'), 'Resposta obrigatória', {defOn: true})}
    ${(c.multiple || c.awaitSubmit) && !hasBtn ? '<div class="banner warn">Sem avanço automático, a etapa precisa de um botão para seguir.</div>' : ''}<p class="hint">${auto ? 'Como no InLead: ao escolher, o funil já vai para o destino da opção' + (hasBtn ? ', mesmo com botão na etapa' : '') + '.' : 'A opção só marca a resposta; o botão da etapa avança.'}</p></div>
    <div class="psec"><span class="eyebrow">Introdução</span>${P.seg(L('content.introType'), 'Mostrar antes das opções', [['none', 'Nada'], ['text', 'Texto'], ['video', 'Vídeo resposta']], 'none', true)}${intro === 'text' ? P.rich(L('content.introduction'), 'Texto', {small: true}) : intro === 'video' ? P.area(L('content.introduction'), 'Vídeo', {rows: 3, ph: 'Link do YouTube/Vimeo ou código de incorporação', hint: 'O vídeo aparece em cima e as opções embaixo, num bloco escuro.'}) + P.seg(L('content.aspectRatio'), 'Formato', [['video', '16:9'], ['square', '1:1'], ['portrait', '3:4'], ['mobile', '9:16']], 'video') : ''}</div>
    <div class="psec"><span class="eyebrow">Opções</span>${listEditor(l, 'options', 'Opção', (o, i) => `${P.rich(L(`content.options.${i}.label`), 'Texto', {small: true})}<div class="g2">${P.text(L(`content.options.${i}.value`), 'Valor (@variável)')}${P.num(L(`content.options.${i}.score`), 'Pontos')}</div>${auto ? P.dest(L(`content.options.${i}.destination`), 'Leva para') : ''}${imgs ? P.media(L(`content.options.${i}.image.src`), 'Imagem', 'image/*') : `<label class="f">Emoji (opcional)<input class="in" data-p="L:content.options.${i}.image.emoji" value="${attr(o.image && o.image.type === 'emoji' ? o.image.src || '' : '')}" placeholder="Ex.: ✅"></label>`}`)}
    <div class="row"><button class="btn sm" type="button" data-a="opt-images">${imgs ? 'Tirar imagens das opções' : 'Usar imagens nas opções'}</button></div></div>`;
}
function listEditor(l, key, label, fields){
  const items = l.content[key] || [];
  return `<div style="display:grid;gap:8px">${items.map((it, i) => `<div class="item"><div class="item-h"><b>${esc(label)} ${i + 1}</b><button class="btn sm icon ghost" type="button" data-a="li-up" data-k="${key}" data-i="${i}" title="Subir">${IC.up}</button><button class="btn sm icon ghost" type="button" data-a="li-down" data-k="${key}" data-i="${i}" title="Descer">${IC.down}</button><button class="btn sm icon ghost" type="button" data-a="li-dup" data-k="${key}" data-i="${i}" title="Duplicar">${IC.copy}</button><button class="btn sm icon ghost" type="button" data-a="li-del" data-k="${key}" data-i="${i}" title="Remover">${IC.trash}</button></div>${fields(it, i)}</div>`).join('')}
    <button class="btn sm" type="button" data-a="li-add" data-k="${key}">${IC.plus}Adicionar ${esc(label.toLowerCase())}</button></div>`;
}
function designProps(l){
  const L = k => 'L:' + k, d = l.design || {};
  const basis = P.seg(L('design.basis'), 'Largura', [['100', '100%'], ['75', '75%'], ['50', '50%'], ['33', '33%'], ['25', '25%']], '100');
  switch (l.type) {
    case 'button': return `<div class="psec">${P.sel(L('design.style'), 'Cor', BTN_STYLES, {def: 'theme'})}${customColors(L, d)}${basis}</div>`;
    case 'options': return `<div class="psec">${P.seg(L('design.grid'), 'Colunas', [['grid-cols-1', '1'], ['grid-cols-2', '2'], ['grid-cols-3', '3'], ['grid-cols-4', '4'], ['grid-cols-5', '5']], 'grid-cols-1')}${P.sel(L('design.icon'), 'Marcador', [['select', 'Círculo'], ['checkbox', 'Quadrado'], ['arrow', 'Seta'], ['value', 'Valor da opção'], ['none', 'Nenhum']], {def: 'select'})}${P.seg(L('design.iconPosition'), 'Posição do marcador', [['end', 'Direita'], ['start', 'Esquerda']], 'end')}${P.sel(L('design.background'), 'Fundo das opções', [['contrast', 'Suave'], ['transparent', 'Transparente'], ['solid', 'Cor de destaque']], {def: 'contrast'})}${P.sel(L('design.border'), 'Borda', [['border-0', 'Sem borda'], ['border-[1px]', 'Fina'], ['border-[2px]', 'Normal'], ['border-[3px]', 'Grossa']], {def: 'border-[2px]'})}${P.sel(L('design.gap'), 'Espaço entre opções', [['gap-1', 'Pequeno'], ['gap-2', 'Normal'], ['gap-3', 'Médio'], ['gap-4', 'Grande']], {def: 'gap-2'})}${P.sel(L('design.shadow'), 'Sombra', [['shadow-none', 'Sem sombra'], ['shadow', 'Com sombra']], {def: 'shadow-none'})}${P.sel(L('design.aspectImage'), 'Formato das imagens', ASPECTS, {def: 'aspect-[1/1]'})}${P.seg(L('design.align'), 'Texto', [['left', 'À esquerda'], ['center', 'Centralizado']], 'left')}${P.sel(L('design.order'), 'Ordem', [['default', 'Como está'], ['random', 'Embaralhar para cada visitante'], ['reverse', 'Invertida']], {def: 'default'})}${basis}</div>`;
    case 'image': return `<div class="psec">${P.range(L('design.width'), 'Tamanho', 10, 100, 5, {unit: '%', def: 100})}${P.sel(L('design.rounded'), 'Cantos', [['', 'Retos'], ['rounded-lg', 'Pouco arredondados'], ['rounded-2xl', 'Arredondados'], ['rounded-full', 'Redondos']], {def: ''})}${basis}</div>`;
    case 'video': return `<div class="psec">${P.seg(L('design.ratio'), 'Formato', [['mobile', '9:16'], ['portrait', '4:5'], ['square', '1:1'], ['landscape', '16:9']], 'landscape')}${P.tog(L('design.autoplay'), 'Começar sozinho, sem som (só arquivo .mp4)')}${basis}</div>`;
    case 'audio': return `<div class="psec">${P.seg(L('design.model'), 'Modelo', [['whatsapp', 'WhatsApp'], ['default', 'Simples']], 'whatsapp')}${P.seg(L('design.theme'), 'Tema', [['dark', 'Escuro'], ['light', 'Claro']], 'dark')}${basis}</div>`;
    case 'metric': return `<div class="psec">${P.seg(L('design.color'), 'Cor da barra', [['theme', 'Destaque'], ['#22c55e', 'Verde'], ['#f59e0b', 'Amarelo'], ['#dc2626', 'Vermelho']], 'theme')}${basis}</div>`;
    case 'timer': return `<div class="psec">${P.seg(L('design.layout'), 'Modelo', [['countdown', 'Caixas'], ['cards', 'Cartões'], ['banner', 'Faixa'], ['hero', 'Destaque'], ['text', 'Texto']], 'countdown', true)}${P.sel(L('design.style'), 'Cor', SOFT_STYLES, {def: 'black'})}${customColors(L, d)}${P.range(L('design.padding'), 'Espaço interno', 0, 32, 1, {unit: 'px', def: 10})}${basis}</div>`;
    case 'loading': return `<div class="psec">${P.seg(L('design.layout'), 'Modelo', [['default', 'Barra'], ['circle', 'Círculo']], 'default')}</div>`;
    case 'price': return `<div class="psec">${P.sel(L('design.style'), 'Cor da faixa', [['theme', 'Destaque'], ['success', 'Verde'], ['danger', 'Vermelho'], ['info', 'Azul'], ['warning', 'Amarelo']], {def: 'theme'})}${basis}</div>`;
    case 'alert': return `<div class="psec">${P.sel(L('design.style'), 'Cor', [['danger', 'Vermelho'], ['info', 'Azul'], ['success', 'Verde'], ['warning', 'Amarelo'], ['theme', 'Cores do funil'], ['black', 'Preto'], ['white', 'Branco']], {def: 'danger'})}${P.range(L('design.padding'), 'Espaço interno', 4, 32, 1, {unit: 'px', def: 16})}${P.range(L('design.borderWidth'), 'Borda', 0, 4, 1, {unit: 'px', def: 1})}${basis}</div>`;
    case 'notification': return `<div class="psec">${P.sel(L('design.style'), 'Cor', [['white', 'Branco'], ['light', 'Cinza'], ['danger', 'Vermelho'], ['info', 'Azul'], ['success', 'Verde'], ['warning', 'Amarelo'], ['theme', 'Destaque']], {def: 'white'})}${basis}</div>`;
    case 'arguments': return `<div class="psec">${P.sel(L('design.aspectImage'), 'Formato das imagens', ASPECTS, {def: 'aspect-[1/1]'})}${basis}</div>`;
    case 'carousel': return `<div class="psec">${P.sel(L('design.aspectImage'), 'Formato das imagens', ASPECTS, {def: 'aspect-[1/1]'})}${basis}</div>`;
    case 'compare': return `<div class="psec">${P.seg(L('design.ratio'), 'Formato', [['square', '1:1'], ['video', '16:9'], ['portrait', '3:4'], ['mobile', '9:16']], 'square')}${basis}</div>`;
    case 'ifood': return `<div class="psec">${P.sel(L('design.style'), 'Cor do botão', BTN_STYLES, {def: 'theme'})}${customColors(L, d)}${basis}</div>`;
    case 'charts': return `<div class="psec">${P.tog(L('design.area'), 'Preencher a área (linha)', {defOn: true})}${P.tog(L('design.gridY'), 'Linhas de grade', {defOn: true})}${P.tog(L('design.axisX'), 'Eixo de baixo', {defOn: true})}${basis}</div>`;
    case 'clear': return '<p class="hint">O espaço não tem aparência própria.</p>';
    default: return `<div class="psec">${basis}<p class="hint">Cores, fontes e cantos vêm da aba Design (valem para o funil todo).</p></div>`;
  }
}
function advancedProps(l){
  const L = k => 'L:' + k, c = l.content;
  const named = FR.INPUT_TYPES.includes(l.type) || l.type === 'button';
  return `<div class="psec">${P.text(L('title'), 'Nome no editor')}${named ? P.text(L('content.name'), 'ID/Name do componente (variável)', {hint: `É o nome da coluna na aba Leads, a chave no webhook e a variável <code>@${esc(c.name || '')}</code> nas regras e textos. Use letras, números e _.`}) : ''}</div>
    ${l.type === 'button' ? `<div class="psec"><span class="eyebrow">Rastreamento</span>${P.sel(L('content.pixelEvent'), 'Evento do Pixel da Meta ao clicar', PIXEL_EVENTS, {def: ''})}${P.area(L('content.script'), 'Script ao clicar (JavaScript)', {rows: 4, code: true, ph: "fbq('track', 'Lead');"})}</div>` : ''}
    ${l.type === 'options' ? `<div class="psec"><span class="eyebrow">Rastreamento por opção</span>${(c.options || []).map((o, i) => `<div class="item"><b class="hint">${esc(FR.stripHtml(o.label).slice(0, 50))}</b>${P.sel(L(`content.options.${i}.pixelEvent`), 'Evento do Pixel ao escolher', PIXEL_EVENTS, {def: ''})}</div>`).join('')}</div>` : ''}
    <div class="psec"><span class="eyebrow">Identificação</span><p class="hint">Camada <code>${esc(l.id)}</code> · conteúdo <code>${esc(c.id || '')}</code></p></div>`;
}

/* ================= regras de exibição ================= */
function allVars(){
  const out = [];
  D.steps.forEach((s, i) => s.layers.forEach(l => {
    if (l.type === 'options') out.push({name: l.content.name, step: i + 1, stepTitle: s.title, type: 'options', values: (l.content.options || []).map(o => [String(o.value ?? ''), FR.stripHtml(o.label)])});
    else if (FR.INPUT_TYPES.includes(l.type)) out.push({name: l.content.name, step: i + 1, stepTitle: s.title, type: 'field'});
    else if (l.type === 'button' && l.content.name) out.push({name: l.content.name, step: i + 1, stepTitle: s.title, type: 'button'});
  }));
  return out.filter(v => v.name);
}
function varsHint(){
  const vs = allVars(); if (!vs.length) return '';
  return `<details><summary class="hint" style="cursor:pointer">Variáveis disponíveis (${vs.length})</summary><div class="vars" style="margin-top:6px">${vs.map(v => `<button type="button" data-a="ins-var" data-v="{{${attr(v.name)}}}" title="Etapa ${v.step} · ${attr(v.stepTitle)}">{{${esc(v.name)}}}</button>${v.type === 'options' ? `<button type="button" data-a="ins-var" data-v="{{score.${attr(v.name)}}}">{{score.${esc(v.name)}}}</button>` : ''}`).join('')}<button type="button" data-a="ins-var" data-v="{{score}}">{{score}}</button></div></details>`;
}
// Operadores das regras, nos mesmos grupos do InLead (módulo 60527).
const COMPARE_GROUPS = [['Lógica básica', ['==', '!=', '>', '>=', '<', '<=', 'includes']], ['Lógica por quantidade', ['count==', 'count>=', 'count<']], ['Lógica por porcentagem', ['percent==', 'percent>', 'percent<']]];
const needsNumber = c => /count|percent/.test(c || '');
function rolesProps(l){
  const roles = Array.isArray(l.roles) ? l.roles : [];
  const vs = allVars(), label = Object.fromEntries(FR.ROLE_OPERATORS);
  const list = `<datalist id="fn-vars">${vs.map(x => `<option value="@${attr(x.name)}">${esc(x.stepTitle)}</option>${x.type === 'options' ? `<option value="@score.${attr(x.name)}">pontos · ${esc(x.stepTitle)}</option><option value="@responses.${attr(x.name)}">todas as opções · ${esc(x.stepTitle)}</option>` : ''}`).join('')}<option value="@score">pontuação total</option><option value="@tracking.utm_content">anúncio (utm_content)</option><option value="@tracking.utm_campaign">campanha (utm_campaign)</option><option value="@tracking.utm_medium">conjunto (utm_medium)</option><option value="@tracking.utm_source">origem (utm_source)</option>${(typeof INS !== 'undefined' ? INS.utm : []).map(u => `<option value="${attr(u.split('|')[0])}">anúncio que trouxe visitas</option>`).join('')}</datalist>`;
  const cmpSel = (g, c, v) => `<select class="in" data-role="${g}.${c}.compare">${COMPARE_GROUPS.map(([gl, ops]) => `<optgroup label="${gl}">${ops.map(k => `<option value="${k}"${v === k ? ' selected' : ''}>${esc(label[k])}</option>`).join('')}</optgroup>`).join('')}${v && !label[v] ? `<option value="${attr(v)}" selected>${esc(v)}</option>` : ''}</select>`;
  const valIn = (g, c, cond) => {
    if (['empty', 'not_empty'].includes(cond.compare)) return '<span></span>';
    const vdef = vs.find(x => '@' + x.name === cond.variable);
    if (vdef && vdef.type === 'options' && ['==', '!='].includes(cond.compare)) return `<select class="in" data-role="${g}.${c}.value"><option value="">—</option>${vdef.values.map(([v, lb]) => `<option value="${attr(v)}"${String(cond.value) === v ? ' selected' : ''}>${esc(v)} · ${esc(lb.slice(0, 30))}</option>`).join('')}${cond.value && !vdef.values.some(([v]) => v === String(cond.value)) ? `<option value="${attr(cond.value)}" selected>${esc(cond.value)}</option>` : ''}</select>`;
    return `<input class="in" data-role="${g}.${c}.value" value="${attr(cond.value ?? '')}" placeholder="${needsNumber(cond.compare) ? '@resposta' : 'valor ou @variável'}" list="fn-vars">`;
  };
  const row = (gi, ci, c) => `<div class="cond"><div class="cr" style="grid-template-columns:1fr 28px"><input class="in" data-role="${gi}.${ci}.variable" value="${attr(c.variable ?? '')}" placeholder="${needsNumber(c.compare) ? 'valor procurado (ex.: ifood)' : '@variável'}" list="fn-vars"><button class="btn sm icon ghost" type="button" data-a="role-del" data-g="${gi}" data-c="${ci}" title="Remover">${IC.x}</button></div>
    ${needsNumber(c.compare) ? `<div class="cr" style="grid-template-columns:1fr 60px auto">${cmpSel(gi, ci, c.compare)}<input class="in" type="number" data-role="${gi}.${ci}.number" value="${attr(c.number ?? '')}" placeholder="nº"><span class="hint">${/count/.test(c.compare) ? 'vezes em' : '% em'}</span></div><div class="cr" style="grid-template-columns:1fr">${valIn(gi, ci, c)}</div>` : `<div class="cr" style="grid-template-columns:132px 1fr">${cmpSel(gi, ci, c.compare)}${valIn(gi, ci, c)}</div>`}</div>`;
  return `<div class="psec">${list}<p class="hint">Mostra este componente só quando as condições valem. Dentro de um grupo, todas precisam valer (E); entre grupos, basta um (OU). Sem regras, aparece sempre. Os dois lados aceitam @variáveis e viram número quando dá.</p>
    ${roles.map((g, gi) => `${gi ? '<div class="roles-or">OU</div>' : ''}<div class="roles-g">${g.map((c, ci) => row(gi, ci, c)).join('<div class="hint" style="font-weight:700">E</div>')}
      <button class="btn sm ghost" type="button" data-a="role-add" data-g="${gi}" style="justify-self:start">${IC.plus}E…</button></div>`).join('')}
    <div class="row" style="flex-wrap:wrap"><button class="btn sm" type="button" data-a="role-group">${IC.plus}${roles.length ? 'OU: novo grupo' : 'Adicionar condição'}</button><button class="btn sm ghost" type="button" data-a="role-ad" title="Mostrar só para quem veio de um anúncio">${IC.plus}Condição de anúncio</button></div>
    <p class="hint">Condição de anúncio: mostra este componente só para quem clicou num criativo (ex.: <code>@tracking.utm_content</code> contém <code>Escondeu</code>). Use para trocar o título da Capa conforme o anúncio.</p>
    <details><summary class="hint" style="cursor:pointer">Como funcionam “aparece” e “representa”</summary><p class="hint">Servem para múltipla escolha. Ex.: <code>ifood</code> aparece pelo menos <code>1</code> vezes em <code>@canais</code>; <code>sim</code> representa mais de <code>50</code>% em <code>@responses.quiz</code>.</p></details></div>`;
}

/* ================= eventos do painel ================= */
function onPropInput(e){
  const t = e.target;
  if (t.dataset.rich != null) { const p = t.dataset.rich; applyValue(p, cleanRich(t.innerHTML), {key: p}); return }
  if (t.dataset.role) { setRole(t.dataset.role, t.value, e.type === 'change'); return }
  if (t.dataset.rr) { setRuleAt(t.dataset.rr, t.value, e.type === 'change'); return }
  const p = t.dataset.p; if (!p) return;
  if (p === 'R:slug') { if (e.type === 'change') { const sl = slugify(t.value); t.value = sl; applyValue(p, sl, {key: p, props: true}) } return }
  let v = t.value;
  if (t.dataset.t === 'num') v = t.value === '' ? '' : +t.value;
  if (t.dataset.t === 'bool') v = t.dataset.inv ? !t.checked : t.checked;
  if (t.dataset.t === 'list') v = t.value.split('|').map(x => x.trim());
  // emoji da opção: vira image {type: 'emoji', src} (formato do InLead)
  if (/\.image\.emoji$/.test(p)) { applyValue(p.replace(/\.emoji$/, ''), v.trim() ? {type: 'emoji', src: v.trim()} : {type: 'image', src: null}, {key: p}); return }
  if (t.type === 'color') { const tx = t.parentElement.querySelector('input[type=text]'); if (tx) tx.value = v }
  if (t.type === 'text' && t.closest('.colorin')) { const cp = t.parentElement.querySelector('input[type=color]'); if (cp && /^#[0-9a-f]{6}$/i.test(v)) cp.value = v }
  const out = document.querySelector(`[data-out="${CSS.escape(p)}"]`); if (out) out.textContent = v + (t.dataset.unit || '');
  // mudanças que alteram o próprio painel
  const structural = (/content\.(type|multiple|destination|awaitSubmit|introType|basedOn)$|content\.model\.type$|\.destination$|design\.(style|layout)$/.test(p) || t.dataset.re) && e.type === 'change';
  applyValue(p, v, {key: p, props: structural, steps: p === 'S:title'});
}
function applyValue(p, v, o){
  const [scope, path] = p.split(':');
  if (scope === 'W') { setPath(WH.data, path, v); WH.dirty = true; paintWebhookState(); if (o.props) renderProps(); return }
  const obj = scopeObj(scope); if (!obj) return;
  mutate(() => {
    setPath(obj, path, v);
    if (scope === 'L' && path === 'content.destination' && obj.type === 'button') obj.content.type = FR.isUrl(v) || /^[\w-]+(\.[\w-]+)+\//.test(v) ? 'redirect' : 'next';
    if (scope === 'L' && path === 'content.model.type' && obj.type === 'button') { if (!v) delete obj.content.model; obj.content.type = v || FR.isUrl(obj.content.destination || '') ? 'redirect' : 'next' }
    if (scope === 'L' && path === 'content.type' && obj.type === 'field') { if (v === 'phone') obj.content.mask = 'phone'; else delete obj.content.mask; if (v === 'height') Object.assign(obj.content, {unit: 'cm', min: 140, max: 220, value: 170}); if (v === 'weight') Object.assign(obj.content, {unit: 'kg', min: 40, max: 250, value: 70}) }
  }, {key: o.key, props: o.props, steps: o.steps, canvas: false});
  if (scope === 'F' && /^design\.(featuredFont|contentFont)$/.test(path)) loadFonts();
  if (scope === 'R') { const t = $('.ed-title b'), sm = $('.ed-title small'); if (t) t.textContent = REC.title; if (sm) sm.textContent = '/' + REC.slug + (REC.published_at ? ' · publicado ' + fmtDateTime(REC.published_at) : ' · não publicado') }
  refreshCanvasSoon();
  if (UI.tab === 'design' && typeof refreshDesign === 'function') refreshDesign();
}
function cleanRich(h){ return String(h || '').replace(/<div>/gi, '<p>').replace(/<\/div>/gi, '</p>').replace(/<p><br><\/p>$/i, '').replace(/ style=""/g, '') }
function setRole(path, v, structural){
  const l = layer(); const [g, c, k] = path.split('.');
  mutate(() => { l.roles = Array.isArray(l.roles) ? l.roles : []; l.roles[+g][+c][k] = k === 'number' && v !== '' ? +v : v }, {key: 'role' + path, canvas: false});
  refreshCanvasSoon();
  if (structural && (k === 'variable' || k === 'compare')) renderProps();
}
function richCmd(btn){
  const wrap = btn.closest('.rich-wrap'), ed = wrap.querySelector('.rich'); ed.focus();
  document.execCommand('styleWithCSS', false, true);
  const cmd = btn.dataset.rcmd, arg = btn.dataset.rarg;
  if (cmd === 'formatBlock') document.execCommand('formatBlock', false, '<' + arg + '>');
  else if (cmd === 'createLink') { const u = prompt('Endereço do link (https://…)'); if (u) document.execCommand('createLink', false, u) }
  else if (cmd === 'colorPick') { const inp = document.createElement('input'); inp.type = 'color'; inp.value = '#f59e0b'; inp.addEventListener('input', () => { ed.focus(); document.execCommand('foreColor', false, inp.value); ed.dispatchEvent(new Event('input', {bubbles: true})) }); inp.click(); return }
  else document.execCommand(cmd, false, arg || null);
  ed.dispatchEvent(new Event('input', {bubbles: true}));
}
function wireProps(){
  const el = $('#col-props'); if (!el || el._wired) return; el._wired = true;
  el.addEventListener('input', e => { if (e.target.matches('select,input[type=checkbox]')) return; onPropInput(e) });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.dest) {
      const p = t.dataset.dest;
      if (t.value === '__url') { applyValue(p, 'https://', {key: p}); renderProps(); const i = el.querySelector(`input[data-p="${CSS.escape(p)}"]`); if (i) { i.focus(); i.select() } return }
      applyValue(p, t.value, {key: p, props: true}); return;
    }
    if (t.dataset.upload) { uploadTo(t.dataset.upload, t.files[0]); return }
    if (t.matches('select,input[type=checkbox],input[type=color],input[type=datetime-local]') || t.dataset.role || t.dataset.rr || t.dataset.re || t.dataset.p === 'R:slug') onPropInput(e);
    else if (t.dataset.p && /destination$/.test(t.dataset.p)) renderProps();
  });
  el.addEventListener('click', e => {
    const s = e.target.closest('[data-segp]'), b = e.target.closest('[data-segp] button');
    if (s && b) { const p = s.dataset.segp; let v = b.dataset.v; if (/design\.basis$/.test(p)) v = +v; $$('button', s).forEach(x => x.setAttribute('aria-pressed', x === b)); applyValue(p, v, {key: p, props: !!s.dataset.re}); return }
    const rc = e.target.closest('[data-rcmd]'); if (rc) { e.preventDefault(); richCmd(rc); return }
    const cl = e.target.closest('[data-clear]'); if (cl) { applyValue(cl.dataset.clear, '', {key: cl.dataset.clear, props: true}); return }
  });
  el.addEventListener('mousedown', e => { if (e.target.closest('[data-rcmd]')) e.preventDefault() });
}
async function uploadTo(p, file){
  if (!file) return;
  try { toast('Enviando…'); const url = await DB.upload(file); applyValue(p, url, {key: p, props: true}); toast('Arquivo enviado') } catch (e) { toast(e.message, 'err') }
}

/* ================= ações do Construtor ================= */
Object.assign(ACT, {
  'pick-step': t => { if (UI.step === +t.dataset.i) return; UI.step = +t.dataset.i; UI.sel = null; renderStepsCol(); refreshCanvas(true); renderProps() },
  'add-step': t => { const r = t.getBoundingClientRect(); stepTemplatesMenu(r.left, r.bottom + 4) },
  'step-menu': (t, e) => {
    e.stopPropagation(); const i = +t.dataset.i, r = t.getBoundingClientRect();
    menu(r.right - 4, r.bottom + 2, [
      {label: 'Renomear', run: () => { const n = prompt('Título da etapa', D.steps[i].title); if (n != null && n.trim()) { mutate(d => { d.steps[i].title = n.trim() }, {steps: true, props: true}) } }},
      {label: 'Duplicar', icon: IC.copy, run: () => { const c = clone(D.steps[i]); c.id = uid(); c.title += ' (cópia)'; c.layers = c.layers.map(l => { const n = FR.reId(l); if (n.content) n.content.name = (n.type === 'options' ? 'opcoes_' : '') + uid(); return n }); c.position = {x: (c.position || {x: 0}).x + 40, y: (c.position || {y: 0}).y + 40}; mutate(d => d.steps.splice(i + 1, 0, c)); UI.step = i + 1; UI.sel = null; renderStepsCol(); refreshCanvas(true); renderProps() }},
      {label: 'Nova etapa depois desta', icon: IC.plus, run: () => stepTemplatesMenu(r.right, r.bottom, i + 1)},
      {label: 'Subir', icon: IC.up, run: () => moveStep(i, i - 1 < 0 ? 0 : i - 1)},
      {label: 'Descer', icon: IC.down, run: () => moveStep(i, i + 2)},
      {label: 'Testar a partir desta', icon: IC.play, run: () => previewDialog(i)}, '-',
      {label: 'Excluir etapa', icon: IC.trash, danger: true, run: async () => {
        const used = D.steps.some(s => FR.outlets(D, s).some(o => o.dest === D.steps[i].id));
        if (!(await confirmBox('Excluir “' + D.steps[i].title + '”?', used ? 'Atenção: há opções ou botões que levam para esta etapa. Eles passarão a ir para a próxima etapa.' : 'Ctrl+Z desfaz.', 'Excluir', true))) return;
        const id = D.steps[i].id;
        mutate(d => { d.steps.splice(i, 1); d.steps.forEach(s => FR.outlets(d, s).forEach(o => { if (o.item.destination === id) o.item.destination = 'next' })) });
        UI.step = Math.max(0, Math.min(UI.step, D.steps.length - 1)); UI.sel = null; renderStepsCol(); refreshCanvas(true); renderProps();
      }},
    ]);
  },
  'add-layer': t => insertLayer(+t.dataset.ci),
  'select-layer': t => { UI.sel = t.dataset.id; UI.ptab = 'conteudo'; if (CANVAS) CANVAS.setSelected(UI.sel); renderProps() },
  deselect: () => { UI.sel = null; if (CANVAS) CANVAS.setSelected(null); renderProps() },
  'layer-up': () => moveLayer(UI.sel, -1), 'layer-down': () => moveLayer(UI.sel, 1),
  'layer-dup': () => duplicateLayer(UI.sel), 'layer-del': () => removeLayer(UI.sel),
  ptab: t => { UI.ptab = t.dataset.v; renderProps() },
  undo, redo,
  device: t => { UI.device = t.dataset.v; renderBuilder($('#ed-main')) },
  'preview-here': () => previewDialog(UI.step),
  'li-add': t => { const l = layer(), k = t.dataset.k; const make = {questions: () => ({id: uid(), question: 'Nova pergunta', answer: '<p>Resposta.</p>'}), options: () => { const imgs = (l.content.options || []).some(o => o.image && typeof o.image.src === 'string'); return {id: uid(), image: {type: 'image', src: imgs ? '' : null}, score: 0, value: String.fromCharCode(65 + (l.content.options || []).length), label: '<p>Nova opção</p>', destination: 'next'} }}[k] || (() => { const tpl = FR.newLayer(l.type).content[k]; const base = tpl && tpl[0] ? clone(tpl[0]) : {}; base.id = uid(); return base });
    mutate(() => { l.content[k] = l.content[k] || []; l.content[k].push(make()) }, {props: true}) },
  'li-del': t => { const l = layer(); mutate(() => l.content[t.dataset.k].splice(+t.dataset.i, 1), {props: true}) },
  'li-dup': t => { const l = layer(), arr = l.content[t.dataset.k], i = +t.dataset.i; const c = clone(arr[i]); c.id = uid(); mutate(() => arr.splice(i + 1, 0, c), {props: true}) },
  'li-up': t => { const l = layer(), arr = l.content[t.dataset.k], i = +t.dataset.i; if (i < 1) return; mutate(() => { const [x] = arr.splice(i, 1); arr.splice(i - 1, 0, x) }, {props: true}) },
  'li-down': t => { const l = layer(), arr = l.content[t.dataset.k], i = +t.dataset.i; if (i >= arr.length - 1) return; mutate(() => { const [x] = arr.splice(i, 1); arr.splice(i + 1, 0, x) }, {props: true}) },
  'opt-images': () => { const l = layer(); const has = (l.content.options || []).some(o => o.image && o.image.type !== 'emoji' && typeof o.image.src === 'string'); mutate(() => { l.content.options.forEach(o => { o.image = {type: 'image', src: has ? null : ''} }); if (!has && l.design.grid === 'grid-cols-1') l.design.grid = 'grid-cols-2' }, {props: true}) },
  'role-ad': () => { const l = layer(); mutate(() => { l.roles = Array.isArray(l.roles) ? l.roles : []; l.roles.push([{variable: '@tracking.utm_content', compare: 'includes', value: ''}]) }, {props: true}); if (DB.server && typeof loadAds === 'function' && !INS.utm.length) { INS.level = 'ad'; loadAds().then(() => renderProps()).catch(() => {}) } },
  'role-group': () => { const l = layer(); mutate(() => { l.roles = Array.isArray(l.roles) ? l.roles : []; l.roles.push([{variable: '', compare: '==', value: ''}]) }, {props: true}) },
  'role-add': t => { const l = layer(); mutate(() => l.roles[+t.dataset.g].push({variable: '', compare: '==', value: ''}), {props: true}) },
  'role-del': t => { const l = layer(); mutate(() => { l.roles[+t.dataset.g].splice(+t.dataset.c, 1); l.roles = l.roles.filter(g => g.length); if (!l.roles.length) delete l.roles }, {props: true}) },
  'ins-var': t => { const ed = $('#col-props .rich') || null; const v = t.dataset.v; if (ed) { ed.focus(); document.execCommand('insertText', false, v) } else copy(v) },
});
