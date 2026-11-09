// Avisos nos grupos de WhatsApp (canal Operacional do NicoChat, número do Renan): funções puras, testadas em avisos.test.ts.
// As funções de telefone, trecho, horário e etapa são cópias das de funis-api/logic.ts, para esta função ser publicada sozinha.
// deno-lint-ignore-file no-explicit-any

export type WaMsg = {id?: number | string; mid?: string; type?: string; msg_type?: string; content?: unknown; ts?: number; username?: string; payload?: {url?: unknown} | null};
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
export type GrpMsg = {mid: string; ts: number; own: boolean; author: string; text: string; kind: string; meet?: string};
// Link do Meet (meet.google.com/abc-defg-hij): o código fica na mensagem, lido do texto inteiro (o trecho é cortado em 140).
const AV_MEET = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
export function grpMsg(m: WaMsg): GrpMsg | null {
  if (!m || typeof m.ts !== 'number' || (m.type !== 'in' && m.type !== 'agent')) return null;
  const raw = typeof m.content === 'string' ? m.content : '';
  const hit = /^\s*👤\s*([^\n:]{1,60}):[ \t]*\n?/u.exec(raw);
  const body = hit ? raw.slice(hit[0].length) : raw, meet = AV_MEET.exec(body);
  const g: GrpMsg = {mid: String(m.mid || m.id || m.ts), ts: m.ts, own: m.type === 'agent', author: hit ? hit[1].trim() : m.type === 'agent' ? 'Renan' : '', text: waSnippet({...m, content: body}), kind: String(m.msg_type || 'text')};
  if (meet) g.meet = meet[1].toLowerCase();
  return g;
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
      if (!prev || prev.own || !prev.author || m.ts - prev.ts > 900) {
        // Áudio transcrito sem autor: não abre espera (pode ser da equipe), mas sinal de risco no que foi dito aparece.
        if (avIsAudio(m) && avIsRisk(m.text)) risks.push({...m, author: AV_AUDIO_SEM_AUTOR});
        continue;
      }
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
// Áudio do grupo: a funis-avisos baixa o arquivo (payload.url), transcreve (Whisper) e guarda em fn_audios; o texto entra no
// lugar de "[áudio]" com 🎤 na frente, e vale para os avisos (risco, espera) e para os pedidos de alteração (OPS). O WhatsApp
// não diz quem mandou o áudio: depois de transcrito, cada um é classificado como do cliente ou da equipe (quem); áudio da
// equipe (Luis, Gabriel, Felipe, Luiz Felipe) é ignorado e só conta como "a Brase respondeu".
const AV_AUDIO_KINDS = ['audio', 'voice', 'ptt'];
export const AV_AUDIO_SEM_AUTOR = 'Autor não identificado (áudio)';
export const AV_AUDIO_EQUIPE = 'Equipe Brase (áudio)';
export const AV_AUDIO_CLIENTE = 'Cliente (áudio)';
export const avIsAudio = (m: GrpMsg) => AV_AUDIO_KINDS.includes(m.kind);
// Áudio de outro participante (o do Renan não precisa) com link https para baixar.
export function avAudioUrl(m: WaMsg){
  if (!m || m.type !== 'in' || !AV_AUDIO_KINDS.includes(String(m.msg_type || ''))) return '';
  const u = m.payload && m.payload.url;
  return typeof u === 'string' && /^https:\/\/\S+$/i.test(u) ? u : '';
}
export const avAudioTexto = (t: unknown) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return '🎤 ' + (s ? (s.length > 600 ? s.slice(0, 599) + '…' : s) : '(áudio sem fala)') };
export type AvAudio = {texto: string; quem?: string | null};
// Põe a transcrição no lugar de "[áudio]" (mapa mid → {texto, quem}). Equipe: vira mensagem da Brase, sem o conteúdo.
// Cliente: o nome é o da mensagem anterior de alguém do cliente (até 15 min antes), senão "Cliente (áudio)". Sem
// classificação ainda: fica sem autor (só conta para o sinal de risco).
export function avComAudios(msgs: GrpMsg[], audios: Map<string, AvAudio>, team: string[] = []){
  const sorted = [...(msgs || [])].sort((a, b) => a.ts - b.ts);
  return sorted.map((m, i) => {
    const a = avIsAudio(m) ? audios.get(m.mid) : undefined;
    if (!a) return m;
    if (a.quem === 'equipe') return {...m, author: AV_AUDIO_EQUIPE, text: '🎤 (áudio da equipe)'};
    const text = avAudioTexto(a.texto);
    if (a.quem !== 'cliente') return {...m, text};
    let nome = '';
    for (let j = i - 1; j >= 0; j--) {
      const p = sorted[j];
      if (m.ts - p.ts > 900) break;
      if (p.own || !p.author || avNameIn(p.author, team) || /brase/i.test(p.author)) continue;
      nome = p.author; break;
    }
    return {...m, author: nome || AV_AUDIO_CLIENTE, text};
  });
}
// Quem falou o áudio, pela regra fixa (reserva para quando a IA do Groq não responde): cumprimentar alguém pelo nome no
// começo ("Boa tarde, Lindomar" = a equipe falando com o cliente; "Oi Felipe" = o cliente falando com a equipe) e o jeito de
// falar ("seu cardápio", "a gente fez", "a recomendação" = equipe; "meu cardápio", "vocês", "pode tirar" = cliente).
const AV_EQUIPE_FALA = /(seu cardapio|sua loja|seu funil|seus produtos|seu ifood|a gente fez|fizemos|te mandei|ajustes que a gente|a recomendacao|eu recomendo|recomendaria|conversao|campanha)/g;
const AV_CLIENTE_FALA = /(meu cardapio|minha loja|meus produtos|meu ifood|voces|pode (tirar|pausar|ativar|colocar|mudar|subir|baixar)|acabou|nao tem mais|nao temos mais)/g;
export function avQuemPeloTexto(texto: unknown, team: string[], clientes: string[]): 'equipe' | 'cliente' | null {
  const t = fold(texto).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ini = t.slice(0, 50).replace(/ /g, '');
  const saudou = (nomes: string[]) => nomes.some(n => {
    const p = fold(n).replace(/[^a-z ]+/g, ' ').trim().split(' ')[0] || '';
    return p.length >= 3 && new RegExp('^((oi|ola|opa|fala|eai|bomdia|boatarde|boanoite|tudobem)+)?' + p).test(ini);
  });
  if (saudou(clientes)) return 'equipe';
  if (saudou(team)) return 'cliente';
  const eq = (t.match(AV_EQUIPE_FALA) || []).length, cl = (t.match(AV_CLIENTE_FALA) || []).length;
  if (eq >= 2 && eq > cl) return 'equipe';
  if (cl >= 1 && cl > eq) return 'cliente';
  return null;
}
// Autor de cada mensagem pela mesma regra do avGroupState: sem nome (áudio, imagem) = o da mensagem anterior de outro
// participante, se de até 15 min antes; senão fica de fora do mapa (não identificado).
export function avAutores(msgs: GrpMsg[]){
  const out = new Map<string, string>();
  let prev: GrpMsg | null = null;
  for (const m0 of [...(msgs || [])].sort((a, b) => a.ts - b.ts)) {
    let m = m0;
    if (!m.own && !m.author) {
      if (!prev || prev.own || !prev.author || m.ts - prev.ts > 900) continue;
      m = {...m, author: prev.author};
    }
    prev = m;
    out.set(m.mid, m.author);
  }
  return out;
}
export const avDur = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60e3)), h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? String(r).padStart(2, '0') : ''}` : `${r} min` };
export const avSemRespostaText = (group: string, w: GrpMsg, ms: number) => `⏰ *Sem resposta há ${avDur(ms)}*\n${group}\n${w.author || 'Cliente'}: ${avQuote(w.text)}`;
export const avRiscoText = (group: string, m: GrpMsg) => `🚨 *Atenção: possível risco*\n${group}\n${m.author || 'Cliente'}: ${avQuote(m.text, 220)}`;
export const avSilencioText = (group: string, days: number) => `😶 *${days} dias sem mensagem da Brase*\n${group}`;

// Reunião com o cliente: cada link do Meet num grupo de cliente vira uma reunião "provável" no dia do link (Brasília); a rotina
// de IA confirma (realizada / não realizada) pelo contexto e pelas Anotações do Gemini, e corrige o dia. Id = grupo:código:dia.
export const brDate = (ms: number) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);
export function avMeetings(groupNs: string, groupName: string, msgs: GrpMsg[]){
  const seen = new Set<string>(), out: {id: string; group_ns: string; grupo: string; dia: string; link_at: Date; meet: string; autor: string}[] = [];
  for (const m of [...(msgs || [])].sort((a, b) => a.ts - b.ts)) {
    if (!m.meet) continue;
    const dia = brDate(m.ts * 1000), id = `${groupNs}:${m.meet}:${dia}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({id, group_ns: groupNs, grupo: groupName, dia, link_at: new Date(m.ts * 1000), meet: m.meet, autor: m.own ? 'Renan' : m.author || ''});
  }
  return out;
}
// Aviso de 30 dias: a última reunião do grupo (provável ou realizada) fez N dias. Sai às 9h (Brasília) do 30º dia, um por reunião.
export function avReuniao30Due(lastDia: string, nowMs: number, days = 30){
  const t = Date.parse(lastDia + 'T09:00:00-03:00');
  return !isNaN(t) && nowMs - t >= days * 864e5;
}
export const avReuniao30Text = (group: string, dia: string, status: string, days: number) =>
  `📆 *${days} dias desde a última reunião*\n${group}\nÚltima: ${dia.slice(8, 10)}/${dia.slice(5, 7)} (${status === 'realizada' ? 'confirmada' : 'link do Meet no grupo'}). Hora de marcar a próxima.`;

