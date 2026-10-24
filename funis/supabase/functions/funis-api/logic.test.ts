// deno test funis/supabase/functions/funis-api/logic.test.ts
import {assert, assertEquals, assertThrows} from 'jsr:@std/assert@1';
import {abandonDue, aggregateAccount, aggregateAds, aggregateE2E, crmLeadFacts, isMetaLead, aggregatePaths, attributeSpend, brDay, crmFlags, crmLeadRows, crmSpendDoc, crmSpendRows, isPaid, buildPayload, capiEvent, encodeBody, ifoodSummary, importRow, isQualified, leadMetrics, merchantIdFrom, mergeSession, mergeWebhook, normPhone, parseCrm, parseMoney, parseSale, payloadExtras, periodStart, plainLabel, sameKey, sampleSession, sanitizeParams, sanitizeTracking, sessionVars, sha256, slugify, splitUtm, validBrPhone, webhookDue, webhookForEditor, type Event, type Session} from './logic.ts';
import {evalRoles, interpolate} from './rules.ts';

const brase = JSON.parse(await Deno.readTextFile(new URL('../../../data/brase-2.json', import.meta.url)));
const pub = brase.published;
const stepByTitle = (t: string) => pub.steps.find((s: {title: string}) => s.title === t);
const layerOf = (t: string, type: string) => stepByTitle(t).layers.find((l: {type: string}) => l.type === type);

Deno.test('junta as respostas dos eventos e marca interação, etapas e conclusão', () => {
  const capa = stepByTitle('Capa'), dor = stepByTitle('Dor');
  const opt = layerOf('Dor', 'options');
  const evs: Event[] = [
    {type: 'step', step: capa.id},
    {type: 'click', step: capa.id, layer: capa.layers[2].id, name: 'WTiTGM', label: 'INICIAR ANÁLISE ➔', at: 1},
    {type: 'step', step: dor.id},
    {type: 'answer', step: dor.id, layer: opt.id, answer: {name: opt.content.name, type: 'options', value: 'A', label: 'Silêncio Total: Minhas visitas e vendas caíram do nada.', score: 1}},
    {type: 'step', step: 'nao-existe'},
  ];
  const s = mergeSession(null, 'AbC123', evs, {utm_source: 'FB'}, pub);
  assertEquals(s.steps, [capa.id, dor.id]);
  assertEquals(s.last_step, dor.id);
  assert(s.interacted);
  assert(!s.completed);
  assertEquals(s.answers[opt.id].value, 'A');
  assertEquals(s.clicks[capa.layers[2].id].name, 'WTiTGM');
  assertEquals(s.tracking.utm_source, 'FB');
  // segunda leva: completa e não repete a etapa
  const s2 = mergeSession(s, 'AbC123', [{type: 'step', step: dor.id}, {type: 'complete', step: dor.id}], {utm_source: 'outro'}, pub);
  assertEquals(s2.steps.length, 2);
  assert(s2.completed);
  assertEquals(s2.tracking.utm_source, 'FB', 'o rastreamento da primeira visita é mantido');
});

Deno.test('webhook do BRASE 2 sai no clique do botão VT19S2, uma vez só', () => {
  const w = {enabled: true, url: 'https://exemplo.com/hook', trigger: 'component', component: 'VT19S2'};
  const s = mergeSession(null, 'AbC123', [], null, pub);
  assert(!webhookDue(w, null, s, [{type: 'click', name: 'WTiTGM'}]));
  assert(webhookDue(w, null, s, [{type: 'click', name: 'VT19S2'}]));
  assert(!webhookDue(w, {...s, webhook: {ok: true}}, s, [{type: 'click', name: 'VT19S2'}]), 'já enviado');
  assert(webhookDue(w, {...s, webhook: {ok: false}}, s, [{type: 'click', name: 'VT19S2'}]), 'tenta de novo se falhou');
  assert(!webhookDue({...w, enabled: false}, null, s, [{type: 'click', name: 'VT19S2'}]));
  assert(webhookDue({...w, trigger: 'complete'}, null, {...s, completed: true}, []));
  assert(!webhookDue({...w, trigger: 'complete'}, {...s, completed: true}, {...s, completed: true}, []));
  assert(webhookDue({...w, trigger: 'lead'}, null, {...s, answers: {x: {type: 'field', value: '(21) 95905-5007'}}}, []));
  // como no InLead: vários componentes separados por vírgula, e opção também conta como interação
  const w2 = {...w, component: 'WTiTGM, VT19S2'};
  assert(webhookDue(w2, null, s, [{type: 'click', name: 'WTiTGM'}]));
  assert(webhookDue({...w, component: 'opcoes_sz3HdB'}, null, s, [{type: 'answer', answer: {name: 'opcoes_sz3HdB', type: 'options', value: 'A'}}]));
});

