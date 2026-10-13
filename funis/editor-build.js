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
  text: (p, label, o = {}) => `<label class="f">${esc(label)}<input class="in" data-p="${p}" value="${attr(val(p) ?? '')}" placeholder="${attr(o.ph || '')}"${o.list ? ` list="${o.list}"` : ''}>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</label>`,
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
  const c = FR.reId(s.layers[k]); if (['options', 'field', 'button'].includes(c.type)) c.content.name = (c.type === 'options' ? 'opcoes_' : '') + uid();
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
    <div class="psec"><span class="eyebrow">Navegação</span>${P.tog('S:settings.scrollTop', 'Voltar ao topo ao abrir a etapa', {defOn: true})}<p class="hint">Opções sem botão na etapa levam direto para o destino de cada uma. Com botão, as opções só marcam a resposta e o botão avança.</p></div>
    <div class="psec"><span class="eyebrow">Componentes desta etapa</span>${s.layers.length ? s.layers.map(l => `<button class="pal-it" data-a="select-layer" data-id="${attr(l.id)}" style="cursor:pointer">${IC[iconOf(l)] || IC.layout}${esc(l.title || FR.TYPE_TITLE[l.type])}${l.roles && l.roles.some(g => g.length) ? ' <span class="chip" style="margin-left:auto">condicional</span>' : ''}</button>`).join('') : '<p class="hint">Clique num componente da coluna ao lado (ou arraste para o celular) para adicionar.</p>'}</div>
    <p class="hint">Atalhos: <kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplica, <kbd>Delete</kbd> exclui o componente selecionado, <kbd>Ctrl</kbd>+<kbd>S</kbd> salva.</p></div>`;
}
const BTN_STYLES = [['theme', 'Cor de destaque'], ['success', 'Verde'], ['danger', 'Vermelho'], ['dark', 'Escuro'], ['light', 'Claro'], ['outline', 'Contorno'], ['contrast', 'Discreto']];
const PIXEL_EVENTS = [['', 'Nenhum'], ['Lead', 'Lead'], ['CompleteRegistration', 'CompleteRegistration'], ['Contact', 'Contact'], ['InitiateCheckout', 'InitiateCheckout'], ['AddToCart', 'AddToCart'], ['ViewContent', 'ViewContent'], ['Schedule', 'Schedule'], ['SubmitApplication', 'SubmitApplication']];
function contentProps(l){
  const c = l.content, L = k => 'L:' + k;
  switch (l.type) {
    case 'text': return `<div class="psec">${P.rich(L('content.text'), 'Texto', {hint: 'Use {{nome_da_variavel}} para mostrar uma resposta e calc(…) para contas, como calc({{score.tempo}}+10).'})}${varsHint()}</div>`;
    case 'image': return `<div class="psec">${P.media(L('content.image.src'), 'Imagem', 'image/*')}${P.text(L('content.alt'), 'Texto alternativo')}${P.text(L('content.link'), 'Link ao clicar (opcional)', {ph: 'https://…'})}</div>`;
    case 'video': return `<div class="psec">${P.area(L('content.video'), 'Vídeo', {rows: 4, ph: 'Link do YouTube/Vimeo, arquivo .mp4 ou código <iframe>', hint: 'Cole o link do vídeo ou o código de incorporação.'})}</div>`;
    case 'audio': return `<div class="psec">${P.media(L('content.audio.src'), 'Arquivo de áudio', 'audio/*', {preview: false})}${P.text(L('content.sender'), 'Nome de quem fala')}${P.media(L('content.image.src'), 'Foto (opcional)', 'image/*')}</div>`;
    case 'button': return `<div class="psec">${P.text(L('content.label'), 'Texto do botão')}${P.dest(L('content.destination'), 'Ao clicar, vai para')}${FR.isUrl(c.destination || '') ? P.tog(L('content.target'), 'Abrir o link em outra aba') + P.tog(L('content.passUtm'), 'Repassar os parâmetros do anúncio (utm, fbclid) para o link') : ''}${P.tog(L('content.pulse'), 'Animação de pulsar')}<p class="hint">Antes de sair da etapa, o botão confere os campos e opções obrigatórios.</p></div>`;
    case 'options': return optionsProps(l);
    case 'field': {
      const t = c.type || 'text';
      return `<div class="psec">${P.sel(L('content.type'), 'Tipo', [['text', 'Texto'], ['email', 'E-mail'], ['phone', 'Telefone/WhatsApp'], ['number', 'Número'], ['textarea', 'Texto longo'], ['date', 'Data'], ['height', 'Altura (régua)'], ['weight', 'Peso (régua)']])}${P.text(L('content.title'), 'Pergunta')}${['height', 'weight'].includes(t) ? '' : P.text(L('content.placeholder'), 'Texto de exemplo (placeholder)')}${P.tog(L('content.required'), 'Obrigatório')}
        ${['height', 'weight', 'number'].includes(t) ? `<div class="g3">${P.num(L('content.min'), 'Mínimo')}${P.num(L('content.max'), 'Máximo')}${t === 'number' ? '' : P.num(L('content.value'), 'Inicial')}</div>${t === 'number' ? '' : P.text(L('content.unit'), 'Unidade', {ph: t === 'height' ? 'cm' : 'kg'})}` : ''}</div>`;
    }
    case 'metric': return `<div class="psec">${P.text(L('content.title'), 'Título')}${P.text(L('content.subtitle'), 'Descrição')}${P.text(L('content.percent'), 'Porcentagem (0 a 100)', {hint: 'Número fixo ou conta: calc(({{score.tempo}}+{{score.promo}})/10)'})}${P.text(L('content.legends'), 'Legendas abaixo da barra (opcional)', {ph: 'Baixo|Médio|Alto'})}${P.tog(L('content.show_title'), 'Mostrar título', {defOn: true})}${P.tog(L('content.show_percent'), 'Mostrar porcentagem', {defOn: true})}${P.tog(L('content.show_dot'), 'Mostrar marcador', {defOn: true})}${varsHint()}</div>`;
    case 'timer': return `<div class="psec">${P.num(L('content.time'), 'Duração (segundos)', {min: 1})}${P.rich(L('content.text'), 'Texto (no modelo faixa, [time] mostra o tempo)', {small: true})}<p class="hint">O tempo continua contando se o visitante recarregar a página.</p></div>`;
    case 'loading': return `<div class="psec">${P.text(L('content.title'), 'Título')}${P.rich(L('content.description'), 'Descrição', {small: true})}<div class="g2">${P.num(L('content.seconds'), 'Duração (s)', {min: 0.5, step: 0.5})}${P.num(L('content.starts'), 'Começa em (%)', {min: 0, max: 99})}</div>${P.dest(L('content.destination'), 'Ao terminar, vai para')}${P.tog(L('content.show_title'), 'Mostrar título', {defOn: true})}${P.tog(L('content.show_progress'), 'Mostrar barra', {defOn: true})}${P.tog(L('content.show_percent'), 'Mostrar porcentagem')}</div>`;
    case 'price': return `<div class="psec">${P.rich(L('content.title'), 'Produto', {small: true})}<div class="g3">${P.text(L('content.before'), 'Antes do preço')}${P.text(L('content.value'), 'Preço')}${P.text(L('content.after'), 'Depois do preço')}</div>${P.text(L('content.featured'), 'Faixa de destaque', {ph: 'Ex.: Tempo limitado!'})}${P.tog(L('content.redirect'), 'Clicar no preço aciona o botão da etapa')}</div>`;
    case 'faq': return `<div class="psec">${listEditor(l, 'questions', 'Pergunta', (q, i) => P.text(L(`content.questions.${i}.question`), 'Pergunta') + P.rich(L(`content.questions.${i}.answer`), 'Resposta', {small: true}))}${P.tog(L('content.firstQuestionOpened'), 'Primeira pergunta aberta')}</div>`;
    case 'clear': return `<div class="psec">${P.sel(L('content.clear'), 'Altura do espaço', [['h-[0.25rem]', 'Mínimo (4 px)'], ['h-[0.5rem]', 'Pequeno (8 px)'], ['h-[1rem]', 'Normal (16 px)'], ['h-[1.5rem]', 'Médio (24 px)'], ['h-[2rem]', 'Grande (32 px)'], ['h-[3rem]', 'Maior (48 px)'], ['h-[5rem]', 'Enorme (80 px)']])}</div>`;
    case 'alert': return `<div class="psec">${P.text(L('content.title'), 'Título')}${P.rich(L('content.text'), 'Texto', {small: true})}${P.text(L('content.icon'), 'Ícone (emoji, opcional)')}</div>`;
    case 'arguments': return `<div class="psec">${listEditor(l, 'items', 'Argumento', (a, i) => `<div class="g2" style="grid-template-columns:70px 1fr">${P.text(L(`content.items.${i}.icon`), 'Ícone')}${P.text(L(`content.items.${i}.title`), 'Título')}</div>` + P.text(L(`content.items.${i}.text`), 'Texto'))}</div>`;
    case 'testimonials': return `<div class="psec">${listEditor(l, 'items', 'Depoimento', (t, i) => `<div class="g2">${P.text(L(`content.items.${i}.name`), 'Nome')}${P.text(L(`content.items.${i}.handle`), '@ ou cidade')}</div>` + P.area(L(`content.items.${i}.text`), 'Depoimento', {rows: 2}) + `<div class="g2" style="grid-template-columns:1fr 90px">${P.media(L(`content.items.${i}.image`), 'Foto', 'image/*', {preview: false})}${P.num(L(`content.items.${i}.stars`), 'Estrelas', {min: 0, max: 5})}</div>`)}</div>`;
    case 'checklist': return `<div class="psec">${listEditor(l, 'items', 'Item', (t, i) => P.text(L(`content.items.${i}.text`), 'Texto'))}</div>`;
    case 'beforeafter': return `<div class="psec">${P.media(L('content.before.src'), 'Imagem de antes', 'image/*')}${P.text(L('content.beforeLabel'), 'Legenda de antes')}${P.media(L('content.after.src'), 'Imagem de depois', 'image/*')}${P.text(L('content.afterLabel'), 'Legenda de depois')}</div>`;
    case 'carousel': return `<div class="psec">${listEditor(l, 'items', 'Imagem', (t, i) => P.media(L(`content.items.${i}.image.src`), 'Imagem', 'image/*') + P.text(L(`content.items.${i}.caption`), 'Legenda'))}</div>`;
    case 'chart': return `<div class="psec">${P.text(L('content.title'), 'Título')}${P.text(L('content.suffix'), 'Unidade depois do número', {ph: '%'})}${listEditor(l, 'items', 'Barra', (t, i) => `<div class="g2">${P.text(L(`content.items.${i}.label`), 'Rótulo')}${P.text(L(`content.items.${i}.value`), 'Valor')}</div>`)}<p class="hint">O valor aceita variáveis e calc(…).</p></div>`;
    case 'stats': return `<div class="psec">${listEditor(l, 'items', 'Métrica', (t, i) => `<div class="g3">${P.text(L(`content.items.${i}.value`), 'Valor')}${P.text(L(`content.items.${i}.suffix`), 'Unidade')}${P.text(L(`content.items.${i}.label`), 'Rótulo')}</div>`)}</div>`;
    case 'html': return `<div class="psec">${P.area(L('content.html'), 'HTML / Script', {rows: 12, code: true, hint: 'Roda só na página publicada e no teste. No editor aparece como um bloco.'})}</div>`;
    default: return '<p class="hint">Este componente não tem opções.</p>';
  }
}
function optionsProps(l){
  const c = l.content, L = k => 'L:' + k;
  const hasBtn = step().layers.some(x => x.type === 'button');
  const imgs = (c.options || []).some(o => o.image && typeof o.image.src === 'string');
  return `<div class="psec">${P.tog(L('content.multiple'), 'Permitir marcar várias (múltipla escolha)')}${c.multiple ? P.num(L('content.max'), 'Máximo de marcações (vazio = sem limite)', {min: 1}) : ''}${P.tog(L('content.required'), 'Resposta obrigatória', {defOn: true})}
    ${c.multiple && !hasBtn ? '<div class="banner warn">Múltipla escolha precisa de um botão na etapa para avançar.</div>' : ''}${!c.multiple && hasBtn ? '<p class="hint">Esta etapa tem botão: as opções só marcam a resposta e o destino é o do botão.</p>' : ''}</div>
    <div class="psec"><span class="eyebrow">Opções</span>${listEditor(l, 'options', 'Opção', (o, i) => `${P.rich(L(`content.options.${i}.label`), 'Texto', {small: true})}<div class="g2">${P.text(L(`content.options.${i}.value`), 'Valor (@variável)')}${P.num(L(`content.options.${i}.score`), 'Pontos')}</div>${!c.multiple && !hasBtn ? P.dest(L(`content.options.${i}.destination`), 'Leva para') : ''}${imgs ? P.media(L(`content.options.${i}.image.src`), 'Imagem', 'image/*') : ''}`)}
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
    case 'button': return `<div class="psec">${P.sel(L('design.style'), 'Cor', BTN_STYLES, {def: 'theme'})}${basis}</div>`;
    case 'options': return `<div class="psec">${P.seg(L('design.grid'), 'Colunas', [['grid-cols-1', '1'], ['grid-cols-2', '2'], ['grid-cols-3', '3'], ['grid-cols-4', '4'], ['grid-cols-5', '5']], 'grid-cols-1')}${P.sel(L('design.icon'), 'Marcador', [['select', 'Círculo'], ['checkbox', 'Quadrado'], ['arrow', 'Seta'], ['none', 'Nenhum']], {def: 'select'})}${P.seg(L('design.iconPosition'), 'Posição do marcador', [['end', 'Direita'], ['start', 'Esquerda']], 'end')}${P.sel(L('design.background'), 'Fundo das opções', [['contrast', 'Suave'], ['transparent', 'Transparente'], ['solid', 'Cor de destaque']], {def: 'contrast'})}${P.sel(L('design.border'), 'Borda', [['border-0', 'Sem borda'], ['border-[1px]', 'Fina'], ['border-[2px]', 'Normal'], ['border-[3px]', 'Grossa']], {def: 'border-[2px]'})}${P.sel(L('design.gap'), 'Espaço entre opções', [['gap-1', 'Pequeno'], ['gap-2', 'Normal'], ['gap-3', 'Médio'], ['gap-4', 'Grande']], {def: 'gap-2'})}${P.sel(L('design.shadow'), 'Sombra', [['shadow-none', 'Sem sombra'], ['shadow', 'Com sombra']], {def: 'shadow-none'})}${P.sel(L('design.aspectImage'), 'Formato das imagens', [['aspect-[1/1]', 'Quadrado'], ['aspect-[4/3]', '4:3'], ['aspect-[3/4]', '3:4'], ['aspect-[16/9]', '16:9']], {def: 'aspect-[1/1]'})}${P.seg(L('design.align'), 'Texto', [['left', 'À esquerda'], ['center', 'Centralizado']], 'left')}${P.sel(L('design.order'), 'Ordem', [['default', 'Como está'], ['random', 'Embaralhar para cada visitante']], {def: 'default'})}${basis}</div>`;
    case 'image': return `<div class="psec">${P.range(L('design.width'), 'Tamanho', 10, 100, 5, {unit: '%', def: 100})}${P.sel(L('design.rounded'), 'Cantos', [['', 'Retos'], ['rounded-lg', 'Pouco arredondados'], ['rounded-2xl', 'Arredondados'], ['rounded-full', 'Redondos']], {def: ''})}${basis}</div>`;
    case 'video': return `<div class="psec">${P.seg(L('design.ratio'), 'Formato', [['mobile', '9:16'], ['portrait', '4:5'], ['square', '1:1'], ['landscape', '16:9']], 'landscape')}${P.tog(L('design.autoplay'), 'Começar sozinho, sem som (só arquivo .mp4)')}${basis}</div>`;
    case 'audio': return `<div class="psec">${P.seg(L('design.model'), 'Modelo', [['whatsapp', 'WhatsApp'], ['default', 'Simples']], 'whatsapp')}${P.seg(L('design.theme'), 'Tema', [['dark', 'Escuro'], ['light', 'Claro']], 'dark')}${basis}</div>`;
    case 'metric': return `<div class="psec">${P.seg(L('design.color'), 'Cor da barra', [['theme', 'Destaque'], ['#22c55e', 'Verde'], ['#f59e0b', 'Amarelo'], ['#dc2626', 'Vermelho']], 'theme')}${basis}</div>`;
    case 'timer': return `<div class="psec">${P.seg(L('design.layout'), 'Modelo', [['boxes', 'Caixas'], ['text', 'Faixa com texto']], 'boxes')}${P.sel(L('design.style'), 'Cor', [['danger', 'Vermelho'], ['theme', 'Destaque'], ['warning', 'Amarelo'], ['success', 'Verde'], ['dark', 'Escuro']], {def: 'danger'})}${basis}</div>`;
    case 'loading': return `<div class="psec">${P.seg(L('design.layout'), 'Modelo', [['default', 'Barra'], ['circle', 'Círculo']], 'default')}</div>`;
    case 'price': return `<div class="psec">${P.sel(L('design.style'), 'Cor da faixa', [['theme', 'Destaque'], ['success', 'Verde'], ['danger', 'Vermelho']], {def: 'theme'})}${basis}</div>`;
    case 'alert': return `<div class="psec">${P.sel(L('design.style'), 'Tipo', [['warning', 'Atenção (amarelo)'], ['danger', 'Alerta (vermelho)'], ['info', 'Informação (azul)'], ['success', 'Sucesso (verde)'], ['theme', 'Notificação (destaque)']], {def: 'warning'})}${basis}</div>`;
    case 'arguments': return `<div class="psec">${P.seg(L('design.grid'), 'Colunas', [['grid-cols-1', '1'], ['grid-cols-2', '2'], ['grid-cols-3', '3']], 'grid-cols-1')}${basis}</div>`;
    case 'checklist': return `<div class="psec">${P.text(L('design.icon'), 'Ícone dos itens', {ph: '✅'})}${basis}</div>`;
    case 'carousel': return `<div class="psec">${P.tog(L('design.autoplay'), 'Passar sozinho', {defOn: true})}${basis}</div>`;
    case 'clear': return '<p class="hint">O espaço não tem aparência própria.</p>';
    default: return `<div class="psec">${basis}<p class="hint">Cores, fontes e cantos vêm da aba Design (valem para o funil todo).</p></div>`;
  }
}
function advancedProps(l){
  const L = k => 'L:' + k, c = l.content;
  const named = ['options', 'field', 'button'].includes(l.type);
  return `<div class="psec">${P.text(L('title'), 'Nome no editor')}${named ? P.text(L('content.name'), 'ID/Name do componente (variável)', {hint: `É o nome da coluna na aba Leads, a chave no webhook e a variável <code>@${esc(c.name || '')}</code> nas regras e textos. Use letras, números e _.`}) : ''}</div>
    ${['button'].includes(l.type) ? `<div class="psec"><span class="eyebrow">Rastreamento</span>${P.sel(L('content.pixelEvent'), 'Evento do Pixel da Meta ao clicar', PIXEL_EVENTS, {def: ''})}${P.area(L('content.script'), 'Script ao clicar (JavaScript)', {rows: 4, code: true, ph: "fbq('track', 'Lead');"})}</div>` : ''}
    ${l.type === 'options' ? `<div class="psec"><span class="eyebrow">Rastreamento por opção</span>${(c.options || []).map((o, i) => `<div class="item"><b class="hint">${esc(FR.stripHtml(o.label).slice(0, 50))}</b>${P.sel(L(`content.options.${i}.pixelEvent`), 'Evento do Pixel ao escolher', PIXEL_EVENTS, {def: ''})}</div>`).join('')}</div>` : ''}
    <div class="psec"><span class="eyebrow">Identificação</span><p class="hint">Camada <code>${esc(l.id)}</code> · conteúdo <code>${esc(c.id || '')}</code></p></div>`;
}

