// Gera funis/data/brase-2-otimizado.json: o BRASE 2 com as decisões de 13/10/2026 (documento "Funil Inlead Brase —
// Análise e Testes de Conversão"). O BRASE 2 original não muda.  Uso: node funis/tools/brase-2-otimizado.js
// Atenção: o data/brase-2-otimizado.json hoje é a cópia do publicado (com edições feitas no editor). Rodar este gerador
// volta à versão de 13/10 e apaga essas edições.
//  · Capa: teste A/B da capa atual (só "menos de 2 minutos" no lugar de "45 segundos") contra a V1 (desligado em 15/10
//    e religado em 16/10/2026).
//  · Etapa 6 corrigida: 5 a 10 mil + iFood/99 vai para o formulário; balcão e cardápio próprio, para o ramo de baixo.
//  · Formulário V7 (diagnóstico com ❌ por resposta, 3 campos, WhatsApp do Lipe com texto pronto) e a cópia V5 para
//    quem já pagou agência.
//  · Ramo abaixo de R$ 5 mil no arco do Hunt Cash, terminando no ZapFood com checkout honesto.
//  · Etiquetas no webhook e LeadQualificado só quando o lead no perfil envia o formulário.
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../runtime.js');
const src = require('../data/brase-2.json');
const pub = R.clone(src.published), draft = R.clone(src.draft);
const AMBER = 'rgb(245, 158, 11)';
const byTitle = (f, t) => f.steps.find(s => s.title === t || s.title.startsWith(t));
const C = (variable, compare, value) => ({variable, compare, value});
const is = (v, val) => [[C('@' + v, '==', val)]];
const T = (html, roles) => { const l = R.newLayer('text'); l.content.text = html; if (roles) l.roles = roles; return l };
const clear = h => { const l = R.newLayer('clear'); l.content.clear = h || 'h-[1rem]'; return l };
const amber = b => { b.design = Object.assign({basis: 100}, {style: 'custom', backgroundColor: '#f59e0b', color: '#171717'}); return b };
const btn = (label, destination, name) => { const b = R.newLayer('button'); Object.assign(b.content, {label, destination, type: /^https?:/.test(destination) ? 'redirect' : 'next'}); if (name) b.content.name = name; return b };
const optDesign = R.clone(byTitle(draft, 'PP 02').layers.find(l => l.type === 'options').design);
function options(name, list){
  const l = R.newLayer('options');
  l.design = R.clone(optDesign);
  l.content.name = name;
  l.content.options = list.map(([value, label]) => ({id: R.uid(), image: {type: 'image', src: null}, score: 0, value, label: `<p>${label}</p>`, destination: 'next'}));
  return l;
}
const setOpt = (layer, value, patch) => { const o = layer.content.options.find(x => String(x.value) === String(value)); Object.assign(o, patch); return o };

/* ================= etapas do BRASE 2 publicado ================= */
const capa = byTitle(pub, 'Capa'), dorS = byTitle(pub, 'Dor'), fotosS = byTitle(pub, 'Fotos'), cardS = byTitle(pub, 'Cardápio');
const fatS = byTitle(pub, 'Faturamento'), canalS = byTitle(pub, 'De onde vem as vendas'), mktS = byTitle(pub, 'Como cuida do mkt');
const formS = byTitle(pub, 'Análise pré-aprovada'), obrigado = byTitle(pub, 'Obrigado'), checkout = byTitle(pub, 'Checkout');
const optOf = s => s.layers.find(l => l.type === 'options');
const dor = optOf(dorS).content.name, fotos = optOf(fotosS).content.name, card = optOf(cardS).content.name;
const fat = optOf(fatS).content.name, canal = optOf(canalS).content.name, mkt = optOf(mktS).content.name;

