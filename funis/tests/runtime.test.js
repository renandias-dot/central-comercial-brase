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
  // como no InLead: {{nome}} é o valor da opção; o texto escolhido fica em {{label.nome}}
  assert.equal(R.interpolate('{{promo}}', ctx), 'nao');
  assert.equal(R.interpolate('{{label.promo}}', ctx), 'Não tenho promoção');
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
  assert.equal(R.validateField({type: 'phone', required: true}, '(21) 9590'), 'Digite o celular com DDD');
  assert.equal(R.validateField({type: 'phone', required: true}, '(20) 95905-5007'), 'Confira o DDD');
  assert.equal(R.validateField({type: 'phone', required: true}, '(21) 85905-5007'), 'Confira o número do celular');
  assert.equal(R.validateField({type: 'phone', required: true}, '+55 (21) 95905-5007'), '');
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

test('variáveis com @, como no InLead (e-mail fica intacto)', () => {
  const ctx = {answers: {c: {name: 'nome', type: 'field', value: 'Ana'}}};
  assert.equal(R.interpolate('Oi @nome!', ctx), 'Oi Ana!');
  assert.equal(R.interpolate('contato@nome.com', ctx), 'contato@nome.com');
  assert.equal(R.interpolate('@@nome', ctx), '@@nome');
  assert.equal(R.interpolate('Oi @sumiu.', ctx), 'Oi .');
});

test('calc: inteiro fica inteiro, decimal com duas casas (InLead)', () => {
  const ctx = {answers: {a: ans('x', '1', 745)}};
  assert.equal(R.interpolate('calc({{score.x}}/10)', ctx), '74.50');
  assert.equal(R.interpolate('calc({{score.x}}+5)', ctx), '750');
});

test('respostas guardadas como no InLead: valor, score, responses, tracking e clique', () => {
  const answers = {m: {name: 'canais', type: 'options', value: ['ifood', 'zap'], score: 3, ids: ['a', 'c'], responses: 'ifood|*|zap'}};
  const v = R.buildVars({answers, params: {utm_source: 'meta'}, clicks: {enviar: true}, screen: '390x844'});
  assert.equal(v.canais, 'ifood|zap');
  assert.equal(v['score.canais'], 3);
  assert.equal(v['responses.canais'], 'ifood|*|zap');
  assert.equal(v['tracking.utm_source'], 'meta');
  assert.equal(v['tracking.screen'], '390x844');
  assert.equal(v.enviar, 'clicked');
  assert.equal(R.interpolate('{{url.utm_source}}', {params: {utm_source: 'meta'}}), 'meta');
});

test('regras: contém, aparece N vezes e porcentagem (múltipla escolha)', () => {
  const answers = {m: {name: 'canais', type: 'options', value: ['ifood', 'zap', 'ifood'], score: 0}};
  const ctx = {answers};
  assert.equal(R.evalRoles([[{variable: '@canais', compare: 'includes', value: 'zap'}]], ctx), true);
  assert.equal(R.evalRoles([[{variable: 'ifood', compare: 'count==', value: '@canais', number: 2}]], ctx), true);
  assert.equal(R.evalRoles([[{variable: 'ifood', compare: 'count>=', value: '@canais', number: 3}]], ctx), false);
  assert.equal(R.evalRoles([[{variable: 'zap', compare: 'count<', value: '@canais', number: 2}]], ctx), true);
  assert.equal(R.evalRoles([[{variable: 'ifood', compare: 'percent>', value: '@canais', number: 50}]], ctx), true);
  assert.equal(R.evalRoles([[{variable: 'zap', compare: 'percent<', value: '@canais', number: 30}]], ctx), false);
  // números com vírgula viram número dos dois lados
  assert.equal(R.evalRoles([[{variable: '@fat', compare: '>', value: '1.000'}]], {answers: {f: {name: 'fat', type: 'field', value: '1.234,56'}}}), true);
  assert.equal(R.ROLE_OPERATORS.length, 13);
});

test('link externo leva os parâmetros da URL atual (UTMs) e ganha https://', () => {
  assert.equal(R.buildRedirect('wa.me/5511999999999?text=oi', {utm_source: 'meta', fbclid: 'x'}), 'https://wa.me/5511999999999?utm_source=meta&fbclid=x&text=oi');
  assert.equal(R.buildRedirect('https://pay.kirvano.com/abc?utm_source=site', {utm_source: 'meta'}), 'https://pay.kirvano.com/abc?utm_source=site');
  assert.equal(R.buildRedirect('https://a.com/p#topo', {}), 'https://a.com/p#topo');
});

