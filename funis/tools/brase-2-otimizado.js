// Gera funis/data/brase-2-otimizado.json: cópia do BRASE 2 publicado com as melhorias de leitura de leads
// (formulário em 3 passos com o WhatsApp primeiro, Raio-X do iFood, resultado parcial na hora, regra de perfil,
// nota do lead, abandono e repetidos). O BRASE 2 original não muda.  Uso: node funis/tools/brase-2-otimizado.js
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../runtime.js');
const src = require('../data/brase-2.json');
const f = R.clone(src.published);
const ORANGE = 'rgb(245, 158, 11)';
const byTitle = t => f.steps.find(s => s.title === t);
const T = (html, roles) => { const l = R.newLayer('text'); l.content.text = html; if (roles) l.roles = roles; return l };
const C = (variable, compare, value) => ({variable, compare, value});
const clear = h => { const l = R.newLayer('clear'); l.content.clear = h || 'h-[1rem]'; return l };
const btn = (label, destination, name) => { const b = R.newLayer('button'); Object.assign(b.content, {label, destination, type: /^https?:/.test(destination) ? 'redirect' : 'next'}); if (name) b.content.name = name; return b };

// ---------- formulário em 3 passos ----------
const form = byTitle('Análise pré-aprovada');
const [hTitle, hText, fNome, fLoja, fZap, send] = form.layers;
const CONSENT = '<p>Ao informar seu WhatsApp, você aceita receber o diagnóstico e o contato da Brase por lá.</p>';
fZap.content.title = 'Para qual WhatsApp eu mando seu diagnóstico?';
fZap.content.consent = CONSENT;
form.layers = [hTitle, T(`<h3 class="ql-align-center">Seu perfil técnico foi recebido e <span style="color: ${ORANGE};">já apareceram pontos travando sua loja.</span></h3><p class="ql-align-center">Eu analiso pessoalmente e te mando o diagnóstico completo.</p>`), fZap, btn('CONTINUAR ➔', 'next')];
const nome = R.newStep('Seu nome', [T('<h2 class="ql-align-center">Como você se chama?</h2>'), fNome, btn('CONTINUAR ➔', 'next')]);
const ifood = R.newLayer('ifood');
Object.assign(ifood.content, {name: 'ifood_loja', title: 'Quer que eu já olhe sua loja no iFood? Cole o link', button: 'VER O RAIO-X DA MINHA LOJA 🔎'});
ifood.design.style = 'dark';
send.content.destination = 'next'; send.content.type = 'next'; // o webhook sai no clique; agora vai para o resultado parcial
const loja = R.newStep('Sua loja', [T('<h2 class="ql-align-center">E qual o nome da sua loja?</h2>'), fLoja, clear(), ifood, clear(), send]);

