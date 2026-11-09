// Avisos nos grupos de WhatsApp (canal Operacional do NicoChat, número do Renan): funções puras, testadas em avisos.test.ts.
// As funções de telefone, trecho, horário e etapa são cópias das de funis-api/logic.ts, para esta função ser publicada sozinha.
// deno-lint-ignore-file no-explicit-any

export type WaMsg = {id?: number | string; mid?: string; type?: string; msg_type?: string; content?: unknown; ts?: number; username?: string};
export function normPhone(v: unknown){
  const d = String(v ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d.length >= 8 && d.length <= 15 ? d : '';
}
// Chave do telefone: DDD + os 8 últimos dígitos (ignora o 55 e o 9 a mais). A mesma da ponte do SDR (fn_wa_contacts.phone_key).
export function waPhoneKey(v: unknown){
  const m = /^55(\d\d)\d*?(\d{8})$/.exec(normPhone(v));
  return m ? m[1] + m[2] : '';
}
const WA_KIND: Record<string, string> = {image: '[imagem]', audio: '[áudio]', voice: '[áudio]', ptt: '[áudio]', video: '[vídeo]', file: '[arquivo]', document: '[arquivo]', sticker: '[figurinha]', location: '[localização]', contact: '[contato]'};
export function waSnippet(m: WaMsg){
  const t = typeof m.content === 'string' ? m.content.replace(/\s+/g, ' ').trim() : '';
  const kind = WA_KIND[String(m.msg_type || '')] || '';
  const s = t && kind && t === String(m.msg_type) ? kind : t || kind;
  return s.length > 140 ? s.slice(0, 139) + '…' : s;
}
// Horário de Brasília (UTC-3, sem horário de verão) no formato ISO: "2026-11-09T11:00:00-03:00".
export const brIso = (ms: number) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 19) + '-03:00';
// "2026-11-09 03:11:10" do NicoChat (UTC) → milissegundos.
export const nicoTime = (v: unknown) => { const t = Date.parse(String(v ?? '').trim().replace(' ', 'T') + 'Z'); return isNaN(t) ? 0 : t };
const STAGES: [string, RegExp][] = [['novo', /^(novo|lead novo)$/], ['link', /^(link|link recebido)$/], ['print', /^(print|print enviado)$/], ['qualificando', /^qualificando$/], ['agendando', /^agendando$/],
  ['marcada', /^(marcada|reuniao marcada)$/], ['feita', /^(feita|reuniao feita|reuniao realizada)$/], ['fechado', /^(fechado|ganho|venda|vendido)$/],
  ['noshow', /^(noshow|no-show|no show)$/], ['perdido', /^perdido$/], ['desqualificado', /^desqualificado$/], ['frio', /^frio$/], ['morno', /^morno$/]];
export function stageId(v: unknown){
  const t = String(v ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  return (STAGES.find(([, re]) => re.test(t)) || [''])[0];
}
// Leads da Central por chave de telefone; com o mesmo telefone em mais de um, vale o que está em andamento e, entre eles, o mais novo.
const CLOSED = new Set(['fechado', 'perdido', 'desqualificado']);
export function leadIndex(docs: any){
  const idx = new Map<string, {id: string; data: any}>();
  const rank = (d: any) => [CLOSED.has(stageId(d.stage)) ? 0 : 1, String(d.createdAt || '')];
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || d.col !== 'leads' || d.deleted || !d.data || typeof d.data !== 'object') continue;
    const k = waPhoneKey(d.data.phone); if (!k) continue;
    const cur = idx.get(k), a = rank(d.data), b = cur && rank(cur.data);
    if (!b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) idx.set(k, {id: String(d.id), data: d.data});
  }
  return idx;
}