/* ---------- 1. Capa: teste A/B (atual × V1) ---------- */
// Sem variante (página antiga ou link sem teste), aparece a capa atual.
const ATUAL = [[C('@teste.capa', '!=', 'v1')]], V1 = is('teste.capa', 'v1');
for (const l of capa.layers) {
  l.roles = ATUAL;
  if (l.type === 'text') l.content.text = l.content.text.replace(/Tempo&nbsp;estimado:&nbsp;45&nbsp;segundos\./, 'Tempo&nbsp;estimado:&nbsp;menos&nbsp;de&nbsp;2&nbsp;minutos.');
}
if (!capa.layers.some(l => /menos&nbsp;de&nbsp;2&nbsp;minutos/.test(l.content.text || ''))) throw new Error('Não achei "45 segundos" na capa.');
capa.layers.push(
  T(`<h1 class="ql-align-center">Sua loja vende menos no iFood <span style="color: ${AMBER};">do que deveria?</span></h1>`, V1),
  T('<h3 class="ql-align-center">Leva menos de 2 minutos. Depois, a gente te mostra onde o ranking está segurando a sua loja.</h3>', V1),
  Object.assign(amber(btn('Ver onde minha loja trava ➔', 'next', 'iniciar_v1')), {roles: V1}),
  T('<p class="ql-align-center"><em>Feito para lojas que já vendem a partir de R$ 10 mil por mês no iFood.</em></p>', V1),
);

/* ---------- 2. Ramo de baixo (arco do Hunt Cash) — montado antes para ter os ids ---------- */
const pp = t => R.clone(byTitle(draft, t));
// Ponte: porta fechada honesta (P1).
const ponte = pp('PP 01');
ponte.title = 'Ponte · abaixo de R$ 5 mil';
ponte.layers = [
  T(`<h1 class="ql-align-center">Nossa análise individual é só pra loja que já vende <span style="color: ${AMBER};">mais de R$ 5 mil por mês no iFood.</span></h1>`),
  T('<h3 class="ql-align-center">Mas o que trava loja pequena no iFood dá pra arrumar sozinho. Responda umas perguntas rápidas e você vê o que mexer primeiro.</h3>'),
  ponte.layers.find(l => l.type === 'button'),
];
ponte.layers[2].content.label = 'Me mostra ➔';
// Tipo de loja (nova): segmenta e adapta os exemplos do resultado.
const TIPOS = [['hamburgueria', '🍔 <strong>Hamburgueria</strong>', 'do X-Bacon', 'no X-Bacon'], ['pizzaria', '🍕 <strong>Pizzaria</strong>', 'da pizza de calabresa', 'na pizza de calabresa'], ['acai', '🍧 <strong>Açaí ou sorvete</strong>', 'do açaí de 500 ml', 'no açaí de 500 ml'], ['marmita', '🍱 <strong>Marmita</strong>', 'da marmita de frango', 'na marmita de frango'], ['japones', '🍣 <strong>Japonês</strong>', 'do combinado de 20 peças', 'no combinado de 20 peças'], ['doces', '🍰 <strong>Doces e bolos</strong>', 'do bolo de pote', 'no bolo de pote'], ['outro', '🍽️ <strong>Outro</strong>', 'do prato mais vendido', 'no prato mais vendido']];
const tipo = R.newStep('Tipo de loja', [
  T(`<h1 class="ql-align-center">Que tipo de loja <span style="color: ${AMBER};">é a sua?</span></h1>`),
  T('<p class="ql-align-center">Pra adaptar os exemplos do seu resultado ao que você vende.</p>'),
  options('tipo_loja', TIPOS.map(([v, l]) => [v, l])),
]);
const ident = pp('PP 02'), culpa = pp('PP 03');
// PP 04 a 07: a pior opção na voz do dono.
const tempo = pp('PP 04'), adic = pp('PP 05'), promo = pp('PP 06'), entrega = pp('PP 07');
setOpt(optOf(tempo), 'mais10', {label: '<p>❌ <strong>Mais de 10 min a mais:</strong> O cliente vê um tempo e o pedido chega bem depois.</p>'});
setOpt(optOf(adic), 'nao', {label: '<p>❌ <strong>Não tenho:</strong> O cliente pede o lanche e pronto, não tem o que somar.</p>'});
setOpt(optOf(promo), 'nao', {label: '<p>🚫 <strong>Não tenho:</strong> Tenho medo de dar desconto e não sobrar nada.</p>'});
setOpt(optOf(entrega), 'bolso', {label: '<p>💸 <strong>Sim, do meu bolso:</strong> Eu pago e nem sei quanto isso me custa no mês.</p>'});
// Carregando: diz o que de fato acontece.
const carregando = pp('PP 08');
carregando.layers.find(l => l.type === 'loading').content.title = 'Calculando o Score da sua loja com as suas respostas...';
// Diagnóstico: Score calculado, o que tira pedido e a causa única (bloco novo).
const diag = pp('PP 09');
diag.title = 'Diagnóstico · abaixo de R$ 5 mil';
diag.layers[0].content.text = `<h1 class="ql-align-center">📊 Seu resultado <span style="color: ${AMBER};">está pronto</span></h1>`;
const quase = diag.layers.findIndex(l => l.type === 'text' && /alguém mandou/.test(l.content.text || ''));
if (quase < 0) throw new Error('Não achei o bloco "alguém mandou" na PP 09.');
diag.layers.splice(quase, 0,
  T(`<p><strong>A causa é uma só:</strong> o cliente novo não tem um bom motivo pra fazer o primeiro pedido na sua loja. <span style="color: ${AMBER};">Sem esse primeiro pedido, sua loja não sobe na lista.</span></p>`),
  clear());
