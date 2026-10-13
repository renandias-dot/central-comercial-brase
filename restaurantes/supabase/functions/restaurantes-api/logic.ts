// Funções puras da restaurantes-api (sem banco nem rede), testadas em logic.test.ts.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Aceita o ID puro ou qualquer link de loja do iFood (…/delivery/cidade-uf/nome/ID ou …?identifier=ID).
export const merchantIdFrom = (text: unknown) => (String(text ?? '').match(UUID)?.[0] ?? '').toLowerCase();

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function km(lat1: number, lon1: number, lat2: number, lon2: number){
  const r = (d: number) => d * Math.PI / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Comparação em tempo constante para o código de acesso.
export function sameKey(a: string, b: string){
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Resposta de https://marketplace.ifood.com.br/v1/merchants/{id}/extra → linha de rs_merchants.
export function parseIfood(d: any){
  const a = d.address ?? {};
  const logo = (d.resources ?? []).find((r: any) => r.type === 'LOGO')?.fileName;
  const phone = d.phoneIf ? String(d.areaCode ?? '') + String(d.phoneIf) : null;
  return {
    id: String(d.id).toLowerCase(),
    name: String(d.name ?? '').trim(),
    chain: d.merchantChain?.name ?? null,
    category: d.mainCategory?.friendlyName ?? d.mainCategory?.description ?? null,
    category_code: d.mainCategory?.code ?? null,
    price_range: d.priceRange ?? null,
    street: a.streetName ?? null,
    street_number: a.streetNumber ?? null,
    district: a.district ?? null,
    city: a.city ?? null,
    state: a.state ?? null,
    zip: a.zipCode ?? null,
    lat: typeof a.latitude === 'number' ? a.latitude : null,
    lon: typeof a.longitude === 'number' ? a.longitude : null,
    phone: phone ? phone.replace(/\D/g, '') : null,
    cnpj: d.documents?.CNPJ?.value ? String(d.documents.CNPJ.value).replace(/\D/g, '') : null,
    logo: logo ? `https://static.ifood-static.com.br/image/upload/t_thumbnail/logosgde/${logo}` : null,
    enabled: d.enabled !== false,
    rating_count: typeof d.userRatingCount === 'number' ? Math.round(d.userRatingCount) : null,
  };
}

// Resposta de https://brasilapi.com.br/api/cnpj/v1/{cnpj} → o que a ficha mostra.
export function parseCnpj(d: any){
  return {
    situacao: d.descricao_situacao_cadastral ?? null,
    razao_social: d.razao_social ?? null,
    nome_fantasia: d.nome_fantasia || null,
    porte: d.porte ?? null,
    abertura: d.data_inicio_atividade ?? null,
    natureza: d.natureza_juridica ?? null,
    atividade: d.cnae_fiscal_descricao ?? null,
    simples: d.opcao_pelo_simples ?? null,
    mei: d.opcao_pelo_mei ?? null,
    capital: d.capital_social ?? null,
    telefones: [d.ddd_telefone_1, d.ddd_telefone_2].map(t => String(t ?? '').replace(/\D/g, '')).filter(Boolean),
    email: d.email || null,
    socios: (d.qsa ?? []).map((s: any) => ({nome: s.nome_socio, cargo: s.qualificacao_socio, entrada: s.data_entrada_sociedade ?? null})),
  };
}

const PRICE_LEVEL: Record<string, string> = {PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$', PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$'};

// Lugar da Places API (New) → formato guardado em rs_places e em rs_merchants.google.
export function parsePlace(p: any){
  const money = (v: any) => v?.units != null ? Number(v.units) : null;
  const lo = money(p.priceRange?.startPrice), hi = money(p.priceRange?.endPrice);
  return {
    id: String(p.id),
    name: p.displayName?.text ?? '',
    category: p.primaryTypeDisplayName?.text ?? null,
    rating: typeof p.rating === 'number' ? p.rating : null,
    count: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
    price: lo != null ? (hi != null ? `R$ ${lo}–${hi}` : `a partir de R$ ${lo}`) : (PRICE_LEVEL[p.priceLevel] ?? null),
    address: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? null,
    lon: p.location?.longitude ?? null,
    website: p.websiteUri ?? null,
    phone: p.nationalPhoneNumber ?? null,
    maps_url: p.googleMapsUri ?? null,
  };
}

// Palavras que quase todo restaurante tem no nome: não servem para dizer que dois nomes são o mesmo lugar.
const GENERIC = new Set(('restaurante restaurantes pizzaria pizzas pizza lanchonete lanches lanche bar cafe padaria delivery comida comidas ' +
  'marmitaria marmitas marmita sushi hamburgueria burguer burger hamburguer acai doceria doces sorveteria esfiharia esfihas churrascaria ' +
  'cozinha food foods express loja unidade shopping the de da do das dos e em no na ltda me eireli').split(' '));

export function tokens(s: string){
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
}

// Parte das palavras distintivas do nome menor que aparece no outro (0 a 1).
export function nameSimilarity(a: string, b: string){
  let A = tokens(a), B = tokens(b);
  const As = A.filter(t => !GENERIC.has(t)), Bs = B.filter(t => !GENERIC.has(t));
  if (As.length && Bs.length){ A = As; B = Bs }
  const setA = new Set(A), setB = new Set(B);
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / Math.min(setA.size, setB.size);
}

// Escolhe, entre lugares do Google, o que é a mesma loja: até 400 m de distância e nome parecido.
export function bestMatch(m: {name: string, lat: number, lon: number}, places: any[]){
  let best = null, bestScore = -1;
  for (const p of places){
    if (p.lat == null || m.lat == null) continue;
    const meters = km(m.lat, m.lon, p.lat, p.lon) * 1000;
    if (meters > 400) continue;
    const sim = nameSimilarity(m.name, p.name);
    if (sim < 0.5) continue;
    const score = sim - meters / 4000;
    if (score > bestScore){ best = {...p, distance_m: Math.round(meters)}; bestScore = score }
  }
  return best;
}