/* ================= Avisos ================= */
// Dois grupos internos recebem avisos automáticos, 24 h por dia, 7 dias por semana:
// - AVISOS - COMERCIAIS: horário sugerido na conversa do SDR (pelo SDR ou pelo lead) e reunião marcada ou remarcada na Central;
// - AVISOS - OPERACIONAIS: grupos dos clientes ("BRASE - " e "DI "): sem resposta da Brase, sinal de risco e silêncio longo.
// Cada aviso tem um id (a chave do evento), então nada sai duas vezes. Funções puras aqui; a leitura e o envio, em index.ts.
const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const AV_WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const AV_STAGE: Record<string, string> = {novo: 'Lead Novo', link: 'Link recebido', print: 'Print Enviado', qualificando: 'Qualificando', agendando: 'Agendando',
  marcada: 'Reunião Marcada', feita: 'Reunião Feita', fechado: 'Fechado', noshow: 'No-show', perdido: 'Perdido', desqualificado: 'Desqualificado', frio: 'Frio', morno: 'Morno'};
const avQuote = (t: string, max = 160) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return '“' + (s.length > max ? s.slice(0, max - 1) + '…' : s) + '”' };

// Horário concreto numa mensagem: "amanhã às 10h", "quinta 14h30", "pode ser 16:00?". Precisa de um dia ou de uma palavra de
// agenda junto; duração ("em 24h", "dura 1h") não conta (só 7h a 22h no formato "10h").
const AV_TIME = [/(?:^|[^\d:])([01]?\d|2[0-3]):[0-5]\d(?![\d:])/, /(?:^|[^\d])(0?[7-9]|1\d|2[0-2]) ?h(?:rs?|s)?(?: ?[0-5]\d)?(?![a-z\d])/, /(?:^|\s)[àa]s (0?[7-9]|1\d|2[0-2])(?![\d%])(?! ?(?:reais|dias|lojas|vezes|pessoas|pedidos|unidades))/];
const AV_DAY = /(?:^|[^a-z])(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|\d{1,2}\/\d{1,2})(?![a-z])/;
const AV_CTX = /(?:^|[^a-z])(horarios?|reuniao|call|agenda|marca[rm]?|marcamos|pode ser|posso|consegue|consigo|fica melhor|fica bom|disponivel|tenho|livre|confirmad[ao])(?![a-z])/;
export function avHasTime(text: unknown){
  const t = fold(text);
  return AV_TIME.some(r => r.test(t)) && (AV_DAY.test(t) || AV_CTX.test(t));
}
// Mensagens com horário numa conversa do SDR (as 5 mais recentes): quem sugeriu, quem da equipe mandou e o trecho.
export type AvTime = {mid: string; ts: number; who: 'sdr' | 'lead'; agent: string; text: string};
export function avTimeOffers(list: (WaMsg & {username?: string})[], max = 5): AvTime[] {
  return (Array.isArray(list) ? list : []).filter(m => m && typeof m.ts === 'number' && (m.type === 'in' || m.type === 'agent') && typeof m.content === 'string' && avHasTime(m.content))
    .sort((a, b) => (a.ts as number) - (b.ts as number)).slice(-max)
    .map(m => ({mid: String(m.mid || m.id || m.ts), ts: m.ts as number, who: m.type === 'agent' ? 'sdr' : 'lead', agent: m.type === 'agent' ? String(m.username || '') : '', text: waSnippet(m)}));
}
export function avHorarioText(t: AvTime, lead: any, contactName: string){
  const who = lead ? `${lead.name || 'Lead sem nome'}${lead.company ? ' · ' + lead.company : ''}${AV_STAGE[stageId(lead.stage)] ? ' (' + AV_STAGE[stageId(lead.stage)] + ')' : ''}`
    : `${contactName || 'Lead'} (sem card na Central)`;
  // Sem o nome de quem mandou: no NicoChat o SDR e o Renan usam a mesma conta, então tudo chega como "Renan".
  return `${t.who === 'sdr' ? '🕐 *SDR sugeriu horário*' : '🙋 *Lead sugeriu horário*'}\n${who}\n${avQuote(t.text)}`;
}