Deno.test('corpo do webhook tem as chaves do CRM da Central e as UTMs', () => {
  const f = layerOf('Análise pré-aprovada', 'field');
  const fields = stepByTitle('Análise pré-aprovada').layers.filter((l: {type: string}) => l.type === 'field');
  const fat = layerOf('Faturamento', 'options'), dor = layerOf('Dor', 'options'), mkt = layerOf('Como cuida do mkt', 'options');
  const s = {
    id: 'Ln0w4s', created_at: '2026-10-13T20:00:00.000Z', steps: [], last_step: null, interacted: true, completed: false,
    clicks: {[layerOf('Análise pré-aprovada', 'button').id]: {name: 'VT19S2', label: 'ENVIAR APLICAÇÃO!'}},
    tracking: {utm_source: 'FB', utm_campaign: 'Leads - Inlead|120243447856370151', utm_content: 'IFood Escondeu|120244276786450151', userAgent: 'x', screen: '390x844', url: 'https://site/funis/f/?f=brase-2'},
    params: {utm_source: 'FB', utm_campaign: 'Leads - Inlead|120243447856370151', utm_content: 'IFood Escondeu|120244276786450151', fbclid: 'abc'},
    answers: {
      [fields[0].id]: {name: 'ukieyT', type: 'field', value: 'Maria Souza'},
      [fields[1].id]: {name: 'KVvZKi', type: 'field', value: 'Pizzaria Exemplo'},
      [fields[2].id]: {name: 'L5Lzbe', type: 'field', value: '(11) 90000-0000'},
      [fat.id]: {name: 'opcoes_Cu6gxU', type: 'options', value: '30000', label: '30.000 a 50.000/mês'},
      [dor.id]: {name: 'opcoes_sz3HdB', type: 'options', value: 'A', label: 'Silêncio Total: Minhas visitas e vendas caíram do nada.', score: 1, responses: 'A|*|*|*'},
      [mkt.id]: {name: 'opcoes_8HsUvT', type: 'options', value: 'C', label: 'Tenho equipe/freela: (Mas sinto que dava pra vender mais)'},
    },
  };
  assert(f);
  const p = buildPayload('brase-2', s, brase.webhook);
  assertEquals(p.code, 'Ln0w4s');
  assertEquals(p.nome, 'Maria Souza');
  assertEquals(p.empresa, 'Pizzaria Exemplo');
  assertEquals(p.telefone, '(11) 90000-0000');
  assertEquals(p.faturamento, '30000');
  assertEquals(p.dor, 'Silêncio Total: Minhas visitas e vendas caíram do nada.');
  assertEquals(p.estrutura, 'Tenho equipe/freela: (Mas sinto que dava pra vender mais)');
  // o resto é igual ao corpo do InLead: {...variáveis, ...parâmetros da URL, code}
  assertEquals(p.ukieyT, 'Maria Souza');
  assertEquals(p.opcoes_sz3HdB, 'A', 'opção vai com o valor, como no InLead');
  assertEquals(p['score.opcoes_sz3HdB'], 1);
  assertEquals(p['responses.opcoes_sz3HdB'], 'A|*|*|*');
  assertEquals(p.VT19S2, 'clicked');
  assertEquals(p['tracking.fbclid'], 'abc');
  assertEquals(p['tracking.screen'], '390x844');
  assertEquals(p.fbclid, 'abc');
  assertEquals(p.score, 1);
  assertEquals(p.utm_campaign, 'Leads - Inlead|120243447856370151');
  assertEquals(p.userAgent, undefined, 'dados do aparelho não vão para o CRM');
  assertEquals(p.data, '2026-10-13T20:00:00.000Z');
  const form = encodeBody({a: 'x y', b: ['1', '2']}, 'FORM');
  assertEquals(form.type, 'application/x-www-form-urlencoded');
  assertEquals(form.body, 'a=x+y&b=%5B%221%22%2C%222%22%5D');
});

Deno.test('o token do webhook não volta para o editor e é mantido quando vem vazio', () => {
  const old = {enabled: true, url: 'https://a.com/h', token: 'segredo'};
  const w = mergeWebhook(old, {enabled: true, url: 'https://a.com/h2', token: ''});
  assertEquals(w.token, 'segredo');
  assertEquals(w.url, 'https://a.com/h2');
  assertEquals(mergeWebhook(old, {url: 'https://a.com', clearToken: true}).token, '');
  const view = webhookForEditor(w);
  assertEquals(view.token, undefined);
  assertEquals(view.tokenSet, true);
  assertThrows(() => mergeWebhook(null, {url: 'http://inseguro.com'}));
});

