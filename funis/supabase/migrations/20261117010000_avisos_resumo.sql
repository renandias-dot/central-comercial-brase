-- Resumo diário por gestor no AVISOS - OPERACIONAIS (seg a sex, 9h): o que não precisa sair na hora (reunião registrada
-- ou não registrada no OPS) entra na fila com canal 'resumo', o grupo e os gestores; o passo "resumo" da funis-avisos junta
-- numa mensagem por gestor, marcando cada um. O envio comum nunca manda o canal 'resumo'.
alter table fn_avisos drop constraint if exists fn_avisos_canal_check;
alter table fn_avisos add constraint fn_avisos_canal_check check (canal in ('comercial', 'operacional', 'resumo'));
alter table fn_avisos add column if not exists grupo text;
alter table fn_avisos add column if not exists gestores text[];