// Horário que o Renan sugere (em grupo ou no privado): os horários da mensagem como data e hora (Brasília), para avisar o
// comercial e bloquear a agenda da Central. Dia: "hoje", "amanhã", "depois de amanhã", dia da semana (o próximo; o mesmo dia
// da semana = semana que vem), "12/11" ou "dia 12"; sem dia, hoje se o horário ainda não passou, senão amanhã. Vários horários
// viram vários ("10h ou 15h"). Só horários futuros e até 30 dias.
const AV_WD: Record<string, number> = {domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6};
const AV_TIME_G = [/(?:^|[^\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g, /(?:^|[^\d])(0?[7-9]|1\d|2[0-2]) ?h(?:rs?|s)?(?: ?([0-5]\d))?(?![a-z\d])/g,
  /(?:^|\s)as (0?[7-9]|1\d|2[0-2])(?![\d%:h])(?! ?(?:reais|dias|lojas|vezes|pessoas|pedidos|unidades))/g];
export function avParseSlots(text: unknown, msgMs: number): number[] {
  const t = fold(text);
  if (!avHasTime(t)) return [];
  const b = new Date(msgMs - 3 * 3600e3), y = b.getUTCFullYear(), mo = b.getUTCMonth(), d = b.getUTCDate(), nowMin = b.getUTCHours() * 60 + b.getUTCMinutes();
  let off: number | null = null, date: [number, number, number] | null = null, m: RegExpExecArray | null;
  if (/depois de amanha/.test(t)) off = 2;
  else if (/(?:^|[^a-z])amanha(?![a-z])/.test(t)) off = 1;
  else if (/(?:^|[^a-z])hoje(?![a-z])/.test(t)) off = 0;
  else if ((m = /(?:^|[^\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/.exec(t)) && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
    const yy = Date.UTC(y, +m[2] - 1, +m[1]) < Date.UTC(y, mo, d) - 30 * 864e5 ? y + 1 : y;
    date = [yy, +m[2] - 1, +m[1]];
  } else if ((m = /(?:^|[^a-z])(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?![a-z])/.exec(t))) off = (AV_WD[m[1]] - b.getUTCDay() + 7) % 7 || 7;
  else if ((m = /(?:^|[^a-z])dia (\d{1,2})(?![\d/])/.exec(t)) && +m[1] >= 1 && +m[1] <= 31) date = +m[1] >= d ? [y, mo, +m[1]] : [y, mo + 1, +m[1]];
  const mins = new Set<number>();
  for (const r of AV_TIME_G) for (const x of t.matchAll(r)) mins.add(+x[1] * 60 + (x[2] ? +x[2] : 0));
  const out = new Set<number>();
  for (const mi of mins) {
    const at = date ? Date.UTC(date[0], date[1], date[2], 0, mi) : Date.UTC(y, mo, d + (off ?? (mi > nowMin ? 0 : 1)), 0, mi);
    const ms = at + 3 * 3600e3;
    if (ms > msgMs && ms < msgMs + 30 * 864e5) out.add(ms);
  }
  return [...out].sort((a, c) => a - c).slice(0, 4);
}
// Prioridade na agenda: só conta horário combinado com cliente ou com lead. Compromisso pessoal (amigo, família) e o grupo de
// anotações do Renan não contam: reunião tem prioridade. Grupo "D.I - " é a 1ª reunião do cliente, e o Renan fica só 5 a 10 min:
// não fecha o horário, só avisa e bloqueia 10 min (dá para marcar logo antes ou depois).
export type AvAgendaKind = 'di' | 'cliente' | 'lead';
// Só "D.I" com ponto: "Di Blasi" (rede de clientes) também começa com DI e não é 1ª reunião.
export const avIsDi = (name: unknown) => /^(g:\s*)?d\.\s?i(?![a-z])/i.test(String(name || '').trim());
// Conversa no privado com quem escreve num grupo de cliente: é cliente daquele grupo (o nome do contato é o mesmo do "👤 Nome:").
export function avClientOf(contactName: unknown, groups: {nome: string; authors: string[]}[]){
  const n = fold(contactName).trim();
  if (n.length < 3) return null;
  for (const g of groups || []) if ((g.authors || []).some(a => { const x = fold(a).trim(); return x === n || (x.length >= 3 && (x.startsWith(n + ' ') || n.startsWith(x + ' '))) })) return g.nome;
  return null;
}
export const AV_DI_MIN = 10;
export function avAgendaText(where: string, kind: AvAgendaKind, slots: number[], snippet: string, blocked: boolean){
  const when = slots.map(s => avWhen(brIso(s))).join(' ou '), quote = snippet ? '\n' + avQuote(snippet) : '';
  if (kind === 'di') {
    const near = slots.length === 1 ? ` (${avWhen(brIso(slots[0] - 30 * 60e3)).slice(-5)} ou ${avWhen(brIso(slots[0] + 30 * 60e3)).slice(-5)}, por exemplo)` : '';
    return `🗓 *Renan: reunião rápida (5 a 10 min)*\n${where}\n${when}${quote}\nNão fecha o horário: dá para marcar outra reunião logo antes ou depois${near}.`;
  }
  return `🗓 *Renan sugeriu horário*\n${where}\n${when}${quote}\n${blocked ? 'Bloqueado na agenda da Central: não ofereça esse horário.' : 'Não ofereça esse horário (não deu para bloquear na agenda da Central).'}`;
}
// Bloqueio na agenda da Central (coleção holds, sem lead): id e início no formato da tela ("r202611101500", "2026-11-10T15:00").
export const avHoldId = (ms: number) => 'r' + brIso(ms).slice(0, 16).replace(/\D/g, '');
export const avHoldStart = (ms: number) => brIso(ms).slice(0, 16);

// Pedido de alteração no iFood no grupo do cliente ("acabou o X", "pausa a loja amanhã", "o X agora é 32,90"): filtro barato
// antes de mandar a mensagem para a função whatsapp-pedidos do OPS, que lê com IA contra o cardápio real e aplica sozinha.
const AV_PEDIDO = /(paus[ae]|pausar|tira(r)? (o|a|os|as|do|da|esse|essa)\b|desativ|deslig|acabou|acabaram|esgot|sem estoque|nao tem mais|nao temos mais|faltou|volt(a|ou|ar) (o|a|os|as|com)\b|reativ|ativa(r)? (o|a|os|as)\b|liber(a|ar) (o|a|os|as)\b|preco|valor d|fecha(r)? a loja|fechar hoje|nao (vamos|vai|vou) abrir|abrir mais tarde|feriado)/;
export const avPedidoCandidato = (text: unknown) => AV_PEDIDO.test(fold(text));
export type AvPedidoResp = {status?: string; cliente?: string; gestor?: string | null; resumo?: string; feitos?: string[]; nao_feitos?: {pedido: string; motivo: string}[]; duvida?: string | null; erro?: string; simulado?: boolean};
// Aviso no AVISOS - OPERACIONAIS com o que o OPS fez (ou não), marcando o gestor do cliente para revisar.
export function avPedidoText(grupo: string, autor: string, texto: string, r: AvPedidoResp){
  const quem = r.gestor ? '@' + r.gestor : 'Gestor', feitos = r.feitos || [], nao = r.nao_feitos || [];
  const head = r.status === 'sem_cliente' ? '🛠 *Pedido de alteração (cliente não está no OPS)*'
    : feitos.length ? (r.simulado ? '🧪 *Alteração no iFood (simulação, nada foi gravado)*' : '🛠 *Alteração feita no iFood*') : '🛠 *Pedido de alteração NÃO aplicado*';
  const linhas = [head, grupo, `${autor || 'Cliente'}: ${avQuote(texto, 220)}`, ...feitos.map(f => '✅ ' + f), ...nao.map(n => `⚠️ ${n.pedido}: ${n.motivo}`)];
  if (r.duvida) linhas.push('❓ ' + r.duvida);
  if (r.erro) linhas.push('⚠️ ' + r.erro);
  linhas.push(r.status === 'sem_cliente' ? 'Faça à mão: o grupo não bate com nenhum cliente do OPS.'
    : feitos.length && !r.simulado ? `${quem}, revise no OPS (Cardápio iFood › histórico do item).` : `${quem}, resolva com o cliente.`);
  return linhas.join('\n');
}
export const avAgendadoText = (e: {ok?: boolean; cliente?: string; gestor?: string | null; texto?: string}) =>
  `⏱ *Alteração com hora marcada*\n${e.cliente || 'Cliente'}\n${e.ok ? '✅' : '⚠️'} ${e.texto || ''}\n${e.gestor ? '@' + e.gestor : 'Gestor'}, revise no OPS.`;