Deno.test('utilitários', () => {
  assertEquals(slugify('BRASE 2 — Diagnóstico!'), 'brase-2-diagnostico');
  assert(sameKey('abc', 'abc')); assert(!sameKey('abc', 'abd')); assert(!sameKey('', ''));
  assertEquals(periodStart('day', 864e5 * 10).getTime(), 864e5 * 9);
  assertEquals(periodStart('all').getTime(), 0);
  assertEquals(plainLabel('<p>🔇&nbsp;<strong>Silêncio Total:</strong> Minhas</p>'), 'Silêncio Total: Minhas');
  const t = sanitizeTracking({utm_source: 'FB', hack: 'x', userAgent: 'a'.repeat(900)});
  assertEquals(Object.keys(t).sort(), ['userAgent', 'utm_source']);
  assertEquals(t.userAgent.length, 600);
  assertEquals(sanitizeParams({f: 'brase-2', utm_source: 'FB', 'x y': '1', obj: {a: 1}, step: 'abc'}), {utm_source: 'FB', step: 'abc'});
  const sample = sampleSession(pub);
  assert(Object.values(sample.answers).some(a => a.name === 'L5Lzbe' && a.value === '(21) 90000-0000'));
});

Deno.test('variáveis e qualificado como no InLead', () => {
  const base = {id: 'A1b2C3', tracking: {}, steps: [], last_step: null, interacted: true, completed: false, clicks: {}};
  const multi = {...base, answers: {m: {name: 'canais', type: 'options', value: ['ifood', 'zap'], score: 3}}};
  assertEquals(sessionVars(multi).canais, 'ifood|zap');
  assertEquals(sessionVars(multi).score, 3);
  // BRASE 2 publicado tem 11 etapas: precisa de mais de 7,7 respostas/cliques
  const many = (n: number) => Object.fromEntries(Array.from({length: n}, (_, i) => ['l' + i, {name: 'n' + i, type: 'field', value: 'x'}]));
  assert(!isQualified({...base, answers: many(7)}, 11));
  assert(isQualified({...base, answers: many(8)}, 11));
  assert(isQualified({...base, answers: {}, completed: true}, 11));
  // parâmetros da URL guardados só na primeira visita
  const s = mergeSession(null, 'A1b2C3', [], null, pub, {utm_source: 'FB'});
  assertEquals(mergeSession(s, 'A1b2C3', [], null, pub, {utm_source: 'outro'}).params, {utm_source: 'FB'});
});

const sess = (o: Partial<Session> = {}): Session => ({id: 'A1b2C3', tracking: {}, params: {}, answers: {}, clicks: {}, steps: [], last_step: null, interacted: true, completed: false, ...o});
const ICP = [[{variable: '@fat', compare: '>=', value: '10000'}]];
const LS = {icp: ICP, score: [{when: ICP, points: 50, label: 'Fatura 10 mil+'}, {when: [[{variable: '@canal', compare: '==', value: '0'}]], points: 20, label: 'Vende no iFood'}, {when: [[{variable: '@lead.telefone_valido', compare: '==', value: 'sim'}]], points: 30}], hot: 70, abandon: {enabled: true, minutes: 15}};

Deno.test('regras no servidor iguais às do funil (variáveis, contas e operadores do InLead)', () => {
  const vars = {fat: '30000', canais: 'ifood|zap|ifood', nome: 'Ana', 'score.x': 745};
  assertEquals(interpolate('Oi @nome, calc({{score.x}}/10)', vars), 'Oi Ana, 74.50');
  assert(evalRoles(ICP, vars));
  assert(evalRoles([[{variable: 'ifood', compare: 'count==', value: '@canais', number: 2}]], vars));
  assert(!evalRoles([[{variable: '@fat', compare: '<', value: '10000'}]], vars));
  assert(evalRoles([], vars), 'sem regra mostra');
  assert(!evalRoles([], vars, false), 'sem regra de perfil, ninguém é do perfil');
});

Deno.test('nota do lead, perfil e quente', () => {
  const s = sess({answers: {a: {name: 'fat', type: 'options', value: '30000'}, b: {name: 'canal', type: 'options', value: '0'}, c: {name: 'zap', type: 'field', title: 'Qual seu Whatsapp?', value: '(11) 98888-7777'}}});
  s.phone = normPhone('(11) 98888-7777');
  const m = leadMetrics(s, LS);
  assertEquals(m, {icp: true, score: 100, hot: true, reasons: ['Fatura 10 mil+', 'Vende no iFood'], tags: []});
  const pobre = sess({answers: {a: {name: 'fat', type: 'options', value: '0'}}});
  assertEquals(leadMetrics(pobre, LS).icp, false);
  assertEquals(leadMetrics(pobre, LS).score, 0);
  assertEquals(leadMetrics(pobre, null), {icp: null, score: null, hot: null, reasons: [], tags: []});
  const extra = payloadExtras(s, LS, 'abandono', 'Análise pré-aprovada');
  assertEquals(extra, {nota_lead: 100, lead_no_perfil: true, lead_quente: true, telefone_valido: true, abandonou: true, etapa_abandono: 'Análise pré-aprovada'});
});

