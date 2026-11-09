-- WhatsApp do SDR (canal BraseBot no NicoChat) → Central Comercial.
-- A função funis-api (op cron.wa, a cada 2 min) lê as conversas com mensagem nas últimas 24 h, guarda aqui o estado de
-- cada conversa e cada resposta da equipe, e grava na Central o campo wa de cada lead (tela Hoje: "esperando resposta")
-- e os documentos wa_stats (SLA em Análises). Pode rodar de novo sem problema.

-- Estado de cada conversa (o que a última leitura calculou). phone_key = DDD + 8 últimos dígitos.
create table if not exists fn_wa_contacts (
  user_ns text primary key,
  flow_ns text not null,
  phone_key text not null default '',
  last_message_at timestamptz,
  facts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists fn_wa_contacts_flow on fn_wa_contacts (flow_ns, last_message_at desc);
alter table fn_wa_contacts enable row level security;

-- Cada resposta da equipe a uma mensagem do lead que chegou no horário comercial (seg a sex, 9h às 19h de Brasília).
-- id = id da 1ª mensagem do lead naquela vez; day = dia dela em Brasília; minutes = até a 1ª resposta de uma pessoa.
create table if not exists fn_wa_responses (
  id text primary key,
  flow_ns text not null,
  business text not null default '',
  user_ns text not null,
  day date not null,
  in_at timestamptz not null,
  out_at timestamptz not null,
  minutes numeric not null
);
create index if not exists fn_wa_responses_day on fn_wa_responses (flow_ns, day);
alter table fn_wa_responses enable row level security;

-- Canal do SDR em modo prévia: lê e calcula, mas não grava na Central até mudar para 'on'
-- (update fn_config set v = jsonb_set(v, '{mode}', '"on"') where k = 'wa').
insert into fn_config (k, v) values ('wa', jsonb_build_object('flow', 'f302947', 'business', '553193877523', 'mode', 'preview'))
on conflict (k) do nothing;

-- A cada 2 minutos, com a chave das operações de máquina (fn_config, k = 'cron').
do $$ begin
  if exists (select 1 from cron.job where jobname = 'funis-wa') then perform cron.unschedule('funis-wa'); end if;
end $$;
select cron.schedule('funis-wa', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://covwdaygoorabowiuyfr.supabase.co/functions/v1/funis-api',
    body := '{"op":"cron.wa"}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-fn-cron', (select v->>'key' from public.fn_config where k = 'cron')),
    timeout_milliseconds := 120000)
$cron$);
