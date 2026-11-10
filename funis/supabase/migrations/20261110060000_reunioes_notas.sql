-- Anotações do Gemini (resumo das reuniões do Meet) lidas pela rotina "Leitor dos grupos dos clientes", e o envio das
-- reuniões com cliente para o OPS. A rotina grava uma linha por documento em fn_reunioes_notas; a funis-avisos manda:
--   tipo 'cliente' → OPS (função reunioes-clientes): reunião marcada como feita, resumo e tarefas para o gestor;
--   tipo 'lead'    → Central: o resumo entra nas observações do card do lead;
--   tipo 'interna' → ignorada.
-- E as reuniões "realizada" de fn_reunioes_clientes (link do Meet no grupo + evidência) também vão para o OPS.
-- Pode rodar de novo sem problema.
create table if not exists fn_reunioes_notas (
  id text primary key,                 -- id do documento no Google Drive
  titulo text not null,
  dia date not null,                   -- dia da reunião (Brasília)
  tipo text not null check (tipo in ('cliente', 'lead', 'interna')),
  group_ns text,                       -- cliente: grupo do NicoChat (se a rotina achou)
  grupo text,                          -- cliente: nome do grupo, sem "G: "
  lead_hint text,                      -- lead: nome, empresa e participantes, para achar o card na Central
  participantes text,
  resumo text,
  acoes jsonb not null default '[]',   -- cliente: o que a Brase ficou de fazer [{titulo, detalhe, prazo}]
  proximos text,                       -- próximos passos combinados
  status text not null default 'novo' check (status in ('novo', 'feito', 'sem_destino', 'erro', 'ignorado')),
  destino text,                        -- cliente do OPS ou lead da Central que recebeu
  erro text,
  tries integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fn_reunioes_notas_novas on fn_reunioes_notas (created_at) where status = 'novo';
alter table fn_reunioes_notas enable row level security;

alter table fn_reunioes_clientes add column if not exists ops_status text;      -- ok | sem_cliente | erro
alter table fn_reunioes_clientes add column if not exists ops_info text;
alter table fn_reunioes_clientes add column if not exists ops_at timestamptz;
