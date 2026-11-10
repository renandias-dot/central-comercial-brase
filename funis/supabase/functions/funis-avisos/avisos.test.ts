// deno test funis/supabase/functions/funis-avisos/avisos.test.ts
import {assert, assertEquals} from 'jsr:@std/assert@1';
import {avClientGroup, avDur, avGroupLabel, avGroupState, avHasTime, avHorarioText, avIsAck, avIsRisk, avMeetingDue, avNameIn, avReuniaoText, avSemRespostaText, avTimeOffers, avWhen, grpMsg, leadIndex, avMeetings, avReuniao30Due, avReuniao30Text, avParseSlots, avAgendaText, avHoldId, avHoldStart, avIsDi, avClientOf, avPedidoCandidato, avPedidoText, avAgendadoText, avAudioUrl, avAudioTexto, avComAudios, avAutores, avQuemPeloTexto, AV_AUDIO_SEM_AUTOR, AV_AUDIO_EQUIPE, AV_AUDIO_CLIENTE, avReuniaoOpsText, avLeadDaReuniao, avExpediente, avMsUteis, avGestorLinha, avRiscoText, avSilencioText, avNotasComReuniao, avNotaLeadText, type GrpMsg, type WaMsg} from './avisos.ts';

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
Deno.test('horários da conversa do SDR: quem sugeriu e o dia e a hora, só as mais recentes', () => {
  const m = (type: string, at: number, content: string, username = ''): WaMsg & {username?: string} => ({id: at, mid: 'm' + at, type, msg_type: 'text', content, ts: at, username});
  const list = [m('agent', t('10:00'), 'Tenho amanhã às 10h ou 15h, qual fica melhor?', 'Luiz Felipe'), m('in', t('10:05'), 'Pode ser às 15h'), m('agent', t('10:06'), 'Fechado!'), m('bot', t('10:07'), 'Lembrete: amanhã às 15h')];
  const out = avTimeOffers(list);
  assertEquals(out.map(x => [x.who, x.agent, x.mid]), [['sdr', 'Luiz Felipe', 'm' + t('10:00')], ['lead', '', 'm' + t('10:05')]]);
  assertEquals(avTimeOffers(list, 1).length, 1);
  const txt = avHorarioText(out[0], {name: 'João', company: 'Pizzaria do João', stage: 'agendando'}, '');
  assertEquals(txt, '🕐 *Lipe sugeriu horário*\nJoão · Pizzaria do João (Agendando)\nter 10/11 às 10:00 ou ter 10/11 às 15:00');
  assertEquals(avHorarioText(out[1], null, 'Maria'), '🙋 *Lead sugeriu horário*\nMaria (sem card na Central)\nseg 09/11 às 15:00');
  // mensagem longa: o horário vinha depois do corte do trecho; agora sai o dia e a hora lidos da mensagem inteira
  const longa = m('agent', t('08:16', '2026-11-10'), 'Entendi meu amigo! Vamos marcar uma reunião com o Renan pra ele te mostrar o que tá travando suas vendas por aí e como corrigir isso. Como tá sua disponibilidade amanhã 13h ou 17h?');
  assertEquals(avHorarioText(avTimeOffers([longa])[0], null, ''), '🕐 *Lipe sugeriu horário*\nLead (sem card na Central)\nqua 11/11 às 13:00 ou qua 11/11 às 17:00');
  // cara de horário, mas sem um horário que dê para entender (já passou): não entra
  assertEquals(avTimeOffers([m('agent', t('20:00'), 'Hoje às 10h deu certo?')]).length, 0);
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
  assert(avClientGroup('G: Gestão IFood - Texas Burguer'));
  assert(avClientGroup('G: gestao ifood - Pizzaria'));
  assert(!avClientGroup('G: Gestão de Pessoas'));
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
  assertEquals(avSemRespostaText('BRASE - Texas Burger', g('Carla', 'E a foto?', 1), 130 * 60e3, 1000 + 130 * 60e3, ['Renan']), '⏰ *Sem resposta há 2h10 no horário comercial*\nBRASE - Texas Burger\nCarla: “E a foto?”\n👤 @Renan, responda o cliente.');
  // mensagem da noite: diz quando o cliente mandou
  const noite = Date.parse('2026-11-06T20:14:00-03:00') / 1000, seg11 = Date.parse('2026-11-09T11:00:00-03:00');
  assertEquals(avSemRespostaText('D.I - Liz Café', g('Fabiola', 'Oi?', noite), 120 * 60e3, seg11, 'Gabriel'), '⏰ *Sem resposta há 2h no horário comercial*\nD.I - Liz Café\nFabiola: “Oi?”\nMandou sex 06/11 às 20:14.\n👤 @Gabriel, responda o cliente.');
  assertEquals(avRiscoText('D.I - Meu Croc', g('Ana', 'quero cancelar', 1), ['Felipe']), '🚨 *Atenção: possível risco*\nD.I - Meu Croc\nAna: “quero cancelar”\n👤 @Felipe, fale com o cliente hoje.');
  assertEquals(avSilencioText('D.I - Point da Lolo', 6, []), '😶 *6 dias sem mensagem da Brase*\nD.I - Point da Lolo\n👤 Gestor não identificado no OPS: mande uma mensagem no grupo.');
  assertEquals(avGestorLinha(['Gabriel', 'Felipe', 'Gabriel', ''], 'revise.'), '👤 @Gabriel e @Felipe, revise.');
});
Deno.test('horário comercial: a espera do cliente só conta seg a sex, das 9h às 19h', () => {
  const e = avExpediente(undefined), at = (s: string) => Date.parse(s + '-03:00');
  assertEquals(e, {inicio: 540, fim: 1140, dias: [1, 2, 3, 4, 5]});
  // dentro do expediente: conta tudo
  assertEquals(avMsUteis(at('2026-11-10T10:00:00'), at('2026-11-10T12:30:00'), e), 150 * 60e3);
  // terça 22h → quarta 10h30: só 1h30 (das 9h às 10h30)
  assertEquals(avMsUteis(at('2026-11-10T22:00:00'), at('2026-11-11T10:30:00'), e), 90 * 60e3);
  // sexta 18h → segunda 10h: 1h na sexta + 1h na segunda; sábado e domingo não contam
  assertEquals(avMsUteis(at('2026-11-06T18:00:00'), at('2026-11-09T10:00:00'), e), 120 * 60e3);
  // sábado inteiro: zero
  assertEquals(avMsUteis(at('2026-11-07T08:00:00'), at('2026-11-07T23:00:00'), e), 0);
  // cliente às 18h30: 30 min hoje; às 2h de espera, o aviso sai às 10h30 do dia seguinte
  assertEquals(avMsUteis(at('2026-11-10T18:30:00'), at('2026-11-11T10:29:00'), e) < 120 * 60e3, true);
  assertEquals(avMsUteis(at('2026-11-10T18:30:00'), at('2026-11-11T10:30:00'), e), 120 * 60e3);
  // configuração própria (sábado de manhã também) e configuração inválida volta ao padrão
  const sab = avExpediente({inicio: '08:00', fim: '12:00', dias: [6]});
  assertEquals(avMsUteis(at('2026-11-07T07:00:00'), at('2026-11-07T23:00:00'), sab), 240 * 60e3);
  assertEquals(avExpediente({inicio: '20:00', fim: '08:00', dias: ['x']}), {inicio: 540, fim: 1140, dias: [1, 2, 3, 4, 5]});
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
  assertEquals(avReuniao30Text('D.I - Liz Café', '2026-11-09', 'provavel', 30), '📆 *30 dias desde a última reunião*\nD.I - Liz Café\nÚltima: 09/11 (link do Meet no grupo).\n👤 Gestor não identificado no OPS: marque a próxima reunião.');
  assert(avReuniao30Text('D.I - Liz Café', '2026-11-09', 'realizada', 30, ['Gabriel']).endsWith('(confirmada).\n👤 @Gabriel, marque a próxima reunião.'));
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
  // mais de um dia na mensagem: cada horário fica com o dia do seu trecho da frase (caso real do grupo do Shinkai, 10/11)
  assertEquals(p('Só na quinta vou estar na estrada, podemos sexta às 10h?', Date.parse('2026-11-10T16:14:00-03:00')), ['2026-11-13T10:00']);
  assertEquals(p('Amanhã não consigo, quinta 10h pode?'), ['2026-11-12T10:00']);
  assertEquals(p('Quinta às 10h ou sexta às 15h'), ['2026-11-12T10:00', '2026-11-13T15:00']);
  assertEquals(p('Tenho amanhã às 10h ou às 15h'), ['2026-11-10T10:00', '2026-11-10T15:00']);
  assertEquals(p('Depois de amanhã 9h ou amanhã 17h'), ['2026-11-10T17:00', '2026-11-11T09:00']);
  assertEquals(p('Às 10h na quinta ou às 15h na sexta'), ['2026-11-12T10:00', '2026-11-13T15:00']);
  assertEquals(p('Tenho quinta às 10h ou 14h30, qual fica melhor?'), ['2026-11-12T10:00', '2026-11-12T14:30']);
  assertEquals(p('Pode ser 10h de amanhã?'), ['2026-11-10T10:00']);
  assertEquals([avHoldId(Date.parse('2026-11-10T15:00:00-03:00')), avHoldStart(Date.parse('2026-11-10T15:00:00-03:00'))], ['r202611101500', '2026-11-10T15:00']);
});
Deno.test('aviso do horário do Renan: D.I é reunião rápida; cliente e lead bloqueiam', () => {
  const s = [Date.parse('2026-11-10T15:00:00-03:00')];
  assertEquals(avAgendaText('D.I - Point da Lolo', 'di', s, true), '🗓 *Renan: reunião rápida (5 a 10 min)*\nD.I - Point da Lolo\nter 10/11 às 15:00\nNão fecha o horário: dá para marcar outra reunião logo antes ou depois (14:30 ou 15:30, por exemplo).');
  assertEquals(avAgendaText('BRASE - Texas Burger', 'cliente', s, true), '🗓 *Renan sugeriu horário*\nBRASE - Texas Burger\nter 10/11 às 15:00\nBloqueado na agenda da Central: não ofereça esse horário.');
  assert(avIsDi('G: D.I - Liz Café') && avIsDi('D.I - Liz Café') && avIsDi('G: D.I. Sushi') && !avIsDi('G: DI Blasi - Batel') && !avIsDi('G: BRASE - X') && !avIsDi('G: Desconto em Games'));
});
Deno.test('privado com cliente: o nome do contato é o mesmo de quem escreve no grupo', () => {
  const groups = [{nome: 'D.I - Liz Café', authors: ['Fabiola']}, {nome: 'D.I - Point da Lolo', authors: ['Patrick William', 'Felipe Araújo']}];
  assertEquals(avClientOf('Fabiola', groups), 'D.I - Liz Café');
  assertEquals(avClientOf('Patrick William', groups), 'D.I - Point da Lolo');
  assertEquals(avClientOf('Patrick', groups), 'D.I - Point da Lolo');
  assertEquals(avClientOf('Rodrigo', groups), null);
  assertEquals(avClientOf('Jo', groups), null);
});
Deno.test('pedido de alteração no grupo: filtro e aviso com o gestor marcado', () => {
  for (const x of ['Acabou o pão de queijo', 'pausa o X-Bacon hoje', 'Pode tirar o açaí 500ml', 'amanhã não vamos abrir', 'o valor do combo agora é 39,90', 'pode ativar o X-Tudo de novo', 'Sem estoque de coca lata']) assert(avPedidoCandidato(x), x);
  for (const x of ['Bom dia, tudo certo?', 'Obrigado pelo relatório', 'Como vai ser as próximas etapas?', 'Chegou pedido agora']) assert(!avPedidoCandidato(x), x);
  const feito = avPedidoText('D.I - Liz Café', 'Fabiola', 'acabou o pão de queijo', {status: 'aplicado', gestor: 'Gabriel', feitos: ['Pão de queijo pausado']});
  assertEquals(feito, '🛠 *Alteração feita no iFood*\nD.I - Liz Café\nFabiola: “acabou o pão de queijo”\n✅ Pão de queijo pausado\n👤 @Gabriel, revise a alteração no OPS (Cardápio iFood › histórico do item).');
  // parte feita e parte não: revisar e resolver o resto
  assert(avPedidoText('D.I - Liz Café', 'Fabiola', 'x', {status: 'aplicado', gestor: 'Gabriel', feitos: ['a'], nao_feitos: [{pedido: 'b', motivo: 'c'}]}).endsWith('👤 @Gabriel, revise a alteração no OPS (Cardápio iFood › histórico do item) e resolva o que não foi feito com o cliente.'));
  const nao = avPedidoText('BRASE - Texas Burger', 'João', 'pausa a coca', {status: 'nao_aplicado', gestor: 'Felipe Araújo', nao_feitos: [{pedido: 'pausar Coca', motivo: 'não ficou claro (duas cocas)'}]});
  assert(nao.startsWith('🛠 *Pedido de alteração NÃO aplicado*') && nao.includes('⚠️ pausar Coca: não ficou claro (duas cocas)') && nao.endsWith('👤 @Felipe Araújo, resolva com o cliente.'));
  // loja não identificada no OPS: o gestor do grupo (as duas lojas do Texas são do Renan) faz à mão
  assert(avPedidoText('Gestão IFood - Texas Burguer', 'Patrick', 'pausa o combo', {status: 'sem_cliente'}, ['Renan']).endsWith('👤 @Renan, faça à mão: o grupo não bate com uma loja só no OPS (nenhuma, ou mais de uma loja no mesmo grupo).'));
  assert(avPedidoText('D.I - Point da Lolo', 'Patrick', 'pausa o combo', {status: 'sem_cliente'}).endsWith('👤 Gestor não identificado no OPS: faça à mão: o grupo não bate com uma loja só no OPS (nenhuma, ou mais de uma loja no mesmo grupo).'));
  assert(avAgendadoText({ok: true, cliente: 'Liz Café', gestor: 'Gabriel', texto: 'Pão de queijo ativado'}).endsWith('✅ Pão de queijo ativado\n👤 @Gabriel, revise a alteração no OPS.'));
});

