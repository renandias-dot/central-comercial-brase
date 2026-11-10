-- Quem falou cada áudio dos grupos dos clientes: o WhatsApp não diz, então a funis-avisos classifica pela transcrição
-- (IA gratuita do Groq; reserva: regra fixa). Só os áudios do cliente são usados; os da equipe (Luis, Gabriel, Felipe,
-- Luiz Felipe) são ignorados e só contam como "a Brase respondeu". Pode rodar de novo sem problema.
alter table fn_audios add column if not exists quem text check (quem in ('cliente', 'equipe', 'incerto'));
alter table fn_audios add column if not exists quem_motivo text;
