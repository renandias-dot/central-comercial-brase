-- Resumo do dia do Renan: a rotina do Claude põe a mensagem na fila com canal 'renan', e a funis-avisos manda no grupo
-- "Organização - BRASE" (fn_config avisos.groups.renan), onde o Renan anota as tarefas.
alter table fn_avisos drop constraint if exists fn_avisos_canal_check;
alter table fn_avisos add constraint fn_avisos_canal_check check (canal in ('comercial', 'operacional', 'resumo', 'renan'));