/* ================= regras de exibição ================= */
function allVars(){
  const out = [];
  D.steps.forEach((s, i) => s.layers.forEach(l => {
    if (l.type === 'options') out.push({name: l.content.name, step: i + 1, stepTitle: s.title, type: 'options', values: (l.content.options || []).map(o => [String(o.value ?? ''), FR.stripHtml(o.label)])});
    else if (l.type === 'field') out.push({name: l.content.name, step: i + 1, stepTitle: s.title, type: 'field'});
  }));
  return out.filter(v => v.name);
}
function varsHint(){
  const vs = allVars(); if (!vs.length) return '';
  return `<details><summary class="hint" style="cursor:pointer">Variáveis disponíveis (${vs.length})</summary><div class="vars" style="margin-top:6px">${vs.map(v => `<button type="button" data-a="ins-var" data-v="{{${attr(v.name)}}}" title="Etapa ${v.step} · ${attr(v.stepTitle)}">{{${esc(v.name)}}}</button>${v.type === 'options' ? `<button type="button" data-a="ins-var" data-v="{{score.${attr(v.name)}}}">{{score.${esc(v.name)}}}</button>` : ''}`).join('')}<button type="button" data-a="ins-var" data-v="{{score}}">{{score}}</button></div></details>`;
}
const COMPARES = [['==', 'é igual a'], ['!=', 'é diferente de'], ['>', 'maior que'], ['<', 'menor que'], ['>=', 'maior ou igual'], ['<=', 'menor ou igual'], ['contains', 'contém'], ['empty', 'está vazio'], ['not_empty', 'está preenchido']];
function rolesProps(l){
  const roles = Array.isArray(l.roles) ? l.roles : [];
  const vs = allVars();
  const varSel = (g, c, v) => `<select class="in" data-role="${g}.${c}.variable"><option value="">Variável…</option>${vs.map(x => `<option value="@${attr(x.name)}"${v === '@' + x.name ? ' selected' : ''}>@${esc(x.name)} · ${esc(x.stepTitle)}</option>`).join('')}<option value="@score"${v === '@score' ? ' selected' : ''}>@score · pontuação total</option>${v && !vs.some(x => '@' + x.name === v) && v !== '@score' ? `<option value="${attr(v)}" selected>${esc(v)}</option>` : ''}</select>`;
  const valIn = (g, c, cond) => {
    const vdef = vs.find(x => '@' + x.name === cond.variable);
    if (['empty', 'not_empty'].includes(cond.compare)) return '<span></span>';
    if (vdef && vdef.type === 'options' && ['==', '!='].includes(cond.compare)) return `<select class="in" data-role="${g}.${c}.value"><option value="">—</option>${vdef.values.map(([v, lb]) => `<option value="${attr(v)}"${String(cond.value) === v ? ' selected' : ''}>${esc(v)} · ${esc(lb.slice(0, 30))}</option>`).join('')}</select>`;
    return `<input class="in" data-role="${g}.${c}.value" value="${attr(cond.value ?? '')}" placeholder="valor">`;
  };
  return `<div class="psec"><p class="hint">Mostra este componente só quando as condições valem. Dentro de um grupo, todas precisam valer (E); entre grupos, basta um (OU). Sem regras, aparece sempre.</p>
    ${roles.map((g, gi) => `${gi ? '<div class="roles-or">OU</div>' : ''}<div class="roles-g">${g.map((c, ci) => `<div class="cond">${varSel(gi, ci, c.variable)}<select class="in" data-role="${gi}.${ci}.compare">${COMPARES.map(([k, t]) => `<option value="${k}"${c.compare === k ? ' selected' : ''}>${t}</option>`).join('')}</select>${valIn(gi, ci, c)}<button class="btn sm icon ghost" type="button" data-a="role-del" data-g="${gi}" data-c="${ci}" title="Remover">${IC.x}</button></div>`).join('<div class="hint" style="font-weight:700">E</div>')}
      <button class="btn sm ghost" type="button" data-a="role-add" data-g="${gi}" style="justify-self:start">${IC.plus}E…</button></div>`).join('')}
    <button class="btn sm" type="button" data-a="role-group">${IC.plus}${roles.length ? 'OU: novo grupo' : 'Adicionar condição'}</button></div>`;
}

