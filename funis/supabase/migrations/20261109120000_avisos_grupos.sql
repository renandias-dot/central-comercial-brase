-- Avisos nos grupos de WhatsApp (canal Operacional do NicoChat, número do Renan), 24 h por dia.
-- AVISOS - COMERCIAIS: horário sugerido na conversa do SDR e reunião marcada/remarcada na Central.
-- AVISOS - OPERACIONAIS: grupos dos clientes ("BRASE - " e "DI "): sem resposta da Brase, sinal de risco e silêncio longo.
-- A função funis-avisos (op cron.avisos, a cada 2 min) lê, põe na fila e envia (o endereço do agendamento muda na migration seguinte).
-- A chave da API do canal Operacional é o segredo NICOCHAT_OPS_KEY. Pode rodar de novo sem problema.

-- Fila dos avisos. id = a chave do evento (ex.: "horario:<mensagem>", "reuniao:<lead>:<bookedAt>|<meetingAt>"), então nada sai duas vezes.
create table if not exists fn_avisos (
  id text primary key,
  canal text not null check (canal in ('comercial', 'operacional')),
  tipo text not null,
  texto text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  tries int not null default 0,
  erro text
);
create index if not exists fn_avisos_fila on fn_avisos (created_at) where sent_at is null;
alter table fn_avisos enable row level security;

-- Grupos dos clientes vistos no canal Operacional: as últimas 40 mensagens (autor, horário, trecho) e quem já escreveu.
create table if not exists fn_grupos (
  user_ns text primary key,
  flow_ns text not null,
  nome text not null default '',
  last_message_at timestamptz,
  facts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists fn_grupos_flow on fn_grupos (flow_ns);
alter table fn_grupos enable row level security;

-- Configuração. since fica vazio: a 1ª rodada com a chave grava o horário, e nada antes dele vira aviso.
-- Os grupos de aviso são achados pelo nome (AVISOS - COMERCIAIS / AVISOS - OPERACIONAIS) e guardados em groups.
insert into fn_config (k, v) values ('avisos', jsonb_build_object(
  'mode', 'on',
  'flow', 'f316913',
  'groups', '{}'::jsonb,
  'com', jsonb_build_object('horarios', true, 'reunioes', true),
  'op', jsonb_build_object('semRespostaMin', 120, 'risco', true, 'silencioDias', 5, 'equipeGrupos', 4),
  'team', jsonb_build_array('Renan', 'Luiz Felipe'),
  'ignore', jsonb_build_array('Kauã')))
on conflict (k) do nothing;

-- A cada 2 minutos, com a chave das operações de máquina (fn_config, k = 'cron').
do $$ begin
  if exists (select 1 from cron.job where jobname = 'funis-avisos') then perform cron.unschedule('funis-avisos'); end if;
end $$;
select cron.schedule('funis-avisos', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://covwdaygoorabowiuyfr.supabase.co/functions/v1/funis-api',
    body := '{"op":"cron.avisos"}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-fn-cron', (select v->>'key' from public.fn_config where k = 'cron')),
    timeout_milliseconds := 120000)
$cron$);