// Reunião marcada na Central: etapa "marcada" com bookedAt depois de os avisos ligarem. Um aviso por marcação; se o horário
// muda depois, sai "remarcada" (ou o horário, se a 1ª saiu sem ele). Sem horário preenchido, espera 10 min antes de avisar.
// Ids: "reuniao:<lead>:<bookedAt>|<meetingAt>". sent = ids que já existem para esse lead e essa marcação.
export function avMeetingDue(id: string, l: any, sent: string[], sinceMs: number, nowMs: number): {key: string; kind: 'nova' | 'remarcada' | 'horario'} | null {
  if (!l || stageId(l.stage) !== 'marcada' || !l.bookedAt) return null;
  const booked = Date.parse(String(l.bookedAt));
  if (isNaN(booked) || booked < sinceMs) return null;
  const base = `reuniao:${id}:${l.bookedAt}|`, meet = String(l.meetingAt || ''), key = base + meet;
  const mine = sent.filter(k => k.startsWith(base));
  if (mine.includes(key)) return null;
  if (!mine.length) return meet || nowMs - booked >= 10 * 60e3 ? {key, kind: 'nova'} : null;
  if (!meet) return null;
  return {key, kind: mine.some(k => k !== base) ? 'remarcada' : 'horario'};
}
// "2026-11-13T15:00" (hora de Brasília, como a Central grava) ou ISO com fuso → "sex 13/11 às 15:00".
export function avWhen(v: unknown){
  let s = String(v || '');
  if (/(?:z|[+-]\d\d:?\d\d)$/i.test(s)) { const ms = Date.parse(s); if (isNaN(ms)) return ''; s = brIso(ms) }
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s);
  if (!m) return '';
  return `${AV_WEEK[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]} ${m[3]}/${m[2]} às ${m[4]}:${m[5]}`;
}
export function avReuniaoText(l: any, kind: 'nova' | 'remarcada' | 'horario', sellers: Record<string, string>){
  const title = kind === 'remarcada' ? '🔁 *Reunião remarcada*' : kind === 'horario' ? '🗓 *Horário da reunião definido*' : '📅 *Reunião marcada*';
  const when = avWhen(l.meetingAt), owner = String((sellers || {})[l.ownerId] || '').split(' ')[0];
  return `${title}\n${l.name || 'Lead sem nome'}${l.company ? ' · ' + l.company : ''}\n${when || 'horário ainda não preenchido na Central'}${owner ? ' · SDR: ' + owner : ''}`;
}

