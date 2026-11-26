// Avisos nos grupos de WhatsApp (canal Operacional do NicoChat, número do Renan): funções puras, testadas em avisos.test.ts.
// As funções de telefone, trecho, horário e etapa são cópias das de funis-api/logic.ts, para esta função ser publicada sozinha.
// deno-lint-ignore-file no-explicit-any

export type WaMsg = {id?: number | string; mid?: string; type?: string; msg_type?: string; content?: unknown; ts?: number; username?: string; payload?: {url?: unknown; reply_to_mid?: unknown} | null};
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
const avQuote = (t: string, max = 160) => { const s = String(t || '').replace(/@\d{6,}/g, '').replace(/\s+/g, ' ').trim(); return '“' + (s.length > max ? s.slice(0, max - 1) + '…' : s) + '”' };

// Horário concreto numa mensagem: "amanhã às 10h", "quinta 14h30", "pode ser 16:00?". Precisa de um dia ou de uma palavra de
// agenda junto; duração ("em 24h", "dura 1h") não conta (só 7h a 22h no formato "10h").
const AV_TIME = [/(?:^|[^\d:])([01]?\d|2[0-3]):[0-5]\d(?![\d:])/, /(?:^|[^\d])(0?[7-9]|1\d|2[0-2]) ?h(?:rs?|s)?(?: ?[0-5]\d)?(?![a-z\d])/, /(?:^|\s)[àa]s (0?[7-9]|1\d|2[0-2])(?![\d%])(?! ?(?:reais|dias|lojas|vezes|pessoas|pedidos|unidades))/];
const AV_DAY = /(?:^|[^a-z])(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|\d{1,2}\/\d{1,2})(?![a-z])/;
const AV_CTX = /(?:^|[^a-z])(horarios?|reuniao|call|agenda|marca[rm]?|marcamos|pode ser|posso|consegue|consigo|fica melhor|fica bom|disponivel|tenho|livre|confirmad[ao])(?![a-z])/;
export function avHasTime(text: unknown){
  const t = fold(text);
  return AV_TIME.some(r => r.test(t)) && (AV_DAY.test(t) || AV_CTX.test(t));
}
// Mensagens com horário numa conversa do SDR (as 5 mais recentes): quem sugeriu, os horários (data e hora, lidos da mensagem
// inteira) e o trecho. Mensagem com cara de horário mas sem um horário que dê para entender não entra.
export type AvTime = {mid: string; ts: number; who: 'sdr' | 'lead'; agent: string; text: string; slots: number[]};
export function avTimeOffers(list: (WaMsg & {username?: string})[], max = 5): AvTime[] {
  return (Array.isArray(list) ? list : []).filter(m => m && typeof m.ts === 'number' && (m.type === 'in' || m.type === 'agent') && typeof m.content === 'string' && avHasTime(m.content))
    .sort((a, b) => (a.ts as number) - (b.ts as number)).slice(-max)
    .map(m => ({mid: String(m.mid || m.id || m.ts), ts: m.ts as number, who: m.type === 'agent' ? 'sdr' as const : 'lead' as const, agent: m.type === 'agent' ? String(m.username || '') : '', text: waSnippet(m),
      slots: avParseSlots(String(m.content), (m.ts as number) * 1000)}))
    .filter(t => t.slots.length);
}
// Aviso do horário que o SDR sugeriu: só o lead e o dia e a hora (o trecho da mensagem cortava antes do horário).
export function avHorarioText(t: AvTime, lead: any, contactName: string, sdr = 'Lipe'){
  const who = lead ? `${lead.name || 'Lead sem nome'}${lead.company ? ' · ' + lead.company : ''}${AV_STAGE[stageId(lead.stage)] ? ' (' + AV_STAGE[stageId(lead.stage)] + ')' : ''}`
    : `${contactName || 'Lead'} (sem card na Central)`;
  // Sem o nome de quem mandou: no NicoChat o SDR e o Renan usam a mesma conta, então tudo chega como "Renan".
  return `${t.who === 'sdr' ? `🕐 *${sdr || 'SDR'} sugeriu horário*` : '🙋 *Lead sugeriu horário*'}\n${who}\n${t.slots.map(x => avWhen(brIso(x))).join(' ou ')}`;
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

// Grupos dos clientes: no NicoChat o nome chega como "G: BRASE - Loja", "G: D.I - Loja" (também "DI Loja") ou
// "G: Gestão IFood - Loja". Os grupos de aviso ficam de fora.
export const avClientGroup = (name: unknown) => /^g:\s*(brase\s*-|d\.?\s?i\.?(\s|-)|gest[aã]o\s+ifood\b)/i.test(String(name || '').trim()) && !/avisos/i.test(String(name || ''));
// Grupos que NUNCA aparecem nos avisos (decisão do dono, 17/11: o Texas Burguer). Vale para qualquer texto que cite o nome:
// o grupo não é lido para avisos e o envio barra qualquer aviso que fale dele. Mais nomes em fn_config avisos.gruposIgnorados.
export const AV_IGNORADOS = ['texas'];
export function avIgnorado(texto: unknown, extra: unknown = []){
  const t = fold(texto), lista = [...AV_IGNORADOS, ...(Array.isArray(extra) ? extra : [])].map(x => fold(x).trim()).filter(x => x.length >= 3);
  return lista.some(k => t.includes(k));
}
// Destino de cada grupo de cliente (decisão do dono, 19/11/2026):
// - 'fora': a assessoria de tráfego do Luis (fn_config avisos.assessoria; padrão Shinkai, Sky Poke, Santa Marta, Baila
//   Burguer, Amazon Sushi e Bella Capri) e os grupos de avisos.gruposIgnorados (Liz Café). Nem são lidos.
// - 'assistida': a oferta assistida, que o Renan atende sozinho. É a loja com serviço "reservado" no OPS (op "gestores"),
//   o Texas e o grupo "BRASE - " fora da assessoria cuja loja o OPS ainda não conhece (avisos.assistida = {prefixos:
//   ['brase'], nomes: ['texas']}). Loja que o OPS conhece e não é "reservado" nunca é assistida, mesmo com "BRASE - " (a
//   Marmita Moxuara é continuação do Intense, com o Felipe; decisão do dono, 19/11). Os avisos
//   vão só para o grupo Organização - BRASE, sem marcar ninguém, e o resumo entra no pacote da manhã. Gestores e heads não
//   veem nada da assistida.
// - 'avisos': o resto, no AVISOS - OPERACIONAIS com o gestor.
export const AV_ASSESSORIA = ['shinkai', 'sky poke', 'santa marta', 'baila burg', 'amazon sushi', 'bella capri'];
export type AvDestino = 'fora' | 'assistida' | 'avisos';
export type AvGruposCfg = {ignorados?: unknown; assessoria?: unknown; prefixos?: unknown; nomes?: unknown; lojas?: unknown};
const avChave = (s: unknown) => ' ' + fold(s).replace(/^\s*g:\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
const avLista = (v: unknown, padrao: string[]) => (Array.isArray(v) ? v : padrao).map(x => avChave(x).trim()).filter(x => x.length >= 3);
// Algum nome da lista aparece como começo de palavra ("baila burg" acha "Baila Burger" e "Baila Burguer").
const avTem = (texto: unknown, lista: string[]) => { const t = avChave(texto); return lista.some(k => t.includes(' ' + k)) };
// cfg vem de avGruposCfg(fn_config avisos, lojas da assistida no OPS). ops = o que o OPS disse da loja do grupo: true (é da
// assistida), false (achou a loja e ela não é da assistida) ou null (não achou a loja).
export function avDestino(nome: unknown, cfg: AvGruposCfg = {}, ops: boolean | null = null): AvDestino {
  if (avTem(nome, [...avLista(cfg.assessoria, AV_ASSESSORIA), ...avLista(cfg.ignorados, [])])) return 'fora';
  if (ops === true || avTem(nome, [...avLista(cfg.nomes, ['texas']), ...avLista(cfg.lojas, [])])) return 'assistida';
  if (ops === false) return 'avisos';
  const n = fold(nome).replace(/^\s*g:\s*/, '').trim();
  return avLista(cfg.prefixos, ['brase']).some(p => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*-').test(n)) ? 'assistida' : 'avisos';
}
export function avGruposCfg(avisos: any = {}, lojasAssistida: unknown = []): AvGruposCfg {
  const a = avisos && typeof avisos.assistida === 'object' ? avisos.assistida : {};
  return {ignorados: avisos?.gruposIgnorados, assessoria: avisos?.assessoria, prefixos: a.prefixos, nomes: a.nomes, lojas: lojasAssistida};
}
// Trava do envio (todo canal menos o do Renan): aviso que cita grupo ou loja que não é dos avisos (assessoria, ignorado ou
// assistida: pelo nome, pela lista do OPS ou por uma linha que começa com "BRASE - ") nunca sai. extras = grupos classificados
// como assistida nesta rodada; liberados = grupos "BRASE - " que o OPS diz que são dos avisos (a Marmita Moxuara).
export function avTextoFora(texto: unknown, cfg: AvGruposCfg = {}, extras: unknown = [], liberados: unknown = []){
  const t = String(texto || '');
  if (avIgnorado(t) || avTem(t, [...avLista(cfg.assessoria, AV_ASSESSORIA), ...avLista(cfg.ignorados, []), ...avLista(cfg.nomes, ['texas']), ...avLista(cfg.lojas, []), ...avLista(extras, [])])) return true;
  const ok = avLista(liberados, []);
  return t.split('\n').some(l => { const s = l.replace(/^\s*(•|[^\p{L}\p{N}]+)\s*/u, ''); return avDestino(s, {prefixos: cfg.prefixos, assessoria: cfg.assessoria}) !== 'avisos' && !avTem(s, ok) });
}
// Aviso da assistida: vai para o grupo do Renan, então a linha "👤 gestor, faça…" vira "👤 Assistida: faça…".
export function avParaAssistida(texto: string){
  return String(texto).split('\n').map(l => l.startsWith('👤') ? l.replace(/^👤[^:,]*[:,]\s*/u, '👤 Assistida: ') : l).join('\n');
}
export const avGroupLabel = (name: unknown) => String(name || '').replace(/^\s*g:\s*/i, '').trim();
// Mensagem de grupo do canal Operacional → quem escreveu e o texto. type "agent" = o número do Renan (é da Brase);
// "in" = outro participante, com o nome na 1ª linha ("👤 Nome:").
export type GrpMsg = {mid: string; ts: number; own: boolean; author: string; text: string; kind: string; meet?: string; reply?: string};
// Link do Meet (meet.google.com/abc-defg-hij): o código fica na mensagem, lido do texto inteiro (o trecho é cortado em 140).
const AV_MEET = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
export function grpMsg(m: WaMsg): GrpMsg | null {
  if (!m || typeof m.ts !== 'number' || (m.type !== 'in' && m.type !== 'agent')) return null;
  const raw = typeof m.content === 'string' ? m.content : '';
  const hit = /^\s*👤\s*([^\n:]{1,60}):[ \t]*\n?/u.exec(raw);
  const body = hit ? raw.slice(hit[0].length) : raw, meet = AV_MEET.exec(body);
  const g: GrpMsg = {mid: String(m.mid || m.id || m.ts), ts: m.ts, own: m.type === 'agent', author: hit ? hit[1].trim() : m.type === 'agent' ? 'Renan' : '', text: waSnippet({...m, content: body}), kind: String(m.msg_type || 'text')};
  if (meet) g.meet = meet[1].toLowerCase();
  // Resposta (citação) a outra mensagem: ajuda a saber de quem é o áudio sem nome (quem responde o cliente é a equipe).
  const reply = m.payload && typeof m.payload === 'object' ? m.payload.reply_to_mid : null;
  if (reply) g.reply = String(reply);
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
// Sinal de risco na mensagem do cliente (um filtro: a IA confirma antes do aviso sair). Cancelar, encerrar, parar e sair só
// contam falando do contrato ou do serviço, ou com "quero"/"vou"/"pensando em"; seguido de pedido, entrega, campanha ou
// promoção é rotina de restaurante. Caso real (Benditta, 16/11): "o iFood encerrou a campanha de 9,90" virava risco.
const AV_RISK = [
  /(?:^|[^a-z])(quero|vou|vamos ter que|pensando em|penso em|estou pensando em|to pensando em|melhor) (cancelar|encerrar|rescindir)(?![a-z])/,
  /(?:^|[^a-z])(quero|pensando em|penso em|estou pensando em|to pensando em) (parar|sair|dar um tempo|pausar)(?![a-z])/,
  /(?:^|[^a-z])(cancelar|cancelamento|encerrar|encerramento|rescindir|rescisao|distrato|sair)( d[aeo]s?| o| a| com| esse| essa| nosso| nossa)? (contrato|servico|parceria|assessoria|gestao|plano|mensalidade|trabalho|brase|voces)(?![a-z])/,
  /(?:^|[^a-z])(distrato|rescisao)(?![a-z])/,
  /nao (esta|ta|tem|tao|estao) (dando|tendo|trazendo) (resultado|retorno)|sem resultado|nao vi resultado|nenhum resultado|insatisfeit|decepcionad|nao vale a pena|muito caro|caro demais|(?:^|[^a-z])(ta|esta) caro|vendas? (cairam|caiu|caindo|despencou|despencaram|piorou|piorando)|caiu muito/,
];
const AV_ROUTINE = /^.{0,40}?(pedido|entrega|cupom|promocao|promo|campanha|anuncio|motoboy|item|produto|complemento|combo|cardapio|loja)/;
export function avIsRisk(text: unknown){
  const t = fold(text);
  return AV_RISK.some(r => { const hit = r.exec(t); return !!hit && !(/cancel|encerr|parar|sair|pausar/.test(hit[0]) && AV_ROUTINE.test(t.slice((hit.index || 0) + hit[0].length))) });
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
      // Áudio sem autor (incerto ou não transcrito) não conta para nada: áudio só vale quando se sabe que é do cliente
      // (decisão do dono, 17/11: "os áudios pra ler não pode ser de ninguém da nossa equipe").
      if (avIsAudio(m) || !prev || prev.own || !prev.author || m.ts - prev.ts > 900) continue;
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
// Quem mandou uma mensagem sem nome (áudio, imagem) pelo jeito do id: o WhatsApp gera o id de um jeito em cada tipo de
// aparelho (iPhone "3A…", WhatsApp Web "3EB0…", outros "2A…"). Se no grupo todas as mensagens com nome e o mesmo jeito de id
// são da equipe, é da equipe; se são todas de uma pessoa só do cliente, é ela. Misturado ou pouca amostra: não decide.
// Caso real (Point da Lolo, 14/11): os áudios do Felipe ("2A…") contavam como do cliente e a resposta dele não contava.
export const avMidChave = (mid: unknown) => { const m = String(mid || ''); return /^3EB0/i.test(m) ? '3EB0' : m.slice(0, 2).toUpperCase() + ':' + m.length };
// Quem mandou a mensagem sem nome, juntando os sinais (o primeiro que decide vale): o jeito do id; a citação (responder a
// mensagem do cliente = equipe; responder a mensagem da equipe = cliente); e o "sanduíche" (a equipe escreveu até 5 min antes
// e o cliente reagiu até 10 min depois = equipe, e o contrário = cliente). Caso real (Point da Lolo, 17/11): o Luis e o
// Patrick usam iPhone ("3A…"), o áudio do Luis respondia à foto do Patrick e foi lido como do cliente.
export function avQuemMandou(m: GrpMsg, msgs: GrpMsg[], team: string[] = [], chavesEquipe?: Set<string>): {quem: 'equipe' | 'cliente'; autor?: string; por: string} | null {
  const pm = avQuemPeloMid(m.mid, msgs, team, chavesEquipe);
  if (pm) return {...pm, por: 'tipo de id'};
  const sorted = [...(msgs || [])].sort((a, b) => a.ts - b.ts);
  const daEquipe = (x: GrpMsg) => x.own || avNameIn(x.author, team) || /brase/i.test(x.author) || x.author === AV_AUDIO_EQUIPE;
  const comNome = (x: GrpMsg) => x.own || (!!x.author && x.author !== AV_AUDIO_CLIENTE && x.author !== AV_AUDIO_SEM_AUTOR);
  const clientes = [...new Set(sorted.filter(x => comNome(x) && !daEquipe(x)).map(x => x.author))];
  const umCliente = clientes.length === 1 ? clientes[0] : undefined;
  // Autor de uma mensagem citada: o nome dela, ou (foto/áudio sem nome) o de quem escreveu até 1 min antes ou depois do MESMO
  // tipo de aparelho (jeito do id). Se esses vizinhos são dos dois lados (equipe e cliente), não decide. Caso real: a foto do
  // Patrick (iPhone) ficou com o Felipe (WhatsApp Web), que escreveu segundos antes.
  const autorDe = (x: GrpMsg | undefined): GrpMsg | null => {
    if (!x) return null;
    if (comNome(x)) return x;
    const k = avMidChave(x.mid);
    const viz = sorted.filter(y => y.mid !== x.mid && comNome(y) && Math.abs(y.ts - x.ts) <= 60 && avMidChave(y.mid) === k);
    if (!viz.length || (viz.some(daEquipe) && viz.some(y => !daEquipe(y)))) return null;
    return viz.sort((a, b) => Math.abs(a.ts - x.ts) - Math.abs(b.ts - x.ts))[0];
  };
  if (m.reply) {
    const citado = autorDe(sorted.find(x => x.mid === m.reply));
    if (citado) return daEquipe(citado) ? {quem: 'cliente', autor: umCliente, por: 'respondeu a equipe'} : clientes.length <= 1 ? {quem: 'equipe', por: 'respondeu o cliente'} : null;
  }
  const antes = [...sorted].reverse().find(x => x.ts < m.ts && comNome(x)), depois = sorted.find(x => x.ts > m.ts && comNome(x));
  if (antes && depois && m.ts - antes.ts <= 300 && depois.ts - m.ts <= 600) {
    if (daEquipe(antes) && !daEquipe(depois)) return {quem: 'equipe', por: 'equipe antes, cliente depois'};
    if (!daEquipe(antes) && daEquipe(depois) && antes.author === umCliente) return {quem: 'cliente', autor: umCliente, por: 'cliente antes, equipe depois'};
  }
  return null;
}
// Jeitos de id que alguém da equipe usa em QUALQUER grupo: com eles, o jeito do id nunca conclui "cliente" (o Luis usa iPhone
// como o Patrick; no Point da Lolo, as mensagens dele saíram da janela guardada e o áudio dele voltou como do cliente).
export function avChavesDaEquipe(listas: GrpMsg[][], team: string[] = []){
  const out = new Set<string>();
  for (const l of listas || []) for (const m of l || []) if (m && m.mid && (m.own || (m.author && (avNameIn(m.author, team) || /brase/i.test(m.author))))) out.add(avMidChave(m.mid));
  return out;
}
export function avQuemPeloMid(mid: unknown, msgs: GrpMsg[], team: string[] = [], chavesEquipe?: Set<string>): {quem: 'equipe' | 'cliente'; autor?: string} | null {
  const k = avMidChave(mid);
  const autores = (msgs || []).filter(m => m.mid !== String(mid) && avMidChave(m.mid) === k && (m.own || (m.author && m.author !== AV_AUDIO_EQUIPE && m.author !== AV_AUDIO_CLIENTE && m.author !== AV_AUDIO_SEM_AUTOR)))
    .map(m => m.own ? '' : m.author);
  if (autores.length < 2) return null;
  const daEquipe = (a: string) => !a || avNameIn(a, team) || /brase/i.test(a);
  if (autores.every(daEquipe)) return {quem: 'equipe'};
  const doCliente = [...new Set(autores.filter(a => !daEquipe(a)))];
  return autores.some(daEquipe) || doCliente.length !== 1 || (chavesEquipe && chavesEquipe.has(k)) ? null : {quem: 'cliente', autor: doCliente[0]};
}
// Põe a transcrição no lugar de "[áudio]" (mapa mid → {texto, quem}). Equipe: vira mensagem da Brase, sem o conteúdo.
// Cliente: o nome é o da mensagem anterior de alguém do cliente (até 15 min antes), senão "Cliente (áudio)". Sem
// classificação ainda: fica sem autor (só conta para o sinal de risco).
export function avComAudios(msgs: GrpMsg[], audios: Map<string, AvAudio>, team: string[] = [], chavesEquipe?: Set<string>){
  const sorted = [...(msgs || [])].sort((a, b) => a.ts - b.ts);
  return sorted.map((m, i) => {
    const a = avIsAudio(m) ? audios.get(m.mid) : undefined;
    // Sem nome: o jeito do id decide antes de tudo (vale também para áudio não transcrito e imagem).
    const pm = !m.own && !m.author ? avQuemMandou(m, sorted, team, chavesEquipe) : null;
    if (pm && pm.quem === 'equipe') return {...m, author: AV_AUDIO_EQUIPE, text: avIsAudio(m) ? '🎤 (áudio da equipe)' : m.text};
    if (pm && pm.quem === 'cliente') return {...m, author: pm.autor || AV_AUDIO_CLIENTE, text: a ? avAudioTexto(a.texto) : m.text};
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

// Horário comercial da Brase (Brasília), para a espera do cliente: só conta o tempo dentro dele. Padrão seg a sex, 9h às
// 19h (o mesmo expediente da Central); muda em fn_config avisos.op.expediente = {inicio: '09:00', fim: '19:00', dias: [1..5]}
// (0 = domingo). Feriado não entra na conta.
export type AvExpediente = {inicio: number; fim: number; dias: number[]};
export function avExpediente(v: any): AvExpediente {
  const tm = (s: unknown, d: number) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : d };
  const dias = Array.isArray(v?.dias) ? [...new Set(v.dias.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6))] as number[] : [];
  const inicio = tm(v?.inicio, 540), fim = tm(v?.fim, 1140);
  return fim > inicio ? {inicio, fim, dias: dias.length ? dias : [1, 2, 3, 4, 5]} : {inicio: 540, fim: 1140, dias: dias.length ? dias : [1, 2, 3, 4, 5]};
}
// Quanto do intervalo [deMs, ateMs] caiu dentro do horário comercial (ms). Olha no máximo 60 dias.
export function avMsUteis(deMs: number, ateMs: number, e: AvExpediente){
  if (!(ateMs > deMs)) return 0;
  const BR = 3 * 3600e3, DIA = 864e5;
  let total = 0, dia = Math.floor((Math.max(deMs, ateMs - 60 * DIA) - BR) / DIA) * DIA + BR;
  for (; dia < ateMs; dia += DIA) {
    if (!e.dias.includes(new Date(dia - BR).getUTCDay())) continue;
    total += Math.max(0, Math.min(dia + e.fim * 60e3, ateMs) - Math.max(dia + e.inicio * 60e3, deMs));
  }
  return total;
}

// Gestor da loja em cada aviso do AVISOS - OPERACIONAIS, com o que ele tem que fazer. O nome vem do OPS (op "gestores" da
// whatsapp-pedidos, pelo nome do grupo); grupo com duas lojas de gestores diferentes leva os dois.
export function avGestorLinha(gestores: (string | null | undefined)[] | string | null | undefined, acao: string){
  const g = [...new Set((Array.isArray(gestores) ? gestores : [gestores]).map(x => String(x || '').trim()).filter(Boolean))];
  return g.length ? `👤 ${g.map(n => '@' + n).join(' e ')}, ${acao}` : `👤 Gestor não identificado no OPS: ${acao}`;
}
type AvGestores = (string | null | undefined)[] | string | null | undefined;
export function avSemRespostaText(group: string, w: GrpMsg, msUteis: number, nowMs: number, gestores?: AvGestores){
  const linhas = [`⏰ *Sem resposta há ${avDur(msUteis)} no horário comercial*`, group, `${w.author || 'Cliente'}: ${avQuote(w.text)}`];
  // Mensagem que chegou fora do horário: diz quando foi, para não parecer que a espera é menor do que a do cliente.
  if (nowMs - w.ts * 1000 - msUteis > 15 * 60e3) linhas.push(`Mandou ${avWhen(brIso(w.ts * 1000))}.`);
  linhas.push(avGestorLinha(gestores, 'responda o cliente.'));
  return linhas.join('\n');
}
// Risco de cancelamento: sai na hora, marcando o Luis (head) e o gestor da loja (decisão do dono, 17/11).
export function avRiscoText(group: string, m: GrpMsg, gestores?: AvGestores){
  const n = new Set((Array.isArray(gestores) ? gestores : [gestores]).map(x => String(x || '').trim()).filter(Boolean)).size;
  return `🚨 *Risco de cancelamento*\n${group}\n${m.author || 'Cliente'}: ${avQuote(m.text, 220)}\n${avGestorLinha(gestores, n > 1 ? 'falem com o cliente hoje.' : 'fale com o cliente hoje.')}`;
}
export const avSilencioText = (group: string, days: number, gestores?: AvGestores) => `😶 *${days} dias sem mensagem da Brase*\n${group}\n${avGestorLinha(gestores, 'mande uma mensagem no grupo.')}`;

// Marcação de verdade no WhatsApp: "@<número>" no texto vira o nome em azul e notifica (testado em 16/11 com o Gabriel). O
// número de cada gestor fica em fn_config avisos.gestoresTelefone ({"Gabriel": "557196234092"}); sem número, "@Nome" em texto.
// Quem saiu da operação (avisos.gestoresSairam, ex.: Thalita) é trocado pelo gestor padrão (avisos.gestorPadrao, o Luis).
export type AvTelefones = Record<string, string>;
export function avMarca(nome: unknown, tel: AvTelefones = {}){
  const n = fold(nome).trim();
  if (!n) return '';
  const k = Object.keys(tel || {}).find(x => { const f = fold(x).trim(); return !!f && (f === n || n.startsWith(f + ' ') || f.startsWith(n + ' ')) });
  const num = k ? String(tel[k]).replace(/\D/g, '') : '';
  return num.length >= 10 && num.length <= 15 ? num : String(nome).trim();
}
export function avQuemCuida(nomes: unknown, cfg: {sairam?: unknown; padrao?: unknown} = {}){
  const sairam = (Array.isArray(cfg.sairam) ? cfg.sairam : []).map(x => fold(x).trim()).filter(Boolean), padrao = String(cfg.padrao || 'Luis');
  const lista = (Array.isArray(nomes) ? nomes : [nomes]).map(x => String(x || '').trim()).filter(Boolean)
    .map(x => sairam.some(sa => fold(x).trim() === sa || fold(x).startsWith(sa + ' ')) ? padrao : x);
  const vistos = new Set<string>(), unicos = lista.filter(x => { const k = fold(x).trim(); if (vistos.has(k)) return false; vistos.add(k); return true });
  return unicos.length ? unicos : [padrao];
}

// Cliente precisa de atendimento: no lugar do "sem resposta". Só quando o cliente perguntou, pediu algo ou reclamou (uma IA
// gratuita lê as mensagens; a regra fixa abaixo é a reserva) e ficou 2 h sem resposta no horário comercial.
const AV_PEDE = /(\?|(?:^|[^a-z])(pod(e|em|eria|eriam) (me|nos|ver|mudar|tirar|colocar|subir|pausar|ativar|mandar|enviar|fazer|verificar|olhar|criar|trocar|alterar|atualizar|ajudar|arrumar|corrigir|incluir|montar|lancar)|consegue|conseguem|conseguiria|preciso|precisamos|precisava|quero|queria|gostaria|ajuda|ajudar|como (faco|fazer|funciona|fica)|quando|qual|quais|por que|porque nao|cade|nao (esta|ta|tao|estao) (funcionando|aparecendo|saindo|chegando)|problema|erro|urgente|reclam|me (liga|ligar|chama|retorna)|retorno|alguem)(?![a-z]))/;
export function avPrecisaPeloTexto(textos: unknown[]): number {
  const i = (Array.isArray(textos) ? textos : []).findIndex(t => { const f = fold(t).replace(/@\d{6,}/g, ''); return AV_PEDE.test(f) && !(AV_ACK.test(f.trim()) && f.trim().length < 30 && !f.includes('?')) });
  return i + 1; // 0 = nenhuma; senão, a posição (1 = a primeira) da mensagem que pede atendimento
}
export function avAtendimentoText(group: string, w: GrpMsg, pedido: string, msUteis: number, nowMs: number, gestores?: AvGestores){
  const linhas = [`🙋 *Cliente precisa de atendimento*`, group, `${w.author || 'Cliente'}: ${avQuote(w.text, 200)}`];
  const p = String(pedido || '').replace(/\s+/g, ' ').trim();
  if (p) linhas.push(`O que precisa: ${p.length > 120 ? p.slice(0, 119) + '…' : p}`);
  const fora = nowMs - w.ts * 1000 - msUteis > 15 * 60e3;
  linhas.push(`Esperando há ${avDur(msUteis)} no horário comercial${fora ? ` (mandou ${avWhen(brIso(w.ts * 1000))})` : ''}.`);
  linhas.push(avGestorLinha(gestores, 'responda o cliente.'));
  return linhas.join('\n');
}

// Resumo das 9h (seg a sex): uma mensagem por gestor, marcando ele, só com as lojas dele. Atendimento ainda pendente, grupo
// parado e reunião a marcar saem do estado do momento (repetem enquanto não resolver); reunião registrada ou não no OPS vem
// da fila (canal 'resumo'). Gestor sem pendência não recebe nada.
export type AvResumoItem = {tipo: 'atendimento' | 'vencida' | 'hoje' | 'nova' | 'parado' | 'reuniao30' | 'ops'; grupo: string; texto: string};
const AV_RESUMO_SECAO: [AvResumoItem['tipo'], string][] = [['atendimento', '🙋 *Atendimento pendente*'], ['vencida', '⏰ *Ações vencidas*'], ['hoje', '📌 *Ações que vencem hoje*'],
  ['nova', '📋 *Ações novas das reuniões*'], ['parado', '😶 *Grupo parado*'], ['reuniao30', '📆 *Marcar reunião*'], ['ops', '📝 *Reuniões no OPS*']];
export function avResumoText(marca: string, itens: AvResumoItem[], nowMs: number){
  const dia = avWhen(brIso(nowMs)).replace(/ às .*/, '');
  const linhas = [`☀️ *Resumo de ${dia}* · @${marca}`];
  for (const [tipo, titulo] of AV_RESUMO_SECAO) {
    const daqui = [...new Set(itens.filter(x => x.tipo === tipo).map(x => `• ${x.grupo}: ${x.texto}`))];
    if (daqui.length) linhas.push('', titulo, ...daqui);
  }
  if (itens.some(x => x.tipo === 'vencida' || x.tipo === 'hoje' || x.tipo === 'nova')) linhas.push('', 'Para concluir uma ação, escreva aqui: feito <número> (ex.: feito 12).');
  return linhas.join('\n');
}
// O resumo sai na 1ª rodada a partir das 9h (Brasília) de um dia útil, uma vez por dia, e só até 3 h depois (publicar ou
// religar a função à noite não manda resumo marcando os gestores fora de hora). Devolve o dia (AAAA-MM-DD) ou null.
export function avResumoDue(nowMs: number, ultimoDia: unknown, hora = '09:00', dias = [1, 2, 3, 4, 5]){
  const b = new Date(nowMs - 3 * 3600e3), dia = b.toISOString().slice(0, 10), m = /^(\d{1,2}):(\d{2})$/.exec(hora);
  const min = m ? +m[1] * 60 + +m[2] : 540;
  const agora = b.getUTCHours() * 60 + b.getUTCMinutes();
  if (!dias.includes(b.getUTCDay()) || agora < min || agora >= min + 180 || String(ultimoDia || '') === dia) return null;
  return dia;
}

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
export const avReuniao30Text = (group: string, dia: string, status: string, days: number, gestores?: AvGestores) =>
  `📆 *${days} dias desde a última reunião*\n${group}\nÚltima: ${dia.slice(8, 10)}/${dia.slice(5, 7)} (${status === 'realizada' ? 'confirmada' : 'link do Meet no grupo'}).\n${avGestorLinha(gestores, 'marque a próxima reunião.')}`;

// Horário que o Renan sugere (em grupo ou no privado): os horários da mensagem como data e hora (Brasília), para avisar o
// comercial e bloquear a agenda da Central. Dia: "hoje", "amanhã", "depois de amanhã", dia da semana (o próximo; o mesmo dia
// da semana = semana que vem), "12/11" ou "dia 12"; com mais de um dia na mensagem, cada horário fica com o dia do mesmo trecho da frase;
// sem dia, hoje se o horário ainda não passou, senão amanhã. Vários horários viram vários ("10h ou 15h"). Só horários futuros e
// até 30 dias.
const AV_WD: Record<string, number> = {domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6};
const AV_TIME_G = [/(?:^|[^\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g, /(?:^|[^\d])(0?[7-9]|1\d|2[0-2]) ?h(?:rs?|s)?(?: ?([0-5]\d))?(?![a-z\d])/g,
  /(?:^|\s)as (0?[7-9]|1\d|2[0-2])(?![\d%:h])(?! ?(?:reais|dias|lojas|vezes|pessoas|pedidos|unidades))/g];
export function avParseSlots(text: unknown, msgMs: number): number[] {
  const t = fold(text);
  if (!avHasTime(t)) return [];
  const b = new Date(msgMs - 3 * 3600e3), y = b.getUTCFullYear(), mo = b.getUTCMonth(), d = b.getUTCDate(), nowMin = b.getUTCHours() * 60 + b.getUTCMinutes();
  // Todos os dias citados, com a posição na mensagem, para cada horário ficar com o seu dia ("Só na quinta vou estar na
  // estrada, podemos sexta às 10h?" = sexta 10h, não quinta).
  const dias: {pos: number; off?: number; date?: [number, number, number]}[] = [];
  for (const x of t.matchAll(/depois de amanha/g)) dias.push({pos: x.index ?? 0, off: 2});
  for (const x of t.matchAll(/(?:^|[^a-z])amanha(?![a-z])/g)) if (!/depois de\s*$/.test(t.slice(0, (x.index ?? 0) + 1))) dias.push({pos: x.index ?? 0, off: 1});
  for (const x of t.matchAll(/(?:^|[^a-z])hoje(?![a-z])/g)) dias.push({pos: x.index ?? 0, off: 0});
  for (const x of t.matchAll(/(?:^|[^\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    if (+x[1] < 1 || +x[1] > 31 || +x[2] < 1 || +x[2] > 12) continue;
    const yy = Date.UTC(y, +x[2] - 1, +x[1]) < Date.UTC(y, mo, d) - 30 * 864e5 ? y + 1 : y;
    dias.push({pos: x.index ?? 0, date: [yy, +x[2] - 1, +x[1]]});
  }
  for (const x of t.matchAll(/(?:^|[^a-z])(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?![a-z])/g)) dias.push({pos: x.index ?? 0, off: (AV_WD[x[1]] - b.getUTCDay() + 7) % 7 || 7});
  for (const x of t.matchAll(/(?:^|[^a-z])dia (\d{1,2})(?![\d/])/g)) if (+x[1] >= 1 && +x[1] <= 31) dias.push({pos: x.index ?? 0, date: +x[1] >= d ? [y, mo, +x[1]] : [y, mo + 1, +x[1]]});
  // Trechos da frase (vírgula, ponto, "?", "!", ";", quebra de linha e " ou "): vale o dia do mesmo trecho do horário; trecho
  // sem dia fica com o último dia citado antes ("quinta às 10h ou 14h30"); sem nenhum antes, o primeiro depois ("10h de amanhã").
  const cortes = [...t.matchAll(/[,;.!?\n]| ou /g)].map(x => x.index ?? 0);
  const trecho = (pos: number) => cortes.filter(c => c < pos).length;
  const out = new Set<number>();
  for (const r of AV_TIME_G) for (const x of t.matchAll(r)) {
    const pos = x.index ?? 0, mi = +x[1] * 60 + (x[2] ? +x[2] : 0), tr = trecho(pos);
    const noTrecho = dias.filter(c => trecho(c.pos) === tr).sort((a, c) => Math.abs(a.pos - pos) - Math.abs(c.pos - pos))[0];
    const antes = dias.filter(c => c.pos < pos).sort((a, c) => c.pos - a.pos)[0], depois = dias.filter(c => c.pos > pos).sort((a, c) => a.pos - c.pos)[0];
    const dia = noTrecho || antes || depois || null;
    const at = dia && dia.date ? Date.UTC(dia.date[0], dia.date[1], dia.date[2], 0, mi) : Date.UTC(y, mo, d + (dia ? dia.off ?? 0 : (mi > nowMin ? 0 : 1)), 0, mi);
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
// Só com quem é e o dia e a hora (sem o trecho da mensagem, que cortava e escondia o horário).
export function avAgendaText(where: string, kind: AvAgendaKind, slots: number[], blocked: boolean){
  const when = slots.map(s => avWhen(brIso(s))).join(' ou ');
  if (kind === 'di') {
    const near = slots.length === 1 ? ` (${avWhen(brIso(slots[0] - 30 * 60e3)).slice(-5)} ou ${avWhen(brIso(slots[0] + 30 * 60e3)).slice(-5)}, por exemplo)` : '';
    return `🗓 *Renan: reunião rápida (5 a 10 min)*\n${where}\n${when}\nNão fecha o horário: dá para marcar outra reunião logo antes ou depois${near}.`;
  }
  return `🗓 *Renan sugeriu horário*\n${where}\n${when}\n${blocked ? 'Bloqueado na agenda da Central: não ofereça esse horário.' : 'Não ofereça esse horário (não deu para bloquear na agenda da Central).'}`;
}
// Bloqueio na agenda da Central (coleção holds, sem lead): id e início no formato da tela ("r202611101500", "2026-11-10T15:00").
export const avHoldId = (ms: number) => 'r' + brIso(ms).slice(0, 16).replace(/\D/g, '');
export const avHoldStart = (ms: number) => brIso(ms).slice(0, 16);

// Pedido de alteração no iFood no grupo do cliente ("acabou o X", "pausa a loja amanhã", "o X agora é 32,90"): filtro barato
// antes de mandar a mensagem para a função whatsapp-pedidos do OPS, que lê com IA contra o cardápio real e aplica sozinha.
const AV_PEDIDO = /(paus[ae]|pausar|tira(r)? (o|a|os|as|do|da|esse|essa)\b|desativ|deslig|acabou|acabaram|esgot|sem estoque|nao tem mais|nao temos mais|faltou|volt(a|ou|ar) (o|a|os|as|com)\b|reativ|ativa(r)? (o|a|os|as)\b|liber(a|ar) (o|a|os|as)\b|preco|valor d|fecha(r)? a loja|fechar hoje|nao (vamos|vai|vou) abrir|abrir mais tarde|feriado)/;
export const avPedidoCandidato = (text: unknown) => AV_PEDIDO.test(fold(text));
export type AvPedidoResp = {status?: string; cliente?: string; gestor?: string | null; resumo?: string; feitos?: string[]; nao_feitos?: {pedido: string; motivo: string}[]; duvida?: string | null; erro?: string; simulado?: boolean};
// Aviso no AVISOS - OPERACIONAIS com o que o OPS fez (ou não), marcando o gestor do cliente para revisar. O gestor vem na
// resposta do OPS; quando o OPS não achou a loja (grupo com duas lojas), vale o gestor do grupo (`doGrupo`).
export function avPedidoText(grupo: string, autor: string, texto: string, r: AvPedidoResp, doGrupo?: AvGestores){
  const quem = r.gestor ? [r.gestor] : doGrupo, feitos = r.feitos || [], nao = r.nao_feitos || [];
  const head = r.status === 'sem_cliente' ? '🛠 *Pedido de alteração (loja não identificada no OPS)*'
    : feitos.length ? (r.simulado ? '🧪 *Alteração no iFood (simulação, nada foi gravado)*' : '🛠 *Alteração feita no iFood*') : '🛠 *Pedido de alteração NÃO aplicado*';
  const linhas = [head, grupo, `${autor || 'Cliente'}: ${avQuote(texto, 220)}`, ...feitos.map(f => '✅ ' + f), ...nao.map(n => `⚠️ ${n.pedido}: ${n.motivo}`)];
  if (r.duvida) linhas.push('❓ ' + r.duvida);
  if (r.erro) linhas.push('⚠️ ' + r.erro);
  linhas.push(avGestorLinha(quem, r.status === 'sem_cliente' ? 'faça à mão: o grupo não bate com uma loja só no OPS (nenhuma, ou mais de uma loja no mesmo grupo).'
    : feitos.length && !r.simulado ? `revise a alteração no OPS (Cardápio iFood › histórico do item)${nao.length ? ' e resolva o que não foi feito com o cliente' : ''}.` : 'resolva com o cliente.'));
  return linhas.join('\n');
}
export const avAgendadoText = (e: {ok?: boolean; cliente?: string; gestor?: string | null; texto?: string}) =>
  `⏱ *Alteração com hora marcada*\n${e.cliente || 'Cliente'}\n${e.ok ? '✅' : '⚠️'} ${e.texto || ''}\n${avGestorLinha(e.gestor, e.ok ? 'revise a alteração no OPS.' : 'faça à mão no OPS.')}`;

// Reuniões que vão para o OPS (link do Meet confirmado pela rotina e Anotações do Gemini) e para a Central (reunião de
// venda com lead). O envio fica em index.ts; aqui, os textos dos avisos e como achar o card do lead.
const avDia = (dia: string) => `${String(dia).slice(8, 10)}/${String(dia).slice(5, 7)}`;
export type AvReuniaoOps = {status?: string; cliente?: string; gestor?: string | null; reuniao?: string; ja_estava_feita?: boolean; resumo_salvo?: boolean; tarefas?: string[]; proxima?: string | null; error?: string};
export function avReuniaoOpsText(grupo: string, dia: string, r: AvReuniaoOps, fonte: 'meet' | 'gemini', doGrupo?: AvGestores){
  if (r.status === 'sem_cliente') return `📆 *Reunião com cliente não registrada no OPS*\n${grupo} · ${avDia(dia)}\nO grupo não bate com uma loja só no OPS.\n${avGestorLinha(doGrupo, 'marque a reunião à mão.')}`;
  const tarefas = r.tarefas || [];
  const linhas = [`✅ *Reunião registrada no OPS*`, `${r.cliente || grupo} · ${avDia(dia)}${r.reuniao ? ' (' + r.reuniao + ')' : ''}`];
  if (fonte === 'gemini') linhas.push(r.resumo_salvo ? '📝 Resumo das Anotações do Gemini salvo na reunião.' : '📝 Anotações do Gemini sem resumo.');
  if (tarefas.length) linhas.push(`${tarefas.length} ${tarefas.length === 1 ? 'tarefa' : 'tarefas'} no Comando:`, ...tarefas.slice(0, 8).map(t => '• ' + t));
  if (r.proxima) linhas.push(`Próxima reunião prevista: ${avDia(r.proxima)}.`);
  linhas.push(avGestorLinha(r.gestor || doGrupo, tarefas.length ? 'revise a reunião e as tarefas no OPS.' : 'revise a reunião no OPS (ficha do cliente › Compromissos).'));
  return linhas.join('\n');
}
// Linha da reunião no resumo das 9h (registrada ou não no OPS). Link do Meet e Anotações do Gemini da mesma reunião dão a mesma
// linha "não registrada", e o resumo junta as iguais.
export function avReuniaoOpsLinha(dia: string, r: AvReuniaoOps){
  if (r.status === 'sem_cliente') return `reunião de ${avDia(dia)} não registrada no OPS (o grupo não bate com uma loja só): marque à mão`;
  if (r.status !== 'ok') return `reunião de ${avDia(dia)} não registrada no OPS${r.error ? ` (${String(r.error).slice(0, 80)})` : ''}: marque à mão`;
  const t = (r.tarefas || []).length;
  return `reunião de ${avDia(dia)} registrada${r.reuniao ? ' (' + r.reuniao + ')' : ''}${t ? `, ${t} ${t === 1 ? 'tarefa' : 'tarefas'} no Comando` : ''}${r.proxima ? `, próxima ${avDia(r.proxima)}` : ''}`;
}
// Card do lead da reunião de venda: primeiro os leads com reunião marcada naquele dia, depois os em andamento; vale o que
// tem mais palavras do título/participantes no nome, empresa ou contato (empate não escolhe nenhum).
const AV_LEAD_STOP = new Set(['reuniao', 'brase', 'gestao', 'ifood', 'call', 'com', 'para', 'diagnostico', 'apresentacao', 'meet', 'google', 'marketing', 'restaurante', 'delivery', 'anotacoes', 'gemini', 'reunião', 'and', 'the', 'das', 'dos', 'sobre', 'proposta', 'primeira', 'conversa']);
export const avTokens = (s: unknown) => [...new Set(fold(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !AV_LEAD_STOP.has(w)))];
export function avLeadDaReuniao(docs: any, nota: {dia: string; titulo: string; lead_hint?: string | null}): {id: string; data: any} | null {
  const leads = (Array.isArray(docs) ? docs : []).filter((d: any) => d && d.col === 'leads' && !d.deleted && d.data && typeof d.data === 'object');
  const toks = avTokens(`${nota.titulo} ${nota.lead_hint || ''}`);
  const score = (d: any) => { const hay = new Set(avTokens(`${d.data.name || ''} ${d.data.company || ''} ${d.data.contact || ''}`)); return toks.filter(t => hay.has(t)).length };
  const melhor = (arr: any[], min: number) => {
    const s = arr.map(d => [d, score(d)] as [any, number]).filter(x => x[1] >= min).sort((a, b) => b[1] - a[1]);
    return s.length && (s.length === 1 || s[0][1] > s[1][1]) ? s[0][0] : null;
  };
  const doDia = leads.filter((d: any) => String(d.data.meetingAt || '').slice(0, 10) === nota.dia);
  const achado = melhor(doDia, 1) || (doDia.length === 1 && !toks.length ? doDia[0] : null)
    || melhor(leads.filter((d: any) => ['marcada', 'feita', 'agendando', 'qualificando'].includes(stageId(d.data.stage))), 2);
  return achado ? {id: String(achado.id), data: achado.data} : null;
}
// Observações do card com o resumo da reunião (uma vez por documento: a marca [gemini:<id>] evita repetir).
export function avNotasComReuniao(notas: unknown, n: {id: string; dia: string; resumo?: string | null; proximos?: string | null}){
  const old = typeof notas === 'string' ? notas : '', marca = `[gemini:${String(n.id).slice(0, 12)}]`;
  if (old.includes(marca)) return old;
  const bloco = [`📝 Reunião ${avDia(n.dia)} (Anotações do Gemini) ${marca}`, String(n.resumo || '').trim(), n.proximos ? 'Próximos passos: ' + String(n.proximos).trim() : ''].filter(Boolean).join('\n');
  return (old.trim() ? old.trimEnd() + '\n\n' : '') + bloco;
}
export function avNotaLeadText(nota: {titulo: string; dia: string; resumo?: string | null}, lead: any | null){
  if (!lead) return `📝 *Resumo de reunião de venda sem card na Central*\n${nota.titulo} · ${avDia(nota.dia)}\nNão achei o lead: cole o resumo no card à mão.\n${avQuote(String(nota.resumo || ''), 300)}`;
  return `📝 *Resumo da reunião salvo na Central*\n${lead.name || 'Lead sem nome'}${lead.company ? ' · ' + lead.company : ''} · ${avDia(nota.dia)}\n${avQuote(String(nota.resumo || ''), 220)}`;
}

// ---------- Pré-análise da loja (AVISOS - COMERCIAIS) ----------
// Quando o lead manda o link do iFood, a função lê os dados públicos da loja pelo próprio link
// (marketplace.ifood.com.br/v1/merchants/{id}/extra: nome, descrição, categoria, avaliações, pedido mínimo e horários)
// e marca o que dá para ver de fora: palavra-chave (nome e descrição) e poucas avaliações. Produto isca, cardápio e fotos
// não vêm nesses dados: ficam para o SDR conferir no link. As frases do roteiro são as mesmas da Central (PONTOS no
// index.html da Central): mude nos dois lugares.
export type AvLoja = {id: string; nome: string; categoria: string; avaliacoes: number | null; pedidoMinimo: number | null; descricao: number;
  kw: 'erro' | 'forte' | null; kwMotivo: string; rev: 'erro' | null; revMotivo: string; horario: string; avisos: string[]};
export const avLojaId = (url: unknown) => { const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(String(url ?? '')); return m ? m[0].toLowerCase() : '' };
const lojaNorm = (s: unknown) => ' ' + String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
// Palavras que o cliente digita na busca, por categoria do iFood (descrição sem acento). Categoria fora da lista é ampla
// demais (Brasileira, Mercado, Variada...) para julgar o nome: aí só a descrição conta.
const LOJA_KW: Record<string, string[]> = {
  'pizza': ['pizza', 'pizzaria'],
  'lanches': ['lanche', 'burger', 'burguer', 'hamburguer', 'hamburgueria', 'sanduiche', 'dog', 'smash', 'x '],
  'hamburguer': ['burger', 'burguer', 'hamburguer', 'hamburgueria', 'smash', 'lanche'],
  'japonesa': ['sushi', 'japones', 'japonesa', 'temaki', 'oriental', 'poke', 'sashimi', 'niguiri'],
  'chinesa': ['china', 'chines', 'chinesa', 'oriental', 'yakisoba', 'wok'],
  'acai': ['acai'],
  'doces bolos': ['doce', 'bolo', 'confeitaria', 'brigadeiro', 'bolaria', 'sobremesa', 'torta', 'cake', 'brownie'],
  'vegetariana': ['vegan', 'vegano', 'vegana', 'vegetarian', 'veg ', 'plant'],
  'vegana': ['vegan', 'vegano', 'vegana', 'veg ', 'plant'],
  'italiana': ['italian', 'massa', 'pasta', 'cantina', 'trattoria', 'pizza', 'lasanha'],
  'arabe': ['arabe', 'esfiha', 'esfirra', 'kebab', 'shawarma', 'beirute', 'libanes'],
  'mexicana': ['mexican', 'taco', 'burrito', 'nacho', 'tex mex'],
  'pastel': ['pastel', 'pastelaria'],
  'sorvetes': ['sorvete', 'sorveteria', 'gelato', 'picole', 'gelateria'],
  'salgados': ['salgado', 'coxinha', 'empada', 'esfiha'],
  'carnes': ['carne', 'churrasco', 'churrascaria', 'grill', 'espeto', 'espetinho', 'steak', 'parrilla', 'costela'],
  'frutos do mar': ['peixe', 'frutos do mar', 'camarao', 'ostra', 'mariscos', 'pescado'],
  'padaria': ['padaria', 'pao', 'panificadora', 'panificacao', 'confeitaria'],
  'cafeteria': ['cafe', 'cafeteria', 'coffee'],
  'saudavel': ['fit', 'saudavel', 'salada', 'natural', 'low carb', 'healthy', 'light', 'marmita fit'],
  'marmita': ['marmita', 'marmitex', 'quentinha', 'comida caseira', 'prato feito'],
  'crepe': ['crepe', 'creperia'],
  'tapioca': ['tapioca'],
  'nordestina': ['nordest', 'baiana', 'cuscuz', 'tapioca', 'acaraje', 'baiao'],
  'peruana': ['peru', 'ceviche'],
  'coreana': ['corean', 'korea', 'kimchi'],
  'tailandesa': ['tailand', 'thai'],
};
const DIAS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'], DIA_PT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const hhmm = (min: number) => { const m = ((min % 1440) + 1440) % 1440, h = Math.floor(m / 60), r = m % 60; return h + 'h' + (r ? String(r).padStart(2, '0') : '') };
// Horário: dias abertos e a faixa, e se a loja fica fechada no jantar (20h) em todos os dias.
export function avLojaHorario(shifts: unknown): {texto: string; avisos: string[]} {
  const list = (Array.isArray(shifts) ? shifts : []).map((s: any) => ({d: DIAS.indexOf(String(s && s.dayOfWeek)), ini: (([h, m]) => (+h || 0) * 60 + (+m || 0))(String((s && s.start) || '0:0').split(':')), dur: +((s && s.duration) || 0)})).filter(s => s.d >= 0 && s.dur > 0);
  if (!list.length) return {texto: 'sem horário no iFood', avisos: []};
  const dias = [...new Set(list.map(s => s.d))].sort((a, b) => a - b);
  const faixas = [...new Set(list.map(s => hhmm(s.ini) + ' às ' + hhmm(s.ini + s.dur)))];
  // Dias seguidos viram faixa ("qua a dom"); com horários diferentes, a abertura mais cedo e o fechamento mais tarde.
  const grupos: number[][] = [];
  for (const d of dias) { const g = grupos[grupos.length - 1]; if (g && d === g[g.length - 1] + 1) g.push(d); else grupos.push([d]) }
  const diasTxt = dias.length === 7 ? 'todos os dias' : grupos.map(g => g.length > 2 ? DIA_PT[g[0]] + ' a ' + DIA_PT[g[g.length - 1]] : g.map(d => DIA_PT[d]).join(', ')).join(', ');
  // Turno que começa à 0h é a continuação da noite anterior: não conta como abertura.
  const abre = list.filter(s => s.ini > 0), ini = Math.min(...(abre.length ? abre : list).map(s => s.ini)), fim = Math.max(...list.map(s => s.ini + s.dur));
  const texto = diasTxt + ', ' + (faixas.length === 1 ? faixas[0] : 'entre ' + hhmm(ini) + ' e ' + hhmm(fim));
  const jantar = list.some(s => s.ini <= 21 * 60 && s.ini + s.dur >= 21 * 60);
  const avisos: string[] = [];
  if (dias.length < 5) avisos.push('abre só ' + dias.length + ' dias por semana');
  if (!jantar) avisos.push('fechada no jantar');
  return {texto, avisos};
}
export function avLojaAnalise(id: string, x: any): AvLoja {
  const nome = String((x && x.name) || '').trim(), desc = String((x && x.description) || '').trim();
  const cat = String((x && x.mainCategory && x.mainCategory.description) || '').trim();
  const kws = LOJA_KW[lojaNorm(cat).trim().replace(/\s+/g, ' ')] || null;
  const has = (s: string) => !!kws && kws.some(k => lojaNorm(s).includes(k.endsWith(' ') ? ' ' + k : k));
  let kw: AvLoja['kw'] = null, kwMotivo = '';
  if (kws && !has(nome)) { kw = 'erro'; kwMotivo = `o nome "${nome}" não diz que é ${cat.toLowerCase()}` }
  else if (desc.length < 40) { kw = 'erro'; kwMotivo = desc ? 'a descrição da loja é curta demais (' + desc.length + ' letras)' : 'a loja está sem descrição' }
  else if (kws && has(desc)) { kw = 'forte'; kwMotivo = 'o nome e a descrição já falam o que a loja vende' }
  else kwMotivo = kws ? 'o nome diz o que vende, mas a descrição não usa a palavra' : 'categoria ampla (' + (cat || 'sem categoria') + '): confira o nome e os produtos';
  const n = x && x.userRatingCount != null && isFinite(+x.userRatingCount) ? Math.round(+x.userRatingCount) : null;
  const rev: AvLoja['rev'] = n != null && n < 50 ? 'erro' : null;
  const revMotivo = n == null ? 'sem o número de avaliações' : rev ? 'só ' + n + ' avaliações' : n + ' avaliações (compare com o concorrente do print)';
  const minimo = x && x.minimumOrderValue != null && isFinite(+x.minimumOrderValue) ? +x.minimumOrderValue : null;
  const h = avLojaHorario(x && x.shifts);
  const avisos = [...h.avisos];
  if (minimo != null && minimo >= 30) avisos.push('pedido mínimo alto (R$ ' + minimo.toFixed(2).replace('.', ',') + ')');
  return {id, nome, categoria: cat, avaliacoes: n, pedidoMinimo: minimo, descricao: desc.length, kw, kwMotivo, rev, revMotivo, horario: h.texto, avisos};
}
// Frases iguais às da Central (PONTOS): erro e ponto forte de palavra-chave, e erro de avaliações.
const LOJA_F = {
  kwErro: 'ainda falta palavra-chave na loja, que é o que traz visibilidade, melhora o ranqueamento e faz as pessoas acharem vocês mais fácil',
  kwForte: 'um nome que já diz o que vocês vendem',
  revErro: 'a loja tem poucas avaliações perto dos concorrentes, e o iFood mostra primeiro quem tem mais',
};
const primeiroNome = (s: unknown) => { const t = String(s ?? '').trim().split(/\s+/)[0] || ''; return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : '' };
// Roteiro do áudio do QL-2 com o que já deu para ver; o resto fica entre colchetes para o SDR completar.
export function avLojaRoteiro(l: any, a: AvLoja, sdr = 'Luiz Felipe'): string {
  const nome = primeiroNome(l && l.contact) || primeiroNome(l && l.name) || '[nome]';
  const loja = a.nome || String((l && (l.company || l.name)) || 'sua loja');
  const erros = [a.kw === 'erro' ? LOJA_F.kwErro : '', a.rev === 'erro' ? LOJA_F.revErro : ''].filter(Boolean);
  erros.push(erros.length ? '[outro erro, se tiver: produto isca, cardápio ou fotos]' : '[o erro que você viu: produto isca, cardápio ou fotos]');
  const fortes = [a.kw === 'forte' ? LOJA_F.kwForte : '', '[ponto forte: uma avaliação boa, fotos boas ou um cardápio organizado]'].filter(Boolean);
  return [
    `Fala ${nome}! Aqui é o ${sdr}, da Brase.`,
    'Eu já reparei alguns erros na sua loja por aqui também.',
    erros.map((e, i) => (i === 0 ? 'Como, por exemplo, ' : i === 1 ? 'Percebi também que ' : 'E ') + e + (e.startsWith('[') ? '' : '.')).join(' '),
    `Mas vi que a ${loja} tem ${fortes.join(' e ')}, então tem muito potencial pra crescer, meu amigo.`,
    'Quem vai entrar mais em detalhe nessas questões da sua loja é o Renan, que é o nosso especialista aqui da Brase.',
    `Mas antes de marcar a reunião com ele, me conta: como tá o momento da ${loja} hoje? Quanto vocês têm faturado por mês no iFood? E vocês têm espaço físico também, ou é só delivery?`,
  ].join('\n');
}
const reais = (v: number) => 'R$ ' + v.toFixed(2).replace('.', ',');
// Aviso no grupo AVISOS - COMERCIAIS.
export function avLojaTexto(l: any, a: AvLoja, link: string, sdrNome = 'Lipe'): string {
  const quem = [String((l && l.contact) || '').trim(), String((l && (l.company || l.name)) || '').trim()].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' · ');
  const linha2 = [a.categoria, a.avaliacoes != null ? a.avaliacoes + ' avaliações' : '', a.pedidoMinimo != null ? 'pedido mínimo ' + reais(a.pedidoMinimo) : ''].filter(Boolean).join(' · ');
  const marcas = [
    a.kw ? (a.kw === 'erro' ? '❌' : '✅') + ' Palavra-chave: ' + a.kwMotivo : '➖ Palavra-chave: ' + a.kwMotivo,
    (a.rev ? '❌' : '➖') + ' Avaliações: ' + a.revMotivo,
    ...a.avisos.map(x => '⚠️ ' + x[0].toUpperCase() + x.slice(1)),
  ];
  return [
    `🔎 *Pré-análise da loja* · ${a.nome || 'loja'}${quem ? '\nLead: ' + quem : ''}`,
    linha2, 'Horário: ' + a.horario, link, '',
    '*O que deu pra ver pelo link:*', ...marcas,
    '*Falta conferir no link:* produto isca, cardápio e fotos (e as avaliações contra o concorrente do print).', '',
    '*Roteiro do áudio (QL-2):*', avLojaRoteiro(l, a), '',
    `👤 @${sdrNome}, confira a loja, marque o resto no card e grave o áudio.`,
  ].join('\n');
}
// Lead que precisa de pré-análise: link do iFood, etapa antes da reunião e (sem análise e link chegado depois de `desde`)
// ou pedido de refazer pela Central (storeCheckAsk mais novo que a última análise).
export function avLojaPendente(l: any, desde: number): boolean {
  if (!l || !['novo', 'link', 'print', 'qualificando', 'agendando'].includes(String(l.stage))) return false;
  const link = String(l.ifoodUrl || (l.wa && l.wa.ifoodLink) || '');
  if (!/ifood/i.test(link)) return false;
  const feita = l.storeCheck && Date.parse(l.storeCheck.at || '');
  const pedido = Date.parse(l.storeCheckAsk || '');
  if (pedido && (!feita || pedido > feita)) return true;
  if (l.storeCheck) return false;
  const chegou = Date.parse((l.wa && l.wa.ifoodLinkAt) || l.linkAt || '') || 0;
  return chegou >= desde;
}

// Resumo do dia do Renan (rotina das 6h53, pela assinatura do Claude): às 6h15 a funis-avisos junta um pacote com as anotações,
// as conversas, a agenda, os horários sugeridos sem confirmação e as rotinas do dia. Uma vez por dia, só dentro da janela.
const avMin = (s: unknown, d: number) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()); return m ? +m[1] * 60 + +m[2] : d };
export function avManhaDue(nowMs: number, ultimoDia: unknown, de = '06:15', ate = '06:50'){
  const b = new Date(nowMs - 3 * 3600e3), dia = b.toISOString().slice(0, 10), agora = b.getUTCHours() * 60 + b.getUTCMinutes();
  if (agora < avMin(de, 375) || agora >= avMin(ate, 410) || String(ultimoDia || '') === dia) return null;
  return dia;
}
// Rotinas fixas do dia (fn_config avisos.manha.rotinas = [{dias: [1, 3], texto}], 0 = domingo). Padrão: segunda e quarta,
// enviar os relatórios.
export const AV_ROTINAS_PADRAO = [{dias: [1, 3], texto: 'Enviar os relatórios semanais dos clientes'}];
export function avRotinasDoDia(rotinas: unknown, nowMs: number): string[] {
  const wd = new Date(nowMs - 3 * 3600e3).getUTCDay(), lista = Array.isArray(rotinas) && rotinas.length ? rotinas : AV_ROTINAS_PADRAO;
  return lista.filter((r: any) => r && Array.isArray(r.dias) && r.dias.map(Number).includes(wd) && String(r.texto || '').trim()).map((r: any) => String(r.texto).trim());
}
// Texto de uma mensagem para o pacote: sem a linha "👤 Nome:", sem marcações cruas, até 500 caracteres.
export function avTextoPacote(content: unknown){
  const s = String(content ?? '').replace(/^\s*👤[^\n]*\n?/u, '').replace(/@\d{6,}/g, '').replace(/\s+/g, ' ').trim();
  return s.length > 500 ? s.slice(0, 499) + '…' : s;
}

// Janela de envio do AVISOS - OPERACIONAIS (os gestores são marcados): fora dela o aviso espera e sai no começo da próxima.
// Padrão das 8h às 20h, todo dia (fn_config avisos.op.envioDe / envioAte).
export function avNaJanela(nowMs: number, de = '08:00', ate = '20:00'){
  const b = new Date(nowMs - 3 * 3600e3), agora = b.getUTCHours() * 60 + b.getUTCMinutes(), d = avMin(de, 480), a = avMin(ate, 1200);
  return d <= a ? agora >= d && agora < a : agora >= d || agora < a;
}

// Ações das reuniões (aba Ações do OPS) no AVISOS - OPERACIONAIS: cada uma tem um número; o gestor conclui escrevendo
// "feito 12" (também "concluída #12", "pronto 12", "✅ 12" ou "#12 feito"). Devolve o número ou null.
export function avFeito(texto: unknown): number | null {
  const t = fold(String(texto ?? '').replace(/^\s*👤[^\n]*\n?/u, '')).trim();
  const m = /^(?:✅\s*)?(?:feito|feita|conclu[ií]d[oa]|conclui|pronto|pronta|ok feito|✅)\s*#?\s*(\d{1,5})(?!\d)/.exec(t) || /^#?(\d{1,5})\s*(?:feito|feita|concluid[oa]|pronto|pronta|ok|✅)(?![a-z])/.exec(t);
  return m ? Number(m[1]) : null;
}
// Linha da ação no resumo: "#12 Pedir custos de produto dele (até qui 19/11)".
export function avAcaoLinha(t: {codigo: number; titulo: string; prazo?: string | null}, hoje: string){
  const p = String(t.prazo || '').slice(0, 10), quando = p ? avWhen(p + 'T12:00').replace(/ às .*/, '') : '';
  const sufixo = !p ? '' : p < hoje ? ` (venceu ${quando})` : p === hoje ? '' : ` (até ${quando})`;
  return `#${t.codigo} ${String(t.titulo).replace(/\s+/g, ' ').trim().slice(0, 120)}${sufixo}`;
}
export const avAcaoConcluidaText = (codigo: number, titulo: string, por: string) => `✅ Ação #${codigo} concluída${por ? ' por ' + por : ''}: ${String(titulo).slice(0, 140)}`;

// Placar da semana (decisão do dono, 19/11): toda segunda, a partir das 8h e por até 3 h, uma mensagem só no grupo
// Organização - BRASE com o que a semana anterior (seg a dom) rendeu: comercial (investimento, leads, reuniões, vendas e
// custo de cada um), atendimento aos clientes, ações das reuniões e quantos avisos saíram de cada tipo (aviso que ninguém
// usa pode ser desligado). Conta, não IA. Devolve a segunda da semana anterior (AAAA-MM-DD) ou null.
export function avPlacarDue(nowMs: number, ultimaSemana: unknown, dia = 1, hora = '08:00'){
  const b = new Date(nowMs - 3 * 3600e3), agora = b.getUTCHours() * 60 + b.getUTCMinutes(), min = avMin(hora, 480);
  if (b.getUTCDay() !== dia || agora < min || agora >= min + 180) return null;
  const segunda = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() - ((b.getUTCDay() + 6) % 7) - 7)).toISOString().slice(0, 10);
  return String(ultimaSemana || '') === segunda ? null : segunda;
}
export function avMediana(v: number[]): number | null {
  const s = v.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Primeira resposta da Brase (o número do Renan ou alguém da equipe) depois da mensagem do cliente (mid); ms ou null.
export function avRespostaDepois(msgs: GrpMsg[], mid: string, team: string[]): number | null {
  const alvo = msgs.find(m => m.mid === mid);
  if (!alvo) return null;
  const r = msgs.find(m => m.ts > alvo.ts && (m.own || (!!m.author && avNameIn(m.author, team))));
  return r ? r.ts * 1000 : null;
}
export const avReais = (v: number) => 'R$ ' + (Number(v) || 0).toFixed(2).replace(/\B(?=(\d{3})+\.)/g, '.').replace(/\.(\d{2})$/, ',$1');
export type AvComercial = {gasto: number; leads: number; marcadas: number; feitas: number; vendas: number; valor: number};
export type AvPlacar = {
  ini: string; fim: string;
  comercial: AvComercial; anterior?: AvComercial | null;
  atendimento: {avisos: number; respondidos: number; medianaMs: number | null};
  riscos: number;
  pedidos: {total: number; feitos: number; mao: number};
  acoes: {criadas: number; concluidas: number; vencidas: {responsavel: string; n: number}[]};
  envios: {canal: string; tipo: string; n: number}[];
};
const AV_TIPO_NOME: Record<string, string> = {cobranca: 'mensalidade atrasada', atendimento: 'atendimento', pedido_ifood: 'pedido', pedido_agendado: 'hora marcada', resumo: 'resumo das 9h', risco: 'risco',
  acao_concluida: 'feito', horario_sdr: 'horário do Lipe', horario_lead: 'horário do lead', agenda_renan: 'sua agenda', reuniao_nova: 'reunião marcada', reuniao_horario: 'reunião remarcada',
  reuniao_lead: 'reunião de venda', loja: 'loja nova', manha: 'resumo da manhã', placar: 'placar', sem_resposta: 'sem resposta', silencio: 'grupo parado'};
const AV_CANAL_NOME: Record<string, string> = {operacional: 'AVISOS - OPERACIONAIS', comercial: 'AVISOS - COMERCIAIS', renan: 'Organização'};
export function avPlacarText(p: AvPlacar){
  const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`, c = p.comercial, plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const por = (v: number, n: number, rotulo: string) => n > 0 && v > 0 ? ` (${avReais(v / n)} ${rotulo})` : '';
  const linhas = [`📊 *Placar da semana* · ${dm(p.ini)} a ${dm(p.fim)}`, '', '*Comercial*',
    `• Investimento ${avReais(c.gasto)} · ${plural(c.leads, 'lead', 'leads')}${por(c.gasto, c.leads, 'cada')}`,
    `• Reuniões: ${c.marcadas} marcadas, ${c.feitas} feitas${por(c.gasto, c.feitas, 'por reunião feita')}`,
    `• Vendas: ${c.vendas ? `${plural(c.vendas, 'venda', 'vendas')}, ${avReais(c.valor)}${por(c.gasto, c.vendas, 'de custo por venda')}` : 'nenhuma'}`];
  if (p.anterior) linhas.push(`• Semana anterior: ${avReais(p.anterior.gasto)} · ${plural(p.anterior.leads, 'lead', 'leads')} · ${p.anterior.feitas} feitas · ${plural(p.anterior.vendas, 'venda', 'vendas')}`);
  const a = p.atendimento;
  linhas.push('', '*Atendimento aos clientes*',
    `• Cliente precisa de atendimento: ${plural(a.avisos, 'aviso', 'avisos')}${a.avisos ? `; ${a.respondidos} respondidos${a.medianaMs != null ? `, em ${avDur(a.medianaMs)} depois do aviso (mediana, horário comercial)` : ''}` : ''}`,
    `• Risco de cancelamento: ${p.riscos}`,
    `• Pedidos no grupo: ${p.pedidos.total}${p.pedidos.total ? ` (${p.pedidos.feitos} feitos no iFood, ${p.pedidos.mao} para fazer à mão)` : ''}`);
  const v = p.acoes.vencidas.filter(x => x.n > 0), totalV = v.reduce((s, x) => s + x.n, 0);
  linhas.push('', '*Ações das reuniões*', `• ${p.acoes.criadas} novas, ${p.acoes.concluidas} concluídas; vencidas agora: ${totalV}${totalV ? ` (${v.map(x => `${x.responsavel} ${x.n}`).join(', ')})` : ''}`);
  const canais = ['operacional', 'comercial', 'renan'].map(k => ({k, itens: p.envios.filter(e => e.canal === k && e.n > 0)})).filter(x => x.itens.length);
  if (canais.length) {
    linhas.push('', '*Avisos enviados*');
    for (const {k, itens} of canais) {
      const total = itens.reduce((s, e) => s + e.n, 0), det = [...itens].sort((x, y) => y.n - x.n).map(e => `${AV_TIPO_NOME[e.tipo] || e.tipo} ${e.n}`).join(', ');
      linhas.push(`• ${AV_CANAL_NOME[k]}: ${total} (${det})`);
    }
  }
  return linhas.join('\n');
}

// Mensalidade da assistida vencida e não paga (espelho do Asaas no OPS, op "cobrancas_assistida"): um aviso por cobrança,
// só no grupo do Renan.
export function avCobrancaText(a: {contrato: string; valor: number; vencimento: string; dias: number}){
  const v = String(a.vencimento || '');
  return `💸 *Mensalidade atrasada*\n${a.contrato}\n${avReais(a.valor)} venceu ${v.slice(8, 10)}/${v.slice(5, 7)} (${a.dias} ${a.dias === 1 ? 'dia' : 'dias'})\n👤 Assistida: cobre o cliente.`;
}

// Telefone inteiro para as mensagens do grupo do Renan (decisão do dono, 23/11: "final 7523" não diz quem é):
// "553193877523" → "+55 31 9387-7523"; "5571996234092" → "+55 71 99623-4092".
export function avTelefone(raw: unknown){
  const d = String(raw ?? '').split('-')[0].replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) { const n = d.slice(4); return `+55 ${d.slice(2, 4)} ${n.slice(0, -4)}-${n.slice(-4)}` }
  return d.length >= 8 ? '+' + d : '';
}
// Nome de quem é o número, quando o dono disse (fn_config avisos.contatos = {"553193877523": "Lipe"}).
export function avContatoConhecido(raw: unknown, contatos: unknown){
  const d = String(raw ?? '').split('-')[0].replace(/\D/g, ''), mapa = contatos && typeof contatos === 'object' ? contatos as Record<string, unknown> : {};
  const v = d ? mapa[d] ?? mapa['+' + d] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}
// Mensagem do grupo Organização: anotação do Renan, resumo da manhã (sai do número dele) ou aviso do sistema.
export function avTipoDaNota(texto: string, doSistema: string[]): 'anotacao' | 'resumo' | 'aviso' {
  const t = String(texto || '').trim();
  if (/^bom dia! hoje,/i.test(t)) return 'resumo';
  return doSistema.some(s => s.length >= 20 && t.startsWith(s.slice(0, 60))) ? 'aviso' : 'anotacao';
}

// ── Avisos mais úteis (decisão do dono, 26/11: "muita coisa repetida", "coisa boba", "nem é pedido") ─────────────────

// Mensagem do cliente que é só resposta, confirmação ou empolgação: nunca vira "Cliente precisa de atendimento", nem passa
// pela IA. Casos reais: "Feito", "os dois", "Não man", "Pior que não, viu…", "Bora pra cima", "Pra cima marcha 🚀", "É uma
// opção boa", "Alterei já 53,99", "Pode deixar sem valor adicional.", "Vou deixar pra responder quando estiver próximo
// do vencimento essas 3". Pergunta ("?") ou pedido/problema claro nunca é trivial.
const AV_TRIVIAL_INICIO = /^(ok|okay|okk+|blz|beleza|obrigad[oa]s?|obg|brigad[oa]|valeu|vlw|show|top|perfeito|certo|combinado|tranquilo|fechado|otimo|massa|boa|bom dia|boa tarde|boa noite|sim|nao|isso|entendi|joia|ta bom|ta otimo|tudo bem|tudo certo|maravilha|feito|pronto|alterei|alterado|mudei|coloquei|mandei|enviei|bora|vamos|pra cima|demais|top demais|pode deixar|pode ser|por mim|fechou|show de bola|e uma opcao|pior que|os dois|as duas|ambos|vou deixar|vou ver|vou verificar|depois (eu )?(respondo|te falo|vejo)|ja estamos|ja tamos|tamos|estamos (organizando|vendo|fazendo)|de qualquer (forma|jeito)|kk+|(ha)+|rs+)(?![a-z])/;
const AV_TRIVIAL_PEDE = /(?:^|[^a-z])(pod(e|em|eria|eriam) (me|nos|ver|mudar|tirar|colocar|subir|pausar|ativar|mandar|enviar|fazer|verificar|olhar|criar|trocar|alterar|atualizar|ajudar|arrumar|corrigir|incluir|montar|lancar)|consegue|conseguem|preciso|precisamos|quero|queria|gostaria|ajuda|como (faco|fazer|funciona|fica)|me (liga|ligar|chama|retorna|manda|envia|passa)|nao (esta|ta|tao|estao) (funcionando|aparecendo|saindo|chegando|entrando)|problema|erro|urgente|reclam|cancelar|cancelamento|golpe)(?![a-z])/;
export function avRespostaTrivial(texto: unknown){
  const t = fold(String(texto ?? '')).replace(/^🎤\s*/u, '').replace(/@\d{6,}/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (t.includes('?') || AV_TRIVIAL_PEDE.test(t)) return false;
  const palavras = t.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (palavras.length <= 3) return true; // "os dois", "Não man", "Feito", só emoji
  return AV_TRIVIAL_INICIO.test(t) && t.length <= 110;
}

// Horário que o Lipe sugeriu: um aviso por lead e horário. Repetir o mesmo horário em outra mensagem, ou falar dele
// depois de marcada a reunião, não avisa de novo. A chave fica em fn_avisos.grupo: "h:<telefone>|<início em ms>,…".
export const avChaveHorario = (telefone: string, slots: number[]) => `h:${telefone}|${[...slots].sort((a, b) => a - b).join(',')}`;
export function avHorariosNovos(telefone: string, slots: number[], chavesAnteriores: string[]): number[] {
  const ja = new Set<number>();
  for (const k of chavesAnteriores) if (k.startsWith(`h:${telefone}|`)) for (const s of k.split('|')[1].split(',')) ja.add(Number(s));
  return slots.filter(s => !ja.has(s));
}
// Lead que já tem a reunião marcada (ou já fez, fechou, não foi): o horário sugerido não é mais novidade.
export const avLeadJaMarcou = (lead: any) => !!lead && ['marcada', 'feita', 'fechado', 'noshow'].includes(stageId(lead.stage));
