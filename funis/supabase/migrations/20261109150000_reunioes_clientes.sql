-- Reuniões com os clientes, detectadas nos grupos de WhatsApp (canal Operacional), para o aviso de 30 dias.
-- A funis-avisos grava cada link do Meet num grupo de cliente como reunião "provável" no dia do link; a rotina de IA
-- "Leitor dos grupos dos clientes" confirma (realizada / não realizada) pelo contexto e pelas Anotações do Gemini, corrige o
-- dia e acrescenta reuniões sem link no grupo (fonte 'rotina'). 30 dias depois da última reunião, sai o aviso no grupo
-- AVISOS - OPERACIONAIS. Pode rodar de novo sem problema.
create table if not exists fn_reunioes_clientes (
  id text primary key,                 -- grupo:código do Meet:dia do link (ou grupo:rotina:dia)
  group_ns text not null,              -- contato do grupo no NicoChat (canal Operacional)
  grupo text not null,                 -- nome do grupo, sem "G: "
  dia date not null,                   -- dia da reunião (Brasília); começa como o dia do link
  link_at timestamptz,                 -- quando o link apareceu no grupo
  meet text,                           -- código do Meet (abc-defg-hij)
  autor text,                          -- quem mandou o link
  fonte text not null default 'meet' check (fonte in ('meet', 'rotina', 'manual')),
  status text not null default 'provavel' check (status in ('provavel', 'realizada', 'nao_realizada')),
  evidencia text,                      -- por que a rotina confirmou ou descartou
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fn_reunioes_clientes_grupo on fn_reunioes_clientes (group_ns, dia desc);
alter table fn_reunioes_clientes enable row level security;