// Grupos dos clientes: no NicoChat o nome chega como "G: BRASE - Loja" ou "G: D.I - Loja" (também "DI Loja"). Os grupos de
// aviso ficam de fora.
export const avClientGroup = (name: unknown) => /^g:\s*(brase\s*-|d\.?\s?i\.?(\s|-))/i.test(String(name || '').trim()) && !/avisos/i.test(String(name || ''));
export const avGroupLabel = (name: unknown) => String(name || '').replace(/^\s*g:\s*/i, '').trim();
// Mensagem de grupo do canal Operacional → quem escreveu e o texto. type "agent" = o número do Renan (é da Brase);
// "in" = outro participante, com o nome na 1ª linha ("👤 Nome:").
export type GrpMsg = {mid: string; ts: number; own: boolean; author: string; text: string; kind: string};
export function grpMsg(m: WaMsg): GrpMsg | null {
  if (!m || typeof m.ts !== 'number' || (m.type !== 'in' && m.type !== 'agent')) return null;
  const raw = typeof m.content === 'string' ? m.content : '';
  const hit = /^\s*👤\s*([^\n:]{1,60}):[ \t]*\n?/u.exec(raw);
  const body = hit ? raw.slice(hit[0].length) : raw;
  return {mid: String(m.mid || m.id || m.ts), ts: m.ts, own: m.type === 'agent', author: hit ? hit[1].trim() : m.type === 'agent' ? 'Renan' : '', text: waSnippet({...m, content: body}), kind: String(m.msg_type || 'text')};
}
// Mensagem que não pede resposta: "ok", "obrigado", "bom dia", só emoji, figurinha, reação.
const AV_ACK = /^(ok|okay|okk+|blz|beleza|obrigad[oa]s?|obg|brigad[oa]|valeu|vlw|show|top|perfeito|certo|combinado|tranquilo|fechado|otimo|massa|boa|bom dia|boa tarde|boa noite|amem|sim|isso|entendi|joia|ta bom|ta otimo|tudo bem|tudo certo|maravilha|kk+|(ha)+|rs+)(?![a-z])/;
export function avIsAck(m: GrpMsg){
  if (['sticker', 'reaction'].includes(m.kind)) return true;
  if (m.text.includes('?')) return false;
  const t = fold(m.text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return !t || (t.length <= 30 && AV_ACK.test(t));
}
// Sinal de risco na mensagem do cliente. "Cancelar o pedido" é rotina de restaurante e não conta.
const AV_RISK = /(cancelar|cancelamento|cancelo|encerrar|rescindir|rescisao|distrato|nao (esta|ta|tem|tao|estao) (dando|tendo|trazendo) (resultado|retorno)|sem resultado|nao vi resultado|nenhum resultado|insatisfeit|decepcionad|quero parar|vou parar|pensando em (parar|sair|cancelar)|nao vale a pena|muito caro|caro demais|ta caro|esta caro|vendas? (cairam|caiu|caindo|despencou|despencaram|piorou|piorando)|caiu muito)/;
const AV_ROUTINE = /(pedido|entrega|cupom|promocao|motoboy|item|produto|complemento)/;
export function avIsRisk(text: unknown){
  const t = fold(text), hit = AV_RISK.exec(t);
  return !!hit && !(/cancel|encerrar/.test(hit[0]) && AV_ROUTINE.test(t));
}
// Nomes da lista (equipe ou ignorados) casam pelo começo: "Luiz Felipe" vale para "Luiz Felipe Souza".
export function avNameIn(author: string, names: string[]){
  const a = fold(author).trim();
  return !!a && (names || []).some(n => { const b = fold(n).trim(); return !!b && (a === b || a.startsWith(b + ' ')) });
}
// Estado de um grupo pelas mensagens guardadas: última mensagem da Brase, a 1ª do cliente ainda sem resposta (que pede
// resposta) e as mensagens com sinal de risco. Brase = número do Renan, equipe (lista ou quem fala em 4+ grupos) ou nome com "Brase".
// Áudio e imagem chegam sem o nome de quem mandou: valem como do autor da mensagem anterior (de outro participante, até 15 min
// antes); sem isso, não contam para nada (nem abrem nem fecham uma espera).
export function avGroupState(msgs: GrpMsg[], team: string[], ignore: string[] = []){
  let lastBrase: number | null = null, waiting: GrpMsg | null = null, prev: GrpMsg | null = null;
  const risks: GrpMsg[] = [];
  for (const m0 of [...(msgs || [])].sort((a, b) => a.ts - b.ts)) {
    let m = m0;
    if (!m.own && !m.author) {
      if (!prev || prev.own || !prev.author || m.ts - prev.ts > 900) continue;
      m = {...m, author: prev.author};
    }
    prev = m;
    if (!m.own && avNameIn(m.author, ignore)) continue;
    if (m.own || avNameIn(m.author, team) || /brase/i.test(m.author)) { lastBrase = m.ts; waiting = null; continue }
    if (avIsRisk(m.text)) risks.push(m);
    if (!waiting && !avIsAck(m)) waiting = m;
  }
  return {lastBrase, waiting, risks};
}
export const avDur = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60e3)), h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? String(r).padStart(2, '0') : ''}` : `${r} min` };
export const avSemRespostaText = (group: string, w: GrpMsg, ms: number) => `⏰ *Sem resposta há ${avDur(ms)}*\n${group}\n${w.author || 'Cliente'}: ${avQuote(w.text)}`;
export const avRiscoText = (group: string, m: GrpMsg) => `🚨 *Atenção: possível risco*\n${group}\n${m.author || 'Cliente'}: ${avQuote(m.text, 220)}`;
export const avSilencioText = (group: string, days: number) => `😶 *${days} dias sem mensagem da Brase*\n${group}`;