Deno.test('áudio: link só de outro participante, transcrição no lugar de [áudio], autor herdado', () => {
  const raw = (over: Partial<WaMsg>): WaMsg => ({mid: 'a1', type: 'in', msg_type: 'audio', content: '', ts: t('10:00'), payload: {url: 'https://nicozap.uazapi.com/files/abc.mp3'}, ...over});
  assertEquals(avAudioUrl(raw({})), 'https://nicozap.uazapi.com/files/abc.mp3');
  assertEquals(avAudioUrl(raw({type: 'agent'})), '');
  assertEquals(avAudioUrl(raw({msg_type: 'image'})), '');
  assertEquals(avAudioUrl(raw({payload: {url: 'http://x/a.mp3'}})), '');
  assertEquals(avAudioUrl(raw({payload: null})), '');
  assertEquals(avAudioTexto('  acabou o  frango '), '🎤 acabou o frango');
  assertEquals(avAudioTexto(''), '🎤 (áudio sem fala)');
  const audio = (mid: string, at: number): GrpMsg => ({mid, ts: at, own: false, author: '', text: '[áudio]', kind: 'audio'});
  const msgs = [g('Carla', 'Bom dia', t('09:00')), audio('x1', t('09:05')), audio('x2', t('09:15')), audio('x3', t('11:00')), g('Felipe Araújo', 'Vou ver', t('11:05')), audio('x4', t('11:06'))];
  const com = avComAudios(msgs, new Map([['x1', {texto: 'tira o strogonoff hoje'}], ['x9', {texto: 'outro'}]]));
  assertEquals(com[1].text, '🎤 tira o strogonoff hoje');
  assertEquals(com[1].author, '');
  assertEquals(com[2].text, '[áudio]');
  const aut = avAutores(msgs);
  assertEquals([aut.get('x1'), aut.get('x2'), aut.get('x3'), aut.get('x4')], ['Carla', 'Carla', undefined, 'Felipe Araújo']);
});
Deno.test('áudio transcrito sem autor: não abre espera, mas risco aparece', () => {
  const solto: GrpMsg = {mid: 'y1', ts: t('10:00'), own: false, author: '', text: '🎤 tô pensando em cancelar o serviço de vocês', kind: 'audio'};
  const s = avGroupState([solto], []);
  assertEquals(s.waiting, null);
  assertEquals(s.risks.length, 1);
  assertEquals(s.risks[0].author, AV_AUDIO_SEM_AUTOR);
  assertEquals(avGroupState([{...solto, text: '[áudio]'}], []).risks.length, 0);
});

