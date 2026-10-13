-- Coleta agendada do app Restaurantes: a cada 30 minutos chama a função restaurantes-api com op=collect,
-- que relê no iFood até 40 lojas (as mais antigas primeiro). A chave vem de rs_settings na hora da chamada.
-- Projeto: brase-restaurantes (kxabfippeekyxpcgjytx). Em outro projeto, troque o endereço da função.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'restaurantes-coleta',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://kxabfippeekyxpcgjytx.supabase.co/functions/v1/restaurantes-api',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-rs-cron', (select value from public.rs_settings where key = 'cron_key')
    ),
    body := jsonb_build_object('op', 'collect', 'limit', 40),
    timeout_milliseconds := 120000
  )
  $$
);