Deno.test('telefone: formato, DDD e celular', () => {
  assertEquals(normPhone('(11) 98888-7777'), '5511988887777');
  assert(validBrPhone('5511988887777'));
  assert(!validBrPhone('5520988887777'), 'DDD 20 não existe');
  assert(!validBrPhone('5511888887777'), 'celular com 9 dígitos começa com 9');
  const s = mergeSession(null, 'A1b2C3', [{type: 'answer', step: pub.steps[7].id, layer: 'L5', answer: {name: 'L5Lzbe', type: 'field', title: 'Qual seu Whatsapp?', value: '(21) 99999-0000'}}, {type: 'answer', step: pub.steps[7].id, layer: 'E1', answer: {name: 'mail', type: 'field', title: 'E-mail', value: 'Ana@Exemplo.com '}}], null, pub);
  assertEquals(s.phone, '5521999990000');
  assertEquals(s.email, 'ana@exemplo.com');
});

Deno.test('abandono: só quem deixou o WhatsApp, não enviou e sumiu há X minutos', () => {
  const old = new Date(Date.now() - 20 * 60e3).toISOString();
  assert(abandonDue(sess({phone: '5511988887777', updated_at: old}), LS));
  assert(!abandonDue(sess({phone: '5511988887777', updated_at: new Date().toISOString()}), LS), 'ainda pode estar digitando');
  assert(!abandonDue(sess({updated_at: old}), LS), 'sem telefone');
  assert(!abandonDue(sess({phone: '5511988887777', updated_at: old, webhook: {ok: false}}), LS), 'já tentou enviar');
  assert(!abandonDue(sess({phone: '5511988887777', updated_at: old}), {...LS, abandon: {enabled: false}}));
  // quem volta e termina depois do abandono vai de novo, completo; repetido não vai
  const w = {enabled: true, url: 'https://x.com/h', trigger: 'component', component: 'VT19S2'};
  assert(webhookDue(w, sess({webhook: {ok: true, kind: 'abandono'}}), sess(), [{type: 'click', name: 'VT19S2'}]));
  assert(!webhookDue(w, sess({webhook: {ok: false, skipped: 'repetido'}}), sess(), [{type: 'click', name: 'VT19S2'}]));
});

Deno.test('venda da Kirvano ligada ao visitante', () => {
  const k = {event: 'SALE_APPROVED', sale_id: 'S1', total_price: 'R$ 297,00', status: 'APPROVED', customer: {name: 'Ana', email: 'ANA@x.com', phone_number: '5511988887777'}, products: [{name: 'ZapFood', price: 'R$ 297,00'}], utm: {utm_source: 'FB', sck: 'fn-Ln0w4s', utm_content: 'IFood Escondeu|1202'}};
  const s = parseSale(k);
  assertEquals([s.status, s.value, s.saleId, s.code, s.email, s.phone, s.product, s.utm.utm_source], ['approved', 297, 'S1', 'Ln0w4s', 'ana@x.com', '5511988887777', 'ZapFood', 'FB']);
  assertEquals(parseSale({event: 'SALE_REFUNDED', sale_id: 'S1', total_price: 'R$ 297,00'}).status, 'refunded');
  assertEquals(parseSale({data: {status: 'paid', amount: 97.5, customer: {email: 'a@b.c'}}}).status, 'approved');
  assertEquals(parseMoney('R$ 1.297,90'), 1297.9);
});

Deno.test('etapas do CRM por código ou telefone', () => {
  const r = parseCrm([{codigo: 'Ln0w4s', etapa: 'Reunião Marcada'}, {telefone: '(11) 98888-7777', etapa: 'Fechado', valor: '2.500,00'}, {etapa: 'x'}]);
  assertEquals(r, [{code: 'Ln0w4s', phone: '', stage: 'marcada', value: 0}, {code: '', phone: '5511988887777', stage: 'fechado', value: 2500}]);
});

Deno.test('relatório por anúncio: perfil, envios, abandono, reuniões, vendas, gasto e custos', () => {
  assertEquals(splitUtm('IFood Escondeu|120244276786450151'), {name: 'IFood Escondeu', id: '120244276786450151'});
  const ad = 'IFood Escondeu|120244276786450151';
  const mk = (id: string, o: Partial<Session>) => sess({id, created_at: '2026-10-10T12:00:00Z', params: {utm_content: ad}, ...o});
  const ss = [
    mk('a', {answers: {f: {name: 'fat', type: 'options', value: '30000'}}, phone: '5511988887777', clicks: {b: {name: 'VT19S2'}}, crm: {stage: 'fechado', value: 1000}}),
    mk('b', {answers: {f: {name: 'fat', type: 'options', value: '0'}}, phone: '5511977776666'}),
    mk('c', {interacted: false}),
    sess({id: 'd', created_at: '2026-10-11T12:00:00Z', params: {utm_content: 'Outro|999999999'}}),
  ];
  const r = aggregateAds(ss, {level: 'ad', settings: LS, submitNames: ['VT19S2'], sales: [{session_id: 'b', status: 'approved', value: 297}], spend: [{day: '2026-10-10', ad_id: '120244276786450151', ad_name: 'IFood Escondeu', spend: 100}, {day: '2026-10-10', ad_id: '555555555', ad_name: 'Sem visita', spend: 50}]});
  const row = r.rows.find(x => x.id === '120244276786450151')!;
  assertEquals([row.visits, row.started, row.contacts, row.submitted, row.abandoned, row.icp, row.meetings, row.won, row.sales, row.revenue, row.spend], [3, 2, 2, 1, 1, 1, 1, 1, 1, 1297, 100]);
  assertEquals(row.cpIcp, 100); assertEquals(row.cpl, 100); assertEquals(row.roas, 12.97);
  assert(r.rows.some(x => x.id === '555555555' && x.spend === 50 && x.visits === 0), 'anúncio que gastou e não trouxe visita aparece');
  assertEquals(r.totals.spend, 150);
});

