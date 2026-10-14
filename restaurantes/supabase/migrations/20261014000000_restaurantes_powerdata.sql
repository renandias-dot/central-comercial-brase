-- Base do Power Data importada em massa (190 mil lojas de SP): nota em estrelas, origem da loja,
-- coleta semanal e histórico compacto para caber no plano grátis do Supabase (500 MB).
-- Rode depois das duas migrações anteriores. Pode rodar de novo sem problema.

-- Nota em estrelas do iFood (vem do Power Data; o endereço público do iFood não informa) e dia da leitura.
alter table rs_merchants add column if not exists stars numeric(2, 1);
alter table rs_merchants add column if not exists stars_at date;
-- Como a loja entrou na base: 'ifood' (link colado, extensão ou busca) ou 'powerdata' (importação).
alter table rs_merchants add column if not exists source text not null default 'ifood';

-- O iFood marca o nome de algumas redes com "*" no fim; a função passou a tirar, aqui corrige o que já estava gravado.
update rs_merchants set chain = nullif(trim(regexp_replace(chain, '\s*\*+\s*$', '')), '') where chain ~ '\*\s*$';

-- Ranking do raio para a ficha (substitui rs_nearby na ficha; rs_nearby continua na busca por região do Google). Com a base inteira, um raio de 10 km em São Paulo passa de 20 mil lojas: as
-- posições e os totais são calculados aqui sobre todas, e só voltam as p_top primeiras no geral, as p_top
-- primeiras da categoria da loja e as vizinhas dela no ranking da categoria.
create or replace function rs_ranking(p_id uuid, p_km double precision, p_top integer default 1000)
returns table (
  id uuid, name text, chain text, category text, price_range text, district text, city text, state text,
  lat double precision, lon double precision, phone text, rating_count integer, count_3m integer, stars double precision,
  google_rating double precision, google_count integer, google_phone text, km double precision,
  rank_all integer, rank_cat integer, total_all integer, total_cat integer
) language sql stable set search_path = public as $$
  with me as (select m.lat, m.lon, m.category from rs_merchants m where m.id = p_id and m.lat is not null),
  area as (
    select m.*, rs_km(me.lat, me.lon, m.lat, m.lon) as dist,
           (m.category is not distinct from me.category) as same_cat,
           row_number() over (order by m.rating_count desc, m.id) as r_all,
           row_number() over (partition by m.category order by m.rating_count desc, m.id) as r_cat,
           count(*) over () as t_all,
           count(*) over (partition by m.category) as t_cat
      from rs_merchants m, me
     where m.enabled and m.rating_count is not null
       and m.lat between me.lat - p_km / 111.0 and me.lat + p_km / 111.0
       and m.lon between me.lon - p_km / (111.0 * cos(radians(me.lat))) and me.lon + p_km / (111.0 * cos(radians(me.lat)))
       and rs_km(me.lat, me.lon, m.lat, m.lon) <= p_km
  ),
  mine as (select coalesce((select r_cat from area where area.id = p_id), 0) as r)
  select a.id, a.name, a.chain, a.category, a.price_range, a.district, a.city, a.state,
         a.lat, a.lon, a.phone, a.rating_count,
         (select c.rating_count from rs_counts c
           where c.merchant_id = a.id and c.day <= current_date - 90
           order by c.day desc limit 1),
         a.stars::double precision,
         (a.google ->> 'rating')::double precision, (a.google ->> 'count')::integer, a.google ->> 'phone',
         a.dist, a.r_all::integer, a.r_cat::integer, a.t_all::integer, a.t_cat::integer
    from area a, mine
   where a.r_all <= p_top
      or (a.same_cat and (a.r_cat <= p_top or a.r_cat between mine.r - 3 and mine.r + 3))
   order by a.r_all
$$;

-- Lojas e avaliações por categoria no raio (distribuição da ficha e participação da loja na categoria).
create or replace function rs_categories(p_lat double precision, p_lon double precision, p_km double precision)
returns table (category text, stores integer, reviews integer)
language sql stable set search_path = public as $$
  select m.category, count(*)::integer, coalesce(sum(m.rating_count), 0)::integer
    from rs_merchants m
   where m.enabled and m.rating_count is not null
     and m.lat between p_lat - p_km / 111.0 and p_lat + p_km / 111.0
     and m.lon between p_lon - p_km / (111.0 * cos(radians(p_lat))) and p_lon + p_km / (111.0 * cos(radians(p_lat)))
     and rs_km(p_lat, p_lon, m.lat, m.lon) <= p_km
   group by m.category
   order by 2 desc
$$;

-- Histórico compacto. A função só grava uma leitura nova quando o número muda (ou a cada 20 dias, para todo mês
-- ter ao menos uma). Aqui, todo dia: leituras com mais de 100 dias ficam só a última de cada mês (é o que a
-- evolução mensal usa) e leituras com mais de 220 dias saem (o app mostra 6 meses).
create or replace function rs_counts_compact()
returns integer language plpgsql set search_path = public as $$
declare n integer; m integer;
begin
  delete from rs_counts c
   where c.day < current_date - 100
     and exists (select 1 from rs_counts d
                  where d.merchant_id = c.merchant_id and d.day > c.day
                    and d.day < date_trunc('month', c.day) + interval '1 month');
  get diagnostics n = row_count;
  delete from rs_counts where day < current_date - 220;
  get diagnostics m = row_count;
  return n + m;
end $$;

revoke execute on function rs_counts_compact(), rs_ranking(uuid, double precision, integer),
  rs_categories(double precision, double precision, double precision) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function rs_counts_compact(), rs_ranking(uuid, double precision, integer),
      rs_categories(double precision, double precision, double precision) from anon, authenticated;
  end if;
end $$;

-- Coleta: a cada 2 minutos, até 40 lojas por rodada, uma por segundo (28.800 por dia). Cada loja é relida no
-- iFood uma vez por semana (as favoritas, todo dia); a ficha relê na hora quando a leitura tem mais de 20 horas.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule(
  'restaurantes-coleta',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://kxabfippeekyxpcgjytx.supabase.co/functions/v1/restaurantes-api',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-rs-cron', (select value from public.rs_settings where key = 'cron_key')
    ),
    body := jsonb_build_object('op', 'collect', 'limit', 40),
    timeout_milliseconds := 140000
  )
  $$
);
select cron.schedule('restaurantes-compactar', '17 6 * * *', 'select public.rs_counts_compact()');