Deno.test('áudio classificado: equipe vira resposta da Brase sem conteúdo; cliente leva o nome de quem é do cliente', () => {
  const audio = (mid: string, at: number): GrpMsg => ({mid, ts: at, own: false, author: '', text: '[áudio]', kind: 'audio'});
  const team = ['Felipe Araújo', 'Gabriel Vieira', 'Luiz Felipe', 'Luis - Gestão Performance'];
  const msgs = [g('Lindomar', 'Bom dia', t('09:00')), g('Felipe Araújo', 'Vou ver', t('09:02')), audio('c1', t('09:05')), audio('e1', t('09:10')), audio('c2', t('11:00'))];
  const m = new Map([['c1', {texto: 'acabou o x-bacon', quem: 'cliente'}], ['e1', {texto: 'boa tarde lindomar, a gente fez', quem: 'equipe'}], ['c2', {texto: 'e aí?', quem: 'cliente'}]]);
  const com = avComAudios(msgs, m, team);
  assertEquals([com[2].author, com[2].text], ['Lindomar', '🎤 acabou o x-bacon']);
  assertEquals([com[3].author, com[3].text], [AV_AUDIO_EQUIPE, '🎤 (áudio da equipe)']);
  assertEquals(com[4].author, AV_AUDIO_CLIENTE);
  // áudio da equipe fecha a espera do cliente
  const st = avGroupState(avComAudios([g('Lindomar', 'Conseguem ver o cardápio?', t('09:00')), audio('e1', t('09:30'))], m, team), team);
  assertEquals(st.waiting, null);
  assertEquals(st.lastBrase, t('09:30'));
});
Deno.test('quem falou o áudio pela regra fixa (reserva da IA)', () => {
  const team = ['Felipe Araújo', 'Gabriel Vieira', 'Luiz Felipe', 'Luis - Gestão Performance'], cli = ['Lindomar', 'Daniel'];
  assertEquals(avQuemPeloTexto('Boa tarde, Lindo Mar. Tudo bem? Então, a gente tá dando uma olhada', team, cli), 'equipe');
  assertEquals(avQuemPeloTexto('Oi Daniel, boa tarde, tudo bem? A gente fez uma análise mais cedo', team, cli), 'equipe');
  assertEquals(avQuemPeloTexto('Oi Felipe, pode tirar o x-bacon que acabou', team, cli), 'cliente');
  assertEquals(avQuemPeloTexto('Com esse funil hoje a recomendação é otimizar a campanha e melhorar a conversão', team, cli), 'equipe');
  assertEquals(avQuemPeloTexto('O frango acabou, pode pausar no meu cardápio', team, cli), 'cliente');
  assertEquals(avQuemPeloTexto('Vamos ver como é que vai proceder, né, hoje, amanhã até sexta.', team, cli), null);
});

