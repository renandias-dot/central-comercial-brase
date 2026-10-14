// deno test funis/supabase/functions/funis-api/logic.test.ts
import {assert, assertEquals, assertThrows} from 'jsr:@std/assert@1';
import {buildPayload, encodeBody, isQualified, mergeSession, mergeWebhook, periodStart, plainLabel, sameKey, sampleSession, sanitizeParams, sanitizeTracking, sessionVars, slugify, webhookDue, webhookForEditor, type Event} from './logic.ts';

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