Deno.test('caminhos e tempo por etapa', () => {
  const steps = [{id: 's1', title: 'Capa'}, {id: 's2', title: 'Dor'}, {id: 's3', title: 'Fim'}];
  const r = aggregatePaths([
    sess({timeline: [['s1', 1000], ['s2', 11000], ['s3', 41000]], completed: true}),
    sess({timeline: [['s1', 0 + 5000], ['s2', 25000], ['s1', 30000, 1]]}),
  ], steps);
  const capa = r.steps.find(x => x.id === 's1')!, dor = r.steps.find(x => x.id === 's2')!;
  assertEquals([capa.visitors, capa.medianSec, capa.exits], [2, 15, 1]);
  assertEquals([dor.visitors, dor.backs], [2, 1]);
  assertEquals(r.transitions[0], {from: 's1', to: 's2', fromTitle: 'Capa', toTitle: 'Dor', n: 2});
});

Deno.test('evento da API de Conversões com dados em SHA-256 e o mesmo event_id do Pixel', async () => {
  const s = sess({id: 'Ln0w4s', created_at: '2026-10-10T12:00:00Z', phone: '5511988887777', params: {fbclid: 'IwAR1'}, tracking: {ip: '200.1.2.3', userAgent: 'UA', url: 'https://site/f/?f=brase-2', fbp: 'fb.1.1.2'}, answers: {n: {name: 'nome', type: 'field', title: 'Qual o seu nome?', value: 'Maria Souza'}}});
  const e = await capiEvent({name: 'LeadQualificado', id: 'Ln0w4s-icp', s, time: 1790000000000});
  const ud = e.user_data as Record<string, unknown>;
  assertEquals(e.event_id, 'Ln0w4s-icp');
  assertEquals(ud.ph, [await sha256('5511988887777')]);
  assertEquals(ud.fn, [await sha256('maria')]);
  assertEquals(ud.fbc, `fb.1.${Date.parse('2026-10-10T12:00:00Z')}.IwAR1`);
  assertEquals([ud.client_ip_address, ud.fbp, e.event_time, e.action_source], ['200.1.2.3', 'fb.1.1.2', 1790000000, 'website']);
  const p = await capiEvent({name: 'Purchase', id: 'venda-S1', s, value: 297});
  assertEquals(p.custom_data, {value: 297, currency: 'BRL'});
});

Deno.test('Raio-X do iFood: posição na categoria e quanto falta para passar a próxima', () => {
  assertEquals(merchantIdFrom('https://www.ifood.com.br/delivery/brasilia-df/texas-burger/0A11D629-C715-470B-ABC5-3E0FAF0BE4E5'), '0a11d629-c715-470b-abc5-3e0faf0be4e5');
  const me = {id: 'm', name: 'Minha', category: 'Lanches', rating_count: 100, district: 'Centro', city: 'X'};
  const near = [{id: 'a', name: 'A', category: 'Lanches', rating_count: 400}, {id: 'b', name: 'B', category: 'Lanches', rating_count: 150}, {id: 'p', name: 'Pizza', category: 'Pizza', rating_count: 999}, me];
  const r = ifoodSummary({merchant: me, nearby: near}, 3)!;
  assertEquals([r.avaliacoes, r.pedidos, r.posicao, r.total, r.proxima, r.falta, r.lider, r.confiavel], [100, 200, 3, 3, 'B', 102, 'A', false]);
});

Deno.test('importa leads do InLead sem reenviar ao CRM', () => {
  const r = importRow({code: 'Ln0w4s', created_at: '2026-10-01T10:00:00Z', tracking: {utm_source: 'FB', userAgent: 'x'}, params: {utm_source: 'FB', f: 'x'}, steps: [pub.steps[0].id, 'nao-existe'],
    answers: {L5: {name: 'L5Lzbe', type: 'field', title: 'Qual seu Whatsapp?', value: '(11) 98888-7777'}}, clicks: {B: {name: 'VT19S2'}}}, pub)!;
  assertEquals([r.id, r.phone, r.steps.length, r.interacted, (r.webhook as {kind: string}).kind, r.params], ['Ln0w4s', '5511988887777', 1, true, 'importado', {utm_source: 'FB'}]);
  assertEquals(importRow({code: 'x'}, pub), null);
  // no relatório, importado só conta como envio se clicou no botão do webhook
  const sem = importRow({code: 'Zz9yX8', created_at: '2026-10-01T10:00:00Z', params: {utm_content: 'IFood Escondeu|120244276786450151'}, answers: {}, clicks: {}}, pub)!;
  r.params = {utm_content: 'IFood Escondeu|120244276786450151'};
  const row = aggregateAds([r, sem], {level: 'ad', submitNames: ['VT19S2']}).rows[0];
  assertEquals([row.visits, row.submitted], [2, 1]);
});