Deno.test('reunião no OPS: aviso com a reunião do calendário, tarefas e próxima', () => {
  const t = avReuniaoOpsText('D.I - Liz Café', '2026-11-10', {status: 'ok', cliente: 'Liz Café', gestor: 'Gabriel', reuniao: 'Mês 2', resumo_salvo: true, tarefas: ['Subir fotos', 'Revisar combos'], proxima: '2026-12-10'}, 'gemini');
  assertEquals(t, '✅ *Reunião registrada no OPS*\nLiz Café · 10/11 (Mês 2)\n📝 Resumo das Anotações do Gemini salvo na reunião.\n2 tarefas no Comando:\n• Subir fotos\n• Revisar combos\nPróxima reunião prevista: 10/12.\n👤 @Gabriel, revise a reunião e as tarefas no OPS.');
  assert(avReuniaoOpsText('Gestão IFood - Texas Burguer', '2026-11-10', {status: 'sem_cliente'}, 'meet', ['Renan']).endsWith('👤 @Renan, marque a reunião à mão.'));
});
Deno.test('lead da reunião de venda: pelo dia da reunião e pelas palavras do título', () => {
  const docs = [
    {col: 'leads', id: 'a', data: {name: 'João', company: 'Pizzaria Bella', stage: 'marcada', meetingAt: '2026-11-10T15:00'}},
    {col: 'leads', id: 'b', data: {name: 'Maria', company: 'Açaí do Porto', stage: 'marcada', meetingAt: '2026-11-10T16:00'}},
    {col: 'leads', id: 'c', data: {name: 'Carlos', company: 'Burger House', stage: 'agendando'}},
    {col: 'sellers', id: 's', data: {name: 'Luiz Felipe'}}];
  assertEquals(avLeadDaReuniao(docs, {dia: '2026-11-10', titulo: 'Brase x Pizzaria Bella - Diagnóstico'})?.id, 'a');
  assertEquals(avLeadDaReuniao(docs, {dia: '2026-11-10', titulo: 'Reunião', lead_hint: 'Maria, maria@acai.com'})?.id, 'b');
  assertEquals(avLeadDaReuniao(docs, {dia: '2026-11-12', titulo: 'Diagnóstico Burger House'})?.id, 'c');
  assertEquals(avLeadDaReuniao(docs, {dia: '2026-11-10', titulo: 'Reunião Brase'}), null);
  assertEquals(avLeadDaReuniao(docs, {dia: '2026-11-12', titulo: 'Burger'}), null);
  const n = avNotasComReuniao('Dono quer crescer', {id: 'doc123', dia: '2026-11-10', resumo: 'Fatura 40 mil', proximos: 'Mandar proposta'});
  assertEquals(n, 'Dono quer crescer\n\n📝 Reunião 10/11 (Anotações do Gemini) [gemini:doc123]\nFatura 40 mil\nPróximos passos: Mandar proposta');
  assertEquals(avNotasComReuniao(n, {id: 'doc123', dia: '2026-11-10', resumo: 'outro'}), n);
  assert(avNotaLeadText({titulo: 'Brase x Bella', dia: '2026-11-10', resumo: 'r'}, null).startsWith('📝 *Resumo de reunião de venda sem card na Central*'));
});
