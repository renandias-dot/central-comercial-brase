// deno test funis/supabase/functions/funis-api/wa.test.ts
import {assert, assertEquals} from 'jsr:@std/assert@1';
import {brIso, inWaHours, nicoTime, waFacts, waLeadIndex, waLeadPatch, waPhoneKey, waSnippet, waStatsDocs, type WaMsg} from './logic.ts';

// Segunda, 9/11/2026, em Brasília (UTC-3).
const t = (hhmm: string, day = '2026-11-09') => Date.parse(`${day}T${hhmm}:00-03:00`) / 1000;
const msg = (type: string, at: number, content = 'oi', extra: Partial<WaMsg> = {}): WaMsg => ({id: at, mid: 'm' + at, type, msg_type: 'text', content, ts: at, ...extra});

Deno.test('chave do telefone ignora 55, máscara e o 9 a mais', () => {
  assertEquals(waPhoneKey('+55 (31) 99387-7523'), '3193877523');
  assertEquals(waPhoneKey('3193877523'), '3193877523');
  assertEquals(waPhoneKey('5531993877523'), '3193877523');
  assertEquals(waPhoneKey(''), '');
  assertEquals(waPhoneKey('12345'), '');
});

Deno.test('horário do SLA: segunda a sexta, 9h às 19h de Brasília', () => {
  assert(inWaHours(t('09:00') * 1000));
  assert(inWaHours(t('18:59') * 1000));
  assert(!inWaHours(t('19:00') * 1000));
  assert(!inWaHours(t('08:30') * 1000));
  assert(!inWaHours(t('10:00', '2026-11-08') * 1000)); // domingo
});

Deno.test('lead esperando: a espera conta da 1ª mensagem dele depois da última resposta da equipe', () => {
  const {facts, responses} = waFacts([
    msg('in', t('10:00'), 'quero saber mais'),
    msg('agent', t('10:03'), 'Fala! Me manda o link'),
    msg('bot', t('10:04'), 'mensagem automática'),
    msg('in', t('11:00'), 'aqui o link'),
    msg('in', t('11:01'), 'https://ifood...'),
  ]);
  assertEquals(facts.waitingSince, '2026-11-09T11:00:00-03:00');
  assertEquals(facts.lastSnippet, 'https://ifood...');
  assertEquals(facts.inCount, 3);
  assertEquals(facts.outCount, 1);
  assertEquals(responses.length, 1);
  assertEquals(responses[0].minutes, 3);
  assertEquals(responses[0].day, '2026-11-09');
});

Deno.test('respondido: sem espera, e a ordem de chegada não importa', () => {
  const {facts, responses} = waFacts([
    msg('agent', t('14:20'), 'Consigo terça às 10h ou 15h?'),
    msg('in', t('14:00'), 'pode ser'),
    msg('agent', t('09:00'), 'Oi, tudo bem?'),
  ]);
  assertEquals(facts.waitingSince, null);
  assertEquals(facts.firstOutAt, '2026-11-09T09:00:00-03:00');
  assertEquals(responses.map(r => r.minutes), [20]);
});

Deno.test('mensagem do lead fora do horário não entra no SLA, mas ainda conta como espera', () => {
  const {facts, responses} = waFacts([msg('in', t('22:00', '2026-11-08')), msg('agent', t('09:10'))]);
  assertEquals(responses, []);
  assertEquals(facts.waitingSince, null);
  const w = waFacts([msg('in', t('22:00', '2026-11-08'))]);
  assertEquals(w.facts.waitingSince, '2026-11-08T22:00:00-03:00');
});

Deno.test('resumo da mensagem: texto limpo, mídia vira rótulo, corta em 140', () => {
  assertEquals(waSnippet(msg('in', 1, '  bom\n dia  ')), 'bom dia');
  assertEquals(waSnippet(msg('in', 1, '', {msg_type: 'audio'})), '[áudio]');
  assertEquals(waSnippet(msg('in', 1, 'image', {msg_type: 'image'})), '[imagem]');
  assertEquals(waSnippet(msg('in', 1, 'x'.repeat(200))).length, 140);
});

Deno.test('o lead só é regravado quando o WhatsApp mudou', () => {
  const {facts} = waFacts([msg('in', t('10:00'), 'oi')]);
  const p = waLeadPatch({name: 'Pizzaria'}, facts);
  assert(p);
  assertEquals(p!.waitingSince, facts.waitingSince);
  assertEquals(p!.source, 'nicochat');
  assertEquals(waLeadPatch({wa: p}, facts), null);
  // Se a tela regravar o lead sem o campo, a próxima rodada escreve de novo.
  assert(waLeadPatch({wa: {}}, facts));
});

Deno.test('telefone repetido: vale o lead em andamento mais novo', () => {
  const idx = waLeadIndex([
    {col: 'leads', id: 'a', data: {phone: '31 99387-7523', stage: 'perdido', createdAt: '2026-11-08T10:00:00Z'}},
    {col: 'leads', id: 'b', data: {phone: '+5531993877523', stage: 'novo', createdAt: '2026-10-01T10:00:00Z'}},
    {col: 'leads', id: 'c', data: {phone: '3193877523', stage: 'qualificando', createdAt: '2026-11-01T10:00:00Z'}},
    {col: 'tasks', id: 'x', data: {phone: '3193877523'}},
    {col: 'leads', id: 'd', data: {phone: ''}},
  ]);
  assertEquals(idx.size, 1);
  assertEquals(idx.get('3193877523')!.id, 'c');
});

Deno.test('wa_stats: um documento por dia e número, no formato que a Central soma', () => {
  const docs = waStatsDocs([
    {day: '2026-11-09', business: '553193877523', minutes: 3},
    {day: '2026-11-09', business: '553193877523', minutes: 12.25},
    {day: '2026-11-10', business: '553193877523', minutes: 5},
    {day: 'ruim', business: '553193877523', minutes: 1},
  ]);
  assertEquals(docs, [
    {id: '2026-11-09_553193877523', data: {date: '2026-11-09', business: '553193877523', count: 2, totalMin: 15.3, under5: 1}},
    {id: '2026-11-10_553193877523', data: {date: '2026-11-10', business: '553193877523', count: 1, totalMin: 5, under5: 1}},
  ]);
});

Deno.test('horário do NicoChat vem em UTC', () => {
  assertEquals(new Date(nicoTime('2026-11-09 03:11:10')).toISOString(), '2026-11-09T03:11:10.000Z');
  assertEquals(nicoTime(''), 0);
});

Deno.test('horários gravados em Brasília', () => {
  assertEquals(brIso(Date.parse('2026-11-09T03:11:10Z')), '2026-11-09T00:11:10-03:00');
  assertEquals(Date.parse(brIso(Date.parse('2026-11-09T03:11:10Z'))), Date.parse('2026-11-09T03:11:10Z'));
});