/* ================= eventos do painel ================= */
function onPropInput(e){
  const t = e.target;
  if (t.dataset.rich != null) { const p = t.dataset.rich; applyValue(p, cleanRich(t.innerHTML), {key: p}); return }
  if (t.dataset.role) { setRole(t.dataset.role, t.value, e.type === 'change'); return }
  const p = t.dataset.p; if (!p) return;
  if (p === 'R:slug') { if (e.type === 'change') { const sl = slugify(t.value); t.value = sl; applyValue(p, sl, {key: p, props: true}) } return }
  let v = t.value;
  if (t.dataset.t === 'num') v = t.value === '' ? '' : +t.value;
  if (t.dataset.t === 'bool') v = t.dataset.inv ? !t.checked : t.checked;
  if (t.type === 'color') { const tx = t.parentElement.querySelector('input[type=text]'); if (tx) tx.value = v }
  if (t.type === 'text' && t.closest('.colorin')) { const cp = t.parentElement.querySelector('input[type=color]'); if (cp && /^#[0-9a-f]{6}$/i.test(v)) cp.value = v }
  const out = document.querySelector(`[data-out="${CSS.escape(p)}"]`); if (out) out.textContent = v + (t.dataset.unit || '');
  // mudanças que alteram o próprio painel
  const structural = /content\.(type|multiple|destination)$|\.destination$/.test(p) && e.type === 'change';
  applyValue(p, v, {key: p, props: structural, steps: p === 'S:title'});
}
function applyValue(p, v, o){
  const [scope, path] = p.split(':');
  if (scope === 'W') { setPath(WH.data, path, v); WH.dirty = true; paintWebhookState(); if (o.props) renderProps(); return }
  const obj = scopeObj(scope); if (!obj) return;
  mutate(() => {
    setPath(obj, path, v);
    if (scope === 'L' && path === 'content.destination' && obj.type === 'button') obj.content.type = FR.isUrl(v) || /^[\w-]+(\.[\w-]+)+\//.test(v) ? 'redirect' : 'next';
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
  mutate(() => { l.roles = Array.isArray(l.roles) ? l.roles : []; l.roles[+g][+c][k] = v; if (k === 'variable') l.roles[+g][+c].value = '' }, {key: 'role' + path, canvas: false});
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
    if (t.matches('select,input[type=checkbox],input[type=color]') || t.dataset.role || t.dataset.p === 'R:slug') onPropInput(e);
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
      {label: 'Duplicar', icon: IC.copy, run: () => { const c = clone(D.steps[i]); c.id = uid(); c.title += ' (cópia)'; c.layers = c.layers.map(l => { const n = FR.reId(l); if (n.content && ['options', 'field', 'button'].includes(n.type)) n.content.name = (n.type === 'options' ? 'opcoes_' : '') + uid(); return n }); c.position = {x: (c.position || {x: 0}).x + 40, y: (c.position || {y: 0}).y + 40}; mutate(d => d.steps.splice(i + 1, 0, c)); UI.step = i + 1; UI.sel = null; renderStepsCol(); refreshCanvas(true); renderProps() }},
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
  'opt-images': () => { const l = layer(); const has = (l.content.options || []).some(o => o.image && typeof o.image.src === 'string'); mutate(() => { l.content.options.forEach(o => { o.image = {type: 'image', src: has ? null : ''} }); if (!has && l.design.grid === 'grid-cols-1') l.design.grid = 'grid-cols-2' }, {props: true}) },
  'role-group': () => { const l = layer(); mutate(() => { l.roles = Array.isArray(l.roles) ? l.roles : []; l.roles.push([{variable: '', compare: '==', value: ''}]) }, {props: true}) },
  'role-add': t => { const l = layer(); mutate(() => l.roles[+t.dataset.g].push({variable: '', compare: '==', value: ''}), {props: true}) },
  'role-del': t => { const l = layer(); mutate(() => { l.roles[+t.dataset.g].splice(+t.dataset.c, 1); l.roles = l.roles.filter(g => g.length); if (!l.roles.length) delete l.roles }, {props: true}) },
  'ins-var': t => { const ed = $('#col-props .rich') || null; const v = t.dataset.v; if (ed) { ed.focus(); document.execCommand('insertText', false, v) } else copy(v) },
});