Deno.test('etiquetas no webhook e relatório por variante do teste A/B', () => {
  const ls = {tags: [
    {label: 'DI, prioridade alta', when: [[{variable: '@fat', compare: '>=', value: '50000'}]]},
    {label: 'Plano IA', when: [[{variable: '@fat', compare: '==', value: '10000'}]]},
    {label: 'Já pagou agência', when: [[{variable: '@mkt', compare: '==', value: 'B'}]]},
    {label: 'sem regra', when: []},
  ]};
  const lead = (id: string, fat: string, mkt: string, capa: string) => ({id, tracking: {}, params: {teste_capa: capa}, answers: {f: {name: 'fat', type: 'options', value: fat}, m: {name: 'mkt', type: 'options', value: mkt}}, clicks: {}, steps: [], last_step: null, interacted: true, completed: false} as Session);
  const a = lead('aaaa', '50000', 'B', 'v1'), b = lead('bbbb', '10000', 'A', 'atual'), c = lead('cccc', '0', 'A', 'v1');
  assertEquals(payloadExtras(a, ls).etiquetas, 'DI, prioridade alta, Já pagou agência');
  assertEquals(payloadExtras(b, ls).etiquetas, 'Plano IA');
  assertEquals(payloadExtras(c, ls).etiquetas, '');
  assertEquals(payloadExtras(c, {}).etiquetas, undefined, 'sem etiquetas configuradas, o campo não vai');
  assertEquals(sessionVars(a)['teste.capa'], 'v1');
  const r = aggregateAds([a, b, c], {level: 'ab:capa'});
  assertEquals(r.param, 'teste_capa');
  assertEquals(r.rows.map(x => [x.key, x.visits]), [['v1', 2], ['atual', 1]]);
});

Deno.test('Central Comercial: liga pelo código ou WhatsApp e separa agendou, fez reunião e fechou', () => {
  const rows = crmLeadRows([
    {col: 'leads', id: 'l1', data: {inleadCode: 'T97gu5', phone: '(31) 99999-0001', stage: 'marcada', bookedAt: '2026-10-19T16:17:12.021Z', meetingDoneAt: null, value: null, ownerId: 'luiz-felipe'}},
    {col: 'leads', id: 'l2', data: {phone: '31999990002', stage: 'perdido', bookedAt: '2026-10-10T10:00:00Z', meetingDoneAt: '2026-10-12T10:00:00Z', lostReason: 'Sem verba'}},
    {col: 'leads', id: 'l3', data: {phone: '31999990003', stage: 'fechado', closedAt: '2026-10-15T10:00:00Z', value: 'R$ 1.500,00'}},
    {col: 'leads', id: 'l4', data: {stage: 'novo'}},
    {col: 'meta', id: 'spend', data: {}},
  ]);
  assertEquals(rows.length, 3);
  assertEquals(rows[0].code, 'T97gu5');
  assertEquals(rows[0].phone, '5531999990001');
  assertEquals(rows[0].crm.lead, 'l1');
  assertEquals(crmFlags(rows[0].crm), {inCrm: true, booked: true, met: false, won: false});
  assertEquals(crmFlags(rows[1].crm), {inCrm: true, booked: true, met: true, won: false});
  assertEquals(rows[1].crm.lost, 'Sem verba');
  assertEquals(crmFlags(rows[2].crm), {inCrm: true, booked: true, met: true, won: true});
  assertEquals(rows[2].crm.value, 1500);
  assertEquals(crmFlags({stage: 'frio'}), {inCrm: true, booked: false, met: false, won: false});
  assertEquals(crmFlags(null).inCrm, false);
  const sp = crmSpendRows({rows: [{adId: '120257610621130151', ad: 'IFood Escondeu 4.0', day: '2026-10-16', spend: 58.44, impressions: 1764, clicks: 39, lpv: 21, metaLeads: 3}, {adId: '1', month: '2026-07', spend: 9}]});
  assertEquals(sp.length, 1);
  assertEquals(sp[0].lpv, 21);
});

