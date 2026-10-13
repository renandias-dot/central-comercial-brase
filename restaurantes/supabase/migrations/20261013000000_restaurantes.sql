-- App Restaurantes (restaurantes/index.html) — tabelas usadas pela função restaurantes-api.
-- Rode uma vez no SQL Editor do Supabase (ou com `supabase db push` dentro da pasta restaurantes/).
-- As tabelas ficam fechadas para a chave pública (RLS ligado e sem políticas): só a função lê e grava.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Lojas do iFood. id = merchant id do iFood (o UUID que aparece no link da loja).
create table if not exists rs_merchants (
  id uuid primary key,
  name text not null,
  chain text,
  category text,
  category_code text,
  price_range text,
  street text,
  street_number text,
  district text,
  city text,
  state text,
  zip text,
  lat double precision,
  lon double precision,
  phone text,
  cnpj text,
  logo text,
  enabled boolean not null default true,
  rating_count integer,
  first_seen timestamptz not null default now(),
  ifood_checked_at timestamptz,
  ifood_error text,
  google jsonb,
  google_checked_at timestamptz,
  cnpj_data jsonb,
  cnpj_checked_at timestamptz
);
create index if not exists rs_merchants_name_trgm on rs_merchants using gin (name gin_trgm_ops);
create index if not exists rs_merchants_cnpj on rs_merchants (cnpj);
create index if not exists rs_merchants_geo on rs_merchants (lat, lon);
create index if not exists rs_merchants_due on rs_merchants (ifood_checked_at nulls first);

-- Número de avaliações do iFood por dia de leitura: é daqui que saem "3m atrás" e a evolução mensal.
create table if not exists rs_counts (
  merchant_id uuid not null references rs_merchants (id) on delete cascade,
  day date not null,
  rating_count integer not null,
  primary key (merchant_id, day)
);

-- Lugares do Google (Places API) buscados por região, ligados à loja do iFood quando houver.
create table if not exists rs_places (
  id text primary key,
  name text not null,
  category text,
  rating numeric,
  rating_count integer,
  price text,
  address text,
  lat double precision,
  lon double precision,
  website text,
  phone text,
  maps_url text,
  merchant_id uuid references rs_merchants (id) on delete set null,
  first_seen timestamptz not null default now(),
  checked_at timestamptz not null default now()
);
create index if not exists rs_places_geo on rs_places (lat, lon);

create table if not exists rs_place_counts (
  place_id text not null references rs_places (id) on delete cascade,
  day date not null,
  rating numeric,
  rating_count integer,
  primary key (place_id, day)
);

-- Favoritos da equipe (o acesso é por código da equipe, então a lista é compartilhada).
create table if not exists rs_favorites (
  merchant_id uuid primary key references rs_merchants (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table rs_merchants enable row level security;
alter table rs_counts enable row level security;
alter table rs_places enable row level security;
alter table rs_place_counts enable row level security;
alter table rs_favorites enable row level security;

-- Distância em km entre dois pontos (fórmula de haversine).
create or replace function rs_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 6371 * 2 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )))
$$;

-- Lojas ativas num raio, com o número de avaliações de ~90 dias atrás (última leitura até essa data).
create or replace function rs_nearby(p_lat double precision, p_lon double precision, p_km double precision, p_limit integer default 5000)
returns table (
  id uuid, name text, chain text, category text, price_range text, district text, city text, state text,
  lat double precision, lon double precision, phone text, rating_count integer, count_3m integer,
  google_rating double precision, google_count integer, google_phone text, km double precision
) language sql stable as $$
  select m.id, m.name, m.chain, m.category, m.price_range, m.district, m.city, m.state,
         m.lat, m.lon, m.phone, m.rating_count,
         (select c.rating_count from rs_counts c
           where c.merchant_id = m.id and c.day <= current_date - 90
           order by c.day desc limit 1) as count_3m,
         (m.google ->> 'rating')::double precision, (m.google ->> 'count')::integer, m.google ->> 'phone',
         rs_km(p_lat, p_lon, m.lat, m.lon) as km
    from rs_merchants m
   where m.enabled and m.rating_count is not null
     and m.lat between p_lat - p_km / 111.0 and p_lat + p_km / 111.0
     and m.lon between p_lon - p_km / (111.0 * cos(radians(p_lat))) and p_lon + p_km / (111.0 * cos(radians(p_lat)))
     and rs_km(p_lat, p_lon, m.lat, m.lon) <= p_km
   order by m.rating_count desc
   limit p_limit
$$;

-- Evolução mensal (últimos 6 meses): a loja e a média das lojas da mesma categoria no raio.
-- Em cada mês vale a última leitura daquele mês.
create or replace function rs_history(p_id uuid, p_km double precision)
returns table (month text, mine integer, region_avg double precision, region_n integer)
language sql stable as $$
  with me as (select * from rs_merchants where id = p_id),
  peers as (
    select m.id from rs_merchants m, me
     where m.enabled and m.category is not distinct from me.category
       and m.lat between me.lat - p_km / 111.0 and me.lat + p_km / 111.0
       and m.lon between me.lon - p_km / (111.0 * cos(radians(me.lat))) and me.lon + p_km / (111.0 * cos(radians(me.lat)))
       and rs_km(me.lat, me.lon, m.lat, m.lon) <= p_km
  ),
  monthly as (
    select distinct on (c.merchant_id, date_trunc('month', c.day))
           c.merchant_id, to_char(c.day, 'YYYY-MM') as month, c.rating_count
      from rs_counts c
     where c.merchant_id in (select id from peers)
       and c.day >= date_trunc('month', current_date) - interval '5 months'
     order by c.merchant_id, date_trunc('month', c.day), c.day desc
  )
  select month,
         max(rating_count) filter (where merchant_id = p_id) as mine,
         round(avg(rating_count), 1)::double precision as region_avg,
         count(*)::integer as region_n
    from monthly
   group by month
   order by month
$$;

-- Lugares do Google num raio, para o ranking da aba Região.
create or replace function rs_places_nearby(p_lat double precision, p_lon double precision, p_km double precision)
returns table (
  id text, name text, category text, rating double precision, rating_count integer, count_3m integer, price text,
  address text, lat double precision, lon double precision, website text, phone text, maps_url text,
  merchant_id uuid, km double precision
) language sql stable as $$
  select p.id, p.name, p.category, p.rating::double precision, p.rating_count,
         (select c.rating_count from rs_place_counts c
           where c.place_id = p.id and c.day <= current_date - 90
           order by c.day desc limit 1) as count_3m,
         p.price, p.address, p.lat, p.lon, p.website, p.phone, p.maps_url, p.merchant_id,
         rs_km(p_lat, p_lon, p.lat, p.lon) as km
    from rs_places p
   where p.lat between p_lat - p_km / 111.0 and p_lat + p_km / 111.0
     and p.lon between p_lon - p_km / (111.0 * cos(radians(p_lat))) and p_lon + p_km / (111.0 * cos(radians(p_lat)))
     and rs_km(p_lat, p_lon, p.lat, p.lon) <= p_km
   order by p.rating_count desc nulls last
$$;