test('modelos de link do botão: WhatsApp e checkout com dados do lead', () => {
  const answers = {n: {name: 'nome', type: 'field', value: 'Ana Souza'}, t: {name: 'telefone', type: 'field', value: '(11) 98888-7777'}, e: {name: 'email', type: 'field', value: 'ana@x.com'}};
  const ctx = {answers};
  assert.equal(R.toE164('(11) 98888-7777'), '5511988887777');
  const wa = R.buttonHref({model: {type: 'whatsapp', phone: '11 98888-7777', message: 'Oi, sou {{nome}}'}}, ctx);
  assert.equal(wa, 'https://wa.me/5511988887777?text=Oi%2C%20sou%20Ana%20Souza');
  const kv = R.buttonHref({model: {type: 'kirvano', code: 'abc', name: '{{nome}}', email: '{{email}}', phone: '{{telefone}}'}}, ctx);
  assert.match(kv, /^https:\/\/pay\.kirvano\.com\/abc\?/);
  assert.match(kv, /email=ana%40x\.com/);
  assert.ok(Object.keys(R.LINK_MODELS).length >= 19);
});

test('componentes do InLead: nomes antigos viram os novos e arquivados somem', () => {
  assert.equal(R.normalizeLayer({type: 'testimonials', content: {}}).type, 'quotes');
  assert.equal(R.normalizeLayer({type: 'html', content: {html: '<b>x</b>'}}).type, 'script');
  for (const t of ['notification', 'quotes', 'compare', 'carousel', 'graphics', 'charts', 'script', 'date', 'height', 'weight']) assert.ok(R.COMPONENTS.some(c => c.type === t), t);
  const o = R.newLayer('options', 'video');
  assert.equal(o.content.introType, 'video');
});

test('Raio-X do iFood: componente e variáveis com os dados da loja', () => {
  const l = R.newLayer('ifood');
  assert.equal(l.type, 'ifood');
  assert.ok(R.INPUT_TYPES.includes('ifood'));
  const v = R.buildVars({answers: {x: {name: 'loja', type: 'ifood', value: 'https://ifood…', data: {avaliacoes: 312, posicao: 7, total: 24}}}});
  assert.equal(v['loja.avaliacoes'], 312);
  assert.equal(R.interpolate('Você está em {{loja.posicao}}º de {{loja.total}}', {answers: {x: {name: 'loja', type: 'ifood', value: '', data: {posicao: 7, total: 24}}}}), 'Você está em 7º de 24');
});

test('teste A/B: variante fixa por visitante, forçada pelo link e em @teste.nome', () => {
  const f = {settings: {ab: [{name: 'Capa', variants: 'atual, v1'}, {name: 'off', variants: 'a,b', enabled: false}, {name: 'uma', variants: 'só'}]}};
  const n = {atual: 0, v1: 0};
  for (let i = 0; i < 1000; i++) n[R.abAssign(f, 'v' + i, {}).teste_capa]++;
  assert.ok(n.atual > 400 && n.v1 > 400, JSON.stringify(n));
  assert.deepStrictEqual(R.abAssign(f, 'abc123', {}), R.abAssign(f, 'abc123', {}));
  assert.deepStrictEqual(Object.keys(R.abAssign(f, 'x', {})), ['teste_capa', 'teste_uma'], 'teste desligado não entra');
  assert.strictEqual(R.abAssign(f, 'x', {}).teste_uma, 'só', 'com uma variante, todo visitante fica marcado com ela');
  assert.strictEqual(R.abAssign(f, 'x', {teste_capa: 'v1'}).teste_capa, 'v1');
  assert.notStrictEqual(R.abAssign(f, 'x', {teste_capa: 'inventada'}).teste_capa, 'inventada');
  const vars = R.buildVars({params: {teste_capa: 'v1'}});
  assert.strictEqual(vars['teste.capa'], 'v1');
  assert.ok(R.evalRoles([[{variable: '@teste.capa', compare: '==', value: 'v1'}]], {vars}));
  assert.ok(!R.evalRoles([[{variable: '@teste.capa', compare: '!=', value: 'v1'}]], {vars}));
  assert.ok(R.evalRoles([[{variable: '@teste.capa', compare: '!=', value: 'v1'}]], {vars: {}}), 'sem variante (página antiga), a capa atual aparece');
});
