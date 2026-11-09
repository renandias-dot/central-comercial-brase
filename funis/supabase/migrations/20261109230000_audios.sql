-- Áudios dos grupos dos clientes (canal Operacional), transcritos pela funis-avisos com a OpenAI (segredo OPENAI_API_KEY).
-- O texto entra no lugar de "[áudio]" nos avisos (risco, espera) e nos pedidos de alteração que vão para o OPS; a rotina
-- "Leitor dos grupos dos clientes" também lê daqui. Sem o segredo, os áudios ficam 'pendente' e nada é transcrito.
-- Pode rodar de novo sem problema.
create table if not exists fn_audios (
  mid text primary key,                -- id da mensagem no NicoChat
  group_ns text not null,              -- contato do grupo no NicoChat
  grupo text not null,                 -- nome do grupo, sem "G: "
  ts bigint not null,                  -- quando chegou (UNIX)
  url text not null,                   -- arquivo do áudio
  status text not null default 'pendente' check (status in ('pendente', 'ok', 'erro', 'grande')),
  texto text,                          -- transcrição
  modelo text,                         -- modelo da OpenAI que transcreveu
  bytes integer,
  usage jsonb,                         -- uso devolvido pela OpenAI (segundos ou tokens)
  tries integer not null default 0,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fn_audios_pendentes on fn_audios (ts) where status = 'pendente';
create index if not exists fn_audios_grupo on fn_audios (group_ns, ts desc);
alter table fn_audios enable row level security;
