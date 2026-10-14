'use strict';
// Popup da extensão: inclui na base da Brase a loja do iFood aberta na aba atual e mostra a posição dela no ranking.
// Numa lista de restaurantes do iFood (início, busca, categoria), inclui de uma vez as lojas que estão na tela.
// Usa a mesma função restaurantes-api do app (restaurantes/index.html).
const API = 'https://kxabfippeekyxpcgjytx.supabase.co/functions/v1/restaurantes-api';
const APP = 'https://renandias-dot.github.io/central-comercial-brase/restaurantes/';
const KM = 5;
const ORDERS_PER_REVIEW = 2; // mesma proporção do app (pedidos estimados = avaliações × 2)
const BATCH = 30; // lojas por chamada de inclusão (limite da função)
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const view = document.getElementById('view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const nf = new Intl.NumberFormat('pt-BR');
const fmt = n => n == null || !isFinite(n) ? '—' : nf.format(Math.round(n));
const pct = x => (x > 0 ? '+' : '') + (x * 100).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + '%';
const lojas = n => `${fmt(n)} ${n === 1 ? 'loja' : 'lojas'}`;
const open = url => chrome.tabs.create({url});

const isIfood = url => { try { return /(^|\.)ifood\.com\.br$/.test(new URL(url).hostname) } catch { return false } };

// ID da loja (merchant_id) a partir do endereço da aba: só vale em páginas de loja do iFood.
function merchantFromUrl(url){
  if (!isIfood(url)) return '';
  const u = new URL(url);
  return ((u.pathname + u.search).match(UUID)?.[0] ?? '').toLowerCase();
}

// Roda dentro da aba do iFood (chrome.scripting): junta os links de loja que já estão na página, sem rolar nem clicar.
// Precisa ser autocontida, porque o Chrome copia só o corpo da função para a aba.
function collectStores(){
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const found = new Map();
  for (const a of document.querySelectorAll('a[href*="/delivery/"]')){
    const id = (a.href.match(uuid)?.[0] ?? '').toLowerCase();
    if (!id || found.has(id)) continue;
    const name = (a.getAttribute('aria-label') || a.innerText || '').split('\n').map(s => s.trim()).find(Boolean) || '';
    found.set(id, name.slice(0, 80));
  }
  return [...found].map(([id, name]) => ({id, name}));
}

async function storesOnPage(tabId){
  const [res] = await chrome.scripting.executeScript({target: {tabId}, func: collectStores});
  return res?.result ?? [];
}

async function call(body){
  const {code = ''} = await chrome.storage.local.get('code');
  let r;
  try { r = await fetch(API, {method: 'POST', headers: {'content-type': 'application/json', 'x-rs-key': code}, body: JSON.stringify(body)}) }
  catch { throw new Error('Sem conexão com o servidor da Brase. Tente de novo.') }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw Object.assign(new Error(j.error || 'Código de acesso inválido.'), {code: 'unauthorized'});
  if (!r.ok) throw new Error(j.error || 'Erro ' + r.status);
  return j;
}

/* ---------- telas ---------- */
function showNotStore(){
  view.innerHTML = `<div class="card"><p><b>Abra o iFood</b> e clique de novo no ícone da Brase.</p>
    <p class="hint">Na página de uma loja, a extensão inclui a loja e mostra a posição dela no ranking. Numa lista de restaurantes (início, busca ou categoria), inclui de uma vez todas as lojas que estão na tela.</p></div>
    <button class="btn" id="app">Abrir o app de Restaurantes</button>`;
  document.getElementById('app').addEventListener('click', () => open(APP));
}

function showNoStores(tabId){
  view.innerHTML = `<div class="card"><p><b>Não achei lojas nesta página.</b></p>
    <p class="hint">Abra uma lista de restaurantes do iFood (início, busca ou categoria), espere as lojas aparecerem e clique de novo. Role a lista até o fim para carregar mais lojas.</p></div>
    <button class="btn" id="rescan">Procurar de novo</button>`;
  document.getElementById('rescan').addEventListener('click', () => scan(tabId));
}

function showList(tabId, stores){
  view.innerHTML = `<div class="card"><p><b>${lojas(stores.length)} nesta página</b></p>
    <p class="hint">Só entram as lojas já carregadas na tela. Para trazer mais, role a lista do iFood até o fim (ou clique em “Ver mais”) e procure de novo.</p>
    <ul class="names">${stores.slice(0, 50).map(s => `<li>${esc(s.name || s.id)}</li>`).join('')}${stores.length > 50 ? `<li class="muted">e mais ${fmt(stores.length - 50)}</li>` : ''}</ul></div>
    <div class="row"><button class="btn" id="rescan">Procurar de novo</button><button class="btn primary" id="include-all">Incluir ${fmt(stores.length)}</button></div>`;
  document.getElementById('rescan').addEventListener('click', () => scan(tabId));
  document.getElementById('include-all').addEventListener('click', () => includeAll(tabId, stores));
}

async function scan(tabId){
  view.innerHTML = '<p class="hint">Procurando lojas nesta página…</p>';
  try {
    const stores = await storesOnPage(tabId);
    stores.length ? showList(tabId, stores) : showNoStores(tabId);
  } catch (e){ showError('Não consegui ler esta página do iFood. Recarregue a página e tente de novo.') }
}

// Inclui as lojas em lotes; as que já estão na base voltam na hora (a função não relê no iFood).
async function includeAll(tabId, stores){
  const totals = {added: 0, known: 0, failed: 0};
  const bar = done => {
    view.innerHTML = `<div class="card"><p><b>Incluindo ${fmt(done)} de ${fmt(stores.length)}…</b></p>
      <div class="bar"><b style="width:${(done / stores.length * 100).toFixed(1)}%"></b></div>
      <p class="hint">Lojas novas são lidas no iFood uma a uma, por isso leva alguns segundos a cada ${BATCH}.</p></div>`;
  };
  try {
    for (let i = 0; i < stores.length; i += BATCH){
      bar(i);
      const {results} = await call({op: 'include', links: stores.slice(i, i + BATCH).map(s => s.id)});
      for (const r of results) r.existing ? totals.known++ : r.ok ? totals.added++ : totals.failed++;
    }
  } catch (e){
    if (e.code === 'unauthorized') return showCode(() => includeAll(tabId, stores), (await chrome.storage.local.get('code')).code ? 'Código inválido. Confira com o gestor.' : '');
    return showError(`${e.message} Até aqui: ${fmt(totals.added)} novas, ${fmt(totals.known)} já estavam na base.`);
  }
  view.innerHTML = `<div class="card"><p class="hint">✓ Pronto</p>
      <div class="stats">
        <div class="stat"><span class="l">Novas na base</span><span class="v">${fmt(totals.added)}</span></div>
        <div class="stat"><span class="l">Já estavam</span><span class="v">${fmt(totals.known)}</span></div>
      </div>
      ${totals.failed ? `<p class="hint">${lojas(totals.failed)} não ${totals.failed === 1 ? 'foi encontrada' : 'foram encontradas'} no iFood.</p>` : ''}
      <p class="hint">As lojas novas entram nos rankings e passam a ser relidas toda semana.</p></div>
    <div class="row"><button class="btn" id="rescan">Procurar de novo</button><button class="btn primary" id="app">Abrir o app</button></div>`;
  document.getElementById('rescan').addEventListener('click', () => scan(tabId));
  document.getElementById('app').addEventListener('click', () => open(APP));
}

function showReady(id){
  view.innerHTML = `<div class="card"><p><b>Loja do iFood detectada</b> nesta aba.</p><code>${esc(id)}</code>
    <p class="hint">A loja entra na base da Brase e passa a ser relida toda semana para o ranking.</p></div>
    <button class="btn primary" id="include">Incluir na Brase</button>`;
  document.getElementById('include').addEventListener('click', () => include(id));
}

function showError(message, id){
  view.innerHTML = `<div class="err">${esc(message)}</div>${id ? '<button class="btn" id="retry">Tentar de novo</button>' : ''}`;
  if (id) document.getElementById('retry').addEventListener('click', () => include(id));
}

// retry: o que rodar de novo depois de salvar o código.
function showCode(retry, message){
  view.innerHTML = `<div class="card"><p><b>O app pede o código de acesso da equipe.</b></p>
    ${message ? `<div class="err">${esc(message)}</div>` : ''}
    <form id="code-form" class="row"><input class="in" id="code" type="password" placeholder="Código de acesso" aria-label="Código de acesso" required>
    <button class="btn primary" style="width:auto">Salvar</button></form></div>`;
  document.getElementById('code').focus();
  document.getElementById('code-form').addEventListener('submit', async e => {
    e.preventDefault();
    await chrome.storage.local.set({code: document.getElementById('code').value.trim()});
    retry();
  });
}

// Posições com as mesmas contas do app: ranking pelo número de avaliações no iFood, num raio de 5 km.
// O servidor calcula posição e totais sobre todas as lojas do raio (rank_*, total_*).
function analyze(d){
  const m = d.merchant;
  const me = d.nearby.find(x => x.id === m.id);
  const count3m = me?.count_3m ?? null;
  return {posAll: me?.rank_all ?? null, posCat: me?.rank_cat ?? null,
    totalAll: d.nearby[0]?.total_all ?? 0, totalCat: me?.total_cat ?? 0,
    growth: count3m ? m.rating_count / count3m - 1 : null, count3m};
}

function showDone(d){
  const m = d.merchant, a = analyze(d);
  const where = [m.district, [m.city, m.state].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  const trend = a.growth == null ? '' : ` · <span class="${a.growth >= 0 ? 'up' : 'down'}">${a.growth >= 0 ? '▲' : '▼'} ${pct(a.growth)}</span>`;
  view.innerHTML = `<div class="card">
      <p class="hint">✓ Na base da Brase</p>
      <div class="name">${esc(m.name)}</div>
      <div class="chips">${m.category ? `<span class="chip">${esc(m.category)}</span>` : ''}${m.chain ? `<span class="chip">Rede: ${esc(m.chain)}</span>` : ''}${where ? `<span class="chip">${esc(where)}</span>` : ''}</div>
    </div>
    <div class="stats">
      <div class="stat"><span class="l">Na categoria</span><span class="v">${a.posCat ? '#' + fmt(a.posCat) : '—'}</span><span class="s">de ${lojas(a.totalCat)} em ${KM} km</span></div>
      <div class="stat"><span class="l">Geral</span><span class="v">${a.posAll ? '#' + fmt(a.posAll) : '—'}</span><span class="s">de ${lojas(a.totalAll)} em ${KM} km</span></div>
      <div class="stat"><span class="l">Avaliações no iFood</span><span class="v">${fmt(m.rating_count)}</span><span class="s">${a.count3m != null ? `3 meses atrás: ${fmt(a.count3m)}${trend}` : 'histórico em formação'}</span></div>
      <div class="stat"><span class="l">Pedidos estimados</span><span class="v">${fmt((m.rating_count || 0) * ORDERS_PER_REVIEW)}</span><span class="s">avaliações × ${ORDERS_PER_REVIEW}</span></div>
    </div>
    <p class="hint">O ranking considera só as lojas que já estão na base da Brase.</p>
    <button class="btn primary" id="ficha">Abrir ficha completa</button>`;
  document.getElementById('ficha').addEventListener('click', () => open(`${APP}#/r/${m.id}`));
}

async function include(id){
  view.innerHTML = '<p class="hint">Incluindo e lendo a loja no iFood…</p>';
  try {
    const {results} = await call({op: 'include', links: [id]});
    const r = results?.[0];
    if (!r?.ok) return showError(r?.error || 'Não consegui incluir essa loja.', id);
    view.innerHTML = `<p class="hint">${r.existing ? 'Já estava na base' : 'Incluída'}: ${esc(r.name)}. Calculando a posição no ranking…</p>`;
    showDone(await call({op: 'detail', id, km: KM}));
  } catch (e){
    if (e.code === 'unauthorized') return showCode(() => include(id), (await chrome.storage.local.get('code')).code ? 'Código inválido. Confira com o gestor.' : '');
    showError(e.message, id);
  }
}

chrome.tabs.query({active: true, currentWindow: true}).then(([tab]) => {
  const id = merchantFromUrl(tab?.url || '');
  if (id) showReady(id);
  else if (isIfood(tab?.url || '')) scan(tab.id);
  else showNotStore();
});
