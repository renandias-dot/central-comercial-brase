-- Tela Cobertura: nome de quem incluiu cada loja pela extensão (opcional) e índice para somar por estado e cidade.
alter table rs_merchants add column if not exists added_by text;
create index if not exists rs_merchants_state_city on rs_merchants (state, city);