Deno.test('gasto da conta vai para o funil mais recente que recebeu visita do anúncio naquele dia', () => {
  const firsts = [{funnel_id: 'velho', ad_id: '111111', first_day: '2026-02-17'}, {funnel_id: 'novo', ad_id: '111111', first_day: '2026-10-15'}, {funnel_id: 'velho', ad_id: '222222', first_day: '2026-06-12'}];
  const rows = ['2026-02-16', '2026-10-14', '2026-10-15', '2026-10-19'].map(day => ({day, ad_id: '111111', spend: 10})).concat([{day: '2026-10-19', ad_id: '222222', spend: 5}, {day: '2026-10-19', ad_id: '333333', spend: 7}]);
  assertEquals(attributeSpend(rows, firsts, 'novo').map(r => r.day), ['2026-10-15', '2026-10-19']);
  assertEquals(attributeSpend(rows, firsts, 'velho').map(r => r.day + ':' + r.ad_id), ['2026-10-14:111111', '2026-10-19:222222']);
  assertEquals(brDay('2026-10-19T02:30:00Z'), '2026-10-18');
  // troca à noite: o dia da troca fica com o funil antigo; anúncio novo (sem funil antes) conta desde a primeira visita
  const late = [{funnel_id: 'velho', ad_id: '111111', first_day: '2026-02-17', first_seen: '2026-02-17'}, {funnel_id: 'novo', ad_id: '111111', first_day: '2026-10-15', first_seen: '2026-10-14'}, {funnel_id: 'novo', ad_id: '444444', first_day: '2026-10-19', first_seen: '2026-10-18'}];
  const r2 = [{day: '2026-10-14', ad_id: '111111', spend: 1}, {day: '2026-10-15', ad_id: '111111', spend: 1}, {day: '2026-10-18', ad_id: '444444', spend: 1}];
  assertEquals(attributeSpend(r2, late, 'novo').map(r => r.day), ['2026-10-15', '2026-10-18']);
  assertEquals(attributeSpend(r2, late, 'velho').map(r => r.day), ['2026-10-14']);
});

Deno.test('ponta a ponta: Meta → funil → Central, só tráfego pago e todo o tráfego', () => {
  const base = {answers: {}, steps: [], last_step: null, completed: false} as unknown as Session;
  const ad = {utm_source: 'FB', utm_content: 'IFood Escondeu 4.0|120257610621130151'};
  const sessions = [
    {...base, id: 'a1', created_at: '2026-10-18T15:00:00Z', tracking: ad, clicks: {x: {name: 'Enviar'}}, interacted: true, phone: '5531999990001', crm: {stage: 'marcada', booked: '2026-10-19T16:00:00Z'}},
    {...base, id: 'a2', created_at: '2026-10-18T16:00:00Z', tracking: ad, clicks: {}, interacted: true, phone: '5531999990002', crm: {stage: 'fechado', value: 1500}},
    {...base, id: 'a3', created_at: '2026-10-19T01:00:00Z', tracking: ad, clicks: {}, interacted: false},
    {...base, id: 'o1', created_at: '2026-10-19T12:00:00Z', tracking: {}, clicks: {x: {name: 'Enviar'}}, interacted: true, phone: '5531999990003', crm: {stage: 'frio'}},
  ] as Session[];
  assert(isPaid(sessions[0]) && !isPaid(sessions[3]));
  const spend = [{day: '2026-10-18', ad_id: '120257610621130151', spend: 26.57, impressions: 698, clicks: 8, link_clicks: 6, lpv: 5, meta_leads: 1}, {day: '2026-10-19', ad_id: '120257610621130151', spend: 14.05, impressions: 417, link_clicks: 6, lpv: 4}];
  const r = aggregateE2E(sessions, spend, {submitNames: ['Enviar']});
  assertEquals(r.paid, {visits: 3, started: 2, contacts: 2, submitted: 1, abandoned: 1, icp: 0, inCrm: 2, booked: 2, met: 1, won: 1, sales: 0, revenue: 1500});
  assertEquals(r.all.visits, 4);
  assertEquals(r.all.inCrm, 3);
  assertEquals(r.meta.spend, 40.62);
  assertEquals(r.meta.link_clicks, 12);
  assertEquals(r.stages.paid, {marcada: 1, fechado: 1});
  assertEquals(r.daily.map(d => [d.day, d.visits, d.spend]), [['2026-10-18', 3, 26.57], ['2026-10-19', 0, 14.05]]);
  // por anúncio: agendadas, feitas e números da Meta
  const ads = aggregateAds(sessions, {level: 'ad', submitNames: ['Enviar'], spend: spend.map(x => ({...x, ad_name: 'IFood Escondeu 4.0'}))});
  const row = ads.rows.find(x => x.id === '120257610621130151')!;
  assertEquals([row.meetings, row.met, row.won, row.inCrm, row.impressions, row.link_clicks, row.lpv], [2, 1, 1, 2, 1115, 12, 9]);
  assertEquals(Math.round(row.cpMet! * 100) / 100, 40.62);
  assertEquals(Math.round(row.ctr! * 10000) / 10000, 0.0108);
});