// Cena de futuro (nova).
const futuro = R.newStep('Cena de futuro', [
  T(`<h1 class="ql-align-center">Agora <span style="color: ${AMBER};">imagine:</span></h1>`),
  T('<h3 class="ql-align-center">Domingo à noite, você abre o portal e vê 3 pedidos de gente que nunca tinha comprado de você, todos pelo mesmo produto.</h3>'),
  T('<p class="ql-align-center"><strong>Isso mudaria sua semana?</strong></p>'),
  options('futuro', [['muito', '🔥 <strong>Mudaria muito</strong>'], ['preciso', '🎯 <strong>É exatamente o que eu preciso</strong>'], ['nao', '🤷 <strong>Acho que não faria diferença</strong>']]),
]);
// Demonstração (nova), com o ZapFood: o erro em vermelho e o que fazer para ficar verde. Exemplo pelo tipo de loja.
const exemplo = ([v, , de, em]) => T(`<p><em>Exemplo ilustrativo, para uma loja fictícia:</em></p><p>🔴 <strong>Foto:</strong> a foto ${de} está escura e de longe.<br>🟢 <strong>Pra ficar verde:</strong> foto de dia, de perto, com o produto bem à mostra.</p><p>🔴 <strong>Texto:</strong> o nome não diz o que vem ${em}.<br>🟢 <strong>Pra ficar verde:</strong> nome com o ingrediente principal e o tamanho.</p><p>🔴 <strong>Estrutura:</strong> o cardápio não tem combo nem produto de entrada.<br>🟢 <strong>Pra ficar verde:</strong> um combo de entrada no topo, com adicional.</p>`, v === 'outro' ? [[C('@tipo_loja', '==', 'outro')], [C('@tipo_loja', 'empty', '')]] : is('tipo_loja', v));
const demo = R.newStep('Demonstração', [
  T(`<h1 class="ql-align-center">E se você recebesse, no WhatsApp, <span style="color: ${AMBER};">o que está errado na sua loja</span> e o que fazer pra arrumar?</h1>`),
  ...TIPOS.map(exemplo),
  T('<p class="ql-align-center"><strong>Você conseguiria arrumar isso sozinho?</strong></p>'),
  options('demo', [['consigo', '💪 <strong>Consigo em poucos minutos</strong>'], ['acho', '🙂 <strong>Acho que sim</strong>'], ['ajuda', '🙋 <strong>Precisaria de ajuda</strong>']]),
]);
// Quando quer começar (nova): compromisso, sem recusa que envergonha.
const quando = R.newStep('Quando quer começar', [
  T(`<h1 class="ql-align-center">Quando você quer <span style="color: ${AMBER};">parar de esperar o iFood tocar?</span></h1>`),
  options('quando', [['semana', '🚀 <strong>Esta semana</strong>'], ['depois', '⏳ <strong>Ainda não é prioridade</strong>']]),
]);
// Oferta: o checkout do ZapFood sem cronômetro, "Tempo limitado!", "DE R$ 297" e barra fixa.
const oferta = checkout;
oferta.title = 'Oferta · ZapFood';
const SCORE = 'calc({{score.tempo}}+{{score.adicional}}+{{score.promo}}+{{score.entrega}})';
const keep = oferta.layers.filter(l => l.type !== 'timer');
const video = keep.find(l => l.type === 'video'), audio = keep.find(l => l.type === 'audio'), price = keep.find(l => l.type === 'price');
const buy = keep.find(l => l.type === 'button'), faq = keep.find(l => l.type === 'faq');
Object.assign(price.content, {value: 'R$ 9,94', before: '12x de', after: 'ou R$ 97 à vista', featured: 'Pagamento único · acesso vitalício'});
buy.content.label = 'Quero destravar minhas vendas ➔';
oferta.layers = [
  T(`<h1 class="ql-align-center">Seu Score está em <span style="color: ${AMBER};">${SCORE} de 1000.</span></h1>`),
  T('<h3 class="ql-align-center">O que sobe primeiro está aqui: o ZapFood é o Scanner de Algoritmo da Brase. Ele aponta o que está travando sua loja, em vermelho, e diz o que fazer pra ficar verde.</h3>'),
  T('<p class="ql-align-center">👇 Veja em 1 minuto como funciona:</p>'),
  video,
  T('<p class="ql-align-center">🎧 Ouça a Michele, dona do “Lanche dos Guri”, que saiu de R$ 600 pra R$ 4.000 por mês usando o Scanner:</p>'),
  clear(), audio, clear(),
  T('<p class="ql-align-center">É simples: o Scanner aponta o erro ➔ você corrige ➔ o pedido toca.</p><p class="ql-align-center">✅ Descubra a trava agora. ✅ Arrume sua loja hoje. ✅ Volte a vender.</p>'),
  T('<p class="ql-align-center"><em>Sem pressa: o acesso é vitalício, você usa quando quiser.</em></p>', is('quando', 'depois')),
  T('<p class="ql-align-center"><em>Se travar em algum ponto, o suporte é com o próprio Renan.</em></p>', is('demo', 'ajuda')),
  price, clear(), buy,
  T('<p class="ql-align-center">🛡️ Pagamento único de R$ 97, sem mensalidade. Não gostou? Pede o dinheiro de volta em até 7 dias.</p>'),
  clear(), faq,
];

