// deno test restaurantes/supabase/functions/restaurantes-api/logic.test.ts
import {assertEquals} from 'jsr:@std/assert@1';
import {bestMatch, km, merchantIdFrom, nameSimilarity, parseCnpj, parseIfood, parsePlace, sameKey} from './logic.ts';

const ID = 'c867d5ae-9ca1-406f-bc59-dcae2488af6d';

Deno.test('merchantIdFrom aceita ID, link com identifier e link com o ID no caminho', () => {
  assertEquals(merchantIdFrom(ID.toUpperCase()), ID);
  assertEquals(merchantIdFrom(`https://www.ifood.com.br/delivery/carapicuiba-sp/pizzaria-x?identifier=${ID}`), ID);
  assertEquals(merchantIdFrom(`https://www.ifood.com.br/delivery/carapicuiba-sp/pizzaria-x-centro/${ID}`), ID);
  assertEquals(merchantIdFrom('pizzaria'), '');
  assertEquals(merchantIdFrom(undefined), '');
});

Deno.test('parseIfood monta a linha da loja', () => {
  const row = parseIfood({
    id: ID, name: ' Pizzaria Exemplo ', enabled: true, userRatingCount: 2000.0, priceRange: 'MODERATE', phoneIf: '984094320', areaCode: '11',
    address: {district: 'Centro', city: 'CARAPICUIBA', state: 'SP', zipCode: '06334000', streetName: 'Rua A', streetNumber: '54', latitude: -23.54, longitude: -46.83},
    resources: [{type: 'COVER', fileName: 'x/cover.png'}, {type: 'LOGO', fileName: `${ID}/logo.png`}],
    mainCategory: {code: 'PIZ', description: 'Pizza', friendlyName: 'Pizza'},
    merchantChain: {name: 'Exemplo *'},
    documents: {CNPJ: {type: 'CNPJ', value: '39.437.120/0001-96'}},
  });
  assertEquals(row.name, 'Pizzaria Exemplo');
  assertEquals(row.rating_count, 2000);
  assertEquals(row.phone, '11984094320');
  assertEquals(row.cnpj, '39437120000196');
  assertEquals(row.category, 'Pizza');
  assertEquals(row.chain, 'Exemplo');
  assertEquals(row.logo, `https://static.ifood-static.com.br/image/upload/t_thumbnail/logosgde/${ID}/logo.png`);
  assertEquals([row.lat, row.lon], [-23.54, -46.83]);
});

Deno.test('parseIfood tolera campos ausentes', () => {
  const row = parseIfood({id: ID, name: 'Sem dados'});
  assertEquals([row.rating_count, row.phone, row.cnpj, row.logo, row.lat, row.enabled], [null, null, null, null, null, true]);
});

Deno.test('parseCnpj pega situação, porte, telefones e sócios', () => {
  const c = parseCnpj({
    descricao_situacao_cadastral: 'ATIVA', razao_social: 'EXEMPLO PIZZARIA LTDA', nome_fantasia: '', porte: 'MICRO EMPRESA',
    ddd_telefone_1: '1130009414', ddd_telefone_2: '', data_inicio_atividade: '2020-10-15',
    qsa: [{nome_socio: 'FULANO DE TAL', qualificacao_socio: 'Sócio-Administrador', data_entrada_sociedade: '2020-10-15'}],
  });
  assertEquals(c.situacao, 'ATIVA');
  assertEquals(c.nome_fantasia, null);
  assertEquals(c.telefones, ['1130009414']);
  assertEquals(c.socios, [{nome: 'FULANO DE TAL', cargo: 'Sócio-Administrador', entrada: '2020-10-15'}]);
});

Deno.test('parsePlace lê faixa de preço, nota e contato', () => {
  const p = parsePlace({
    id: 'ChIJ123', displayName: {text: 'Pizzaria Exemplo'}, primaryTypeDisplayName: {text: 'Pizzaria'}, rating: 2.5, userRatingCount: 442,
    priceRange: {startPrice: {currencyCode: 'BRL', units: '40'}, endPrice: {currencyCode: 'BRL', units: '60'}},
    location: {latitude: -23.5446, longitude: -46.8336}, nationalPhoneNumber: '(11) 98409-4320', websiteUri: 'https://exemplo.com',
  });
  assertEquals([p.name, p.category, p.rating, p.count, p.price, p.phone], ['Pizzaria Exemplo', 'Pizzaria', 2.5, 442, 'R$ 40–60', '(11) 98409-4320']);
  assertEquals(parsePlace({id: 'a', priceLevel: 'PRICE_LEVEL_MODERATE'}).price, '$$');
  assertEquals(parsePlace({id: 'a'}).count, 0);
});

Deno.test('nameSimilarity ignora palavras genéricas', () => {
  assertEquals(nameSimilarity('Pizzaria Skalone', 'Pizzaria Skalone'), 1);
  assertEquals(nameSimilarity('Pizzaria Skalone', 'Pizzaria Bella Napoli'), 0);
  assertEquals(nameSimilarity('Burger King - Aracaju Av Santos Dumont 85', 'Burger King'), 1);
  assertEquals(nameSimilarity('Açaí do Zé', 'Acai do Ze'), 1);
});

Deno.test('bestMatch escolhe o lugar perto e com nome parecido', () => {
  const m = {name: 'Pizzaria Skalone', lat: -23.544582, lon: -46.833605};
  const near = {id: 'a', name: 'Pizzaria Skalone', lat: -23.5447, lon: -46.8337};
  const otherName = {id: 'b', name: 'Pizzaria Bella', lat: -23.5446, lon: -46.8336};
  const far = {id: 'c', name: 'Pizzaria Skalone', lat: -23.5355, lon: -46.8065};
  assertEquals(bestMatch(m, [otherName, far, near])?.id, 'a');
  assertEquals(bestMatch(m, [otherName, far]), null);
});

Deno.test('km e sameKey', () => {
  assertEquals(Math.round(km(-23.544582, -46.833605, -23.535552, -46.80652) * 1000), 2938);
  assertEquals(sameKey('abc', 'abc'), true);
  assertEquals(sameKey('abc', 'abd'), false);
  assertEquals(sameKey('', ''), false);
});