// ---------- resultado parcial na hora ----------
const N = fNome.content.name, LJ = fLoja.content.name;
const dor = byTitle('Dor').layers.find(l => l.type === 'options').content.name;
const fotos = byTitle('Fotos').layers.find(l => l.type === 'options').content.name;
const card = byTitle('Cardápio').layers.find(l => l.type === 'options').content.name;
const mkt = byTitle('Como cuida do mkt').layers.find(l => l.type === 'options').content.name;
const fat = byTitle('Faturamento').layers.find(l => l.type === 'options').content.name;
const canal = byTitle('De onde vem as vendas').layers.find(l => l.type === 'options').content.name;
const is = (v, val) => [[C('@' + v, '==', val)]];
const item = (html, roles) => T(`<p>${html}</p>`, roles);
const result = R.newStep('Seu diagnóstico', [
  T(`<h1 class="ql-align-center">Recebi sua aplicação, <span style="color: ${ORANGE};">{{${N}}}</span>! ✅</h1>`),
  T(`<h3 class="ql-align-center">Enquanto preparo o diagnóstico completo da {{${LJ}}}, veja o que já apareceu nas suas respostas:</h3>`),
  clear('h-[0.5rem]'),
  item('🔎 <b>Pelo iFood:</b> sua loja tem {{ifood_loja.avaliacoes}} avaliações, cerca de {{ifood_loja.pedidos}} pedidos até hoje.', [[C('@ifood_loja.avaliacoes', '>', '0')]]),
  item('🏁 <b>Na sua região:</b> você está em {{ifood_loja.posicao}}º de {{ifood_loja.total}} lojas de {{ifood_loja.categoria}}. Faltam uns {{ifood_loja.falta}} pedidos para passar {{ifood_loja.proxima}}.', [[C('@ifood_loja.confiavel', '==', 'true'), C('@ifood_loja.falta', '>', '0')]]),
  item('🔇 <b>Queda do nada</b> costuma ser configuração: tempo de entrega, entrega grátis e produto em promoção mexem direto na sua posição na lista.', is(dor, 'A')),
  item('👀 <b>Visita sem venda</b> é vitrine: foto, nome do produto e preço âncora decidem se o pedido sai.', is(dor, 'B')),
  item('📉 <b>Lucro baixo</b> costuma vir de cupom no cardápio todo e entrega grátis do bolso. Dá para vender mais sem baixar o preço.', is(dor, 'C')),
  item('🚀 <b>Começando:</b> cardápio estratégico desde o início evita depender de cupom.', is(dor, 'D')),
  item('📸 <b>Fotos de celular:</b> o algoritmo mostra antes quem tem foto profissional, nítida e iluminada.', is(fotos, 'B')),
  item('📸 <b>Fotos do Google ou sem foto:</b> produto sem foto real quase não aparece e vende bem menos.', is(fotos, 'C')),
  item('🧭 <b>Cardápio em lista:</b> sem isca, âncora e combo, o cliente compra só o mínimo.', is(card, 'B')),
  item('🧭 <b>Cardápio bagunçado:</b> o cliente se perde para escolher e sai sem pedir.', is(card, 'C')),
  item('📱 <b>Quase tudo vem do iFood:</b> qualquer mudança no algoritmo pesa direto no seu caixa.', is(canal, '0')),
  clear('h-[0.5rem]'),
  T('<p><em>Você já pagou agência e não teve resultado. Aqui é diferente: eu olho o seu cardápio e a configuração da loja, não vendo anúncio.</em></p>', is(mkt, 'B')),
  T('<p><em>Você faz tudo sozinho: o diagnóstico mostra o que arrumar primeiro, em ordem, para caber na sua rotina.</em></p>', is(mkt, 'A')),
  T(`<h3 class="ql-align-center">O diagnóstico completo, com o que fazer em ordem, eu te mando no WhatsApp.</h3>`),
  btn('FALAR COM RENAN AGORA 📲', 'https://wa.link/bay8db', 'zap_resultado'),
]);
const k = f.steps.indexOf(form);
f.steps.splice(k + 1, 0, nome, loja, result);
// a página "Obrigado" antiga fica fora do caminho (ninguém chega nela); mantida para comparação

// ---------- leitura dos leads ----------
f.settings = Object.assign({}, f.settings, {
  checkoutMark: true,
  pixel: Object.assign({}, f.settings && f.settings.pixel, {icpEvent: true}),
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
  },
});
f.title = 'BRASE 2 · otimizado';
const out = {
  format: src.format, exportedAt: new Date().toISOString(), slug: 'brase-2-otimizado', title: f.title,
  source: {basedOn: 'brase-2', note: 'Cópia do BRASE 2 publicado com formulário em 3 passos (WhatsApp primeiro, com consentimento), Raio-X do iFood, resultado parcial na hora, regra de perfil, nota do lead, envio de abandono e bloqueio de repetidos.'},
  draft: f, published: f, webhook: src.webhook,
};
fs.writeFileSync(path.join(__dirname, '../data/brase-2-otimizado.json'), JSON.stringify(out, null, 1) + '\n');
console.log('etapas:', f.steps.map(s => s.title).join(' › '));