/* ---------- 3. Faturamento e etapa 6 ---------- */
const lowEntry = ponte.id;
setOpt(optOf(fatS), '0', {destination: lowEntry});
const canalOpt = optOf(canalS);
setOpt(canalOpt, '0', {destination: mktS.id});      // iFood / 99 → formulário (passa pela pergunta de marketing)
setOpt(canalOpt, '5000', {destination: lowEntry});  // Presencial / Balcão → ramo de baixo
setOpt(canalOpt, '10000', {destination: lowEntry}); // Cardápio próprio / WhatsApp → ramo de baixo

/* ---------- 4. Formulário V7 e cópia V5 ---------- */
const [, , fNome, fLoja, fZap, send] = formS.layers;
Object.assign(fNome.content, {title: 'Seu primeiro nome', placeholder: 'Digite seu primeiro nome'});
Object.assign(fLoja.content, {title: 'Nome da loja no iFood', placeholder: 'Como ela aparece no iFood'});
Object.assign(fZap.content, {title: 'WhatsApp com DDD', placeholder: '(00) 00000-0000'});
delete fZap.content.consent;
const N = fNome.content.name, LJ = fLoja.content.name;
// Botão abre o WhatsApp do Lipe com o texto pronto (o webhook continua saindo no clique do VT19S2).
const LIPE = '553193877523'; // o mesmo número do wa.link/bay8db do BRASE 2
const zap = b => { b.content.model = {type: 'whatsapp', phone: LIPE, message: `Oi, Lipe! Sou {{${N}}}, da {{${LJ}}}. Acabei de fazer o teste da Brase.`}; b.content.destination = 'https://wa.me/' + LIPE; b.content.type = 'redirect'; return b };
const item = (txt, roles) => T(`<p>${txt}</p>`, roles);
const lines = (withMkt) => [
  item('❌ Seus pedidos caíram do nada. Quando isso acontece, costuma ser a loja perdendo posição no ranking.', is(dor, 'A')),
  item('❌ Muita gente entra e pouca gente pede. O problema está no cardápio, depois do clique.', is(dor, 'B')),
  item('❌ Você vende bem e sobra pouco. Promoção e taxa estão comendo a margem.', is(dor, 'C')),
  item('❌ Loja nova ainda não tem histórico no ranking, então cada detalhe do cardápio pesa mais.', is(dor, 'D')),
  item('❌ Foto tirada na hora faz o cliente passar direto pelo seu prato.', is(fotos, 'B')),
  item('❌ Sem foto própria, seu prato some no meio dos concorrentes.', is(fotos, 'C')),
  item('❌ Sem produto de entrada e sem combo, o cliente novo não arrisca o primeiro pedido.', is(card, 'B')),
  item('❌ O cliente se perde pra escolher, e quem se perde volta pra lista.', is(card, 'C')),
  item('✅ Fotos e cardápio estão no caminho. O que falta aparece no seu portal.', [[C('@' + fotos, '==', 'A'), C('@' + card, '==', 'A')]]),
  ...(withMkt ? [
    item('❌ Você cuida de tudo, então o iFood fica pra quando sobra tempo.', is(mkt, 'A')),
    item('❌ Você já pagou e não viu resultado. Por isso a conversa começa pelo número da sua loja.', is(mkt, 'B')),
    item('❌ Tem gente cuidando, mas ninguém olhando o ranking de perto.', is(mkt, 'C')),
    item('❌ Ninguém cuidou do iFood até agora, então tem espaço fácil pra ganhar.', is(mkt, 'D')),
  ] : []),
];
const below = () => T('<p class="ql-align-center"><em>O botão abre o WhatsApp do Lipe. Sem spam.</em></p>');
send.content.label = 'Quero ver o resto da minha loja ➔';
zap(send);
formS.title = 'Formulário V7';
formS.layers = [
  T(`<h2 class="ql-align-center">Pelas suas respostas, já dá pra ver <span style="color: ${AMBER};">onde sua loja perde pedido:</span></h2>`),
  ...lines(true),
  T('<p>O resto eu só vejo abrindo sua loja no iFood. Deixa seus dados que o Lipe, do meu time, marca uma conversa comigo. Nela eu te mostro onde sua loja aparece na região e o que mexer primeiro.</p>'),
  fNome, fLoja, fZap, send, below(),
];
// V5: quem marcou "Já paguei agência/gestor/consultoria" (os campos e o botão têm os mesmos nomes: mesmo webhook e CRM).
const reId = l => { const c = R.clone(l); c.id = R.uid(); c.content.id = R.uid(); return c };
const send5 = reId(send); send5.content.label = 'Quero ver o número da minha loja ➔';
const formV5 = R.newStep('Formulário V5 · já pagou agência', [
  T(`<h2 class="ql-align-center">Você já pagou por isso <span style="color: ${AMBER};">e não viu resultado.</span></h2>`),
  T('<p>Então a primeira conversa é só sobre o número da sua loja. Eu abro o Portal do Parceiro com você e mostro onde está a trava. Se não fizer sentido, você sai sabendo onde está o problema.</p>'),
  T('<p><strong>Pelas suas respostas, já dá pra ver por onde começar:</strong></p>'),
  ...lines(false),
  reId(fNome), reId(fLoja), reId(fZap), send5, below(),
]);
for (const o of optOf(mktS).content.options) o.destination = String(o.value) === 'B' ? formV5.id : formS.id;

