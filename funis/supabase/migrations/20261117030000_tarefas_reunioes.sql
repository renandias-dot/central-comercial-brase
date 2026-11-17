-- Ações das reuniões (aba Ações do OPS): cada ação criada pela integração ganha um número curto para o gestor concluir no
-- AVISOS - OPERACIONAIS ("feito 12"). A situação vem do OPS (op tarefas_status); as vencidas entram no resumo das 9h.
create table if not exists fn_tarefas (
  codigo serial primary key,
  ops_id uuid not null unique,          -- weekly_meeting_actions.id no OPS
  origem text,                          -- id da reunião (meet:… / gemini:…)
  titulo text not null,
  cliente text,
  responsavel text,                     -- nome no OPS (Gabriel, Felipe, Luis, Renan…)
  prazo date,
  status text not null default 'pendente', -- pendente | em_andamento | concluida | arquivada | sumiu
  criada_em timestamptz not null default now(),
  anunciada_em timestamptz,             -- quando entrou no resumo como nova
  concluida_em timestamptz,
  concluida_por text,
  sincronizada_em timestamptz
);
create index if not exists fn_tarefas_abertas on fn_tarefas (responsavel, prazo) where status in ('pendente', 'em_andamento');
alter table fn_tarefas enable row level security;
