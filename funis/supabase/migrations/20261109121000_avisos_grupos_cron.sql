-- Os avisos rodam numa função própria (funis-avisos), separada da funis-api, para publicar e ajustar sem tocar nos funis
-- públicos. Troca o endereço do agendamento 'funis-avisos' (a cada 2 min, com a chave das operações de máquina).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'funis-avisos') then perform cron.unschedule('funis-avisos'); end if;
end $$;
select cron.schedule('funis-avisos', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://covwdaygoorabowiuyfr.supabase.co/functions/v1/funis-avisos',
    body := '{"op":"cron.avisos"}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-fn-cron', (select v->>'key' from public.fn_config where k = 'cron')),
    timeout_milliseconds := 120000)
$cron$);
