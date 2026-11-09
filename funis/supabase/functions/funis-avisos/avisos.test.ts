// deno test funis/supabase/functions/funis-avisos/avisos.test.ts
import {assert, assertEquals} from 'jsr:@std/assert@1';
import {avClientGroup, avDur, avGroupLabel, avGroupState, avHasTime, avHorarioText, avIsAck, avIsRisk, avMeetingDue, avNameIn, avReuniaoText, avSemRespostaText, avTimeOffers, avWhen, grpMsg, leadIndex, type GrpMsg, type WaMsg} from './avisos.ts';

const t = (hhmm: string, day = '2026-11-09') => Date.parse(`${day}T${hhmm}:00-03:00`) / 1000;
const g = (author: string, text: string, at: number, own = false, kind = 'text'): GrpMsg => ({mid: 'g' + at, ts: at, own, author, text, kind});

Deno.test('horário sugerido: pega horário com dia ou palavra de agenda', () => {
  for (const s of ['Tenho amanhã às 10h ou às 15h, qual fica melhor?', 'Pode ser hoje 16:30?', 'Quinta 14h30 fica bom pra você?', 'Se aqueles não deram, tenho sexta às 9h ou 11h. Qual fica melhor? 🚀',
    'consigo as 15h', 'Reunião confirmada pra terça às 10', 'amanha 9 h pode?', 'Tenho horário dia 12/11 às 14:00']) assert(avHasTime(s), s);
});
Deno.test('horário sugerido: duração, preço e conversa comum não contam', () => {
  for (const s of ['Te mando o diagnóstico em 24h', 'Fala João, aqui é o Luiz Felipe, da Brase!', 'A reunião dura 1h', 'Tenho as 2 lojas no iFood', 'Faturo uns 40 mil por mês',
    'Abre às 18h', 'https://www.ifood.com.br/delivery/sao-paulo-sp/loja/abc', 'Às 10 lojas da rede']) assert(!avHasTime(s), s);
});
Deno.test('horários da conversa do SDR: quem sugeriu e o trecho, só as mais recentes', () => {
  const m = (type: string, at: number, content: string, username = ''): WaMsg & {username?: string} => ({id: at, mid: 'm' + at, type, msg_type: 'text', content, ts: at, username});
  const list = [m('agent', t('10:00'), 'Tenho amanhã às 10h ou 15h, qual fica melhor?', 'Luiz Felipe'), m('in', t('10:05'), 'Pode ser às 15h'), m('agent', t('10:06'), 'Fechado!'), m('bot', t('10:07'), 'Lembrete: amanhã às 15h')];
  const out = avTimeOffers(list);
  assertEquals(out.map(x => [x.who, x.agent, x.mid]), [['sdr', 'Luiz Felipe', 'm' + t('10:00')], ['lead', '', 'm' + t('10:05')]]);
  assertEquals(avTimeOffers(list, 1).length, 1);
  const txt = avHorarioText(out[0], {name: 'João', company: 'Pizzaria do João', stage: 'agendando'}, '');
  assertEquals(txt, '🕐 *SDR sugeriu horário*\nJoão · Pizzaria do João (Agendando)\nLuiz Felipe: “Tenho amanhã às 10h ou 15h, qual fica melhor?”');
  assert(avHorarioText(out[1], null, 'Maria').startsWith('🙋 *Lead sugeriu horário*\nMaria (sem card na Central)'));
});

Deno.test('reunião marcada: um aviso por marcação, remarcada quando o horário muda, espera 10 min sem horário', () => {
  const since = Date.parse('2026-11-09T02:00:00-03:00'), booked = '2026-11-09T13:00:00.000Z', now = Date.parse(booked);
  const l = {stage: 'marcada', bookedAt: booked, meetingAt: '2026-11-13T15:00', name: 'João', company: 'Pizzaria', ownerId: 's1'};
  assertEquals(avMeetingDue('L1', l, [], since, now), {key: `reuniao:L1:${booked}|2026-11-13T15:00`, kind: 'nova'});
  assertEquals(avMeetingDue('L1', l, [`reuniao:L1:${booked}|2026-11-13T15:00`], since, now), null);
  assertEquals(avMeetingDue('L1', {...l, meetingAt: '2026-11-14T10:00'}, [`reuniao:L1:${booked}|2026-11-13T15:00`], since, now)?.kind, 'remarcada');
  const semHora = {...l, meetingAt: ''};
  assertEquals(avMeetingDue('L1', semHora, [], since, now + 5 * 60e3), null);
  assertEquals(avMeetingDue('L1', semHora, [], since, now + 11 * 60e3)?.kind, 'nova');
  assertEquals(avMeetingDue('L1', l, [`reuniao:L1:${booked}|`], since, now)?.kind, 'horario');
  assertEquals(avMeetingDue('L1', {...l, stage: 'agendando'}, [], since, now), null);
  assertEquals(avMeetingDue('L1', {...l, bookedAt: '2026-11-08T13:00:00.000Z'}, [], since, now), null); // antes de ligar os avisos
  assertEquals(avReuniaoText(l, 'nova', {s1: 'Luiz Felipe'}), '📅 *Reunião marcada*\nJoão · Pizzaria\nsex 13/11 às 15:00 · SDR: Luiz');
  assert(avReuniaoText(semHora, 'nova', {}).endsWith('horário ainda não preenchido na Central'));
});
Deno.test('data da reunião em Brasília, com ou sem fuso', () => {
  assertEquals(avWhen('2026-11-13T15:00'), 'sex 13/11 às 15:00');
  assertEquals(avWhen('2026-11-13T18:00:00.000Z'), 'sex 13/11 às 15:00');
  assertEquals(avWhen(''), '');
});

