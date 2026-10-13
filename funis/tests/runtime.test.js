// Testes do motor dos funis: node --test funis/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const R = require('../runtime.js');
const brase = require('../data/brase-2.json');

const ans = (name, value, score, label) => ({name, type: 'options', value, score, label: label || value});
const byTitle = (f, t) => f.steps.find(s => s.title === t);

test('calc: aritmética, precedência, parênteses e funções', () => {
  assert.equal(R.calcEval('1+2*3'), 7);
  assert.equal(R.calcEval('(1+2)*3'), 9);
  assert.equal(R.calcEval('(250+125+0+70)/10'), 44.5);
  assert.equal(R.calcEval('10/0'), 0);
  assert.equal(R.calcEval('round(4.6)'), 5);
  assert.equal(R.calcEval('max(3;8)'), 8);
  assert.equal(R.calcEval('-5+2'), -3);
  assert.equal(R.calcEval('abc+1'), 1);
});

test('variáveis: {{score.x}}, {{score}}, {{x}} e calc() no texto', () => {
  const answers = {a: ans('tempo', 'igual', 250, 'Igual ou menor'), b: ans('promo', 'nao', 0, 'Não tenho promoção'), c: {name: 'nome', type: 'field', value: 'Ana'}};
  const ctx = {answers};
  assert.equal(R.interpolate('{{score.tempo}}', ctx), '250');
  assert.equal(R.interpolate('{{score}}', ctx), '250');
  assert.equal(R.interpolate('Olá {{nome}}', ctx), 'Olá Ana');
  assert.equal(R.interpolate('{{promo}}', ctx), 'Não tenho promoção');
  assert.equal(R.interpolate('{{value.promo}}', ctx), 'nao');
  assert.equal(R.interpolate('calc({{score.tempo}}+{{score.adicional}}) de 1000', ctx), '250 de 1000');
  assert.equal(R.interpolate('<b>{{nome}}</b>', {answers: {x: {name: 'nome', type: 'field', value: '<i>'}}}, {html: true}), '<b>&lt;i&gt;</b>');
});

test('métrica do diagnóstico do BRASE 2 soma as 4 respostas', () => {
  const step = byTitle(brase.draft, 'PP 09 - Diagnóstico');
  const metric = step.layers.find(l => l.type === 'metric');
  const answers = {t: ans('tempo', 'igual', 250), a: ans('adicional', 'alguns', 125), p: ans('promo', 'carrochefe', 300), e: ans('entrega', 'bolso', 70)};
  assert.equal(R.interpolate(metric.content.percent, {answers}, {fmt: String}), '74.5');
  assert.match(R.interpolate(metric.content.subtitle, {answers}), /^745 de 1000/);
  // sem respostas, vale 0
  assert.equal(R.interpolate(metric.content.percent, {answers: {}}, {fmt: String}), '0');
});

test('regras de exibição: E dentro do grupo, OU entre grupos, ==, !=, vazio', () => {
  const answers = {f: ans('frase', 'cupom', 0)};
  assert.equal(R.evalRoles([[{variable: '@frase', compare: '==', value: 'cupom'}]], {answers}), true);
  assert.equal(R.evalRoles([[{variable: '@frase', compare: '==', value: 'sair'}]], {answers}), false);
  assert.equal(R.evalRoles([[{variable: '@frase', compare: '!=', value: 'sair'}]], {answers}), true);
  assert.equal(R.evalRoles([[{variable: '@frase', compare: '==', value: 'sair'}], [{variable: '@frase', compare: '==', value: 'cupom'}]], {answers}), true);
  assert.equal(R.evalRoles([[{variable: '@frase', compare: '==', value: 'cupom'}, {variable: '@culpa', compare: '==', value: 'x'}]], {answers}), false);
  assert.equal(R.evalRoles([[{variable: '@culpa', compare: 'empty'}]], {answers}), true);
  assert.equal(R.evalRoles([], {answers}), true);
  // sem resposta, "!=" mostra (como no diagnóstico: tempo != igual)
  assert.equal(R.evalRoles([[{variable: '@tempo', compare: '!=', value: 'igual'}]], {answers: {}}), true);
});

test('diagnóstico mostra só a frase escolhida', () => {
  const step = byTitle(brase.draft, 'PP 09 - Diagnóstico');
  const answers = {f: ans('frase', 'lojadolado', 0), c: ans('culpa', 'ifood', 0)};
  const shown = step.layers.filter(l => R.evalRoles(l.roles, {answers}) && l.roles).map(l => R.stripHtml(l.content.text));
  assert.ok(shown.some(t => t.includes('A loja do lado vende mais que eu')));
  assert.ok(!shown.some(t => t.includes('Fico esperando o iFood tocar')));
  assert.ok(shown.some(t => t.includes('a culpa é do iFood')));
});