/* ---------- 5. Ordem das etapas ---------- */
const main = [capa, dorS, fotosS, cardS, fatS, canalS, mktS, formS, formV5, obrigado];
const low = [ponte, tipo, ident, culpa, tempo, adic, promo, entrega, carregando, diag, futuro, demo, quando, oferta];
const f = Object.assign(pub, {steps: main.concat(low)});
main.forEach((s, i) => { s.position = {x: i * 300, y: 0} });
low.forEach((s, i) => { s.position = {x: i * 300, y: 520} });

/* ---------- 6. Leitura dos leads, etiquetas, teste A/B e Pixel ---------- */
f.settings = Object.assign({}, f.settings, {
  checkoutMark: true,
  ab: [{name: 'capa', variants: 'atual, v1', enabled: true}],
  // LeadQualificado só quando o lead no perfil (R$ 10 mil+) envia o formulário: é o evento para a Meta otimizar.
  pixel: Object.assign({}, f.settings && f.settings.pixel, {icpEvent: true, icpWhen: [[C('@' + send.content.name, '==', 'clicked')]]}),
  leads: {
    icp: [[C('@' + fat, '>=', '10000')]],
    score: [
      {label: 'Fatura R$ 30 mil ou mais', points: 40, when: [[C('@' + fat, '>=', '30000')]]},
      {label: 'Fatura de R$ 10 a 30 mil', points: 30, when: is(fat, '10000')},
      {label: 'Fatura de R$ 5 a 10 mil', points: 10, when: is(fat, '5000')},
      {label: 'Vende mais pelo iFood', points: 10, when: is(canal, '0')},
      {label: 'Dor: lucro baixo ou visita sem venda', points: 10, when: [[C('@' + dor, '==', 'C')], [C('@' + dor, '==', 'B')]]},
      {label: 'Já tem equipe ou já pagou agência', points: 10, when: [[C('@' + mkt, '==', 'B')], [C('@' + mkt, '==', 'C')]]},
      {label: 'WhatsApp válido', points: 20, when: [[C('@lead.telefone_valido', '==', 'sim')]]},
    ],
    hot: 70,
    abandon: {enabled: true, minutes: 15},
    dedupeDays: 30,
    // Etiquetas para o Lipe (premissa de 07/10: ~R$ 10 mil Plano IA, ~R$ 30 mil DI), a dor e a objeção.
    tags: [
      {label: 'DI, prioridade alta', when: is(fat, '50000')},
      {label: 'DI', when: is(fat, '30000')},
      {label: 'Plano IA', when: is(fat, '10000')},
      {label: 'Plano IA, prioridade baixa', when: is(fat, '5000')},
      {label: 'Já pagou agência', when: is(mkt, 'B')},
      {label: 'Dor: pedidos caíram do nada', when: is(dor, 'A')},
      {label: 'Dor: visita sem venda', when: is(dor, 'B')},
      {label: 'Dor: lucro baixo', when: is(dor, 'C')},
      {label: 'Dor: está começando', when: is(dor, 'D')},
    ],
  },
});
f.title = 'BRASE 2 · otimizado';
const out = {
  format: src.format, exportedAt: new Date().toISOString(), slug: 'brase-2-otimizado', title: f.title,
  source: {basedOn: 'brase-2', note: 'BRASE 2 com as decisões de 13/10/2026: capa atual × V1 em teste A/B, etapa 6 corrigida, formulário V7 com a cópia V5 (já pagou agência), WhatsApp do Lipe com texto pronto, ramo abaixo de R$ 5 mil no arco do Hunt Cash com o ZapFood em checkout honesto, etiquetas no webhook e LeadQualificado só no envio.'},
  draft: f, published: f, webhook: src.webhook,
};
fs.writeFileSync(path.join(__dirname, '../data/brase-2-otimizado.json'), JSON.stringify(out, null, 1) + '\n');
console.log('etapas:', f.steps.map(s => s.title).join(' › '));
