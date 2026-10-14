// restaurantes-api — back-end do app Restaurantes (restaurantes/index.html).
// Recebe POST em JSON {op, ...}. Com o segredo RESTAURANTES_ACCESS_CODE, exige o código da equipe no cabeçalho x-rs-key;
// sem ele, o app fica aberto para quem tiver o endereço.
// Fontes: iFood (endpoint público de cada loja), Google Places API (New), BrasilAPI (CNPJ da Receita Federal) e a
// base do Power Data, importada em lote pela op=import (restaurantes/powerdata/importar.py).
// Segredos opcionais: RESTAURANTES_ACCESS_CODE e GOOGLE_PLACES_API_KEY (sem ela o app funciona sem o Google).
// A coleta agendada se identifica com a chave guardada na tabela rs_settings (cabeçalho x-rs-cron).
import postgres from 'npm:postgres@3.4.5';
import {bestMatch, clamp, merchantIdFrom, parseCnpj, parseIfood, parsePlace, sameKey} from './logic.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const sql = postgres(env('SUPABASE_DB_URL'), {prepare: false, max: 4, idle_timeout: 20});
const ACCESS_CODE = env('RESTAURANTES_ACCESS_CODE');
const GOOGLE_KEY = env('GOOGLE_PLACES_API_KEY');

const HOUR = 3600e3, DAY = 24 * HOUR;
const IFOOD_TTL = 20 * HOUR, CNPJ_TTL = 30 * DAY, GOOGLE_TTL = 30 * DAY;
const RANK_TOP = 1000; // lojas do ranking que a ficha recebe (geral e da categoria)
// Termos da busca por região no Google: cada termo traz até 60 lugares (3 páginas de 20).
const AREA_TERMS = ['restaurante', 'pizzaria', 'hamburgueria', 'lanchonete', 'comida japonesa', 'marmitaria', 'açaí', 'padaria', 'doceria', 'comida brasileira'];
const GOOGLE_FIELDS = ['id', 'displayName', 'primaryTypeDisplayName', 'rating', 'userRatingCount', 'priceRange', 'priceLevel', 'websiteUri', 'nationalPhoneNumber', 'googleMapsUri', 'location', 'formattedAddress'];

class HttpError extends Error { constructor(public status: number, message: string){ super(message) } }
const bad = (message: string, status = 400) => new HttpError(status, message);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const stale = (at: Date | null, ttl: number) => !at || Date.now() - new Date(at).getTime() > ttl;
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
// Fragmentos de INSERT/UPDATE a partir de objetos montados em tempo de execução (os tipos do postgres.js exigem colunas literais).
const values = (row: Record<string, unknown>) => (sql as any)(row);
const assign = (row: Record<string, unknown>) => (sql as any)(row, Object.keys(row).filter(k => k !== 'id'));

async function getJson(url: string, init: RequestInit = {}, ms = 12000){
  const r = await fetch(url, {...init, signal: AbortSignal.timeout(ms)});
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text) } catch { /* resposta não é JSON */ }
  return {status: r.status, ok: r.ok, json};
}

/* ---------- iFood ---------- */
// Lê a loja no endpoint público do iFood e grava a leitura do dia. Devolve false se a loja não existe mais.
async function refreshIfood(id: string){
  let r;
  try { r = await getJson(`https://marketplace.ifood.com.br/v1/merchants/${id}/extra`, {headers: {accept: 'application/json'}}) }
  catch (e){ await sql`update rs_merchants set ifood_error = ${errText(e)}, ifood_checked_at = now() where id = ${id}`; throw e }
  if (r.status === 404){
    await sql`update rs_merchants set enabled = false, ifood_error = 'Loja não encontrada no iFood', ifood_checked_at = now() where id = ${id}`;
    return false;
  }
  if (!r.ok || !r.json?.id){
    const msg = `iFood respondeu ${r.status}`;
    await sql`update rs_merchants set ifood_error = ${msg}, ifood_checked_at = now() where id = ${id}`;
    throw bad(msg, 502);
  }
  const row = parseIfood(r.json);
  await sql`
    insert into rs_merchants ${values({...row, ifood_checked_at: new Date()})}
    on conflict (id) do update set ${assign(row)}, ifood_checked_at = now(), ifood_error = null`;
  if (row.rating_count != null) await saveCount(row.id, row.rating_count);
  return true;
}