Deno.test('grupos dos clientes: "G: BRASE - " e "G: DI ", sem os grupos de aviso', () => {
  assert(avClientGroup('G: BRASE - Texas Burger'));
  assert(avClientGroup('G: brase- Pizzaria'));
  assert(avClientGroup('G: DI Hamburgueria'));
  assert(!avClientGroup('G: Organização - BRASE 🎯'));
  assert(!avClientGroup('G: AVISOS - OPERACIONAIS'));
  assert(!avClientGroup('BRASE - Texas Burger')); // conversa individual não tem "G: "
  assert(!avClientGroup('G: DIVERSOS'));
  assertEquals(avGroupLabel('G: BRASE - Texas Burger'), 'BRASE - Texas Burger');
});
Deno.test('mensagem de grupo: autor pela linha "👤 Nome:", número do Renan é da Brase', () => {
  const a = grpMsg({id: 1, mid: 'x1', type: 'in', msg_type: 'text', content: '👤 Carla Souza:\nConseguem subir o combo hoje?', ts: 100});
  assertEquals(a, {mid: 'x1', ts: 100, own: false, author: 'Carla Souza', text: 'Conseguem subir o combo hoje?', kind: 'text'});
  assertEquals(grpMsg({id: 2, type: 'agent', msg_type: 'text', content: '👤 Renan Dias:\nSubo sim', ts: 101})?.own, true);
  assertEquals(grpMsg({id: 3, type: 'in', content: 'sem prefixo', ts: 102})?.author, '');
  assertEquals(grpMsg({id: 4, type: 'system', content: 'Bot paused', ts: 103}), null);
});
Deno.test('mensagem que não pede resposta', () => {
  for (const s of ['ok', 'Obrigado!', 'valeu, vou ver aqui', 'Bom dia', '👍🙏', 'kkkk', 'Show']) assert(avIsAck(g('C', s, 1)), s);
  for (const s of ['ok, mas e o combo?', 'Bom dia, conseguem ver o cardápio hoje?', 'Preciso trocar a foto do X-Bacon']) assert(!avIsAck(g('C', s, 1)), s);
  assert(avIsAck(g('C', '', 1, false, 'sticker')));
});
Deno.test('risco: contrato e resultado contam; cancelar pedido não', () => {
  for (const s of ['Tô pensando em cancelar', 'Não está dando resultado', 'As vendas caíram muito essa semana', 'Quero encerrar o contrato', 'tá caro demais pra mim']) assert(avIsRisk(s), s);
  for (const s of ['O cliente pediu pra cancelar o pedido', 'Cancelaram a entrega de novo', 'Bom dia, tudo certo?', 'Vamos parar a promoção de terça?']) assert(!avIsRisk(s), s);
});
Deno.test('nomes casam pelo começo, sem acento', () => {
  assert(avNameIn('Luiz Felipe Souza', ['Luiz Felipe']));
  assert(avNameIn('Kaua', ['Kauã']));
  assert(!avNameIn('Luiza', ['Luiz']));
  assert(!avNameIn('', ['Luiz']));
});
Deno.test('estado do grupo: espera conta da 1ª mensagem do cliente que pede resposta depois da Brase', () => {
  const msgs = [g('Carla', 'Conseguem ver o cardápio?', t('09:00')), g('Renan', 'Vejo sim', t('09:10'), true), g('Carla', 'Obrigada!', t('09:12')),
    g('Carla', 'E a foto do X-Bacon?', t('10:00')), g('Carla', 'Alguém?', t('10:30'))];
  const s = avGroupState(msgs, []);
  assertEquals(s.lastBrase, t('09:10'));
  assertEquals(s.waiting?.ts, t('10:00'));
  // gestor da lista responde: para de esperar
  const s2 = avGroupState([...msgs, g('Paulo Gestor', 'Já subi', t('10:40'))], ['Paulo']);
  assertEquals([s2.lastBrase, s2.waiting], [t('10:40'), null]);
  // nome com "Brase" também é da equipe
  assertEquals(avGroupState([...msgs, g('Ana | Brase', 'Feito', t('10:41'))], []).waiting, null);
  // só "obrigado" depois da resposta: ninguém esperando
  assertEquals(avGroupState(msgs.slice(0, 3), []).waiting, null);
  // ignorados (Kauã) não contam para nada
  assertEquals(avGroupState([g('Kauã', 'Me responde aí?', t('11:00'))], [], ['Kauã']).waiting, null);
  // risco
  assertEquals(avGroupState([g('Carla', 'Tô pensando em cancelar', t('11:00'))], []).risks.length, 1);
});
Deno.test('textos dos avisos operacionais', () => {
  assertEquals(avDur(125 * 60e3), '2h05');
  assertEquals(avDur(120 * 60e3), '2h');
  assertEquals(avDur(40 * 60e3), '40 min');
  assertEquals(avSemRespostaText('BRASE - Texas Burger', g('Carla', 'E a foto?', 1), 130 * 60e3), '⏰ *Sem resposta há 2h10*\nBRASE - Texas Burger\nCarla: “E a foto?”');
});
Deno.test('lead pelo telefone: em andamento e mais novo vence; excluído não conta', () => {
  const idx = leadIndex([
    {col: 'leads', id: 'a', data: {phone: '(31) 99387-7523', stage: 'perdido', createdAt: '2026-11-08'}},
    {col: 'leads', id: 'b', data: {phone: '5531993877523', stage: 'agendando', createdAt: '2026-10-01'}},
    {col: 'leads', id: 'c', data: {phone: '31993877523', stage: 'novo', createdAt: '2026-11-09'}, deleted: true},
    {col: 'sellers', id: 's1', data: {name: 'Luiz Felipe'}}]);
  assertEquals(idx.get('3193877523')?.id, 'b');
  assertEquals(idx.size, 1);
});