test('navegação do BRASE 2 igual à do InLead', () => {
  const f = brase.published;
  const idx = t => f.steps.findIndex(s => s.title === t);
  const fat = byTitle(f, 'Faturamento').layers.find(l => l.type === 'options').content.options;
  const go = (from, item) => R.resolveDestination(f, idx(from), R.destinationOf(f, item));
  assert.deepEqual(go('Faturamento', fat[0]), {step: idx('Zapfood')});
  assert.deepEqual(go('Faturamento', fat[1]), {step: idx('De onde vem as vendas')});
  assert.deepEqual(go('Faturamento', fat[2]), {step: idx('Como cuida do mkt')});
  const canal = byTitle(f, 'De onde vem as vendas').layers.find(l => l.type === 'options').content.options;
  assert.deepEqual(go('De onde vem as vendas', canal[0]), {step: idx('Zapfood')});
  assert.deepEqual(go('De onde vem as vendas', canal[2]), {step: idx('Como cuida do mkt')});
  const send = byTitle(f, 'Análise pré-aprovada').layers.find(l => l.type === 'button').content;
  assert.deepEqual(go('Análise pré-aprovada', send), {url: 'https://wa.link/bay8db'});
  assert.equal(send.name, 'VT19S2');
  const zap = byTitle(f, 'Zapfood').layers.find(l => l.type === 'button').content;
  assert.deepEqual(go('Zapfood', zap), {step: idx('Checkout')});
  const cta = byTitle(f, 'Checkout').layers.find(l => l.type === 'button').content;
  assert.match(go('Checkout', cta).url, /^https:\/\/pay\.kirvano\.com\//);
  const capa = byTitle(f, 'Capa').layers.find(l => l.type === 'button').content;
  assert.deepEqual(go('Capa', capa), {step: 1});
});

test('BRASE 2: rascunho tem 21 etapas e publicado 11, com a mesma aparência', () => {
  assert.equal(brase.draft.steps.length, 21);
  assert.equal(brase.published.steps.length, 11);
  assert.deepEqual(brase.published.steps.map(s => s.id), brase.draft.steps.slice(0, 11).map(s => s.id));
  assert.equal(brase.draft.design.themeColor, '#a21caf');
  assert.equal(brase.draft.settings.pixel.facebook, '1696577860982247');
  assert.ok(!JSON.stringify(brase).includes('media.inlead.cloud'), 'mídias copiadas para funis/media');
  assert.ok(!/token=/.test(JSON.stringify(brase)), 'sem token no arquivo público');
});

test('campos: telefone com máscara e validação', () => {
  assert.equal(R.phoneMask('21959055007'), '(21) 95905-5007');
  assert.equal(R.phoneMask('+55 21 95905-5007'), '(21) 95905-5007');
  assert.equal(R.phoneMask('2133334444'), '(21) 3333-4444');
  assert.equal(R.validateField({type: 'phone', required: true}, '(21) 9590'), 'Digite um telefone com DDD');
  assert.equal(R.validateField({type: 'phone', required: true}, '(21) 95905-5007'), '');
  assert.equal(R.validateField({type: 'email', required: true}, 'a@b'), 'Digite um e-mail válido');
  assert.equal(R.validateField({type: 'text', required: true}, '  '), 'Campo obrigatório');
  assert.equal(R.validateField({type: 'text', required: false}, ''), '');
});

test('importação do InLead junta o mapa de navegação nos itens', () => {
  const f = R.fromInlead({data: {title: 'X', slug: 'x', steps: [{id: 's1', title: 'A', layers: [{id: 'l1', type: 'options', design: [], content: {name: 'q', options: [{id: 'o1', label: '<p>a</p>', value: 'a'}]}}]}, {id: 's2', title: 'B', layers: []}], navigation: {o1: 's2'}, design: {themeColor: '#000'}, scripts: {facebook: '123'}}});
  assert.equal(f.steps[0].layers[0].content.options[0].destination, 's2');
  assert.deepEqual(f.steps[0].layers[0].design, {});
  assert.equal(f.settings.pixel.facebook, '123');
  assert.equal(f.design.themeColor, '#000');
});

test('rótulo limpo das opções (para o CRM)', () => {
  assert.equal(R.plainLabel('<p>🔇&nbsp;<strong>Silêncio&nbsp;Total:</strong>&nbsp;Minhas&nbsp;visitas.</p>'), 'Silêncio Total: Minhas visitas.');
  assert.equal(R.plainLabel('<p>+50.000/mês</p>'), '50.000/mês');
});

test('componentes novos têm conteúdo de exemplo e ids únicos', () => {
  for (const c of R.COMPONENTS) {
    const l = R.newLayer(c.type, c.sub);
    assert.ok(l.id && l.content && l.content.name, c.title);
  }
  const l = R.newLayer('options'), d = R.reId(l);
  assert.notEqual(d.id, l.id);
  assert.notEqual(d.content.options[0].id, l.content.options[0].id);
});