// Grava a leitura do dia só se o número mudou ou se a última tem 20 dias ou mais (todo mês fica com uma leitura).
// Loja sem avaliações não entra no histórico (não há crescimento a medir). Com 190 mil lojas, gravar todo dia
// não cabe no plano grátis do Supabase.
async function saveCount(id: string, count: number){
  if (count === 0) return;
  const [last] = await sql`select rating_count, day from rs_counts where merchant_id = ${id} order by day desc limit 1`;
  if (last && last.rating_count === count && Date.now() - new Date(last.day).getTime() < 20 * DAY) return;
  await sql`
    insert into rs_counts (merchant_id, day, rating_count) values (${id}, current_date, ${count})
    on conflict (merchant_id, day) do update set rating_count = excluded.rating_count`;
}

/* ---------- CNPJ (BrasilAPI) ---------- */
async function refreshCnpj(m: any){
  try {
    const r = await getJson(`https://brasilapi.com.br/api/cnpj/v1/${m.cnpj}`);
    const data = r.status === 404 ? {missing: true} : r.ok ? parseCnpj(r.json) : null;
    if (data) await sql`update rs_merchants set cnpj_data = ${sql.json(data)}, cnpj_checked_at = now() where id = ${m.id}`;
    // Falha passageira (limite da BrasilAPI): tenta de novo daqui a um dia.
    else await sql`update rs_merchants set cnpj_checked_at = now() - interval '29 days' where id = ${m.id}`;
  } catch (e){ console.error('cnpj', m.id, errText(e)) }
}

/* ---------- Google Places (New) ---------- */
async function googleText(body: Record<string, unknown>){
  const r = await getJson('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {'content-type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': GOOGLE_FIELDS.map(f => 'places.' + f).join(',') + ',nextPageToken'},
    body: JSON.stringify({languageCode: 'pt-BR', regionCode: 'BR', ...body}),
  }, 15000);
  if (!r.ok) throw bad('Google: ' + (r.json?.error?.message || `respondeu ${r.status}`), 502);
  return {places: (r.json?.places ?? []).map(parsePlace), next: r.json?.nextPageToken as string | undefined};
}

async function savePlaces(places: any[], merchantId: string | null = null){
  for (const p of places){
    if (p.lat == null) continue;
    const row = {id: p.id, name: p.name, category: p.category, rating: p.rating, rating_count: p.count, price: p.price, address: p.address, lat: p.lat, lon: p.lon, website: p.website, phone: p.phone, maps_url: p.maps_url};
    await sql`
      insert into rs_places ${values(row)}
      on conflict (id) do update set ${assign(row)}, checked_at = now()`;
    if (merchantId) await sql`update rs_places set merchant_id = ${merchantId} where id = ${p.id}`;
    await sql`
      insert into rs_place_counts (place_id, day, rating, rating_count) values (${p.id}, current_date, ${p.rating}, ${p.count})
      on conflict (place_id, day) do update set rating = excluded.rating, rating_count = excluded.rating_count`;
  }
}

// Procura a loja do iFood no Google pelo nome perto do endereço dela e guarda o lugar correspondente.
async function refreshGoogle(m: any){
  try {
    const {places} = await googleText({
      textQuery: [m.name, m.district, m.city].filter(Boolean).join(' '),
      pageSize: 5,
      locationBias: {circle: {center: {latitude: m.lat, longitude: m.lon}, radius: 500}},
    });
    const match = bestMatch(m, places);
    await sql`update rs_merchants set google = ${sql.json(match ?? {none: true})}, google_checked_at = now() where id = ${m.id}`;
    if (match) await savePlaces([match], m.id);
  } catch (e){ console.error('google', m.id, errText(e)) }
}

// Busca restaurantes da região no Google (pago por consulta) e liga cada lugar à loja do iFood, quando achar.
async function googleArea(lat: number, lon: number, km: number){
  const dLat = km / 111, dLon = km / (111 * Math.cos(lat * Math.PI / 180));
  const rectangle = {low: {latitude: lat - dLat, longitude: lon - dLon}, high: {latitude: lat + dLat, longitude: lon + dLon}};
  const found = new Map<string, any>();
  let calls = 0;
  for (const textQuery of AREA_TERMS){
    let pageToken: string | undefined;
    for (let page = 0; page < 3; page++){
      const r = await googleText({textQuery, pageSize: 20, locationRestriction: {rectangle}, ...(pageToken ? {pageToken} : {})});
      calls++;
      r.places.forEach((p: any) => found.set(p.id, p));
      if (!(pageToken = r.next)) break;
      await sleep(300);
    }
  }
  const places = [...found.values()];
  await savePlaces(places);
  const merchants = await sql`select id, name, lat, lon from rs_nearby(${lat}, ${lon}, ${km + 0.5})`;
  for (const p of places){
    const m = merchants.find((m: any) => bestMatch(m, [p]));
    if (m) await sql`update rs_places set merchant_id = ${m.id} where id = ${p.id}`;
  }
  return {calls, found: places.length};
}

