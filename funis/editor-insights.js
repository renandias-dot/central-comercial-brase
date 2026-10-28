/* Funis Brase — editor: leitura dos leads (perfil, nota, abandono, repetidos), anúncios e custos, caminhos,
 * integrações (API de Conversões, gasto da Meta, vendas do checkout, etapas do CRM) e importação de leads do InLead. */
'use strict';
const INS = {ads: null, adsKey: '', paths: null, pathsKey: '', e2e: null, e2eKey: '', scope: 'paid', crm: null, int: null, intId: null, level: 'ad', sort: {k: 'visits', d: -1}, sel: null, utm: []};
// Central Comercial (CRM): o lead abre direto pelo endereço #lead=<id>.
const CRM_APP = 'https://app.brasemarketing.com.br/';
const needServer = () => { if (!DB.server) throw new Error('Isso precisa do servidor (Supabase) configurado.') };
const money = v => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pctOf = v => v == null ? '—' : (v * 100).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + '%';
const leadsCfg = () => (D.settings.leads = D.settings.leads || {});

/* ================= regras no navegador (as mesmas do servidor: funis-api/logic.ts › leadMetrics) ================= */
function validPhone(e164){ const d = String(e164 || '').replace(/^55/, ''); return !!d && !FR.validateField({type: 'phone'}, d) }
function leadVars(l){
  const clicks = {}; for (const c of Object.values(l.clicks || {})) if (c && c.name) clicks[c.name] = true;
  const v = Object.assign({}, FR.buildVars({answers: l.answers || {}, params: l.params || {}, clicks, screen: (l.tracking || {}).screen, platform: (l.tracking || {}).platform}));
  return Object.assign(v, {'lead.etapas': (l.steps || []).length, 'lead.completo': l.completed ? 'sim' : 'nao', 'lead.telefone': l.phone ? 'sim' : 'nao', 'lead.telefone_valido': validPhone(l.phone) ? 'sim' : 'nao', 'lead.crm': (l.crm && l.crm.stage) || ''});
}
const hasGroups = r => Array.isArray(r) && r.some(g => Array.isArray(g) && g.length);
function leadInsight(l){
  const ls = D.settings.leads || {}, vars = leadVars(l);
  const rules = (ls.score || []).filter(r => r && Number(r.points));
  let score = 0; const reasons = [];
  for (const r of rules) if (!hasGroups(r.when) || FR.evalRoles(r.when, {vars})) { score += Number(r.points); if (r.label) reasons.push(r.label + ' (+' + r.points + ')') }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tags = (ls.tags || []).filter(t => t && String(t.label || '').trim() && hasGroups(t.when) && FR.evalRoles(t.when, {vars})).map(t => String(t.label).trim());
  return {icp: hasGroups(ls.icp) ? FR.evalRoles(ls.icp, {vars}) : null, score: rules.length ? score : null, hot: rules.length && Number(ls.hot) > 0 ? score >= Number(ls.hot) : null, reasons, tags};
}
const STAGE_NAMES = {novo: 'Lead Novo', link: 'Link Recebido', print: 'Print Enviado', qualificando: 'Qualificando', agendando: 'Agendando', marcada: 'Reunião Marcada', feita: 'Reunião Feita', fechado: 'Fechado', perdido: 'Perdido', desqualificado: 'Desqualificado', frio: 'Frio', morno: 'Morno'};
// Colunas extras da tabela de respostas.
function insightHead(){ return ['Nota', 'Perfil', 'Etiquetas', 'Teste A/B', 'WhatsApp', 'Envio', 'CRM', 'Venda'] }
const abOf = l => Object.entries(l.params || {}).filter(([k]) => /^teste_/.test(k)).map(([k, v]) => k.slice(6) + ': ' + v).join(' · ');
function insightCells(l, data){
  const m = leadInsight(l), phones = data._phones || (data._phones = (data.leads || []).reduce((a, x) => { if (x.phone) a[x.phone] = (a[x.phone] || 0) + 1; return a }, {}));
  const sales = (data.sales || []).filter(s => s.session_id === l.id);
  const wh = l.webhook || null;
  const envio = !wh ? (l.phone ? '<span class="chip">não enviou</span>' : '') : wh.kind === 'importado' ? '<span class="chip">importado</span>' : wh.skipped ? '<span class="chip">repetido</span>' : wh.kind === 'abandono' ? `<span class="chip${wh.ok ? ' acc' : ' bad'}">abandono</span>` : wh.ok ? '<span class="chip ok">enviado</span>' : `<span class="chip bad" title="${attr(wh.error || '')}">falhou</span>`;
  const zap = l.phone ? (validPhone(l.phone) ? '<span class="chip ok">válido</span>' : '<span class="chip bad">inválido</span>') + (phones[l.phone] > 1 ? ' <span class="chip">repetido</span>' : '') : '';
  return [
    m.score == null ? '' : `<b class="num"${m.hot ? ' style="color:var(--ok, #15803d)"' : ''} title="${attr(m.reasons.join(' · '))}">${m.score}</b>${m.hot ? ' 🔥' : ''}`,
    m.icp == null ? '' : m.icp ? '<span class="chip ok">no perfil</span>' : '<span class="chip">fora</span>',
    m.tags.map(t => `<span class="chip acc">${esc(t)}</span>`).join(' '), esc(abOf(l)),
    zap, envio,
    l.crm && l.crm.stage ? esc(STAGE_NAMES[l.crm.stage] || l.crm.stage) : '',
    sales.length ? sales.map(s => `<span class="chip${s.status === 'approved' ? ' ok' : s.status === 'refunded' ? ' bad' : ''}">${s.status === 'approved' ? money(s.value) : s.status === 'refunded' ? 'reembolso' : esc(s.status)}</span>`).join(' ') : '',
  ];
}
function insightDrawer(l, data){
  const m = leadInsight(l), sales = (data.sales || []).filter(s => s.session_id === l.id);
  const rows = [];
  if (m.score != null) rows.push(`<div class="row" style="justify-content:space-between"><span class="muted">Nota do lead</span><b>${m.score}${m.hot ? ' 🔥 quente' : ''}</b></div>${m.reasons.length ? `<p class="hint">${esc(m.reasons.join(' · '))}</p>` : ''}`);
  if (m.icp != null) rows.push(`<div class="row" style="justify-content:space-between"><span class="muted">Perfil</span>${m.icp ? '<span class="chip ok">no perfil</span>' : '<span class="chip">fora do perfil</span>'}</div>`);
  if (m.tags.length) rows.push(`<div class="row" style="justify-content:space-between"><span class="muted">Etiquetas</span><span>${m.tags.map(t => `<span class="chip acc">${esc(t)}</span>`).join(' ')}</span></div>`);
  if (abOf(l)) rows.push(`<div class="row" style="justify-content:space-between"><span class="muted">Teste A/B</span><span>${esc(abOf(l))}</span></div>`);
  if (l.phone) rows.push(`<div class="row" style="justify-content:space-between"><span class="muted">WhatsApp</span><span>+${esc(l.phone)} ${validPhone(l.phone) ? '<span class="chip ok">válido</span>' : '<span class="chip bad">confira</span>'}</span></div>`);
  if (l.crm && l.crm.stage) {
    const c = l.crm, when = (t, d) => d ? `<span class="chip ok">${t} ${esc(fmtDate(d))}</span>` : '';
    rows.push(`<div class="row" style="justify-content:space-between"><span class="muted">Central Comercial</span><span>${esc(STAGE_NAMES[c.stage] || c.stage)}${c.value ? ' · ' + money(c.value) : ''}${c.lead ? ` · <a href="${attr(CRM_APP + '#lead=' + encodeURIComponent(c.lead))}" target="_blank" rel="noopener">abrir</a>` : ''}</span></div>`);
    if (c.booked || c.met || c.closed || c.lost) rows.push(`<div class="row" style="justify-content:flex-end;flex-wrap:wrap;gap:4px">${when('agendou', c.booked)}${when('reunião', c.met)}${when('fechou', c.closed)}${c.lost ? `<span class="chip">${esc(c.lost)}</span>` : ''}</div>`);
  }
  for (const s of sales) rows.push(`<div class="row" style="justify-content:space-between"><span class="muted">Venda${s.product ? ' · ' + esc(s.product) : ''}</span><span>${s.status === 'approved' ? money(s.value) : esc(s.status)} · ${esc(fmtDateTime(s.created_at))}</span></div>`);
  return rows.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Leitura do lead</div><div style="display:grid;gap:6px">${rows.join('')}</div></div>` : '';
}

/* ================= Leads › Anúncios ================= */
const LEVEL_OPTS = [['campaign', 'Campanha', 'utm_campaign'], ['adset', 'Conjunto', 'utm_medium'], ['ad', 'Anúncio', 'utm_content'], ['placement', 'Posicionamento', 'utm_term'], ['source', 'Origem', 'utm_source']];
const intOrDash = n => n ? fmtInt(n) : '—';
const AD_COLS = [
  ['spend', 'Gasto', r => money(r.spend)], ['impressions', 'Impressões', r => intOrDash(r.impressions)], ['link_clicks', 'Cliques', r => intOrDash(r.link_clicks)], ['ctr', 'CTR', r => pctOf(r.ctr)], ['cpc', 'CPC', r => money(r.cpc)],
  ['visits', 'Visitas', r => fmtInt(r.visits)], ['startRate', 'Inícios', r => `${fmtInt(r.started)} <small>${pctOf(r.startRate)}</small>`],
  ['icp', 'No perfil', r => `${fmtInt(r.icp)} <small>${pctOf(r.icpRate)}</small>`], ['score', 'Nota média', r => r.score == null ? '—' : fmtInt(r.score)],
  ['submitted', 'Envios', r => fmtInt(r.submitted)], ['abandoned', 'Abandonos', r => fmtInt(r.abandoned)], ['meetings', 'Agendaram', r => fmtInt(r.meetings)], ['met', 'Reuniões feitas', r => fmtInt(r.met)],
  ['sales', 'Vendas', r => fmtInt(r.sales + r.won)], ['revenue', 'Receita', r => money(r.revenue)],
  ['cpl', 'Custo/envio', r => money(r.cpl)], ['cpIcp', 'Custo/lead no perfil', r => money(r.cpIcp)], ['cpMeeting', 'Custo/agendamento', r => money(r.cpMeeting)], ['cpMet', 'Custo/reunião feita', r => money(r.cpMet)], ['cpSale', 'Custo/venda', r => money(r.cpSale)],
  ['roas', 'ROAS', r => r.roas == null ? '—' : r.roas.toLocaleString('pt-BR', {maximumFractionDigits: 2}) + 'x'],
];
const levelOpts = () => LEVEL_OPTS.concat(FR.abTests(D).map(t => ['ab:' + FR.abName(t.name), 'Teste: ' + FR.abName(t.name), 'teste_' + FR.abName(t.name)]));
async function loadAds(force){
  needServer();
  const key = [REC.id, UI.leads.period, INS.level, JSON.stringify(D.settings.leads || {})].join('|');
  if (!force && INS.ads && INS.adsKey === key) return INS.ads;
  INS.ads = await api('leads.ads', {id: REC.id, period: UI.leads.period, level: INS.level, settings: D.settings.leads || {}}); INS.adsKey = key;
  if (INS.level === 'ad') INS.utm = INS.ads.rows.map(r => r.key).filter(Boolean);
  return INS.ads;
}
async function adsHtml(){
  if (!DB.server) return '<div class="panel"><div class="empty">Os números por anúncio precisam do servidor configurado.</div></div>';
  const r = await loadAds();
  const {k, d} = INS.sort, rows = r.rows.slice().sort((a, b) => ((a[k] ?? -1) - (b[k] ?? -1)) * d);
  const t = r.totals, lvl = levelOpts().find(x => x[0] === INS.level) || ['', 'Variante', r.param];
  const noSpend = !t.spend, noRules = !hasGroups((D.settings.leads || {}).icp);
  const sel = rows.find(x => x.key === INS.sel) || null;
  return `<div class="row" style="margin-bottom:10px;flex-wrap:wrap;gap:8px"><span class="seg">${levelOpts().map(([v, l]) => `<button data-a="ads-level" data-v="${v}" aria-pressed="${INS.level === v}">${l}</button>`).join('')}</span>
      <span class="hint">${/^ab:/.test(INS.level) ? `agrupado pela variante do teste (<code>${lvl[2]}</code>) · Inícios mostra quanto cada capa faz começar` : `agrupado por <code>${lvl[2]}</code> do link do anúncio`} · clique numa linha para ver o dia a dia</span><span style="flex:1"></span><button class="btn sm" data-a="ads-csv">${IC.download}CSV</button></div>
    ${noSpend || noRules ? `<div class="banner" style="margin-bottom:10px">${noSpend ? (/^(campaign|adset|ad)$/.test(INS.level) ? 'Sem gasto da Meta para os anúncios deste funil no período. O gasto entra sozinho (Central Comercial, rotina diária da Meta ou token em Configurações › Pixel/Scripts) ou pela planilha do Gerenciador. ' : 'Gasto e números da Meta aparecem só por campanha, conjunto e anúncio. ') : ''}${noRules ? 'Defina a regra de perfil em Configurações › Leads e dados para ver quantos leads no perfil cada anúncio traz.' : ''}</div>` : ''}
    <div class="tbl-wrap"><table class="tbl ads"><thead><tr><th class="sticky">${lvl[1]}</th>${AD_COLS.map(([c, l]) => `<th data-a="ads-sort" data-v="${c}" style="cursor:pointer">${l}${INS.sort.k === c ? (d < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(x => `<tr data-a="ads-row" data-key="${attr(x.key)}"${x.key === INS.sel ? ' class="on"' : ''}><td class="sticky" title="${attr(x.key)}">${esc(x.name)}${x.id ? `<span class="nm">${esc(x.id)}</span>` : ''}</td>${AD_COLS.map(([, , f]) => `<td class="num">${f(x)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${AD_COLS.length + 1}" class="empty">Sem acessos no período.</td></tr>`}</tbody>
      <tfoot><tr><td class="sticky"><b>Total</b></td>${AD_COLS.map(([, , f]) => `<td class="num"><b>${f(Object.assign({started: t.started, won: t.won || 0}, t))}</b></td>`).join('')}</tr></tfoot></table></div>
    ${sel ? fatigueHtml(sel) : ''}
    <p class="hint" style="margin-top:8px">Impressões, cliques (no link), CTR e CPC vêm da Meta · Envios = clicaram no componente do webhook · Abandonos = deixaram o WhatsApp e não enviaram · Agendaram, reuniões feitas e vendas vêm da Central Comercial (a cada 30 min) · ROAS = (vendas do checkout + vendas da Central) ÷ gasto.</p>`;
}
// Cansaço do criativo: taxa de início por dia (quem começou ÷ quem visitou).
function fatigueHtml(r){
  const days = r.daily || [];
  if (!days.length) return '';
  const max = Math.max(...days.map(x => x.visits ? x.started / x.visits : 0), 0.01);
  return `<section class="panel" style="margin-top:12px"><div class="panel-h"><h2>${esc(r.name)} · dia a dia</h2><span class="hint">taxa de início (barra) e visitas por dia</span></div><div class="panel-b">
    <div class="vchart">${days.map(x => { const k = x.visits ? x.started / x.visits : 0; return `<div class="c" data-tip="${attr(fmtDate(x.day + 'T12:00'))}" data-tipv="${attr(pctOf(k) + ' de início · ' + fmtInt(x.visits) + ' visitas')}" tabindex="0"><i style="height:${k / max * 100}%"></i></div>` }).join('')}</div>
    <div class="vaxis"><span>${esc(fmtDate(days[0].day + 'T12:00'))}</span><span>${esc(fmtDate(days[days.length - 1].day + 'T12:00'))}</span></div>
    <p class="hint" style="margin-top:6px">Queda contínua na taxa de início com o mesmo público costuma indicar criativo cansado.</p></div></section>`;
}
function adsCsv(){
  const r = INS.ads; if (!r) return;
  const head = ['nome', 'id'].concat(AD_COLS.map(c => c[1]));
  const plain = (x, c) => { const v = x[c]; return v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v };
  const lines = [head.map(csvCell).join(';')].concat(r.rows.map(x => [x.name, x.id].concat(AD_COLS.map(([c]) => c === 'sales' ? x.sales + x.won : plain(x, c))).map(csvCell).join(';')));
  download(`anuncios-${REC.slug}-${INS.level}-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

/* ================= Leads › Ponta a ponta ================= */
// Meta (gasto, impressões, cliques) → funil (visitas, envios) → Central Comercial (agendou, reunião feita, fechou).
async function loadE2E(force){
  needServer();
  const account = INS.scope === 'account', key = [REC.id, UI.leads.period, account, JSON.stringify(D.settings.leads || {})].join('|');
  if (!force && INS.e2e && INS.e2eKey === key) return INS.e2e;
  INS.e2e = await api('leads.e2e', {id: REC.id, period: UI.leads.period, settings: D.settings.leads || {}, scope: account ? 'account' : 'funnel'}); INS.e2eKey = key;
  return INS.e2e;
}
const ago = t => { if (!t) return ''; const m = Math.round((Date.now() - new Date(t)) / 60e3); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : 'em ' + fmtDateTime(t) };
const STAGE_ORDER = ['novo', 'link', 'print', 'qualificando', 'agendando', 'marcada', 'feita', 'fechado', 'perdido', 'desqualificado', 'frio', 'morno'];
async function e2eHtml(){
  if (!DB.server) return '<div class="panel"><div class="empty">A visão ponta a ponta precisa do servidor configurado.</div></div>';
  const r = await loadE2E(), account = r.scope === 'account', paid = account || INS.scope !== 'all', b = paid ? r.paid : r.all, m = r.meta, src = r.sources || {}, crm = src.crm || {}, meta = src.meta || {};
  const div = (a, x) => x ? a / x : null, per = n => m.spend && n ? m.spend / n : null, won = b.won + b.sales, leadsN = account ? b.inCrm : b.submitted;
  const yesterday = new Date(Date.now() - 27 * 3600e3).toISOString().slice(0, 10);
  const k = (l, v, s) => `<div class="kpi"><span class="l">${l}</span><span class="v">${v}</span><span class="s">${s}</span></div>`;
  const steps = [
    ['Impressões', 'Meta', m.impressions, null, '', null],
    ['Cliques no link', 'Meta', m.link_clicks, div(m.link_clicks, m.impressions), 'CTR', per(m.link_clicks)],
    ['Visitas na página', 'Meta', m.lpv, div(m.lpv, m.link_clicks), 'dos cliques', per(m.lpv)],
    ['Visitas no funil', 'Funil', b.visits, null, '', per(b.visits)],
    ['Começaram o quiz', 'Funil', b.started, div(b.started, b.visits), 'das visitas', per(b.started)],
    ['Deixaram o WhatsApp', 'Funil', b.contacts, div(b.contacts, b.started), 'de quem começou', per(b.contacts)],
    ['Enviaram (lead)', 'Funil', b.submitted, div(b.submitted, b.contacts), 'de quem deixou', per(b.submitted)],
    account ? ['Leads da Meta na Central', 'Central', b.inCrm, null, '', per(b.inCrm)] : ['Chegaram na Central', 'Central', b.inCrm, div(b.inCrm, b.submitted), 'dos envios', per(b.inCrm)],
    ['Agendaram reunião', 'Central', b.booked, div(b.booked, b.inCrm), 'de quem chegou', per(b.booked)],
    ['Reunião feita', 'Central', b.met, div(b.met, b.booked), 'das agendadas', per(b.met)],
    ['Fecharam', 'Central', won, div(won, b.met), 'das reuniões', per(won)],
  ];
  const stages = (paid ? r.stages.paid : r.stages.all) || {}, nSt = Object.values(stages).reduce((a, x) => a + x, 0);
  const stRows = STAGE_ORDER.filter(s => stages[s]).concat(Object.keys(stages).filter(s => !STAGE_ORDER.includes(s))).map(s => ({label: STAGE_NAMES[s] || s, n: stages[s]}));
  const notes = [];
  if (!crm.configured) notes.push('<div class="banner warn">A Central Comercial ainda não está ligada: guarde o código dela em Configurações › Integrações para ver agendamentos, reuniões e vendas.</div>');
  else if (crm.ok === false) notes.push(`<div class="banner warn">A última leitura da Central Comercial falhou (${esc(crm.error || 'erro')}). Os números da Central podem estar desatualizados.</div>`);
  const periodFrom = UI.leads.period === 'all' ? '' : new Date(Date.now() - ({day: 1, week: 7, month: 30}[UI.leads.period] || 7) * 864e5 - 3 * 3600e3).toISOString().slice(0, 10);
  if (!account && r.firstPaid && periodFrom && r.firstPaid > periodFrom) notes.push(`<div class="banner">Este funil recebe anúncios desde ${esc(fmtDate(r.firstPaid + 'T12:00'))}; antes disso os anúncios levavam para outro funil. Por isso o investimento aqui é ${money(m.spend)}, enquanto a conta inteira investiu ${money(meta.accountSpend)} no período. Para ver o total com todos os leads da Central, use “Conta inteira”.</div>`);
  if (!m.spend) notes.push(`<div class="banner">Sem gasto da Meta ${account ? 'na conta' : 'para os anúncios deste funil'} no período.</div>`);
  else if (meta.lastDay && meta.lastDay < yesterday) notes.push(`<div class="banner warn">O gasto da Meta vai até ${esc(fmtDate(meta.lastDay + 'T12:00'))}: os custos dos dias seguintes ainda não entraram.</div>`);
  const status = [meta.updatedAt ? `Meta: até ${esc(fmtDate(meta.lastDay + 'T12:00'))}, atualizado ${esc(ago(meta.updatedAt))}` : 'Meta: sem dados', crm.configured ? (crm.at ? `Central: lida ${esc(ago(crm.at))}` : 'Central: ainda não lida') : 'Central: desligada'].join(' · ');
  const days = (r.daily || []).slice().reverse();
  return `<div class="row" style="margin-bottom:10px;flex-wrap:wrap;gap:8px"><span class="seg"><button data-a="e2e-scope" data-v="paid" aria-pressed="${INS.scope === 'paid'}">Este funil · anúncios da Meta</button><button data-a="e2e-scope" data-v="all" aria-pressed="${INS.scope === 'all'}">Este funil · todo o tráfego</button><button data-a="e2e-scope" data-v="account" aria-pressed="${account}">Conta inteira</button></span>
      <span class="hint">${status}</span><span style="flex:1"></span>${crm.configured ? `<button class="btn sm" data-a="crm-sync">${IC.refresh}Ler a Central agora</button>` : ''}</div>
    ${notes.length ? `<div style="display:grid;gap:8px;margin-bottom:10px">${notes.join('')}</div>` : ''}
    <div class="kpis">${k('Investimento', money(m.spend), m.impressions ? `${fmtInt(m.impressions)} impressões · CTR ${pctOf(div(m.link_clicks, m.impressions))}` : 'Meta, anúncios deste funil')}${k(account ? 'Leads da Meta (Central)' : 'Leads (envios)', fmtInt(leadsN), `custo por lead ${money(per(leadsN))}`)}${k('Agendaram', fmtInt(b.booked), `custo por agendamento ${money(per(b.booked))}`)}${k('Reuniões feitas', fmtInt(b.met), `custo por reunião ${money(per(b.met))}`)}${k('Vendas', fmtInt(won), `CAC ${money(per(won))}${b.revenue ? ' · ' + money(b.revenue) + ' · ROAS ' + (div(b.revenue, m.spend) || 0).toLocaleString('pt-BR', {maximumFractionDigits: 2}) + 'x' : ''}`)}</div>
    <div style="display:grid;gap:12px;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)" class="perf">
      <section class="panel"><div class="panel-h"><h2>Do anúncio à venda</h2><span class="hint">${account ? 'conta inteira: todo o gasto da Meta, todos os funis e os leads da Meta na Central' : paid ? 'só visitas que vieram de anúncio da Meta' : 'todas as visitas; custos sobre o gasto da Meta'}</span></div><div class="panel-b">
        <table class="tbl" style="width:100%"><thead><tr><th>Etapa</th><th>De onde</th><th>Quantos</th><th>Passaram</th><th>Custo por</th></tr></thead><tbody>
        ${steps.map(([l, s, n, rate, rl, c]) => `<tr><td>${esc(l)}</td><td><span class="chip${s === 'Central' ? ' acc' : s === 'Meta' ? '' : ' ok'}">${s}</span></td><td class="num"><b>${fmtInt(n)}</b></td><td class="num">${rate == null ? '' : `${pctOf(rate)} <small class="muted">${rl}</small>`}</td><td class="num">${money(c)}</td></tr>`).join('')}</tbody></table>
        <p class="hint" style="margin-top:8px;white-space:normal">A Meta contou ${fmtInt(m.meta_leads)} leads pelo Pixel no período. ${account ? 'Os leads da Central contam pela data em que entraram lá, inclusive os que chegaram por outro caminho (InLead, WhatsApp direto); custo por lead = investimento ÷ leads da Meta na Central, como na aba Tráfego da Central. Visitas e envios somam todos os funis.' : 'Visitas, envios e etapas da Central contam pela data da visita no funil; agendamentos e vendas aparecem conforme a equipe avança o lead na Central (lida a cada 30 min). O gasto de um anúncio entra neste funil a partir do dia em que ele passou a mandar visitas para cá.'}</p></div></section>
      <section class="panel"><div class="panel-h"><h2>Onde estão os leads${account ? ' da Meta' : ''} na Central</h2><span class="hint">${fmtInt(nSt)} leads deste período</span></div><div class="panel-b">${stRows.length ? barsHtml(stRows, nSt) : '<div class="empty">Nenhum lead deste período chegou na Central ainda.</div>'}</div></section>
    </div>
    <section class="panel" style="margin-top:12px"><div class="panel-h"><h2>Dia a dia</h2><span class="hint">${account ? 'conta inteira; leads da Meta pela data de entrada na Central' : 'só tráfego dos anúncios da Meta'}</span></div><div class="panel-b"><div class="tbl-wrap" style="min-height:0;max-height:420px">
      <table class="tbl" style="width:100%"><thead><tr><th>Dia</th><th>Gasto</th><th>Impressões</th><th>Cliques</th><th>Visitas</th><th>${account ? 'Leads (Central)' : 'Envios'}</th><th>Custo/lead</th><th>Agendaram</th><th>Reuniões feitas</th><th>Fecharam</th></tr></thead><tbody>
      ${days.map(d => { const n = account ? d.inCrm : d.submitted; return `<tr><td>${esc(fmtDate(d.day + 'T12:00'))}</td><td class="num">${money(d.spend)}</td><td class="num">${intOrDash(d.impressions)}</td><td class="num">${intOrDash(d.link_clicks)}</td><td class="num">${fmtInt(d.visits)}</td><td class="num">${fmtInt(n)}</td><td class="num">${money(d.spend && n ? d.spend / n : null)}</td><td class="num">${fmtInt(d.booked)}</td><td class="num">${fmtInt(d.met)}</td><td class="num">${fmtInt(d.won + d.sales)}</td></tr>` }).join('') || '<tr><td colspan="10" class="empty">Sem dados no período.</td></tr>'}</tbody></table></div></div></section>`;
}

/* ================= Leads › Caminhos ================= */
async function pathsHtml(){
  if (!DB.server) return '<div class="panel"><div class="empty">Os caminhos precisam do servidor configurado.</div></div>';
  const key = REC.id + '|' + UI.leads.period;
  if (!INS.paths || INS.pathsKey !== key) { INS.paths = await api('leads.paths', {id: REC.id, period: UI.leads.period}); INS.pathsKey = key }
  const p = INS.paths, secs = s => s == null ? '—' : s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
  const maxN = Math.max(1, ...p.transitions.map(t => t.n));
  return `<div style="display:grid;gap:12px;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)" class="perf">
    <section class="panel"><div class="panel-h"><h2>Cada etapa</h2><span class="hint">quem viu, quem parou ali, tempo até avançar e quem voltou</span></div><div class="panel-b">
      <table class="tbl"><thead><tr><th>Etapa</th><th>Viram</th><th>Pararam aqui</th><th>Tempo mediano</th><th>Voltaram</th></tr></thead><tbody>
      ${p.steps.map(s => `<tr><td>${esc(s.title)}</td><td class="num">${fmtInt(s.visitors)}</td><td class="num">${fmtInt(s.exits)} <small>${fmtPct(s.exits, s.visitors)}</small></td><td class="num">${secs(s.medianSec)}</td><td class="num">${fmtInt(s.backs)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sem acessos no período.</td></tr>'}</tbody></table>
      <p class="hint" style="margin-top:6px">Tempo alto e muita gente parando na mesma etapa costumam indicar pergunta confusa ou formulário pesado.</p></div></section>
    <section class="panel"><div class="panel-h"><h2>Caminhos mais comuns</h2><span class="hint">de uma etapa para a próxima</span></div><div class="panel-b">
      <div class="bars">${p.transitions.map(t => `<div class="bar-r" data-tip="${attr(t.fromTitle + ' → ' + t.toTitle)}" data-tipv="${attr(fmtInt(t.n) + ' pessoas')}" tabindex="0"><span class="lb" title="${attr(t.fromTitle + ' → ' + t.toTitle)}">${esc(t.fromTitle)} → ${esc(t.toTitle)}</span><span class="tr"><i style="width:${t.n / maxN * 100}%"></i></span><span class="vl num">${fmtInt(t.n)}</span></div>`).join('') || '<div class="empty">Sem caminhos no período.</div>'}</div></div></section></div>`;
}

/* ================= Configurações › Leads e dados ================= */
// Editor de regras (OU de grupos E), guardado em D.settings no caminho dado (ex.: leads.icp).
function rulesBuilder(path, roles, addLabel){
  const vs = typeof allVars === 'function' ? allVars() : [];
  const label = Object.fromEntries(FR.ROLE_OPERATORS);
  const list = `<datalist id="fn-vars-cfg">${vs.map(x => `<option value="@${attr(x.name)}">${esc(x.stepTitle)}</option>`).join('')}<option value="@score">pontuação total</option><option value="@lead.telefone_valido">WhatsApp válido (sim/nao)</option><option value="@lead.completo">completou (sim/nao)</option><option value="@lead.etapas">número de etapas vistas</option><option value="@tracking.utm_content">anúncio (utm_content)</option><option value="@tracking.utm_campaign">campanha (utm_campaign)</option>${FR.abTests(D).map(t => `<option value="@teste.${attr(FR.abName(t.name))}">teste A/B · ${esc(FR.abVariants(t).join(', '))}</option>`).join('')}</datalist>`;
  const valIn = (g, c, cond) => {
    const vdef = vs.find(x => '@' + x.name === cond.variable);
    if (vdef && vdef.type === 'options' && ['==', '!='].includes(cond.compare)) return `<select class="in" data-rr="${path}|${g}.${c}.value"><option value="">—</option>${vdef.values.map(([v, lb]) => `<option value="${attr(v)}"${String(cond.value) === v ? ' selected' : ''}>${esc(v)} · ${esc(lb.slice(0, 34))}</option>`).join('')}</select>`;
    return `<input class="in" data-rr="${path}|${g}.${c}.value" value="${attr(cond.value ?? '')}" placeholder="valor ou @variável" list="fn-vars-cfg">`;
  };
  const groups = Array.isArray(roles) ? roles : [];
  return `${list}<div style="display:grid;gap:6px">${groups.map((g, gi) => `${gi ? '<div class="roles-or">OU</div>' : ''}<div class="roles-g">${g.map((c, ci) => `<div class="cond"><div class="cr" style="grid-template-columns:1fr 28px"><input class="in" data-rr="${path}|${gi}.${ci}.variable" value="${attr(c.variable ?? '')}" placeholder="@variável" list="fn-vars-cfg"><button class="btn sm icon ghost" type="button" data-a="rr-del" data-p="${path}" data-g="${gi}" data-c="${ci}" title="Remover">${IC.x}</button></div>
      <div class="cr" style="grid-template-columns:150px 1fr"><select class="in" data-rr="${path}|${gi}.${ci}.compare">${FR.ROLE_OPERATORS.filter(([k]) => !/count|percent/.test(k)).map(([k]) => `<option value="${k}"${c.compare === k ? ' selected' : ''}>${esc(label[k])}</option>`).join('')}</select>${valIn(gi, ci, c)}</div></div>`).join('<div class="hint" style="font-weight:700">E</div>')}
      <button class="btn sm ghost" type="button" data-a="rr-add" data-p="${path}" data-g="${gi}" style="justify-self:start">${IC.plus}E…</button></div>`).join('')}
    <button class="btn sm" type="button" data-a="rr-group" data-p="${path}" style="justify-self:start">${IC.plus}${groups.length ? 'OU: novo grupo' : addLabel || 'Adicionar condição'}</button></div>`;
}
const settingsAt = path => path.split('.').reduce((a, k) => a == null ? a : a[k], D.settings);
function setRuleAt(spec, v, structural){
  const [path, rest] = spec.split('|'), [g, c, k] = rest.split('.');
  mutate(() => { const roles = settingsAt(path); roles[+g][+c][k] = v }, {key: 'rr' + spec, canvas: false});
  if (structural && k === 'variable') renderConfigBody();
}
function ensureRoles(path){ const ks = path.split('.'); let o = D.settings; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || (/^\d+$/.test(ks[i + 1]) ? [] : {}); if (!Array.isArray(o[ks[ks.length - 1]])) o[ks[ks.length - 1]] = []; return o[ks[ks.length - 1]] }
// Modelo para o BRASE 2: usa os nomes das perguntas do funil (faturamento, canal, dor e marketing).
function braseModel(){
  const by = re => { for (const s of D.steps) for (const l of s.layers) if (l.type === 'options' && re.test(FR.stripHtml((s.layers.find(x => x.type === 'text') || {content: {}}).content.text || '') + ' ' + s.title)) return '@' + l.content.name; return '' };
  const fat = by(/faturamento/i), canal = by(/vendas vem|de onde vem/i), dor = by(/acontecendo|^dor/i), mkt = by(/marketing|mkt/i);
  if (!fat) { toast('Não achei a pergunta de faturamento neste funil.', 'err'); return }
  const C = (variable, compare, value) => ({variable, compare, value});
  mutate(() => {
    const ls = leadsCfg();
    ls.icp = [[C(fat, '>=', '10000')]];
    ls.score = [
      {label: 'Fatura R$ 30 mil ou mais', points: 40, when: [[C(fat, '>=', '30000')]]},
      {label: 'Fatura de R$ 10 a 30 mil', points: 30, when: [[C(fat, '==', '10000')]]},
      {label: 'Fatura de R$ 5 a 10 mil', points: 10, when: [[C(fat, '==', '5000')]]},
      canal && {label: 'Vende mais pelo iFood', points: 10, when: [[C(canal, '==', '0')]]},
      dor && {label: 'Dor: lucro baixo ou visita sem venda', points: 10, when: [[C(dor, '==', 'C')], [C(dor, '==', 'B')]]},
      mkt && {label: 'Já tem equipe ou já pagou agência', points: 10, when: [[C(mkt, '==', 'B')], [C(mkt, '==', 'C')]]},
      {label: 'WhatsApp válido', points: 20, when: [[C('@lead.telefone_valido', '==', 'sim')]]},
    ].filter(Boolean);
    ls.hot = 70;
  }, {canvas: false});
  renderConfigBody(); toast('Modelo aplicado. Ajuste os pontos se quiser e publique o funil.');
}
function leadsDataHtml(){
  const ls = D.settings.leads || {}, F = k => 'F:settings.leads.' + k;
  return `<h2>Leads e dados</h2><p class="muted">Como cada lead é lido: se está no perfil, a nota de 0 a 100 e o que fazer com quem deixa o WhatsApp e não envia. A nota e o perfil aparecem na aba Leads e vão no webhook (<code>nota_lead</code>, <code>lead_no_perfil</code>, <code>lead_quente</code>). <b>Publique o funil</b> para valer na página.</p>
    <div class="row" style="flex-wrap:wrap"><button class="btn sm" data-a="leads-model">${IC.bulb}Usar o modelo Brase (faturamento, canal, dor, marketing)</button></div>
    <div class="psec"><span class="eyebrow">Regra de perfil (lead no perfil)</span><p class="hint">Quem cumpre estas condições conta como “no perfil” nos relatórios, no Pixel (evento LeadQualificado) e no webhook.</p>${rulesBuilder('leads.icp', ls.icp, 'Definir a regra de perfil')}</div>
    <div class="psec"><span class="eyebrow">Nota do lead (0 a 100)</span><p class="hint">Soma os pontos das regras que valem para o lead (limite de 100).</p>
      <div style="display:grid;gap:8px">${(ls.score || []).map((r, i) => `<div class="item"><div class="item-h"><b>Regra ${i + 1}</b><button class="btn sm icon ghost" type="button" data-a="score-del" data-i="${i}" title="Remover">${IC.trash}</button></div>
        <div class="g2" style="grid-template-columns:1fr 90px">${P.text(F(`score.${i}.label`), 'Descrição')}${P.num(F(`score.${i}.points`), 'Pontos')}</div>${rulesBuilder(`leads.score.${i}.when`, r.when, 'Quando…')}</div>`).join('')}
      <button class="btn sm" type="button" data-a="score-add" style="justify-self:start">${IC.plus}Adicionar regra de pontos</button></div>
      ${P.num(F('hot'), 'Lead quente a partir da nota', {min: 0, max: 100, hint: 'Vai no webhook como lead_quente: true para o SDR atender primeiro.'})}</div>
    <div class="psec"><span class="eyebrow">Quem deixou o WhatsApp e não enviou</span>${P.tog(F('abandon.enabled'), 'Mandar para o webhook como abandono')}${P.num(F('abandon.minutes'), 'Depois de quantos minutos sem atividade', {min: 5})}
      <p class="hint">O WhatsApp é guardado enquanto a pessoa digita. Vai com <code>abandonou: true</code> e a etapa onde parou. Se ela voltar e enviar, vai de novo, completo. Pela LGPD, use o texto de consentimento no campo de WhatsApp (aba Conteúdo do campo).</p></div>
    <div class="psec"><span class="eyebrow">Repetidos</span>${P.num(F('dedupeDays'), 'Não mandar de novo o mesmo telefone por (dias)', {min: 0, hint: '0 = desligado. Evita lead duplicado no CRM quando a pessoa refaz o funil.'})}</div>
    <div class="psec"><span class="eyebrow">Etiquetas para o SDR</span><p class="hint">Cada etiqueta que vale para o lead vai no webhook, no campo <code>etiquetas</code> (ex.: “DI, prioridade alta, Já pagou agência”), e aparece na aba Leads.</p>
      <div style="display:grid;gap:8px">${(ls.tags || []).map((r, i) => `<div class="item"><div class="item-h"><b>Etiqueta ${i + 1}</b><button class="btn sm icon ghost" type="button" data-a="tag-del" data-i="${i}" title="Remover">${IC.trash}</button></div>
        ${P.text(F(`tags.${i}.label`), 'Etiqueta')}${rulesBuilder(`leads.tags.${i}.when`, r.when, 'Quando…')}</div>`).join('')}
      <button class="btn sm" type="button" data-a="tag-add" style="justify-self:start">${IC.plus}Adicionar etiqueta</button></div></div>
    <div class="psec"><span class="eyebrow">Testes A/B</span><p class="hint">Cada visitante cai numa variante fixa (sorteada pelo código dele) e fica nela se voltar. Mostre um componente só numa variante com a condição <code>@teste.nome</code> é igual a <code>variante</code> (aba Avançado do componente). Compare em Leads › Anúncios › Teste. Terminou o teste? Deixe só a variante que ficou (ex.: <code>v3</code>): todo visitante passa a ser marcado com ela e a comparação com as anteriores continua. Para conferir uma variante, abra o funil com <code>?teste_nome=variante</code> no link.</p>
      <div style="display:grid;gap:8px">${(D.settings.ab || []).map((t, i) => `<div class="item"><div class="item-h"><b>Teste ${i + 1}</b><button class="btn sm icon ghost" type="button" data-a="ab-del" data-i="${i}" title="Remover">${IC.trash}</button></div>
        <div class="g2">${P.text('F:settings.ab.' + i + '.name', 'Nome (ex.: capa)')}${P.text('F:settings.ab.' + i + '.variants', 'Variantes, separadas por vírgula')}</div>${P.tog('F:settings.ab.' + i + '.enabled', 'Ligado', {defOn: true})}
        ${FR.abName(t.name) ? `<p class="hint">Condição: <code>@teste.${esc(FR.abName(t.name))}</code> · parâmetro no webhook: <code>teste_${esc(FR.abName(t.name))}</code></p>` : ''}</div>`).join('')}
      <button class="btn sm" type="button" data-a="ab-add" style="justify-self:start">${IC.plus}Novo teste A/B</button></div></div>`;
}

/* ================= Configurações › Integrações e Meta ================= */
async function loadInt(force){
  needServer();
  if (!force && INS.int && INS.intId === REC.id) return INS.int;
  INS.int = await api('integrations.get', {id: REC.id}); INS.intId = REC.id; return INS.int;
}
function intHtml(){
  if (!DB.server) return '<h2>Integrações</h2><div class="banner warn">As integrações precisam do servidor configurado.</div>';
  const it = INS.int;
  if (!it || INS.intId !== REC.id || !INS.crm) { Promise.all([loadInt(), loadCrm()]).then(() => { if (UI.cfg === 'integracoes') renderConfigBody() }).catch(e => toast(e.message, 'err')); return '<h2>Integrações</h2><div class="empty">Carregando…</div>' }
  const c = INS.crm, st = c.status || {};
  const crmState = !c.configured ? '<span class="chip">desligada</span>' : st.ok === false ? `<span class="chip bad" title="${attr(st.error || '')}">falhou ${esc(ago(st.at))}</span> <span class="hint">${esc(st.error || '')}</span>` : st.at ? `<span class="chip ok">ligada</span> <span class="hint">lida ${esc(ago(st.at))} · ${fmtInt(st.leads)} leads, ${fmtInt(st.matched)} ligados a visitas dos funis</span>` : '<span class="chip ok">ligada</span>';
  return `<h2>Integrações</h2>
    <div class="psec"><span class="eyebrow">Central Comercial (CRM) · automático</span><p class="hint" style="white-space:normal">Com o código de acesso da Central, o servidor lê os leads de lá a cada 30 minutos e liga cada um à visita no funil (pelo código do visitante que vai no webhook ou pelo WhatsApp). Etapa, agendamento, reunião feita e venda aparecem em Leads › Ponta a ponta e Anúncios. Também traz o investimento da Meta que a Central já buscou. Vale para todos os funis.</p>
      <div class="row" style="flex-wrap:wrap;gap:6px">${crmState}</div>
      <label class="f">Código de acesso da Central<input class="in" type="password" id="crm-key" autocomplete="off" placeholder="${c.configured ? '•••••••• (guardado no servidor; deixe vazio para manter)' : 'o mesmo que a equipe usa para entrar na Central'}"></label>
      <div class="row" style="flex-wrap:wrap"><button class="btn primary" data-a="crm-save">Salvar e ler agora</button>${c.configured ? `<button class="btn" data-a="crm-sync">${IC.refresh}Ler agora</button><button class="btn ghost" data-a="crm-clear">Desligar</button>` : ''}</div></div>
    <div class="psec"><span class="eyebrow">Vendas do checkout (Kirvano, Hotmart, Kiwify)</span><p class="hint">Cole este endereço no webhook de vendas do checkout (na Kirvano: Integrações › Webhooks, eventos de venda aprovada e reembolso). Cada venda entra ligada ao lead e aparece na aba Leads (coluna Venda e aba Anúncios).</p>
      <div class="row"><input class="in" readonly value="${attr(it.saleUrl)}"><button class="btn" data-a="copy" data-v="${attr(it.saleUrl)}">${IC.copy}Copiar</button></div>
      ${P.tog('F:settings.checkoutMark', 'Marcar o visitante no link do checkout (sck=fn-código)', {defOn: true})}<p class="hint">Assim a venda volta ligada ao lead certo mesmo se o telefone for diferente. Sem a marca, liga pelo telefone ou e-mail. Publique o funil para valer.</p></div>
    <div class="psec"><span class="eyebrow">Etapas de outro CRM (manual)</span><p class="hint">Sem a leitura automática acima: mande as etapas para este endereço (POST em JSON <code>{"codigo" ou "telefone", "etapa", "valor"}</code>, um lead ou uma lista) ou importe uma planilha com as colunas telefone (ou código), etapa e valor.</p>
      <div class="row"><input class="in" readonly value="${attr(it.crmUrl)}"><button class="btn" data-a="copy" data-v="${attr(it.crmUrl)}">${IC.copy}Copiar</button></div>
      <div class="row"><label class="btn">${IC.upload}Importar planilha do CRM<input type="file" hidden accept=".csv,text/csv" data-import="crm"></label></div></div>
    <div class="psec"><span class="eyebrow">Leads antigos do InLead</span><p class="hint">Traga os leads do InLead (planilha do “Exportar leads” ou o JSON da API do painel). Entram com nota, perfil e WhatsApp validado, marcados como importados (não vão de novo para o CRM).</p>
      <div class="row"><label class="btn">${IC.upload}Importar leads do InLead<input type="file" hidden accept=".csv,.json,text/csv,application/json" data-import="inlead" multiple></label></div></div>
    <div class="row" style="flex-wrap:wrap"><button class="btn ghost sm" data-a="int-newkey">Trocar a chave dos endereços</button><span class="hint">Use se algum endereço vazar; os antigos param de funcionar.</span></div>`;
}
function metaHtml(){
  const it = INS.int, F = k => 'F:settings.pixel.' + k;
  if (DB.server && (!it || INS.intId !== REC.id)) loadInt().then(() => { if (UI.cfg === 'pixel') renderConfigBody() }).catch(() => {});
  const secret = (k, label, set, ph) => `<label class="f">${esc(label)}<input class="in" type="password" data-int="${k}" placeholder="${set ? '•••••••• (guardado no servidor; deixe vazio para manter)' : ph || ''}" autocomplete="off"></label>`;
  return `<div class="psec"><span class="eyebrow">API de Conversões da Meta</span>
      ${P.tog(F('capi'), 'Mandar os eventos também pelo servidor (API de Conversões)')}${P.tog(F('icpEvent'), 'Avisar “LeadQualificado” quando o lead entra no perfil', {defOn: true})}
      <div class="psec" style="margin:6px 0 0;padding:0;border:0"><span class="eyebrow">Só quando… (opcional)</span><p class="hint">Sem condição, o evento sai assim que o lead entra no perfil. Com condição, espera também ela, ex.: <code>@VT19S2</code> é igual a <code>clicked</code> (o lead no perfil enviou o formulário). Assim a Meta aprende com quem de fato deixou o WhatsApp.</p>${rulesBuilder('pixel.icpWhen', (D.settings.pixel || {}).icpWhen, 'Adicionar condição')}</div>
      <p class="hint">O mesmo evento sai do navegador (Pixel) e do servidor com o mesmo código, então a Meta não conta duas vezes. O servidor manda telefone, e-mail e nome em SHA-256, IP, navegador, fbc e fbp. Eventos: os de botões e opções (aba Avançado), LeadQualificado e Purchase (vendas do checkout).</p>
      ${DB.server ? `${secret('capiToken', 'Token da API de Conversões', it && it.capiTokenSet, 'Gerenciador de Eventos › Configurações › Gerar token')}<label class="f">Código de teste (opcional)<input class="in" data-int="capiTest" value="${attr((it && it.capiTest) || '')}" placeholder="TEST12345"></label>` : '<div class="banner warn">Precisa do servidor configurado.</div>'}</div>
    <div class="psec"><span class="eyebrow">Gasto dos anúncios</span><p class="hint" style="white-space:normal">Gasto, impressões, cliques e visitas na página de cada anúncio entram sozinhos pela Central Comercial e pela atualização diária com a Meta, e aparecem em Leads › Ponta a ponta e Anúncios (custo por lead, por agendamento, por reunião, por venda e ROAS). Com o token abaixo, o próprio servidor busca na Meta a cada 30 minutos.</p>
      ${DB.server ? `<div class="row" style="flex-wrap:wrap"><label class="btn">${IC.upload}Importar planilha do Gerenciador de Anúncios<input type="file" hidden accept=".csv,text/csv" data-import="spend"></label><button class="btn ghost" data-a="spend-clear">Apagar gasto importado</button></div>
      <p class="hint">No Gerenciador: relatório por anúncio com as colunas Dia, Nome e Identificação do anúncio (ou conjunto/campanha) e Valor usado › Exportar › CSV.</p>
      <label class="f">Conta de anúncios (busca automática)<input class="in" data-int="adsAccount" value="${attr((it && it.adsAccount) || '')}" placeholder="act_123… ou só os números"></label>${secret('adsToken', 'Token de acesso da Meta (ads_read)', it && it.adsTokenSet, 'Token de usuário do sistema com permissão ads_read')}
      <div class="row" style="flex-wrap:wrap"><button class="btn primary" data-a="int-save">Salvar tokens</button><button class="btn" data-a="spend-sync">${IC.refresh}Buscar gasto dos últimos 30 dias</button></div>` : ''}</div>`;
}
async function loadCrm(force){
  needServer();
  if (!force && INS.crm) return INS.crm;
  INS.crm = await api('crm.config', {}); return INS.crm;
}
async function crmSync(){
  toast('Lendo a Central Comercial…');
  const r = await api('crm.sync', {});
  INS.crm = null; INS.e2e = null; INS.ads = null; LEADS.cache = null;
  toast(`Central lida: ${fmtInt(r.leads)} leads, ${fmtInt(r.matched)} ligados a visitas (${fmtInt(r.changed)} com novidade)`);
  if (UI.tab === 'config') renderConfigBody(); else if (UI.tab === 'leads') renderLeads($('#ed-main'));
}
async function saveInt(){
  const v = {}; $$('[data-int]').forEach(i => { v[i.dataset.int] = i.value });
  INS.int = await api('integrations.save', {id: REC.id, integrations: v}); INS.intId = REC.id;
  toast('Integrações salvas'); renderConfigBody();
}

/* ================= planilhas ================= */
function parseCsv(text){
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => String(c).trim()));
}
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const colIdx = (head, re) => head.findIndex(h => re.test(norm(h)));
function toDay(v){
  const t = String(v || '').trim(); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
const moneyIn = v => { let t = String(v ?? '').replace(/[^\d,.-]/g, ''); if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''); else t = t.replace(',', '.'); return parseFloat(t) || 0 };
// Planilha do Gerenciador de Anúncios (português ou inglês).
function spendRows(rows){
  const h = rows[0] || [], c = re => colIdx(h, re);
  const day = c(/^dia$|^day$|^data$|inicio dos relatorios|reporting starts/), spend = c(/valor usado|valor gasto|amount spent|^gasto|^spend/);
  const adId = c(/identificacao do anuncio|id do anuncio|^ad id/), adName = c(/nome do anuncio|^ad name/), setId = c(/identificacao do conjunto|id do conjunto|^ad set id/), setName = c(/nome do conjunto|^ad set name/), campId = c(/identificacao da campanha|id da campanha|^campaign id/), campName = c(/nome da campanha|^campaign name/);
  if (spend < 0 || day < 0) throw new Error('Não achei as colunas de dia e valor usado na planilha.');
  return rows.slice(1).map(r => ({day: toDay(r[day]), spend: moneyIn(r[spend]), ad_id: adId >= 0 ? r[adId] : '', ad_name: adName >= 0 ? r[adName] : '', adset_id: setId >= 0 ? r[setId] : '', adset_name: setName >= 0 ? r[setName] : '', campaign_id: campId >= 0 ? r[campId] : '', campaign_name: campName >= 0 ? r[campName] : ''})).filter(r => r.day && r.spend);
}
function crmRows(rows){
  const h = rows[0] || [], c = re => colIdx(h, re);
  const phone = c(/telefone|whats|celular|phone/), code = c(/^codigo|^code|^\[id\]|^id$/), stage = c(/etapa|stage|status|fase/), value = c(/valor|value|ticket/);
  if (stage < 0 || (phone < 0 && code < 0)) throw new Error('A planilha precisa das colunas etapa e telefone (ou código).');
  return rows.slice(1).map(r => ({telefone: phone >= 0 ? r[phone] : '', codigo: code >= 0 ? r[code] : '', etapa: r[stage], valor: value >= 0 ? r[value] : ''}));
}
// Leads do InLead → formato de importação. JSON da API do painel: {data: {leads: [{id, tracking, created_at, <etapa>: {<conteúdo>: valor}}]}}.
// Planilha: uma coluna por componente (nome = ID/Name do componente) e as colunas de rastreamento.
function inleadLayerIndex(){
  const by = {};
  D.steps.forEach(s => s.layers.forEach(l => { const x = {step: s, layer: l}; by[l.id] = x; if (l.content && l.content.id) by[l.content.id] = x; if (l.content && l.content.name) by['name:' + norm(l.content.name)] = x }));
  return by;
}
function answerFor(x, raw, title){
  const l = x.layer, c = l.content || {}, name = c.name || l.id;
  if (l.type === 'button') return /clicked|clicou|sim|true|1/i.test(String(raw)) ? {click: {name, label: FR.stripHtml(c.label || '')}} : null;
  if (l.type === 'options') {
    const vals = Array.isArray(raw) ? raw : String(raw).split(/\s*[|,]\s*/).filter(Boolean);
    const os = vals.map(v => (c.options || []).find(o => o.id === v || String(o.value) === String(v) || norm(FR.plainLabel(o.label)) === norm(v))).filter(Boolean);
    if (!os.length) return null;
    const val = o => o.value != null && o.value !== '' ? String(o.value) : FR.plainLabel(o.label);
    const multi = !!c.multiple;
    return {answer: {step: x.step.id, name, type: 'options', title: '', value: multi ? os.map(val) : val(os[0]), label: os.map(o => FR.plainLabel(o.label)).join(', '), score: os.reduce((t, o) => t + (Number(o.score) || 0), 0), ids: os.map(o => o.id)}};
  }
  const v = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '').trim();
  return v ? {answer: {step: x.step.id, name, type: l.type, title: c.title || title || '', value: v}} : null;
}
const TRACK_COLS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term', 'utm_id', 'fbclid', 'gclid', 'src', 'sck', 'screen', 'viewport', 'platform', 'ip', 'userAgent', 'language', 'referrer'];
function finishLead(o){
  const params = {}; for (const k of TRACK_COLS) if (/^(utm_|fbclid|gclid|src|sck)/.test(k) && o.tracking[k]) params[k] = o.tracking[k];
  const order = D.steps.map(s => s.id), seen = new Set(Object.values(o.answers).map(a => a.step).concat(Object.keys(o.clickSteps)));
  const last = D.steps[D.steps.length - 1];
  const completed = Object.keys(o.clicks).some(lid => { const x = o.idx[lid]; return x && x.layer.type === 'button' && FR.isUrl(x.layer.content.destination || '') }) || seen.has(last && last.id);
  return {code: o.code, created_at: o.created_at, tracking: o.tracking, params, answers: o.answers, clicks: o.clicks, steps: order.filter(id => seen.has(id)), completed};
}
function inleadFromJson(j){
  const list = Array.isArray(j) ? j : (j && j.data && j.data.leads) || (j && j.leads) || [];
  const idx = inleadLayerIndex(), steps = new Set(D.steps.map(s => s.id));
  return list.map(L => {
    const o = {idx, code: L.id || L.code, created_at: L.created_at, tracking: Object.assign({}, L.tracking || {}), answers: {}, clicks: {}, clickSteps: {}};
    for (const [k, v] of Object.entries(L)) if (steps.has(k) && v && typeof v === 'object') for (const [ck, cv] of Object.entries(v)) {
      const x = idx[ck]; if (!x) continue;
      const r = answerFor(x, cv); if (!r) continue;
      if (r.click) { o.clicks[x.layer.id] = r.click; o.clickSteps[x.step.id] = 1 } else o.answers[x.layer.id] = r.answer;
    }
    return finishLead(o);
  });
}
function inleadFromCsv(rows){
  const h = rows[0] || [], idx = inleadLayerIndex();
  const code = colIdx(h, /\[id\]|^id$|^codigo|^code|lead/), date = colIdx(h, /^data|^date|created/);
  const comp = h.map(name => { const n = norm(name); const hit = Object.keys(idx).find(k => k.startsWith('name:') && (n === k.slice(5) || n.endsWith(' ' + k.slice(5)) || n.endsWith('· ' + k.slice(5)))); return hit ? idx[hit] : null });
  const tr = h.map(name => TRACK_COLS.find(t => norm(t) === norm(name)) || null);
  const when = v => { const t = String(v || '').trim(), m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/.exec(t); if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 12), +(m[5] || 0)).toISOString(); const d = new Date(t); return isFinite(d) ? d.toISOString() : new Date().toISOString() };
  if (code < 0) throw new Error('Não achei a coluna com o código do lead ([ID] Lead).');
  return rows.slice(1).map(r => {
    const o = {idx, code: String(r[code] || '').trim(), created_at: date >= 0 ? when(r[date]) : new Date().toISOString(), tracking: {}, answers: {}, clicks: {}, clickSteps: {}};
    r.forEach((v, i) => {
      if (tr[i] && String(v).trim()) o.tracking[tr[i]] = String(v).trim();
      const x = comp[i]; if (!x || !String(v).trim()) return;
      const a = answerFor(x, v); if (!a) return;
      if (a.click) { o.clicks[x.layer.id] = a.click; o.clickSteps[x.step.id] = 1 } else o.answers[x.layer.id] = a.answer;
    });
    return finishLead(o);
  });
}
async function readFile(f){ return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsText(f, 'utf-8') }) }
async function runImport(kind, files){
  needServer();
  try {
    if (kind === 'spend') { const rows = spendRows(parseCsv(await readFile(files[0]))); toast('Enviando ' + fmtInt(rows.length) + ' linhas de gasto…'); const r = await api('spend.import', {id: REC.id, rows}); toast(fmtInt(r.rows) + ' linhas de gasto importadas'); INS.ads = null; return }
    if (kind === 'crm') { const rows = crmRows(parseCsv(await readFile(files[0]))); const r = await api('crm.import', {id: REC.id, rows}); toast(`${fmtInt(r.matched)} de ${fmtInt(rows.length)} leads atualizados com a etapa do CRM`); INS.ads = null; LEADS.cache = null; return }
    if (kind === 'inlead') {
      let leads = [];
      for (const f of files) { const text = await readFile(f); leads = leads.concat(/^\s*[[{]/.test(text) ? inleadFromJson(JSON.parse(text)) : inleadFromCsv(parseCsv(text))) }
      leads = leads.filter(l => l.code);
      if (!leads.length) throw new Error('Nenhum lead encontrado no arquivo.');
      let added = 0;
      for (let i = 0; i < leads.length; i += 1000) { toast(`Importando ${fmtInt(Math.min(i + 1000, leads.length))} de ${fmtInt(leads.length)}…`); added += (await api('leads.import', {id: REC.id, leads: leads.slice(i, i + 1000)})).added }
      toast(`${fmtInt(added)} leads importados (${fmtInt(leads.length - added)} já existiam)`); INS.ads = null; INS.paths = null; LEADS.cache = null;
    }
  } catch (e) { toast(e.message, 'err') }
}

/* ================= ações ================= */
Object.assign(ACT, {
  'ads-level': t => { INS.level = t.dataset.v; INS.sel = null; renderLeads($('#ed-main')) },
  'ads-sort': t => { const k = t.dataset.v; INS.sort = {k, d: INS.sort.k === k ? -INS.sort.d : -1}; paintLeads(LEADS.cache) },
  'ads-row': t => { INS.sel = INS.sel === t.dataset.key ? null : t.dataset.key; paintLeads(LEADS.cache) },
  'ads-csv': adsCsv,
  'e2e-scope': t => { INS.scope = t.dataset.v; paintLeads(LEADS.cache) },
  'crm-sync': () => crmSync().catch(e => { INS.crm = null; toast(e.message, 'err'); if (UI.tab === 'config') renderConfigBody() }),
  'crm-save': async () => {
    const key = ($('#crm-key') || {}).value || '';
    if (!key.trim() && !(INS.crm && INS.crm.configured)) { toast('Digite o código de acesso da Central.', 'err'); return }
    try { if (key.trim()) INS.crm = await api('crm.config', {key: key.trim()}); await crmSync() } catch (e) { INS.crm = null; toast(e.message, 'err'); renderConfigBody() }
  },
  'crm-clear': async () => { if (!(await confirmBox('Desligar a Central Comercial?', 'O servidor para de ler a Central. As etapas já trazidas continuam nos leads.', 'Desligar', true))) return; INS.crm = await api('crm.config', {clear: true}); renderConfigBody(); toast('Central desligada') },
  'rr-add': t => { mutate(() => ensureRoles(t.dataset.p)[+t.dataset.g].push({variable: '', compare: '==', value: ''}), {canvas: false}); renderConfigBody() },
  'rr-group': t => { mutate(() => ensureRoles(t.dataset.p).push([{variable: '', compare: '==', value: ''}]), {canvas: false}); renderConfigBody() },
  'rr-del': t => { mutate(() => { const r = ensureRoles(t.dataset.p); r[+t.dataset.g].splice(+t.dataset.c, 1); const k = r.findIndex(g => !g.length); if (k >= 0) r.splice(k, 1) }, {canvas: false}); renderConfigBody() },
  'score-add': () => { mutate(() => { const ls = leadsCfg(); (ls.score = ls.score || []).push({label: '', points: 10, when: [[{variable: '', compare: '==', value: ''}]]}) }, {canvas: false}); renderConfigBody() },
  'tag-add': () => { mutate(() => { const ls = leadsCfg(); (ls.tags = ls.tags || []).push({label: '', when: [[{variable: '', compare: '==', value: ''}]]}) }, {canvas: false}); renderConfigBody() },
  'tag-del': t => { mutate(() => leadsCfg().tags.splice(+t.dataset.i, 1), {canvas: false}); renderConfigBody() },
  'ab-add': () => { mutate(() => { (D.settings.ab = D.settings.ab || []).push({name: D.settings.ab.length ? 'teste' + (D.settings.ab.length + 1) : 'capa', variants: 'atual, v1', enabled: true}) }, {canvas: false}); renderConfigBody() },
  'ab-del': t => { mutate(() => D.settings.ab.splice(+t.dataset.i, 1), {canvas: false}); renderConfigBody() },
  'score-del': t => { mutate(() => leadsCfg().score.splice(+t.dataset.i, 1), {canvas: false}); renderConfigBody() },
  'leads-model': () => braseModel(),
  'int-save': () => saveInt().catch(e => toast(e.message, 'err')),
  'int-newkey': async () => { if (!(await confirmBox('Trocar a chave?', 'Os endereços de vendas e do CRM mudam; cole os novos no checkout e no CRM.', 'Trocar'))) return; INS.int = await api('integrations.save', {id: REC.id, integrations: {newHookKey: true}}); renderConfigBody(); toast('Chave trocada') },
  'spend-sync': async () => { try { await saveInt(); toast('Buscando o gasto na Meta…'); const r = await api('spend.sync', {id: REC.id}); toast(`${fmtInt(r.rows)} linhas · ${money(r.spend)} de ${fmtDate(r.since + 'T12:00')} a ${fmtDate(r.until + 'T12:00')}`); INS.ads = null } catch (e) { toast(e.message, 'err') } },
  'spend-clear': async () => { if (!(await confirmBox('Apagar o gasto importado?', 'Os custos somem da aba Anúncios até importar de novo.', 'Apagar', true))) return; await api('spend.clear', {id: REC.id}); INS.ads = null; toast('Gasto apagado') },
});
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.import && t.files && t.files.length) { runImport(t.dataset.import, [...t.files]); t.value = '' } });