Deno.test('conta inteira: todo o gasto, visitas de todos os funis e leads da Central pela data de entrada', () => {
  const facts = crmLeadFacts([
    {col: 'leads', id: 'a', data: {source: 'Meta Ads', utm: {source: 'meta', adId: '111111', ad: 'Anúncio A'}, stage: 'feita', createdAt: '2026-10-18T13:00:00Z', bookedAt: '2026-10-18T15:00:00Z', meetingDoneAt: '2026-10-19T15:00:00Z', name: 'Fulano', phone: '31999990001'}},
    {col: 'leads', id: 'b', data: {source: 'Meta Ads', utm: {source: 'meta'}, stage: 'fechado', createdAt: '2026-10-19T13:00:00Z', closedAt: '2026-10-19T20:00:00Z', value: 'R$ 997'}},
    {col: 'leads', id: 'c', data: {source: 'Instagram (link na bio)', utm: {source: 'instagram'}, stage: 'novo', createdAt: '2026-10-19T14:00:00Z'}},
  ]);
  assertEquals(facts.length, 3);
  assert(!('phone' in facts[0]) && !('name' in facts[0]));
  assertEquals([facts[0].ad_id, facts[0].utm_source, facts[1].value, facts[1].closed_at], ['111111', 'meta', 997, '2026-10-19T20:00:00Z']);
  assert(isMetaLead(facts[0]) && !isMetaLead(facts[2]));
  const base = {answers: {}, steps: [], last_step: null, completed: false, interacted: true} as unknown as Session;
  const sessions = [{...base, id: 's1', created_at: '2026-10-18T12:00:00Z', tracking: {utm_source: 'FB', utm_content: 'A|111111'}, clicks: {x: {name: 'Enviar'}}, phone: '5531999990001', crm: {stage: 'feita'}}] as Session[];
  const r = aggregateAccount(sessions, facts, [{day: '2026-10-18', ad_id: '111111', spend: 50, impressions: 1000, link_clicks: 20, lpv: 15}, {day: '2026-10-19', ad_id: '222222', spend: 30}], {submitNames: ['Enviar']});
  assertEquals([r.meta.spend, r.paid.visits, r.paid.submitted], [80, 1, 1]);
  assertEquals([r.paid.inCrm, r.paid.booked, r.paid.met, r.paid.won, r.paid.revenue], [2, 2, 2, 1, 997]);
  assertEquals(r.all.inCrm, 3);
  assertEquals(r.stages.paid, {feita: 1, fechado: 1});
  assertEquals(r.daily.map(d => [d.day, d.spend, d.inCrm]), [['2026-10-18', 50, 1], ['2026-10-19', 30, 1]]);
});

Deno.test('gasto da rotina da Meta entra no documento da Central trocando só os dias da remessa', () => {
  const doc = {updatedAt: '2026-10-22T03:00:00Z', daily: '2026-08-01', account: 'Conta (act_1)', rows: [
    {adId: '111111', ad: 'A', day: '2026-10-20', month: '2026-10', spend: 10},
    {adId: '111111', ad: 'A', day: '2026-10-21', month: '2026-10', spend: 20},
    {adId: '222222', ad: 'B', day: '2026-10-21', month: '2026-10', spend: 5},
    {adId: '111111', ad: 'A', month: '2026-07', spend: 300},
  ]};
  const r = crmSpendDoc(doc, [
    {day: '2026-10-21', ad_id: '111111', ad_name: 'A', campaign_id: '9999999', campaign_name: 'C', adset_id: '8888888', adset_name: 'S', spend: 21.456, impressions: 500, clicks: 9, lpv: 7, meta_leads: 1},
    {day: '2026-10-22', ad_id: '111111', ad_name: 'A', spend: 30, impressions: 600},
    {day: '2026-10-22', ad_id: '333333', ad_name: '', spend: 3},
    {day: '2026-10-22', ad_id: '444444', ad_name: 'Sem gasto', spend: 0, impressions: 0},
  ], '2026-10-24T22:00:00Z')!;
  assertEquals([r.since, r.until, r.rows, r.spend], ['2026-10-21', '2026-10-22', 2, 51.46]);
  assertEquals([r.data.updatedAt, r.data.daily, r.data.account], ['2026-10-24T22:00:00Z', '2026-08-01', 'Conta (act_1)']);
  // o 20/10 e o mês de julho ficam; o 21/10 do B some (sem gasto na remessa) e o do A é trocado
  assertEquals(r.data.rows.map((x: any) => [x.adId, x.day || x.month, x.spend]), [['111111', '2026-10-20', 10], ['111111', '2026-07', 300], ['111111', '2026-10-21', 21.46], ['111111', '2026-10-22', 30]]);
  assertEquals(r.data.rows[2], {adId: '111111', ad: 'A', adsetId: '8888888', adset: 'S', campaignId: '9999999', campaign: 'C', day: '2026-10-21', month: '2026-10', spend: 21.46, impressions: 500, clicks: 9, lpv: 7, metaLeads: 1});
  assertEquals(crmSpendDoc(doc, [{day: '2026-10-22', ad_id: '333333', ad_name: '', spend: 3}], 'x'), null);
  assertEquals(crmSpendDoc(null, [{day: '2026-10-22', ad_id: '111111', ad_name: 'A', spend: 1}], 'x')!.data.daily, '2026-10-22');
});