/* ---------- operações ---------- */
const MERCHANT_COLS = sql`id, name, chain, category, price_range, street, street_number, district, city, state, zip, lat, lon, phone, cnpj, logo, enabled, rating_count, stars::float8 as stars, stars_at::text as stars_at, source, first_seen, ifood_checked_at, ifood_error, google, google_checked_at, cnpj_data, cnpj_checked_at`;
const LIST_COLS = sql`id, name, category, district, city, state, rating_count`;
let cronKey = '';
const loadCronKey = async () => cronKey ||= (await sql`select value from rs_settings where key = 'cron_key'`)[0]?.value ?? '';
const loadMerchant = async (id: string) => (await sql`select ${MERCHANT_COLS} from rs_merchants where id = ${id}`)[0];

const ops: Record<string, (b: any) => Promise<unknown>> = {
  async ping(){ return {ok: true, google: !!GOOGLE_KEY, open: !ACCESS_CODE} },

  async search({q = '', cnpj = '', merchant = ''}){
    const id = merchantIdFrom(merchant || q);
    if (id){
      if (!(await loadMerchant(id))) { try { await refreshIfood(id) } catch (e){ throw bad('Não consegui ler essa loja no iFood agora: ' + errText(e), 502) } }
      return {results: await sql`select ${LIST_COLS} from rs_merchants where id = ${id}`};
    }
    const digits = String(cnpj).replace(/\D/g, '');
    if (cnpj){
      if (digits.length !== 14) throw bad('O CNPJ tem 14 números.');
      return {results: await sql`select ${LIST_COLS} from rs_merchants where cnpj = ${digits} order by rating_count desc nulls last limit 60`};
    }
    const term = String(q).trim();
    if (term.length < 2) throw bad('Digite pelo menos 2 letras do nome.');
    const like = '%' + term.replace(/[\\%_]/g, c => '\\' + c) + '%';
    return {results: await sql`
      select ${LIST_COLS} from rs_merchants
       where rs_unaccent(name) ilike rs_unaccent(${like})
       order by enabled desc, rating_count desc nulls last limit 60`};
  },

  async detail({id, km = 5}){
    id = merchantIdFrom(id);
    if (!id) throw bad('Loja inválida.');
    km = clamp(Number(km) || 5, 0.5, 20);
    let m = await loadMerchant(id);
    if (!m || stale(m.ifood_checked_at, IFOOD_TTL)){
      try { await refreshIfood(id) } catch (e){ if (!m) throw bad('Não consegui ler essa loja no iFood agora: ' + errText(e), 502) }
      m = await loadMerchant(id);
      if (!m) throw bad('Essa loja não existe no iFood.', 404);
    }
    const pending = [];
    if (m.cnpj && stale(m.cnpj_checked_at, CNPJ_TTL)) pending.push(refreshCnpj(m));
    if (GOOGLE_KEY && m.lat != null && stale(m.google_checked_at, GOOGLE_TTL)) pending.push(refreshGoogle(m));
    if (pending.length){ await Promise.all(pending); m = await loadMerchant(id) }
    // nearby: as 1.000 primeiras do raio, as 1.000 primeiras da categoria e as vizinhas da loja, com posição e
    // totais calculados sobre todas as lojas do raio (rank_all, rank_cat, total_all, total_cat).
    const [nearby, categories, history, fav] = await Promise.all([
      m.lat != null ? sql`select * from rs_ranking(${id}, ${km}, ${RANK_TOP})` : [],
      m.lat != null ? sql`select * from rs_categories(${m.lat}, ${m.lon}, ${km})` : [],
      sql`select * from rs_history(${id}, ${km})`,
      sql`select 1 from rs_favorites where merchant_id = ${id}`,
    ]);
    return {merchant: m, nearby, categories, top: RANK_TOP, history, favorite: fav.length > 0, google_enabled: !!GOOGLE_KEY, km};
  },

  // Força nova leitura no iFood, no Google e no CNPJ.
  async refresh({id, km}){
    id = merchantIdFrom(id);
    const m = id && await loadMerchant(id);
    if (!m) throw bad('Loja inválida.');
    if (!stale(m.ifood_checked_at, 10 * 60e3)) throw bad('Essa loja foi atualizada há menos de 10 minutos.');
    await sql`update rs_merchants set ifood_checked_at = null, google_checked_at = null, cnpj_checked_at = null where id = ${id}`;
    return ops.detail({id, km});
  },

  // Solicitar inclusão: links ou IDs de lojas do iFood, um por linha. Loja que já está na base não é relida aqui
  // (a coleta cuida dela) e volta com existing: true; assim a extensão inclui páginas inteiras sem pesar no iFood.
  // by: nome de quem incluiu (opcional, vem da extensão), para a tela Cobertura.
  async include({links, by}){
    const ids = [...new Set((Array.isArray(links) ? links : String(links ?? '').split(/[\s,;]+/)).map(merchantIdFrom).filter(Boolean))];
    if (!ids.length) throw bad('Cole pelo menos um link de loja do iFood.');
    if (ids.length > 30) throw bad('Mande até 30 lojas por vez.');
    const who = String(by ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || null;
    const results = [];
    for (const id of ids){
      try {
        const known = await loadMerchant(id);
        if (known){ results.push({id, ok: true, existing: true, name: known.name, city: known.city, state: known.state, category: known.category}); continue }
        const ok = await refreshIfood(id);
        if (ok && who) await sql`update rs_merchants set added_by = ${who} where id = ${id} and added_by is null`;
        const m = ok && await loadMerchant(id);
        results.push(m ? {id, ok: true, name: m.name, city: m.city, state: m.state, category: m.category} : {id, ok: false, error: 'Loja não encontrada no iFood'});
      } catch (e){ results.push({id, ok: false, error: errText(e)}) }
      await sleep(250);
    }
    return {results};
  },

  async favorite({id, on}){
    id = merchantIdFrom(id);
    if (!id || !(await loadMerchant(id))) throw bad('Loja inválida.');
    if (on) await sql`insert into rs_favorites (merchant_id) values (${id}) on conflict do nothing`;
    else await sql`delete from rs_favorites where merchant_id = ${id}`;
    return {favorite: !!on};
  },

  async favorites(){
    return {results: await sql`
      select m.id, m.name, m.category, m.district, m.city, m.state, m.rating_count, m.enabled,
             (m.google ->> 'rating')::double precision as google_rating, (m.google ->> 'count')::integer as google_count,
             (select c.rating_count from rs_counts c where c.merchant_id = m.id and c.day <= current_date - 90 order by c.day desc limit 1) as count_3m,
             f.created_at
        from rs_favorites f join rs_merchants m on m.id = f.merchant_id
       order by f.created_at desc limit 300`};
  },

  // Cobertura da base: lojas ativas por estado (e por cidade do estado escolhido), quantas a equipe incluiu
  // (source = 'ifood': link colado, extensão ou busca) hoje e nos últimos 7 dias, e quem incluiu na semana.
  async coverage({state = ''}){
    const uf = String(state).trim().toUpperCase().slice(0, 2);
    const today = sql`(date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')`;
    const [totals, states, people, cities, bounds] = await Promise.all([
      sql`
        select count(*)::integer as stores,
               count(*) filter (where rating_count > 0)::integer as with_reviews,
               count(distinct state)::integer as states,
               count(*) filter (where source = 'ifood' and first_seen >= ${today})::integer as today,
               count(*) filter (where source = 'ifood' and first_seen > now() - interval '7 days')::integer as week
          from rs_merchants where enabled`,
      sql`
        select state, count(*)::integer as stores, count(*) filter (where rating_count > 0)::integer as with_reviews,
               count(distinct city)::integer as cities,
               count(*) filter (where source = 'ifood')::integer as by_team,
               count(*) filter (where source = 'ifood' and first_seen > now() - interval '7 days')::integer as week,
               max(first_seen) filter (where source = 'ifood') as last_added
          from rs_merchants where enabled group by state order by stores desc`,
      sql`
        select coalesce(added_by, 'Sem nome') as who, count(*)::integer as stores,
               count(*) filter (where first_seen >= ${today})::integer as today,
               count(distinct state)::integer as states, max(first_seen) as last_added
          from rs_merchants where source = 'ifood' and first_seen > now() - interval '7 days'
         group by 1 order by stores desc limit 30`,
      uf ? sql`
        select city, count(*)::integer as stores, count(*) filter (where rating_count > 0)::integer as with_reviews,
               count(*) filter (where source = 'ifood')::integer as by_team,
               count(*) filter (where source = 'ifood' and first_seen > now() - interval '7 days')::integer as week,
               max(first_seen) filter (where source = 'ifood') as last_added
          from rs_merchants where enabled and state = ${uf} group by city order by stores desc limit 500` : [],
      // Enquadramento do mapa no estado; os percentis ignoram as poucas lojas com coordenada errada.
      uf ? sql`
        select percentile_cont(0.01) within group (order by lat) as s, percentile_cont(0.01) within group (order by lon) as w,
               percentile_cont(0.99) within group (order by lat) as n, percentile_cont(0.99) within group (order by lon) as e
          from rs_merchants where enabled and state = ${uf} and lat is not null` : [],
    ]);
    const b = bounds[0];
    return {totals: totals[0], states, people, state: uf, cities, bounds: b?.s != null ? [b.s, b.w, b.n, b.e] : null};
  },

  // Mapa da Cobertura. bbox = [sul, oeste, norte, leste] da área visível. Até o zoom 13 as lojas vêm agrupadas numa
  // grade de uns 40 px na tela (uma bolinha por célula, no centro das lojas dela); do zoom 14 em diante, uma a uma.
  async coverage_map({bbox, zoom = 4, only = 'all'}){
    const [s, w, n, e] = (Array.isArray(bbox) ? bbox : []).map(Number);
    if (![s, w, n, e].every(Number.isFinite)) throw bad('Área do mapa inválida.');
    const z = clamp(Math.round(Number(zoom) || 4), 2, 19);
    const filter = only === 'reviews' ? sql`and rating_count > 0` : only === 'team' ? sql`and source = 'ifood'` : sql``;
    if (z >= 14){
      const stores = await sql`
        select id, name, category, rating_count, lat, lon from rs_merchants
         where enabled and lat between ${s} and ${n} and lon between ${w} and ${e} ${filter}
         order by rating_count desc nulls last limit 3000`;
      return {mode: 'stores', stores};
    }
    const cell = 360 / 2 ** z / 6;
    const cells = await sql`
      select avg(lat)::float8 as lat, avg(lon)::float8 as lon, count(*)::integer as n,
             count(*) filter (where rating_count > 0)::integer as reviews
        from rs_merchants
       where enabled and lat between ${s} and ${n} and lon between ${w} and ${e} ${filter}
       group by floor(lat / ${cell}::float8), floor(lon / ${cell}::float8)`;
    return {mode: 'grid', cells};
  },

  // Ranking pelas avaliações do Google num raio. update=true busca de novo no Google (consultas pagas).
  async area({lat, lon, km = 2, address = '', update = false}){
    km = clamp(Number(km) || 2, 0.5, 10);
    let center = {lat: Number(lat), lon: Number(lon)}, label = '';
    if (address){
      if (!GOOGLE_KEY) throw bad('Para buscar por endereço, configure a chave do Google (GOOGLE_PLACES_API_KEY).');
      const {places} = await googleText({textQuery: String(address), pageSize: 1});
      if (!places[0]) throw bad('Não encontrei esse endereço no Google.', 404);
      center = {lat: places[0].lat, lon: places[0].lon}; label = places[0].address || places[0].name;
    }
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) throw bad('Informe um endereço ou um ponto do mapa.');
    let calls = 0, found = 0;
    if (update){
      if (!GOOGLE_KEY) throw bad('Falta a chave do Google (GOOGLE_PLACES_API_KEY) no servidor.');
      ({calls, found} = await googleArea(center.lat, center.lon, km));
    }
    const places = await sql`select * from rs_places_nearby(${center.lat}, ${center.lon}, ${km})`;
    return {center, label, km, places, calls, found, google_enabled: !!GOOGLE_KEY};
  },

  // Coleta agendada: relê no iFood as favoritas todo dia, as demais lojas uma vez por semana e as desativadas
  // uma vez por mês, as mais antigas primeiro, com 1 s entre leituras para não pesar no iFood. Para antes de 100 s
  // para não passar do tempo da função.
  async collect({limit = 40}){
    const started = Date.now();
    const due = await sql`
      select m.id from rs_merchants m left join rs_favorites f on f.merchant_id = m.id
       where (m.enabled and (m.ifood_checked_at is null
                or m.ifood_checked_at < now() - case when f.merchant_id is null then interval '6 days' else interval '20 hours' end))
          or (not m.enabled and m.ifood_checked_at < now() - interval '30 days')
       order by f.merchant_id is null, m.ifood_checked_at asc nulls first
       limit ${clamp(Number(limit) || 40, 1, 200)}`;
    let ok = 0, failed = 0;
    for (const {id} of due){
      if (Date.now() - started > 100e3) break;
      try { (await refreshIfood(id)) ? ok++ : failed++ } catch { failed++ }
      await sleep(1000);
    }
    return {due: due.length, ok, failed};
  },

  // Importação em lote (base do Power Data). Só pela chave do agendamento ou pelo código da equipe.
  // Cada linha atualiza a loja só se for mais nova que a última leitura no iFood; a nota em estrelas e a
  // leitura de avaliações do dia da coleta entram sempre.
  async import({rows}){
    if (!Array.isArray(rows) || !rows.length || rows.length > 3000) throw bad('Mande de 1 a 3.000 lojas por vez.');
    const clean = rows.map(r => ({...r, id: merchantIdFrom(r.id)})).filter(r => r.id && r.name && r.seen_at);
    const x = sql`jsonb_to_recordset(${sql.json(clean)}) as x(
      id uuid, name text, chain text, category text, price_range text, street text, street_number text, district text,
      city text, state text, zip text, lat double precision, lon double precision, phone text, cnpj text,
      rating_count integer, stars numeric, seen_at timestamptz)`;
    const merchants = await sql`
      insert into rs_merchants (id, name, chain, category, price_range, street, street_number, district, city, state, zip,
                                lat, lon, phone, cnpj, rating_count, stars, stars_at, ifood_checked_at, source)
      select id, name, chain, category, price_range, street, street_number, district, city, state, zip,
             lat, lon, phone, cnpj, rating_count, stars, seen_at::date, seen_at, 'powerdata' from ${x}
      on conflict (id) do update set
        name = excluded.name, chain = excluded.chain, category = excluded.category, price_range = excluded.price_range,
        street = excluded.street, street_number = excluded.street_number, district = excluded.district, city = excluded.city,
        state = excluded.state, zip = excluded.zip, lat = excluded.lat, lon = excluded.lon, phone = excluded.phone,
        cnpj = excluded.cnpj, rating_count = excluded.rating_count, ifood_checked_at = excluded.ifood_checked_at,
        enabled = true, ifood_error = null
      where rs_merchants.ifood_checked_at is null or rs_merchants.ifood_checked_at < excluded.ifood_checked_at`;
    await sql`
      update rs_merchants m set stars = x.stars, stars_at = x.seen_at::date from ${x}
       where m.id = x.id and x.stars is not null and (m.stars_at is null or m.stars_at <= x.seen_at::date)`;
    const counts = await sql`
      insert into rs_counts (merchant_id, day, rating_count)
      select id, seen_at::date, rating_count from ${x} where rating_count > 0
      on conflict (merchant_id, day) do nothing`;
    return {received: rows.length, valid: clean.length, merchants: merchants.count, counts: counts.count};
  },
};

const CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-rs-key, x-rs-cron', 'access-control-allow-methods': 'POST, OPTIONS'};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {...CORS, 'content-type': 'application/json'}});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: CORS});
  if (req.method !== 'POST') return reply(405, {error: 'Use POST.'});
  const body = await req.json().catch(() => ({}));
  const member = ACCESS_CODE ? sameKey(req.headers.get('x-rs-key') ?? '', ACCESS_CODE) : true;
  // A coleta (que dispara leituras no iFood) e a importação em lote só rodam pelo agendamento ou por quem tem
  // o código, mesmo com o app aberto.
  const cronHeader = req.headers.get('x-rs-cron') ?? '';
  const allowed = body.op === 'collect' || body.op === 'import'
    ? (!!cronHeader && sameKey(cronHeader, await loadCronKey())) || (!!ACCESS_CODE && member)
    : member;
  if (!allowed) return reply(401, {error: 'Código de acesso inválido.'});
  const op = ops[body.op];
  if (!op) return reply(400, {error: 'Operação desconhecida.'});
  try { return reply(200, await op(body)) }
  catch (e){
    if (e instanceof HttpError) return reply(e.status, {error: e.message});
    console.error(body.op, e);
    return reply(500, {error: 'Erro interno: ' + errText(e)});
  }
});
