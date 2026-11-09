// deno test funis/supabase/functions/funis-avisos/avisos.test.ts
import {assert, assertEquals} from 'jsr:@std/assert@1';
import {avClientGroup, avDur, avGroupLabel, avGroupState, avHasTime, avHorarioText, avIsAck, avIsRisk, avMeetingDue, avNameIn, avReuniaoText, avSemRespostaText, avTimeOffers, avWhen, grpMsg, leadIndex, avMeetings, avReuniao30Due, avReuniao30Text, avParseSlots, avAgendaText, avHoldId, avHoldStart, avIsDi, avClientOf, type GrpMsg, type WaMsg} from './avisos.ts';

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
  assertEquals(txt, '🕐 *SDR sugeriu horário*\nJoão · Pizzaria do João (Agendando)\n“Tenho amanhã às 10h ou 15h, qual fica melhor?”');
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
  assert(avClientGroup('G: D.I - Sanduba Lanches'));
  assert(avClientGroup('G: D.I. - Liz Café'));
  assert(!avClientGroup('G: Desconto em Games #1102'));
  assert(!avClientGroup('G: EQUIPE - Delivery Intense'));
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
Deno.test('áudio e imagem sem autor: valem como do autor anterior (até 15 min); sozinhos não contam', () => {
  const media = (at: number) => g('', '[áudio]', at, false, 'audio');
  // gestor manda texto e depois áudio: o áudio é do gestor, não abre espera
  assertEquals(avGroupState([g('Carla', 'Conseguem ver?', t('09:00')), g('Felipe Araújo', 'Vou ver', t('09:05')), media(t('09:06'))], ['Felipe Araújo']).waiting, null);
  // cliente manda texto e áudio: a espera continua do texto
  assertEquals(avGroupState([g('Carla', 'Conseguem ver?', t('09:00')), media(t('09:01'))], []).waiting?.ts, t('09:00'));
  // áudio solto (sem mensagem antes, ou depois do Renan): não conta
  assertEquals(avGroupState([media(t('09:00'))], []).waiting, null);
  assertEquals(avGroupState([g('Renan', 'Oi', t('09:00'), true), media(t('09:01'))], []).waiting, null);
  // áudio muito depois da mensagem anterior: não conta
  assertEquals(avGroupState([g('Felipe Araújo', 'Vou ver', t('09:00')), media(t('10:00'))], ['Felipe Araújo']).lastBrase, t('09:00'));
});
Deno.test('reunião com cliente: link do Meet no grupo vira reunião do dia; aviso 30 dias depois', () => {
  const longo = 'Bom dia pessoal! ' + 'x'.repeat(200) + ' segue o link: https://meet.google.com/abc-defg-hij?authuser=0';
  const a = grpMsg({id: 1, mid: 'm1', type: 'in', msg_type: 'text', content: '👤 Felipe Araújo:\n' + longo, ts: t('10:00')});
  assertEquals(a?.meet, 'abc-defg-hij');
  assertEquals(grpMsg({id: 2, type: 'agent', content: 'Reunião amanhã, combinado?', ts: t('10:01')})?.meet, undefined);
  const r = avMeetings('G1', 'D.I - Liz Café', [a!, {...a!, mid: 'm2', ts: t('10:05')}, g('Renan', 'x', t('11:00'), true)]);
  assertEquals(r.length, 1); // o mesmo link no mesmo dia conta uma vez
  assertEquals([r[0].id, r[0].dia, r[0].autor], ['G1:abc-defg-hij:2026-11-09', '2026-11-09', 'Felipe Araújo']);
  const now = Date.parse('2026-12-09T09:00:00-03:00');
  assert(avReuniao30Due('2026-11-09', now));
  assert(!avReuniao30Due('2026-11-12', now));
  assertEquals(avReuniao30Text('D.I - Liz Café', '2026-11-09', 'provavel', 30), '📆 *30 dias desde a última reunião*\nD.I - Liz Café\nÚltima: 09/11 (link do Meet no grupo). Hora de marcar a próxima.');
});
Deno.test('horário que o Renan sugere: vira data e hora certas', () => {
  const seg = Date.parse('2026-11-09T12:28:00-03:00'); // segunda, 12:28
  const br = (ms: number) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 16);
  const p = (s: string, at = seg) => avParseSlots(s, at).map(br);
  assertEquals(p('Vamos já marcar nossa reunião meu amigo! como estão a disponibilidade de vocês amanhã 15h? @all'), ['2026-11-10T15:00']);
  assertEquals(p('Tenho quinta às 10h ou 14h30, qual fica melhor?'), ['2026-11-12T10:00', '2026-11-12T14:30']);
  assertEquals(p('Pode ser hoje 16:00?'), ['2026-11-09T16:00']);
  assertEquals(p('Consigo dia 12/11 às 9h'), ['2026-11-12T09:00']);
  assertEquals(p('Fechado, segunda às 11h então'), ['2026-11-16T11:00']); // mesma segunda = semana que vem
  assertEquals(p('Consigo às 10h'), ['2026-11-10T10:00']);              // sem dia e já passou: amanhã
  assertEquals(p('Consigo às 15h'), ['2026-11-09T15:00']);              // sem dia e ainda não passou: hoje
  assertEquals(p('Depois de amanhã 9h tá ótimo'), ['2026-11-11T09:00']);
  assertEquals(p('A promoção vai até o fim do mês'), []);
  assertEquals(p('Te mando o diagnóstico em 24h'), []);
  assertEquals(p('hoje as 10h'), []);                                   // já passou
  assertEquals([avHoldId(Date.parse('2026-11-10T15:00:00-03:00')), avHoldStart(Date.parse('2026-11-10T15:00:00-03:00'))], ['r202611101500', '2026-11-10T15:00']);
});
Deno.test('aviso do horário do Renan: D.I é reunião rápida; cliente e lead bloqueiam', () => {
  const s = [Date.parse('2026-11-10T15:00:00-03:00')];
  assertEquals(avAgendaText('D.I - Point da Lolo', 'di', s, 'amanhã 15h?', true), '🗓 *Renan: reunião rápida (5 a 10 min)*\nD.I - Point da Lolo\nter 10/11 às 15:00\n“amanhã 15h?”\nNão fecha o horário: dá para marcar outra reunião logo antes ou depois (14:30 ou 15:30, por exemplo).');
  assertEquals(avAgendaText('BRASE - Texas Burger', 'cliente', s, 'quinta 15h', true), '🗓 *Renan sugeriu horário*\nBRASE - Texas Burger\nter 10/11 às 15:00\n“quinta 15h”\nBloqueado na agenda da Central: não ofereça esse horário.');
  assert(avIsDi('G: D.I - Liz Café') && avIsDi('D.I - Liz Café') && avIsDi('G: DI Sushi') && !avIsDi('G: BRASE - X') && !avIsDi('G: Desconto em Games'));
});
Deno.test('privado com cliente: o nome do contato é o mesmo de quem escreve no grupo', () => {
  const groups = [{nome: 'D.I - Liz Café', authors: ['Fabiola']}, {nome: 'D.I - Point da Lolo', authors: ['Patrick William', 'Felipe Araújo']}];
  assertEquals(avClientOf('Fabiola', groups), 'D.I - Liz Café');
  assertEquals(avClientOf('Patrick William', groups), 'D.I - Point da Lolo');
  assertEquals(avClientOf('Patrick', groups), 'D.I - Point da Lolo');
  assertEquals(avClientOf('Rodrigo', groups), null);
  assertEquals(avClientOf('Jo', groups), null);
});
