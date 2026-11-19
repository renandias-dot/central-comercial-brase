// funis-avisos — avisos automáticos nos grupos de WhatsApp da Brase, 24 h por dia, pelo canal Operacional do NicoChat
// (o número do Renan, conexão não oficial). Chamada pelo pg_cron a cada 2 min (op cron.avisos, cabeçalho x-fn-cron).
//   AVISOS - COMERCIAIS: horário sugerido na conversa do SDR (pelo SDR ou pelo lead), reunião marcada/remarcada na Central e
//   pré-análise da loja quando o lead manda o link do iFood (dados públicos da loja, marcas no card e o roteiro do áudio).
//   AVISOS - OPERACIONAIS: grupos dos clientes ("BRASE - " e "DI "): sem resposta da Brase, sinal de risco e silêncio longo.
// Configuração em fn_config (k = 'avisos'); estado da última rodada em fn_config (k = 'avisos_state'); fila em fn_avisos
// (id = a chave do evento, então nada sai duas vezes); grupos dos clientes em fn_grupos. Segredos: NICOCHAT_OPS_KEY (canal
// Operacional, lê os grupos e envia) e NICOCHAT_API_KEY (canal do SDR, o mesmo da ponte cron.wa da funis-api); GROQ_API_KEY
// (opcional, plano gratuito) transcreve os áudios dos grupos dos clientes com o Whisper (fn_audios). Só envia para os grupos
// AVISOS: nunca no grupo do cliente.
// SUPABASE_DB_URL já vem do Supabase. Função separada da funis-api para publicar e mexer sem tocar nos funis públicos.
// deno-lint-ignore-file no-explicit-any
import postgres from 'npm:postgres@3.4.5';
import {avClientGroup, avGroupLabel, avGroupState, avHorarioText, avMeetingDue, avReuniaoText, avRiscoText, avTimeOffers, brIso, grpMsg, leadIndex, nicoTime, avMeetings, avReuniao30Due, avParseSlots, avAgendaText, avHoldId, avHoldStart, avIsDi, avClientOf, avNameIn, waPhoneKey, AV_DI_MIN, avPedidoCandidato, avPedidoText, avAgendadoText, avAudioUrl, avAudioTexto, avComAudios, avQuemPeloTexto, AV_AUDIO_SEM_AUTOR, avLeadDaReuniao, avIgnorado, avMarca, avQuemCuida, avPrecisaPeloTexto, avAtendimentoText, avResumoText, avResumoDue, avReuniaoOpsLinha, avWhen, avQuemMandou, avChavesDaEquipe, avNaJanela, avFeito, avAcaoLinha, avAcaoConcluidaText, avDestino, avGruposCfg, avParaAssistida, avPlacarDue, avPlacarText, avMediana, avRespostaDepois, type AvGruposCfg, type AvDestino, type AvPlacar, type AvComercial, avTextoFora, avCobrancaText, avManhaDue, avRotinasDoDia, avTextoPacote, type AvResumoItem, avExpediente, avMsUteis, avNotasComReuniao, avNotaLeadText, avLojaId, avLojaAnalise, avLojaTexto, avLojaPendente, type AvAudio, type AvAgendaKind, type GrpMsg} from './avisos.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const sql = postgres(env('SUPABASE_DB_URL'), {prepare: false, max: 2, idle_timeout: 20});
const NICO_API = (env('NICOCHAT_API') || 'https://app.nicochat.com/api').replace(/\/$/, '');
const SDR_KEY = env('NICOCHAT_API_KEY');
const OPS_KEY = env('NICOCHAT_OPS_KEY');
const GROQ_KEY = env('GROQ_API_KEY');
const CRM_API = env('CRM_API') || 'https://wndgqvkeguampmtmkmhq.supabase.co/functions/v1/crm-api';
const SEND_MAX = 8;        // avisos enviados por rodada; o resto vai na próxima
const READ_MAX = 15;       // grupos dos clientes relidos por rodada
const SDR_READ_MAX = 20;   // conversas do SDR relidas por rodada (só as que a ponte acabou de atualizar)
const AG_READ_MAX = 20;    // conversas do Renan relidas por rodada atrás de horário sugerido
const SELLERS_TTL = 6 * 3600e3;
const AUDIO_MAX = 6;           // áudios transcritos por rodada (o resto fica pendente para a próxima)
const AUDIO_BYTES = 24e6;      // o plano gratuito do Groq aceita até 25 MB
const AUDIO_JANELA = 6 * 3600e3; // só áudio das últimas 6 h (o mesmo prazo dos pedidos)
const QUEM_MAX = 4;            // áudios classificados (cliente ou equipe) por rodada: o plano gratuito tem limite por minuto
type Row = Record<string, any>;
type AvRow = {id: string; canal: 'comercial' | 'operacional' | 'resumo' | 'renan'; tipo: string; texto: string; grupo?: string | null; gestores?: string[] | null};
const json = (v: unknown) => (sql as any).json(v);
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json; charset=utf-8'}});
const sameKey = (a: string, b: string) => { if (!a || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0 };
async function getConf(k: string): Promise<Row> { const [r] = await sql`select v from fn_config where k = ${k}`; return (r && r.v) || {} }
const setConf = (k: string, v: unknown) => sql`insert into fn_config (k, v) values (${k}, ${json(v)}) on conflict (k) do update set v = excluded.v, updated_at = now()`;

async function nico(key: string, path: string, params: Record<string, string | number>){
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`${NICO_API}/${path}?${qs}`, {headers: {authorization: 'Bearer ' + key, accept: 'application/json'}, signal: AbortSignal.timeout(20000)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('O NicoChat respondeu ' + r.status + (j && j.message ? ': ' + String(j.message).slice(0, 200) : ''));
  return j;
}
async function nicoSend(userNs: string, content: string){
  const r = await fetch(`${NICO_API}/subscriber/send-text`, {method: 'POST', headers: {authorization: 'Bearer ' + OPS_KEY, accept: 'application/json', 'content-type': 'application/json'},
    body: JSON.stringify({user_ns: userNs, content}), signal: AbortSignal.timeout(20000)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 'ok') throw new Error('Envio pelo NicoChat falhou (' + r.status + (j && j.message ? ': ' + String(j.message).slice(0, 200) : '') + ')');
}
// Central Comercial (crm-api): o código de acesso fica em fn_config (k = 'crm'), o mesmo que a funis-api usa.
async function crmCall(body: Row){
  const conf = await getConf('crm');
  if (!conf.key) throw new Error('Sem o código de acesso da Central Comercial (fn_config crm).');
  const r = await fetch(conf.url || CRM_API, {method: 'POST', headers: {'content-type': 'application/json', 'x-crm-key': conf.key}, body: JSON.stringify(body), signal: AbortSignal.timeout(40000)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('A Central Comercial respondeu ' + (j.error || 'HTTP ' + r.status));
  return j;
}
async function queue(rows: AvRow[]){
  if (!rows.length) return 0;
  const lista = rows.map(r => ({...r, grupo: r.grupo ?? null, gestores: r.gestores ?? null}));
  const ins = await sql`insert into fn_avisos ${sql(lista as unknown as Row[], 'id', 'canal', 'tipo', 'texto', 'grupo', 'gestores')} on conflict (id) do nothing returning id`;
  return ins.length;
}
// Nomes da equipe da Central (para "SDR: Fulano" no aviso de reunião), guardados por 6 h.
async function sellersFrom(docs: Row[]){
  const map: Record<string, string> = {};
  for (const d of docs) if (d && d.col === 'sellers' && !d.deleted && d.data && d.data.name) map[String(d.id)] = String(d.data.name);
  await setConf('crm_sellers', {at: new Date().toISOString(), map});
  return map;
}
async function sellers(){
  const c = await getConf('crm_sellers');
  if (c.map && Date.now() - (Date.parse(c.at || '') || 0) < SELLERS_TTL) return c.map as Record<string, string>;
  return await sellersFrom((await crmCall({op: 'load'})).docs || []);
}

// 1. Horário sugerido: relê as conversas do SDR que a ponte (cron.wa) acabou de atualizar e procura mensagem com horário.
async function horarios(c: Row, prev: Row){
  if (c.com && c.com.horarios === false) return {skipped: 'desligado'};
  if (!SDR_KEY) return {skipped: 'sem o segredo NICOCHAT_API_KEY'};
  const flow = String((await getConf('wa')).flow || 'f302947');
  const cursor = prev.waCursor || c.since;
  const rows = await sql`select user_ns, phone_key, updated_at from fn_wa_contacts where flow_ns = ${flow} and updated_at > ${new Date(Date.parse(cursor))} order by updated_at limit ${SDR_READ_MAX}`;
  if (!rows.length) return {read: 0, cursor};
  const found: {phone: string; t: ReturnType<typeof avTimeOffers>[number]}[] = [];
  for (const r of rows) {
    const j = await nico(SDR_KEY, 'subscriber/chat-messages', {user_ns: String(r.user_ns), limit: 30});
    // Só o horário que o SDR (o Lipe) sugeriu; o que o lead sugere fica de fora (volta com com.horarioLead = true).
    for (const t of avTimeOffers(Array.isArray(j.data) ? j.data : [])) if (t.ts * 1000 >= c.sinceMs && (t.who === 'sdr' || (c.com && c.com.horarioLead === true))) found.push({phone: String(r.phone_key || ''), t});
  }
  let queued = 0;
  const ids = found.map(x => 'horario:' + x.t.mid);
  const known = new Set((ids.length ? await sql`select id from fn_avisos where id = any(${ids})` : []).map((r: Row) => String(r.id)));
  const fresh = found.filter(x => !known.has('horario:' + x.t.mid));
  let semCard = 0;
  if (fresh.length) {
    const docs = (await crmCall({op: 'load'})).docs || [];
    await sellersFrom(docs);
    const idx = leadIndex(docs);
    // Só conversa com lead que tem card na Central: o horário que o Lipe combina com o Renan (sem card) não vira aviso
    // (decisão do dono, 19/11; volta com com.horarioSemCard = true). Fica registrado sem envio para não ser lido de novo.
    const comCard = fresh.filter(x => idx.has(x.phone) || (c.com && c.com.horarioSemCard === true));
    const sem = fresh.filter(x => !comCard.includes(x));
    semCard = sem.length;
    for (const x of sem) await sql`insert into fn_avisos (id, canal, tipo, texto, sent_at) values (${'horario:' + x.t.mid}, 'comercial', 'horario_sem_card', 'conversa sem card na Central', now()) on conflict (id) do nothing`;
    queued = await queue(comCard.map(({phone, t}) => ({id: 'horario:' + t.mid, canal: 'comercial' as const, tipo: t.who === 'sdr' ? 'horario_sdr' : 'horario_lead',
      texto: avHorarioText(t, (idx.get(phone) || {data: null}).data, '', String((c.com && c.com.sdrNome) || 'Lipe'))})));
  }
  return {read: rows.length, found: found.length, queued, semCard, cursor: new Date(rows[rows.length - 1].updated_at).toISOString()};
}
// 2. Reunião marcada ou remarcada: lê na Central só os documentos que mudaram (com folga de 12 min para esperar o horário).
async function crmChanges(prev: Row){
  const now = Date.now(), cursor = Date.parse(prev.crmCursor || '') || now;
  const since = new Date(Math.max(now - 864e5, Math.min(cursor, now - 12 * 60e3))).toISOString();
  return await crmCall({op: 'changes', since});
}
async function reunioes(c: Row, prev: Row, sink: Row[] = []){
  if (c.com && c.com.reunioes === false) return {skipped: 'desligado'};
  const now = Date.now();
  const j = await crmChanges(prev);
  const docs: Row[] = j.docs || [];
  sink.push(...docs);
  if (docs.some(d => d && d.col === 'sellers')) await sellersFrom((await crmCall({op: 'load'})).docs || []);
  const leads = docs.filter(d => d && d.col === 'leads' && !d.deleted && d.data && d.data.stage === 'marcada' && d.data.bookedAt);
  let queued = 0;
  if (leads.length) {
    const sent = (await sql`select id from fn_avisos where id like any(${leads.map(d => `reuniao:${d.id}:%`)})`).map((r: Row) => String(r.id));
    const rows: AvRow[] = [];
    for (const d of leads) {
      const due = avMeetingDue(String(d.id), d.data, sent, c.sinceMs, now);
      if (due) rows.push({id: due.key, canal: 'comercial', tipo: 'reuniao_' + due.kind, texto: avReuniaoText(d.data, due.kind, await sellers())});
    }
    queued = await queue(rows);
  }
  return {docs: docs.length, marcadas: leads.length, queued, cursor: j.cursor || null};
}
// 3. Pré-análise da loja: lead que mandou o link do iFood (ou pediu de novo na Central). Lê os dados públicos da loja pelo
// próprio link, grava no card o resultado (storeCheck) e as marcas que estiverem vazias (palavra-chave, avaliações), e
// manda o aviso com o roteiro do áudio. Só links que chegaram depois de ligar (avisos_state.lojasDesde).
const LOJA_MAX = 4;
async function lojas(c: Row, prev: Row, docs: Row[], desde: number){
  if (c.com && c.com.lojas === false) return {skipped: 'desligado'};
  let lista = docs;
  if (!lista.length && c.com && c.com.reunioes === false) lista = (await crmChanges(prev)).docs || [];
  const pend = lista.filter(d => d && d.col === 'leads' && !d.deleted && d.data && avLojaPendente(d.data, desde));
  const rows: AvRow[] = [], erros: string[] = [];
  let feitas = 0;
  for (const d of pend.slice(0, LOJA_MAX)) {
    const l: Row = d.data, link = String(l.ifoodUrl || (l.wa && l.wa.ifoodLink) || ''), id = avLojaId(link), at = new Date().toISOString();
    let check: Row;
    try {
      if (!id) throw new Error('o link não tem o código da loja');
      const r = await fetch(`https://marketplace.ifood.com.br/v1/merchants/${id}/extra`, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(15000)});
      if (!r.ok) throw new Error('o iFood respondeu ' + r.status);
      const a = avLojaAnalise(id, await r.json());
      check = {...a, at, link};
      const lead: Row = {...l, storeCheck: check, updatedAt: at};
      if (!lead.ptKw && a.kw) lead.ptKw = a.kw;
      if (!lead.ptRev && a.rev) lead.ptRev = a.rev;
      await crmCall({op: 'set', col: 'leads', id: d.id, data: lead});
      rows.push({id: `loja:${d.id}:${l.storeCheckAsk || id}`, canal: 'comercial', tipo: 'loja', texto: avLojaTexto(lead, a, link, String((c.com && c.com.sdrNome) || 'Lipe'))});
      feitas++;
    } catch (e) {
      // Grava o erro no card para não tentar de novo a cada rodada; "Fazer pré-análise" na Central tenta outra vez.
      erros.push(String(d.id) + ': ' + errText(e));
      await crmCall({op: 'set', col: 'leads', id: d.id, data: {...l, storeCheck: {at, link, erro: errText(e).slice(0, 200)}, updatedAt: at}}).catch(() => {});
    }
  }
  return {pendentes: pend.length, feitas, queued: await queue(rows), erros: erros.length ? erros : undefined, desde: brIso(desde)};
}
// Conversas do canal Operacional com mensagem nas últimas 24 h (grupos e privado), uma vez por rodada.
async function opsContacts(){
  const contacts: Row[] = [];
  for (let page = 1; page <= 5; page++) {
    const j = await nico(OPS_KEY, 'subscribers', {limit: 100, page, is_last_message_in_last_24h: 'yes'});
    contacts.push(...(Array.isArray(j.data) ? j.data : []));
    if (!j.meta || page >= Number(j.meta.last_page || 1)) break;
  }
  return contacts;
}
// Transcrição de um áudio com o Whisper (modelo aberto da OpenAI) rodando no Groq, plano gratuito: sem custo, até 2 mil
// áudios e 8 h de áudio por dia. Sempre em português (language = pt). Modelo em fn_config avisos.op.audioModelo (padrão
// whisper-large-v3-turbo); se o Groq recusar o modelo (400/404), tenta o whisper-large-v3. Limite do dia (429): o áudio
// fica pendente e a rodada para, sem gastar tentativa.
const AUDIO_MIME: Record<string, string> = {mp3: 'audio/mpeg', mpeg: 'audio/mpeg', mpga: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac'};
const AUDIO_DICA = 'Áudio de WhatsApp do dono de um restaurante para a agência que cuida do iFood dele: cardápio, preços, pausar e ativar produtos, horário da loja.';
class AudioGrande extends Error {}
class AudioLimite extends Error {}
async function transcrever(url: string, modelo: string){
  const a = await fetch(url, {signal: AbortSignal.timeout(20000)});
  if (!a.ok) throw new Error('O áudio não baixou (HTTP ' + a.status + ')');
  if (Number(a.headers.get('content-length') || 0) > AUDIO_BYTES) throw new AudioGrande('Áudio maior que 24 MB');
  const buf = new Uint8Array(await a.arrayBuffer());
  if (buf.byteLength > AUDIO_BYTES) throw new AudioGrande('Áudio maior que 24 MB');
  const hdr = (a.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = ((/\.([a-z0-9]{2,4})(?:\?|$)/i.exec(new URL(url).pathname) || [])[1] || '').toLowerCase();
  const tipo = AUDIO_MIME[ext] ? ext : (Object.entries(AUDIO_MIME).find(([, v]) => v === hdr) || ['mp3'])[0];
  let ultimo = '';
  for (const m of [...new Set([modelo, 'whisper-large-v3'])]) {
    const fd = new FormData();
    fd.append('file', new Blob([buf], {type: AUDIO_MIME[tipo]}), 'audio.' + tipo);
    fd.append('model', m);
    fd.append('language', 'pt');
    fd.append('temperature', '0');
    fd.append('response_format', 'json');
    fd.append('prompt', AUDIO_DICA);
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {method: 'POST', headers: {authorization: 'Bearer ' + GROQ_KEY}, body: fd, signal: AbortSignal.timeout(60000)});
    const j = await r.json().catch(() => ({}));
    if (r.ok) return {texto: String(j.text || '').trim(), modelo: m, bytes: buf.byteLength, usage: j.x_groq || j.usage || null};
    ultimo = 'O Groq respondeu ' + r.status + (j && j.error && j.error.message ? ': ' + String(j.error.message).slice(0, 200) : '');
    if (r.status === 429) throw new AudioLimite(ultimo);
    if (r.status !== 400 && r.status !== 404) break;   // chave ou fora do ar: outro modelo não resolve
  }
  throw new Error(ultimo);
}
// Quem falou o áudio (o WhatsApp não diz): IA gratuita do Groq (openai/gpt-oss-20b, a mesma chave do Whisper) lê a
// transcrição com as mensagens anteriores do grupo e responde cliente, equipe ou incerto. Se a IA falhar, vale a regra fixa
// (avQuemPeloTexto). Modelo em fn_config avisos.op.audioQuemModelo.
const QUEM_SCHEMA = {type: 'object', properties: {quem: {type: 'string', enum: ['cliente', 'equipe', 'incerto']}, motivo: {type: 'string'}}, required: ['quem', 'motivo'], additionalProperties: false};
async function quemFalou(texto: string, antes: string[], equipe: string[], clientes: string[], modelo: string){
  const sistema = `Você descobre quem falou um áudio de WhatsApp num grupo entre a Brase (agência que cuida do iFood de restaurantes) e o cliente (o dono do restaurante ou alguém da loja dele).
Equipe da Brase: Renan, ${equipe.join(', ') || 'Luis, Gabriel, Felipe, Luiz Felipe'}.
Pessoas do cliente que já escreveram neste grupo: ${clientes.join(', ') || 'não se sabe'}.
- "equipe": quem fala é da Brase. Explica o que a agência fez ou vai fazer (cardápio, combos, anúncios, campanhas, funil, conversão), dá recomendação, chama o cliente pelo nome ("Oi Daniel", "Boa tarde, Lindomar"), fala "seu cardápio", "sua loja", "a gente fez".
- "cliente": quem fala é do restaurante. Pede algo à agência, fala da própria loja ("meu cardápio", "acabou o frango", "fecha a loja amanhã"), pergunta pelo resultado, chama alguém da Brase pelo nome ("Oi Felipe").
- "incerto": só se não der para saber.
Responda em JSON: {"quem": "cliente" | "equipe" | "incerto", "motivo": "uma frase curta"}.`;
  const usuario = ['Mensagens anteriores do grupo:', ...(antes.length ? antes : ['(nenhuma)']), '', 'ÁUDIO A CLASSIFICAR: ' + texto].join('\n');
  const base = {model: modelo, messages: [{role: 'system', content: sistema}, {role: 'user', content: usuario}], temperature: 0, max_completion_tokens: 600};
  const tentativas = [{...base, reasoning_effort: 'low', response_format: {type: 'json_schema', json_schema: {name: 'quem_falou', strict: true, schema: QUEM_SCHEMA}}}, {...base, response_format: {type: 'json_object'}}];
  let ultimo = '';
  for (const body of tentativas) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {method: 'POST', headers: {authorization: 'Bearer ' + GROQ_KEY, 'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(30000)});
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      try {
        const o = JSON.parse(String(j.choices?.[0]?.message?.content || ''));
        if (['cliente', 'equipe', 'incerto'].includes(o.quem)) return {quem: String(o.quem), motivo: String(o.motivo || '').slice(0, 200)};
      } catch { /* fora do formato: tenta a próxima forma */ }
      ultimo = 'resposta fora do formato';
      continue;
    }
    ultimo = 'O Groq respondeu ' + r.status + (j && j.error && j.error.message ? ': ' + String(j.error.message).slice(0, 200) : '');
    if (r.status === 429) throw new AudioLimite(ultimo);
    if (r.status !== 400) break;
  }
  throw new Error(ultimo);
}
// Conversa no privado do Renan que não é de cliente (pelo nome) nem de lead da Central (pelo telefone): a IA gratuita do Groq
// lê as últimas mensagens e diz com quem é pelo contexto. Só lead e cliente contam para a agenda; equipe (o Lipe, os gestores),
// pessoal e incerto ficam de fora.
const PRIVADO_SCHEMA = {type: 'object', properties: {tipo: {type: 'string', enum: ['lead', 'cliente', 'equipe', 'pessoal', 'incerto']}, motivo: {type: 'string'}}, required: ['tipo', 'motivo'], additionalProperties: false};
async function conversaDeQuem(contato: string, msgs: Row[], equipe: string[], modelo: string){
  const sistema = `Você lê uma conversa de WhatsApp no celular do Renan, dono da Brase (agência que cuida do iFood de restaurantes: cardápio, promoções, anúncios), e diz com quem é a conversa.
Equipe da Brase: ${equipe.join(', ') || 'Luiz Felipe (Lipe), Gabriel, Felipe, Luis, Thalita'}. O Lipe (Luiz Felipe) é o SDR: o Renan passa para ele horários, leads e tarefas.
- "lead": dono, sócio ou gerente de restaurante que ainda não é cliente: marcar reunião ou diagnóstico, apresentação da Brase, proposta, preço, o iFood da loja dele.
- "cliente": restaurante que já é cliente da Brase: cardápio, resultados, relatório, gestor, reunião de acompanhamento.
- "equipe": alguém da Brase. Falam de terceiros ("marca o fulano", "o lead X", "a reunião com a pizzaria"), de tarefas e da operação da agência.
- "pessoal": amigo, família, fornecedor, banco, compromisso pessoal ou qualquer outra coisa.
- "incerto": só se não der para saber.
Responda em JSON: {"tipo": "lead" | "cliente" | "equipe" | "pessoal" | "incerto", "motivo": "uma frase curta"}.`;
  const linhas = msgs.filter(m => m && typeof m.content === 'string' && (m.type === 'agent' || m.type === 'in')).sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-14)
    .map(m => `${m.type === 'agent' ? 'Renan' : 'Contato'}: ${String(m.content).replace(/^\s*👤[^\n]*\n?/u, '').replace(/\s+/g, ' ').trim().slice(0, 300)}`);
  const usuario = [`Contato salvo como: ${contato || '(sem nome)'}`, 'Conversa (mais antigas primeiro):', ...linhas].join('\n');
  const base = {model: modelo, messages: [{role: 'system', content: sistema}, {role: 'user', content: usuario}], temperature: 0, max_completion_tokens: 600};
  const tentativas = [{...base, reasoning_effort: 'low', response_format: {type: 'json_schema', json_schema: {name: 'conversa', strict: true, schema: PRIVADO_SCHEMA}}}, {...base, response_format: {type: 'json_object'}}];
  let ultimo = '';
  for (const body of tentativas) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {method: 'POST', headers: {authorization: 'Bearer ' + GROQ_KEY, 'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(30000)});
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      try {
        const o = JSON.parse(String(j.choices?.[0]?.message?.content || ''));
        if (['lead', 'cliente', 'equipe', 'pessoal', 'incerto'].includes(o.tipo)) return {tipo: String(o.tipo), motivo: String(o.motivo || '').slice(0, 200)};
      } catch { /* fora do formato: tenta a próxima forma */ }
      ultimo = 'resposta fora do formato';
      continue;
    }
    ultimo = 'O Groq respondeu ' + r.status + (j && j.error && j.error.message ? ': ' + String(j.error.message).slice(0, 200) : '');
    if (r.status !== 400) break;
  }
  throw new Error(ultimo);
}
// Áudios dos grupos dos clientes: registra os novos em fn_audios, transcreve os pendentes, descobre quem falou (cliente ou
// equipe) e manda para o passo "pedidos" só os do cliente que parecem pedido de alteração. Devolve o mapa mid → {texto, quem}
// dos últimos 3 dias para os avisos de risco e de espera (áudio da equipe só conta como "a Brase respondeu").
type Lido = {ns: string; name: string; raw: Row[]; msgs: GrpMsg[]};
async function audios(c: Row, lidos: Lido[], team: string[], ignore: string[], sink: Row[], chaves?: Set<string>){
  const op = c.op || {}, now = Date.now(), desde = Math.max(c.sinceMs, now - AUDIO_JANELA);
  const novos: Row[] = [];
  for (const l of lidos) for (const r of l.raw) {
    const url = avAudioUrl(r);
    if (url && typeof r.ts === 'number' && r.ts * 1000 >= desde) novos.push({mid: String(r.mid || r.id || r.ts), group_ns: l.ns, grupo: l.name, ts: r.ts, url});
  }
  if (novos.length) await sql`insert into fn_audios ${sql(novos, 'mid', 'group_ns', 'grupo', 'ts', 'url')} on conflict (mid) do nothing`;
  const st: Row = {novos: novos.length};
  const classificados: Row[] = [];
  if (op.audio === false) st.skipped = 'desligado';
  else if (!GROQ_KEY) st.skipped = 'sem o segredo GROQ_API_KEY';
  else {
    // 1. Transcrição.
    const pend = await sql`select mid, tries, url from fn_audios where status = 'pendente' and tries < 3 and ts >= ${Math.floor(desde / 1000)} order by ts limit ${AUDIO_MAX}`;
    const t0 = Date.now();
    let transcritos = 0, falhas = 0;
    for (const a of pend) {
      if (Date.now() - t0 > 60e3) break;
      try {
        const r = await transcrever(String(a.url), String(op.audioModelo || 'whisper-large-v3-turbo'));
        await sql`update fn_audios set status = 'ok', texto = ${r.texto}, modelo = ${r.modelo}, bytes = ${r.bytes}, usage = ${json(r.usage)}, erro = null, updated_at = now() where mid = ${a.mid}`;
        transcritos++;
      } catch (e) {
        if (e instanceof AudioLimite) { st.limite = errText(e).slice(0, 200); break }   // limite do plano gratuito: tenta na próxima
        falhas++;
        const status = e instanceof AudioGrande ? 'grande' : Number(a.tries) + 1 >= 3 ? 'erro' : 'pendente';
        await sql`update fn_audios set tries = tries + 1, status = ${status}, erro = ${errText(e).slice(0, 300)}, updated_at = now() where mid = ${a.mid}`;
      }
    }
    Object.assign(st, {pendentes: pend.length, transcritos, falhas});
    // 2. Quem falou (cliente ou equipe), com as mensagens anteriores do grupo como contexto.
    const semQuem = st.limite ? [] : await sql`select mid, group_ns, grupo, ts, texto from fn_audios where status = 'ok' and quem is null and ts >= ${Math.floor((now - 3 * 864e5) / 1000)} order by ts limit ${QUEM_MAX}`;
    if (semQuem.length) {
      const ns = [...new Set(semQuem.map((a: Row) => String(a.group_ns)))];
      const fatos = new Map<string, Row>((await sql`select user_ns, facts from fn_grupos where user_ns = any(${ns})`).map((r: Row) => [String(r.user_ns), r.facts || {}]));
      for (const a of semQuem) {
        const f = fatos.get(String(a.group_ns)) || {}, l = lidos.find(x => x.ns === String(a.group_ns));
        const msgs: GrpMsg[] = l ? l.msgs : (f.msgs || []);
        const clientes = ((f.authors || []) as string[]).filter(n => !avNameIn(n, team) && !avNameIn(n, ignore) && !/brase/i.test(n)).slice(-8);
        const antes = msgs.filter(x => x.ts < Number(a.ts) && !(avIsAudioKind(x.kind))).slice(-6).map(x => `[${brIso(x.ts * 1000).slice(11, 16)}] ${x.own ? 'Renan (Brase)' : x.author || '?'}: ${x.text}`);
        let quem: string, motivo: string;
        // O jeito do id da mensagem (aparelho de quem mandou) decide antes da IA, que errava com áudio da equipe.
        const eu = msgs.find(x => x.mid === String(a.mid));
        const pm = eu ? avQuemMandou(eu, msgs, team, chaves) : null;
        if (pm) { quem = pm.quem; motivo = 'pela conversa: ' + pm.por + (pm.autor ? ' (' + pm.autor + ')' : '') }
        else try { ({quem, motivo} = await quemFalou(String(a.texto || ''), antes, team, clientes, String(op.audioQuemModelo || 'openai/gpt-oss-20b'))) }
        catch (e) {
          if (e instanceof AudioLimite) { st.limite = errText(e).slice(0, 200); break }
          quem = avQuemPeloTexto(a.texto, team, clientes) || 'incerto'; motivo = 'regra fixa (IA: ' + errText(e).slice(0, 120) + ')';
        }
        await sql`update fn_audios set quem = ${quem}, quem_motivo = ${motivo}, updated_at = now() where mid = ${a.mid}`;
        classificados.push({...a, quem});
      }
      st.classificados = classificados.length;
      st.equipe = classificados.filter(x => x.quem === 'equipe').length;
    }
  }
  const mapa = new Map<string, AvAudio>((await sql`select mid, texto, quem from fn_audios where status = 'ok' and ts >= ${Math.floor((now - 3 * 864e5) / 1000)}`).map((r: Row) => [String(r.mid), {texto: String(r.texto || ''), quem: r.quem}]));
  // 3. Pedido de alteração em áudio: só os do cliente (ou incertos) classificados agora, cada áudio uma vez; áudio da equipe nunca.
  // Só áudio que se sabe ser do cliente vira pedido (incerto não: pode ser da equipe).
  const cand = classificados.filter(a => a.quem === 'cliente' && Number(a.ts) * 1000 >= desde && avPedidoCandidato(a.texto));
  if (cand.length) {
    const ns = [...new Set(cand.map(a => String(a.group_ns)))];
    const fatos = new Map<string, GrpMsg[]>((await sql`select user_ns, facts->'msgs' as msgs from fn_grupos where user_ns = any(${ns})`).map((r: Row) => [String(r.user_ns), r.msgs || []]));
    for (const a of cand) {
      const msgs = avComAudios((lidos.find(l => l.ns === String(a.group_ns)) || {msgs: fatos.get(String(a.group_ns)) || []}).msgs, mapa, team, chaves);
      const eu = msgs.find(x => x.mid === String(a.mid));
      const autor = (eu && eu.author) || AV_AUDIO_SEM_AUTOR;
      const contexto = msgs.filter(x => x.ts < Number(a.ts)).slice(-8).map(x => ({autor: x.own ? 'Renan (Brase)' : x.author || 'não identificado', texto: x.text, quando: brIso(x.ts * 1000)}));
      sink.push({mid: String(a.mid), grupo: String(a.grupo), autor, texto: avAudioTexto(a.texto), ts: Number(a.ts), contexto, audio: true});
    }
    st.pedidos = cand.length;
  }
  return {mapa, st};
}
const avIsAudioKind = (k: string) => ['audio', 'voice', 'ptt'].includes(k);
// 3. Grupos dos clientes: relê os que tiveram mensagem nova, guarda as últimas 40 mensagens e avalia todos os grupos conhecidos.
// Gestor de cada grupo, pelo OPS (op "gestores" da whatsapp-pedidos), para cada aviso do AVISOS - OPERACIONAIS dizer quem
// precisa agir. Guardado em fn_config (k = 'ops_gestores'), relido a cada 30 min ou quando aparece grupo novo; se o OPS não
// responder, vale o guardado e, sem ele, o aviso sai com "Gestor não identificado no OPS".
const GESTORES_TTL = 30 * 60e3;
type Gestores = (grupo: unknown) => string[];
// O OPS também diz quais lojas são da oferta assistida (serviço "reservado"): por grupo (assistida: true) e a lista de nomes,
// guardados junto ({at, grupos, assistida}).
async function gestoresDosGrupos(nomes: string[], avisosConf: Row = {}): Promise<{de: Gestores; st: Row; assistida: (grupo: unknown) => boolean | null; lojas: string[]}> {
  const lista = [...new Set(nomes.map(n => String(n || '').trim()).filter(Boolean))];
  const cache = await getConf('ops_gestores');
  let mapa: Row = cache.grupos && typeof cache.grupos === 'object' ? cache.grupos : {};
  let lojas: string[] = Array.isArray(cache.assistida) ? cache.assistida.map(String) : [];
  const st: Row = {grupos: lista.length, fonte: 'guardado'};
  const velho = Date.now() - (Date.parse(cache.at || '') || 0) >= GESTORES_TTL || !Array.isArray(cache.assistida), novo = lista.some(n => !(n in mapa));
  if (lista.length && (velho || novo)) {
    const conf = await getConf('ops_pedidos');
    if (conf.url && conf.key) {
      try {
        const r = await opsPedidos(conf, {op: 'gestores', grupos: lista});
        if (r.grupos && typeof r.grupos === 'object') {
          mapa = {...mapa, ...r.grupos};
          if (Array.isArray(r.assistida)) lojas = r.assistida.map(String);
          await setConf('ops_gestores', {at: brIso(Date.now()), grupos: mapa, assistida: lojas}); st.fonte = 'OPS';
        }
      } catch (e) { st.erro = errText(e).slice(0, 200) }
    }
  }
  st.assistida = lojas.length;
  // Grupo de loja que não está no OPS: gestor definido à mão em fn_config avisos.gestoresGrupo = {"nome do grupo": ["Nome"]}.
  const manual: Row = avisosConf.gestoresGrupo || {};
  const bruto = (grupo: unknown): string[] => {
    const k = String(grupo || '').trim(), m = manual[k], g = mapa[k];
    if (Array.isArray(m) && m.length) return m.map(String);
    return g && Array.isArray(g.gestores) ? g.gestores.map(String) : [];
  };
  // Sem gestor, ou gestor que saiu da operação: vai para o gestor padrão (o Luis).
  const de: Gestores = (grupo) => avQuemCuida(bruto(grupo), cfgGestores(avisosConf));
  st.semGestor = lista.filter(n => !bruto(n).length);
  const assistida = (grupo: unknown) => opsAssistida(mapa, grupo);
  return {de, st, assistida, lojas};
}
// O que o OPS disse da loja do grupo: true (assistida), false (achou a loja e não é assistida) ou null (não achou loja).
function opsAssistida(mapa: Row, grupo: unknown): boolean | null {
  const g = mapa[String(grupo || '').trim()];
  if (!g) return null;
  if (g.assistida) return true;
  return Array.isArray(g.lojas) && g.lojas.length ? false : null;
}
// Quem cuida e como marcar: fn_config avisos.gestoresTelefone ({"Gabriel": "557196234092"}), gestoresSairam (["Thalita"]) e
// gestorPadrao ("Luis"). "@<número>" vira a marcação de verdade no WhatsApp; sem número, "@Nome" em texto.
const cfgGestores = (c: Row) => ({sairam: c.gestoresSairam || [], padrao: c.gestorPadrao || 'Luis'});
// destino(grupo): 'fora' (assessoria e ignorados), 'assistida' (vai para o grupo do Renan) ou 'avisos'. Começa com o que
// ficou guardado do OPS e é atualizado no passo "grupos", depois de perguntar ao OPS.
type Ctx = {gestores: Gestores; marca: (nome: unknown) => string; estado: Row[]; gruposOk: boolean; gcfg: AvGruposCfg; destino: (grupo: unknown) => AvDestino; assistidaGrupos: string[]; avisosGrupos: string[]; team: string[]};
function novoCtx(c: Row, opsCache: Row = {}): Ctx {
  const tel = c.gestoresTelefone || {}, mapa: Row = opsCache.grupos || {};
  const gcfg = avGruposCfg(c, Array.isArray(opsCache.assistida) ? opsCache.assistida : []);
  return {gestores: () => avQuemCuida([], cfgGestores(c)), marca: (nome) => avMarca(avQuemCuida(nome, cfgGestores(c))[0], tel), estado: [], gruposOk: false,
    gcfg, destino: (g) => avDestino(g, gcfg, opsAssistida(mapa, g)), assistidaGrupos: [], avisosGrupos: [], team: [...(c.team || [])]};
}
// Aviso de grupo da assistida: canal do Renan e sem marcar ninguém.
const paraOnde = (ctx: Ctx, grupo: unknown, canal: 'operacional' | 'resumo' = 'operacional') => ctx.destino(grupo) === 'assistida' ? 'renan' as const : canal;
// Cliente precisa de atendimento? A IA gratuita do Groq lê as mensagens do cliente que ainda não tiveram resposta da Brase
// e diz se alguma pergunta, pede algo ou reclama (e qual é a primeira); agradecimento, "pode ser", aviso solto e mensagem de
// outra agência não contam. Sem o Groq, vale a regra fixa (avPrecisaPeloTexto). A decisão fica guardada por grupo em
// fn_config (k = 'atendimento') até chegar mensagem nova do cliente.
const ATEND_SCHEMA = {type: 'object', properties: {precisa: {type: 'boolean'}, desde: {type: 'integer'}, pedido: {type: 'string'}, motivo: {type: 'string'}}, required: ['precisa', 'desde', 'pedido', 'motivo'], additionalProperties: false};
const ATEND_MAX = 4; // grupos classificados por rodada
async function decideAtendimento(grupo: string, antes: GrpMsg[], pend: GrpMsg[], modelo: string){
  const reserva = () => { const i = avPrecisaPeloTexto(pend.map(m => m.text)); return {precisa: i > 0, desdeMid: i > 0 ? pend[i - 1].mid : '', pedido: '', motivo: 'regra fixa', fonte: 'regra'} };
  if (!GROQ_KEY || !pend.length) return reserva();
  const sistema = `Você lê um grupo de WhatsApp entre a Brase (agência que cuida do iFood de restaurantes) e o cliente (o dono do restaurante ou alguém da loja) e decide se o cliente está esperando atendimento da Brase.
- precisa = true: o cliente perguntou algo, pediu algo (mudança no cardápio, preço, foto, combo, campanha, relatório, reunião, ajuda), relatou um problema ou reclamou, e a Brase ainda não respondeu.
- precisa = false: agradecimento, confirmação ("ok", "pode ser", "por mim tudo bem", "combinado", "show"), aviso que não pede resposta ("tô chegando", "gravamos hoje", "acabou o insumo e pausei"), número ou informação solta que responde algo da Brase, conversa entre pessoas do cliente, mensagem de outra agência ou fornecedor que não é para a Brase.
Responda em JSON: {"precisa": true | false, "desde": número da primeira mensagem do cliente que pede atendimento (1 = a primeira da lista; 0 se nenhuma), "pedido": o que o cliente precisa em até 12 palavras ("" se nada), "motivo": uma frase curta}.`;
  const linha = (m: GrpMsg) => `${m.own ? 'Renan (Brase)' : m.author || 'Cliente'}: ${String(m.text || '').replace(/@\d{6,}/g, '').replace(/\s+/g, ' ').trim().slice(0, 400)}`;
  const usuario = [`Grupo: ${grupo}`, 'Antes (contexto):', ...(antes.length ? antes.map(linha) : ['(nada)']), '', 'Mensagens do cliente sem resposta da Brase:', ...pend.map((m, i) => `${i + 1}. ${linha(m)}`)].join('\n');
  const base = {model: modelo, messages: [{role: 'system', content: sistema}, {role: 'user', content: usuario}], temperature: 0, max_completion_tokens: 700};
  const tentativas = [{...base, reasoning_effort: 'low', response_format: {type: 'json_schema', json_schema: {name: 'atendimento', strict: true, schema: ATEND_SCHEMA}}}, {...base, response_format: {type: 'json_object'}}];
  for (const body of tentativas) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {method: 'POST', headers: {authorization: 'Bearer ' + GROQ_KEY, 'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(30000)});
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (r.status === 400) continue; break }
      const o = JSON.parse(String(j.choices?.[0]?.message?.content || ''));
      if (typeof o.precisa !== 'boolean') continue;
      const i = Number.isInteger(o.desde) && o.desde >= 1 && o.desde <= pend.length ? o.desde : 1;
      return {precisa: o.precisa, desdeMid: o.precisa ? pend[i - 1].mid : '', pedido: String(o.pedido || '').slice(0, 160), motivo: String(o.motivo || '').slice(0, 200), fonte: 'ia'};
    } catch { /* fora do formato ou rede: tenta a próxima forma */ }
  }
  return reserva();
}
// Risco de cancelamento: o filtro de palavras (avIsRisk) só indica; a IA gratuita do Groq lê a mensagem com o contexto e
// confirma se o cliente está insatisfeito com a Brase, reclamando do resultado ou pensando em sair. Decisão guardada por
// mensagem em fn_config (k = 'riscos'). Sem o Groq, vale o filtro.
const RISCO_SCHEMA = {type: 'object', properties: {risco: {type: 'boolean'}, motivo: {type: 'string'}}, required: ['risco', 'motivo'], additionalProperties: false};
async function confirmaRisco(grupo: string, msg: GrpMsg, antes: GrpMsg[], modelo: string): Promise<{risco: boolean; motivo: string}> {
  if (!GROQ_KEY) return {risco: true, motivo: 'filtro (sem IA)'};
  const sistema = `Você lê um grupo de WhatsApp entre a Brase (agência que cuida do iFood de restaurantes) e o cliente (o dono do restaurante) e diz se uma mensagem do cliente é RISCO DE CANCELAMENTO do serviço da Brase.
- risco = true: o cliente fala em cancelar, encerrar ou pausar o contrato ou o serviço da Brase, sair, que não está tendo resultado com a Brase, que está caro, está insatisfeito ou decepcionado com o trabalho, ou reclama forte das vendas culpando o serviço.
- risco = false: rotina da loja (cancelar pedido, entrega, o iFood encerrou uma campanha, pausar item), comentário normal sobre o movimento ("a sexta foi mais devagar", "o fim de semana foi razoável"), explicação, pedido de ajuda sem insatisfação.
Responda em JSON: {"risco": true | false, "motivo": "uma frase curta"}.`;
  const linha = (m: GrpMsg) => `${m.own ? 'Renan (Brase)' : m.author || '?'}: ${String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 600)}`;
  const usuario = [`Grupo: ${grupo}`, 'Antes:', ...(antes.length ? antes.map(linha) : ['(nada)']), '', 'MENSAGEM: ' + linha(msg)].join('\n');
  const base = {model: modelo, messages: [{role: 'system', content: sistema}, {role: 'user', content: usuario}], temperature: 0, max_completion_tokens: 500};
  for (const body of [{...base, reasoning_effort: 'low', response_format: {type: 'json_schema', json_schema: {name: 'risco', strict: true, schema: RISCO_SCHEMA}}}, {...base, response_format: {type: 'json_object'}}]) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {method: 'POST', headers: {authorization: 'Bearer ' + GROQ_KEY, 'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(30000)});
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (r.status === 400) continue; break }
      const o = JSON.parse(String(j.choices?.[0]?.message?.content || ''));
      if (typeof o.risco === 'boolean') return {risco: o.risco, motivo: String(o.motivo || '').slice(0, 200)};
    } catch { /* tenta a próxima forma */ }
  }
  return {risco: true, motivo: 'filtro (IA não respondeu)'};
}
async function grupos(c: Row, contacts: Row[], sink: Row[] = [], ctx: Ctx = novoCtx(c)){
  const flow = String(c.flow || 'f316913'), op = c.op || {}, now = Date.now();
  const waitMin = Number(op.semRespostaMin) || 120, quietDays = Number(op.silencioDias) || 5, minGroups = Number(op.equipeGrupos) || 4;
  // Grupo fora dos avisos (a assessoria do Luis e os ignorados, decisão do dono): nem é lido.
  const groups = contacts.filter(x => avClientGroup(x.name) && ctx.destino(x.name) !== 'fora');
  const ns = groups.map(x => String(x.user_ns));
  const known = new Map<string, Row>((ns.length ? await sql`select user_ns, last_message_at, facts from fn_grupos where user_ns = any(${ns})` : []).map((r: Row) => [String(r.user_ns), r]));
  const changed = groups.filter(x => { const at = nicoTime(x.last_message_at), k = known.get(String(x.user_ns)); return at > 0 && at > (k && k.last_message_at ? new Date(k.last_message_at).getTime() : 0) })
    .sort((a, b) => nicoTime(a.last_message_at) - nicoTime(b.last_message_at)).slice(0, READ_MAX);
  const lidos: Lido[] = [];
  for (const x of changed) {
    const j = await nico(OPS_KEY, 'subscriber/chat-messages', {user_ns: String(x.user_ns), limit: 100});
    const msgs = (Array.isArray(j.data) ? j.data : []).map(grpMsg).filter(Boolean).sort((a: GrpMsg, b: GrpMsg) => a.ts - b.ts) as GrpMsg[];
    lidos.push({ns: String(x.user_ns), name: avGroupLabel(x.name), raw: Array.isArray(j.data) ? j.data : [], msgs});
    const old = (known.get(String(x.user_ns)) || {}).facts || {};
    const authors = [...new Set([...(old.authors || []), ...msgs.filter(m => !m.own && m.author).map(m => m.author)])].slice(-60);
    const facts = {name: avGroupLabel(x.name), msgs: msgs.slice(-40), authors, firstSeen: old.firstSeen || brIso(now)};
    await sql`insert into fn_grupos (user_ns, flow_ns, nome, last_message_at, facts, updated_at)
      values (${String(x.user_ns)}, ${flow}, ${facts.name}, ${new Date(nicoTime(x.last_message_at))}, ${json(facts)}, now())
      on conflict (user_ns) do update set nome = excluded.nome, last_message_at = excluded.last_message_at, facts = excluded.facts, updated_at = now()`;
    // Reunião com o cliente: link do Meet no grupo (a rotina de IA confirma depois).
    const meets = avMeetings(String(x.user_ns), facts.name, msgs);
    if (meets.length) await sql`insert into fn_reunioes_clientes ${sql(meets as unknown as Row[], 'id', 'group_ns', 'grupo', 'dia', 'link_at', 'meet', 'autor')} on conflict (id) do nothing`;
  }
  // Equipe: a lista guardada + quem escreve em 4 ou mais grupos de clientes (dono com 3 lojas continua sendo cliente).
  const todos = await sql`select user_ns, nome, facts from fn_grupos where flow_ns = ${flow}`;
  const all = todos.filter((r: Row) => ctx.destino(r.nome) !== 'fora');
  const count = new Map<string, number>();
  for (const r of all) for (const a of new Set<string>((r.facts && r.facts.authors) || [])) count.set(a, (count.get(a) || 0) + 1);
  const team = [...(c.team || []), ...[...count].filter(([, n]) => n >= minGroups).map(([a]) => a)], ignore = c.ignore || [];
  ctx.team = team;
  // Áudios: transcreve e já põe no passo "pedidos" os que pedem alteração; os textos entram nos avisos abaixo.
  // Jeitos de id da equipe em todos os grupos (inclusive os que ficam fora dos avisos, onde o Luis mais escreve).
  const chaves = avChavesDaEquipe([...todos.map((r: Row) => (r.facts && r.facts.msgs) || []), ...lidos.map(l => l.msgs)], team);
  const aud = await audios(c, lidos, team, ignore, sink, chaves);
  // Mensagens do cliente que parecem pedido de alteração no iFood: vão para o passo "pedidos" (OPS), com as anteriores de contexto.
  for (const l of lidos) for (const m of l.msgs) {
    if (m.own || !m.author || avNameIn(m.author, team) || avNameIn(m.author, ignore) || /brase/i.test(m.author) || m.ts * 1000 < Math.max(c.sinceMs, now - 6 * 3600e3)) continue;
    const raw = l.raw.find((r: Row) => String(r.mid || r.id || r.ts) === m.mid), texto = typeof raw?.content === 'string' ? raw.content.replace(/^\s*👤[^\n]*\n?/u, '').trim() : '';
    if (!texto || !avPedidoCandidato(texto)) continue;
    const contexto = l.msgs.filter(x => x.ts < m.ts).slice(-8).map(x => ({autor: x.own ? 'Renan (Brase)' : x.author, texto: x.text, quando: brIso(x.ts * 1000)}));
    sink.push({mid: m.mid, grupo: l.name, autor: m.author, texto, ts: m.ts, contexto});
  }
  const rows: AvRow[] = [], meetDays = Number(op.reuniaoDias) || 30, exp = avExpediente(op.expediente);
  const gest = await gestoresDosGrupos(all.map((r: Row) => String(r.nome || (r.facts || {}).name || '')), c);
  ctx.gestores = gest.de;
  // Assistida: pelo que o OPS acabou de dizer (loja com serviço "reservado") e pela configuração (BRASE - fora da assessoria, Texas).
  ctx.gcfg = avGruposCfg(c, gest.lojas);
  ctx.destino = (g) => avDestino(g, ctx.gcfg, gest.assistida(g));
  const atend: Row = (await getConf('atendimento')).grupos || {}, modelo = String(op.audioQuemModelo || 'openai/gpt-oss-20b');
  let classificados = 0, atendMudou = false;
  // Espera que começou antes de ligar o aviso novo (op.atendimentoDesde) não dispara na hora: vai só para o resumo das 9h.
  const atendDesde = Date.parse(op.atendimentoDesde || '') || c.sinceMs;
  const riscoCom: string[] = Array.isArray(op.riscoTambem) ? op.riscoTambem : ['Luis'];
  const riscos: Row = (await getConf('riscos')).msgs || {};
  let riscosMudou = false, riscosIa = 0;
  // Última reunião de cada grupo (provável ou realizada), para o aviso de 30 dias.
  const lastMeet = new Map<string, Row>((await sql`select distinct on (group_ns) group_ns, dia::text as dia, status from fn_reunioes_clientes where status <> 'nao_realizada' order by group_ns, dia desc`).map((r: Row) => [String(r.group_ns), r]));
  for (const r of all) {
    const ns = String(r.user_ns), f = r.facts || {}, name = String(r.nome || f.name || 'Grupo'), msgsA = avComAudios(f.msgs || [], aud.mapa, team, chaves);
    // Assistida: o aviso vai para o grupo do Renan (Organização - BRASE), sem marcar ninguém, e o resto entra no pacote da manhã.
    const assist = ctx.destino(name) === 'assistida', canal = assist ? 'renan' as const : 'operacional' as const;
    const st = avGroupState(msgsA, team, ignore), quem = assist ? [] : gest.de(name), marcas = quem.map(ctx.marca);
    const texto = (t: string) => assist ? avParaAssistida(t) : t;
    const estado: Row = {grupo: name, gestores: assist ? ['Renan'] : quem, assistida: assist};
    if (assist) ctx.assistidaGrupos.push(name); else ctx.avisosGrupos.push(name);
    // 30 dias sem reunião e grupo parado: só no resumo das 9h (repetem enquanto não resolver).
    const lm = lastMeet.get(ns);
    if (op.reuniao30 !== false && lm && avReuniao30Due(lm.dia, now, meetDays)) estado.reuniao30 = `última reunião em ${lm.dia.slice(8, 10)}/${lm.dia.slice(5, 7)}${lm.status === 'realizada' ? '' : ' (link do Meet no grupo)'}`;
    const ref = st.lastBrase ? st.lastBrase * 1000 : Date.parse(f.firstSeen || '') || now;
    if (now - ref >= quietDays * 864e5) estado.parado = `${Math.floor((now - ref) / 864e5)} dias sem mensagem da Brase`;
    // Cliente precisa de atendimento: pergunta, pedido ou reclamação sem resposta há 2 h no horário comercial (sai na hora;
    // o que seguir pendente entra no resumo das 9h).
    if (st.waiting && st.waiting.ts * 1000 >= c.sinceMs && avMsUteis(st.waiting.ts * 1000, now, exp) >= waitMin * 60e3) {
      const doCliente = (m: GrpMsg) => !m.own && !!m.author && !avNameIn(m.author, team) && !avNameIn(m.author, ignore) && !/brase/i.test(m.author) && m.author !== AV_AUDIO_SEM_AUTOR;
      const pend = msgsA.filter(m => m.ts >= st.waiting!.ts && doCliente(m)).slice(-12);
      const ultimo = pend.length ? pend[pend.length - 1].mid : st.waiting.mid;
      let d = atend[ns];
      if ((!d || d.ultimo !== ultimo) && classificados < ATEND_MAX) {
        classificados++;
        d = {ultimo, ...(await decideAtendimento(name, msgsA.filter(m => m.ts < st.waiting!.ts).slice(-6), pend.length ? pend : [st.waiting], modelo)), at: brIso(now)};
        atend[ns] = d; atendMudou = true;
      }
      if (d && d.ultimo === ultimo && d.precisa) {
        const alvo = pend.find(m => m.mid === d.desdeMid) || st.waiting, util = avMsUteis(alvo.ts * 1000, now, exp);
        if (util >= waitMin * 60e3) {
          if (alvo.ts * 1000 >= atendDesde) rows.push({id: `atend:${ns}:${alvo.mid}`, canal, tipo: 'atendimento', texto: texto(avAtendimentoText(name, alvo, String(d.pedido || ''), util, now, marcas)), grupo: name});
          estado.atendimento = `esperando desde ${avWhen(brIso(alvo.ts * 1000))}${d.pedido ? ` (${d.pedido})` : ''}`;
        }
      }
    }
    // Risco de cancelamento: na hora, marcando o Luis e o gestor (no máximo um por grupo a cada 6 h).
    if (op.risco !== false) for (const m of st.risks) if (m.ts * 1000 >= c.sinceMs) {
      let d = riscos[m.mid];
      if (!d) {
        if (riscosIa >= 2) continue; // o resto fica para a próxima rodada
        riscosIa++;
        d = {...(await confirmaRisco(name, m, msgsA.filter(x => x.ts < m.ts).slice(-6), modelo)), at: brIso(now)};
        riscos[m.mid] = d; riscosMudou = true;
      }
      if (d.risco) rows.push({id: `risco:${ns}:${Math.floor(m.ts / 21600)}`, canal, tipo: 'risco', grupo: name,
        texto: assist ? avParaAssistida(avRiscoText(name, m, [])) : avRiscoText(name, m, avQuemCuida([...riscoCom, ...quem], cfgGestores(c)).map(ctx.marca))});
    }
    ctx.estado.push(estado);
  }
  if (atendMudou) await setConf('atendimento', {grupos: atend});
  if (riscosMudou) {
    // Guarda só os dos últimos 7 dias.
    const corte = brIso(now - 7 * 864e5);
    for (const k of Object.keys(riscos)) if (String(riscos[k].at || '') < corte) delete riscos[k];
    await setConf('riscos', {msgs: riscos});
  }
  ctx.gruposOk = true;
  return {contacts: contacts.length, groups: groups.length, read: changed.length, known: all.length, assistida: ctx.assistidaGrupos, team: team.length, audios: aud.st, gestores: gest.st, atendimento: {classificados}, queued: await queue(rows)};
}
// 4. Horário que o Renan sugere: bloqueia a agenda da Central (holds sem lead) e avisa no AVISOS - COMERCIAIS. Prioridade: só
// conta horário com cliente ou com lead; compromisso pessoal e o grupo de anotações do Renan não contam (reunião tem prioridade).
// - grupo de cliente "BRASE - ": bloqueia 60 min; grupo "D.I - " (1ª reunião, o Renan fica 5 a 10 min): só avisa e bloqueia 10 min;
// - privado com cliente (o mesmo nome de quem escreve num grupo de cliente, fora a equipe): segue a regra do grupo dele;
// - privado com lead da Central (pelo telefone): bloqueia 60 min;
// - privado com alguém da equipe (o Lipe, os gestores; pelo nome do contato): ignora (horário que o Renan passa para o Lipe);
// - outro privado: a IA (Groq) lê a conversa e só conta se for lead ou cliente pelo contexto (bloqueia 60 min). Muitos contatos
//   chegam sem nome no NicoChat (o do Lipe pode ser um deles), então o que a IA decide fica guardado por contato por 14 dias em
//   fn_config (k = 'privados', {mapa: {user_ns: {tipo, motivo, contato, at}}}); dá para corrigir à mão ali (tipo "equipe");
// - qualquer outro grupo: ignora.
const CONTEXTO_MAX = 3; // conversas classificadas por rodada
const CONTEXTO_VALE = 14 * 864e5;
async function agenda(c: Row, contacts: Row[], prev: Row, ctx: Ctx){
  if (c.com && c.com.renan === false) return {skipped: 'desligado'};
  const now = Date.now(), cursor = Math.max(Date.parse(prev.renanCursor || '') || 0, c.sinceMs);
  const list = contacts.filter(x => (avClientGroup(x.name) || !/^\s*g:/i.test(String(x.name || ''))) && ctx.destino(x.name) !== 'fora' && nicoTime(x.last_message_at) > cursor)
    .sort((a, b) => nicoTime(a.last_message_at) - nicoTime(b.last_message_at)).slice(0, AG_READ_MAX);
  let found = 0, queued = 0, blocked = 0, ignored = 0, maxAt = cursor, contexto = 0;
  const porContexto: Row = {}, modelo = String((c.op && c.op.audioQuemModelo) || 'openai/gpt-oss-20b');
  let privados: Row | null = null, privadosMudou = false;
  let clientGroups: {nome: string; authors: string[]}[] | null = null, leads: Map<string, {id: string; data: Row}> | null = null;
  const team = [...(c.team || [])];
  for (const x of list) {
    maxAt = Math.max(maxAt, nicoTime(x.last_message_at));
    const j = await nico(OPS_KEY, 'subscriber/chat-messages', {user_ns: String(x.user_ns), limit: 20});
    const mine = (Array.isArray(j.data) ? j.data : []).filter((m: Row) => m && m.type === 'agent' && typeof m.ts === 'number' && m.ts * 1000 > cursor && typeof m.content === 'string')
      .map((m: Row) => ({m, slots: avParseSlots(m.content.replace(/^\s*👤[^\n]*\n?/u, ''), m.ts * 1000).filter(st => st > now)})).filter((y: Row) => y.slots.length);
    if (!mine.length) continue;
    // Com quem é a conversa.
    let where = '', kind: AvAgendaKind | null = null;
    // Cliente da assistida: bloqueia a agenda e avisa o comercial sem dizer qual loja (ninguém além do Renan vê a assistida).
    if (avClientGroup(x.name)) { kind = avIsDi(x.name) ? 'di' : 'cliente'; where = ctx.destino(x.name) === 'assistida' ? 'cliente da assistida' : avGroupLabel(x.name) }
    else if (avNameIn(String(x.name || ''), team.filter(n => !/^renan$/i.test(String(n).trim())))) { porContexto.equipe_nome = (porContexto.equipe_nome || 0) + 1 }
    else {
      clientGroups ??= (await sql`select nome, facts->'authors' as authors from fn_grupos`).map((r: Row) => ({nome: String(r.nome), authors: (r.authors || []).filter((a: string) => !avNameIn(a, team))}));
      const g = avClientOf(x.name, clientGroups);
      if (g) { where = ctx.destino(g) === 'assistida' ? 'cliente da assistida, no privado' : `${x.name} (${g}), no privado`; kind = avIsDi(g) ? 'di' : 'cliente' }
      else {
        leads ??= leadIndex((await crmCall({op: 'load'})).docs || []);
        const lead = leads.get(waPhoneKey(x.phone || String(x.user_id || '').split('-')[0]));
        if (lead) { where = `Lead ${lead.data.name || ''}${lead.data.company ? ' · ' + lead.data.company : ''}, no privado`; kind = 'lead' }
        else {
          privados ??= (await getConf('privados')).mapa || {};
          const ns = String(x.user_ns), memo = (privados as Row)[ns];
          let tipo = memo && ['lead', 'cliente', 'equipe', 'pessoal'].includes(memo.tipo) && Date.now() - (Date.parse(memo.at || '') || 0) < CONTEXTO_VALE ? String(memo.tipo) : '';
          if (!tipo && GROQ_KEY && contexto < CONTEXTO_MAX) {
            contexto++;
            try {
              const r = await conversaDeQuem(String(x.name || ''), Array.isArray(j.data) ? j.data : [], team, modelo);
              tipo = r.tipo;
              if (tipo !== 'incerto') { (privados as Row)[ns] = {tipo, motivo: r.motivo, contato: String(x.name || x.phone || ''), at: brIso(Date.now())}; privadosMudou = true }
            } catch (e) { porContexto.erro = errText(e).slice(0, 200) }
          }
          if (tipo) porContexto[tipo] = (porContexto[tipo] || 0) + 1;
          if (tipo === 'lead' || tipo === 'cliente') { where = `${x.name || 'Contato sem nome'} (${tipo} pela conversa), no privado`; kind = tipo === 'lead' ? 'lead' : 'cliente' }
        }
      }
    }
    if (!kind) { ignored += mine.length; continue }
    for (const {m, slots} of mine) {
      found++;
      const id = 'agenda:' + (m.mid || m.id);
      if ((await sql`select 1 from fn_avisos where id = ${id}`).length) continue;
      let ok = true;
      for (const st of slots) {
        try { await crmCall({op: 'set', col: 'holds', id: avHoldId(st), data: {block: true, start: avHoldStart(st), dur: kind === 'di' ? AV_DI_MIN : 60, label: 'Renan: ' + where + (kind === 'di' ? ' (rápida)' : ''), by: 'avisos', at: new Date().toISOString()}}); blocked++ }
        catch { ok = false }
      }
      queued += await queue([{id, canal: 'comercial', tipo: 'agenda_renan', texto: avAgendaText(where, kind, slots, ok)}]);
    }
  }
  if (privadosMudou && privados) await setConf('privados', {mapa: privados});
  return {read: list.length, found, queued, blocked, ignored, contexto: porContexto, cursor: new Date(maxAt).toISOString()};
}
// Ajustes pedidos na agenda da Central (fn_config avisos.agendaFila: [{op: 'delete', id} | {op: 'set', id, data}]): roda uma vez e limpa.
async function agendaFila(c: Row){
  const fila = Array.isArray(c.agendaFila) ? c.agendaFila : [];
  if (!fila.length) return {n: 0};
  let ok = 0;
  for (const f of fila) {
    if (!f || !/^r\d{12}$/.test(String(f.id))) continue;
    if (f.op === 'delete') { await crmCall({op: 'delete', col: 'holds', id: String(f.id)}); ok++ }
    else if (f.op === 'set' && f.data && typeof f.data === 'object') { await crmCall({op: 'set', col: 'holds', id: String(f.id), data: f.data}); ok++ }
  }
  await sql`update fn_config set v = v - 'agendaFila', updated_at = now() where k = 'avisos'`;
  return {n: ok};
}
// 5. Pedido de alteração no iFood feito pelo cliente no grupo: manda para a função whatsapp-pedidos do OPS, que lê com IA contra
// o cardápio real, aplica sozinha (snapshot antes) e devolve o que fez; o aviso vai para o AVISOS - OPERACIONAIS marcando o
// gestor. fn_config (k = 'ops_pedidos'): {url, key, mode: 'on' | 'simular' | 'off'}. Também roda as alterações com hora marcada.
const PEDIDOS_MAX = 3;
async function opsPedidos(conf: Row, body: Row){
  const r = await fetch(String(conf.url), {method: 'POST', headers: {'content-type': 'application/json', 'x-pedidos-key': String(conf.key)}, body: JSON.stringify(body), signal: AbortSignal.timeout(100000)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OPS respondeu ' + r.status + (j && j.error ? ': ' + String(j.error).slice(0, 200) : ''));
  return j as Row;
}
async function pedidos(sink: Row[], ctx: Ctx){
  const conf = await getConf('ops_pedidos');
  if (!conf.url || !conf.key || conf.mode === 'off' || !conf.mode) return {skipped: 'desligado'};
  let enviados = 0, avisos = 0;
  for (const p of sink) {
    if (enviados >= PEDIDOS_MAX) break;
    const id = 'pedido:' + p.mid;
    if ((await sql`select 1 from fn_avisos where id = ${id}`).length) continue;
    enviados++;
    let r: Row;
    // Falha do OPS não pode sumir com o pedido: vira aviso "NÃO aplicado" com o erro, para o gestor fazer à mão.
    try { r = await opsPedidos(conf, {op: 'pedido', grupo: p.grupo, autor: p.autor, texto: p.texto, mensagem_id: p.mid, enviado_em: brIso(p.ts * 1000), contexto: p.contexto, simular: conf.mode === 'simular'}) }
    catch (e) { r = {status: 'erro', erro: 'O OPS não respondeu: ' + errText(e).slice(0, 200)} }
    if (r.status === 'nada' || r.repetido) {
      await sql`insert into fn_avisos (id, canal, tipo, texto, sent_at) values (${id}, 'operacional', 'pedido_nada', ${String(r.resumo || 'não é pedido').slice(0, 500)}, now()) on conflict (id) do nothing`;
      continue;
    }
    // Assistida: o resultado vai para o grupo do Renan, sem marcar ninguém.
    const assist = ctx.destino(p.grupo) === 'assistida';
    const texto = assist ? avParaAssistida(avPedidoText(p.grupo, p.autor, p.texto, {...r, gestor: null}, []))
      : avPedidoText(p.grupo, p.autor, p.texto, {...r, gestor: r.gestor ? ctx.marca(r.gestor) : null}, ctx.gestores(p.grupo).map(ctx.marca));
    avisos += await queue([{id, canal: assist ? 'renan' : 'operacional', tipo: 'pedido_ifood', texto, grupo: String(p.grupo)}]);
  }
  let horaMarcada = 0;
  if (conf.mode === 'on') {
    const ag = await opsPedidos(conf, {op: 'agendados'});
    for (const e of Array.isArray(ag.executados) ? ag.executados : []) {
      horaMarcada++;
      const assist = ctx.destino(e.cliente) === 'assistida';
      avisos += await queue([{id: 'agendado:' + crypto.randomUUID(), canal: assist ? 'renan' : 'operacional', tipo: 'pedido_agendado', grupo: e.cliente ? String(e.cliente) : null,
        texto: assist ? avParaAssistida(avAgendadoText({...e, gestor: null})) : avAgendadoText({...e, gestor: ctx.marca(e.gestor || '')})}]);
    }
  }
  return {candidatos: sink.length, enviados, horaMarcada, avisos};
}
// 6. Reuniões para o OPS e a Central. (a) Reunião "realizada" em fn_reunioes_clientes (link do Meet no grupo, confirmada
// pela rotina) → função reunioes-clientes do OPS: marca a reunião do calendário do cliente como feita e prevê a próxima.
// (b) Anotações do Gemini que a rotina gravou em fn_reunioes_notas: cliente → OPS (resumo + tarefas no Comando para o
// gestor); lead → observações do card na Central; interna → ignorada. Avisa no AVISOS - OPERACIONAIS (cliente) ou no
// AVISOS - COMERCIAIS (lead). Até 3 de cada por rodada. Usa a mesma chave da whatsapp-pedidos (fn_config ops_pedidos).
const REUNIOES_MAX = 3;
class OpsAusente extends Error {}
// Chamada à função reunioes-clientes do OPS (mesma chave da whatsapp-pedidos). null = sem a configuração do OPS.
async function opsReunioes(): Promise<((body: Row) => Promise<Row>) | null> {
  const conf = await getConf('ops_pedidos');
  if (!conf.url || !conf.key) return null;
  const url = String(conf.urlReunioes || String(conf.url).replace(/whatsapp-pedidos\/?$/, 'reunioes-clientes'));
  return async (body: Row) => {
    const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', 'x-pedidos-key': String(conf.key)}, body: JSON.stringify(body), signal: AbortSignal.timeout(60000)});
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 && !j.status) throw new OpsAusente('função reunioes-clientes ainda não publicada no OPS');
    if (!r.ok) throw new Error('OPS respondeu ' + r.status + (j && j.error ? ': ' + String(j.error).slice(0, 200) : ''));
    return j as Row;
  };
}
// Ações criadas na aba Ações do OPS ganham um número (fn_tarefas.codigo) para o gestor concluir com "feito 12".
async function salvarAcoes(lista: unknown, origem: string){
  const rows = (Array.isArray(lista) ? lista : []).filter((t: Row) => t && /^[0-9a-f-]{36}$/i.test(String(t.id || '')) && t.titulo)
    .map((t: Row) => ({ops_id: String(t.id), origem, titulo: String(t.titulo).slice(0, 300), cliente: t.cliente ? String(t.cliente) : null, responsavel: t.responsavel ? String(t.responsavel) : null, prazo: t.prazo ? String(t.prazo).slice(0, 10) : null}));
  if (!rows.length) return 0;
  return (await sql`insert into fn_tarefas ${sql(rows, 'ops_id', 'origem', 'titulo', 'cliente', 'responsavel', 'prazo')} on conflict (ops_id) do nothing returning codigo`).length;
}
async function reunioesOps(ctx: Ctx, cfg: Row = {}){
  const gestores = ctx.gestores, quem = (r: Row, grupo: unknown) => r.gestor ? avQuemCuida([r.gestor], cfgGestores(cfg)) : gestores(grupo);
  // Reunião registrada no OPS: entra no resumo das 9h do gestor; a da assistida sai na hora no grupo do Renan.
  const linhaReuniao = (id: string, tipo: string, linha: string, cliente: string, grupo: unknown, gest: string[]): AvRow =>
    paraOnde(ctx, grupo, 'resumo') === 'renan' || ctx.destino(cliente) === 'assistida'
      ? {id, canal: 'renan', tipo, texto: `🗓 *${cliente}*: ${linha}`, grupo: cliente}
      : {id, canal: 'resumo', tipo, texto: linha, grupo: cliente, gestores: gest};
  const ops = await opsReunioes();
  if (!ops) return {skipped: 'sem a configuração do OPS (fn_config ops_pedidos)'};
  const st: Row = {meet: 0, notas: 0, avisos: 0};
  try {
    // (a) Reuniões confirmadas pela rotina (dos últimos 45 dias).
    const reais = await sql`select id, grupo, dia::text as dia from fn_reunioes_clientes where status = 'realizada' and ops_at is null and dia >= current_date - 45 order by dia limit ${REUNIOES_MAX}`;
    for (const m of reais) {
      if (ctx.destino(m.grupo) === 'fora') { await sql`update fn_reunioes_clientes set ops_status = 'ignorado', ops_at = now() where id = ${m.id}`; continue }
      let r: Row;
      try { r = await ops({op: 'reuniao', id: 'meet:' + m.id, grupo: m.grupo, dia: m.dia, fonte: 'rotina dos grupos'}) }
      catch (e) { if (e instanceof OpsAusente) throw e; await sql`update fn_reunioes_clientes set ops_status = 'erro', ops_info = ${errText(e).slice(0, 300)} where id = ${m.id}`; continue }
      st.meet++;
      st.acoes = (st.acoes || 0) + await salvarAcoes(r.tarefas_criadas, 'meet:' + m.id);
      await sql`update fn_reunioes_clientes set ops_status = ${r.status === 'ok' ? 'ok' : String(r.status || 'erro')}, ops_info = ${String(r.reuniao || r.cliente || '').slice(0, 200)}, ops_at = now() where id = ${m.id}`;
      if (!r.repetido && !(r.status === 'ok' && r.ja_estava_feita)) st.avisos += await queue([linhaReuniao('reuniaoops:' + m.id, 'reuniao_ops', avReuniaoOpsLinha(String(m.dia), r), String(r.cliente || m.grupo), m.grupo, quem(r, m.grupo))]);
    }
    // (b) Anotações do Gemini.
    const notas = await sql`select * from fn_reunioes_notas where status = 'novo' and tries < 3 order by created_at limit ${REUNIOES_MAX}`;
    let docs: Row[] | null = null;
    for (const n of notas) {
      const dia = n.dia instanceof Date ? n.dia.toISOString().slice(0, 10) : String(n.dia).slice(0, 10);
      try {
        const acoes = Array.isArray(n.acoes) ? n.acoes : [];
        if ((n.tipo === 'interna' && !acoes.length) || avDestino([n.grupo, n.titulo, n.lead_hint].filter(Boolean).join(' '), ctx.gcfg) === 'fora' || (n.tipo !== 'interna' && ctx.destino(n.grupo) === 'fora')) { await sql`update fn_reunioes_notas set status = 'ignorado', updated_at = now() where id = ${n.id}`; continue }
        if (n.tipo === 'interna') {
          // Reunião do time: o que cada um ficou de fazer vira ação na aba Ações (uma por cliente; sem cliente não entra).
          const r = await ops({op: 'reuniao_interna', id: 'gemini:' + n.id, dia, titulo: n.titulo || '', acoes});
          const novas = await salvarAcoes(r.tarefas_criadas, 'gemini:' + n.id);
          st.acoes = (st.acoes || 0) + novas;
          const fora = Array.isArray(r.sem_cliente) ? r.sem_cliente.length : 0;
          await sql`update fn_reunioes_notas set status = 'feito', destino = ${`${(r.tarefas_criadas || []).length} ações na aba Ações${fora ? `, ${fora} sem cliente ficaram de fora` : ''}`}, erro = null, updated_at = now() where id = ${n.id}`;
          st.notas++;
          continue;
        }
        if (n.tipo === 'cliente') {
          if (!n.grupo) { await sql`update fn_reunioes_notas set status = 'sem_destino', erro = 'sem o grupo do cliente', updated_at = now() where id = ${n.id}`; continue }
          const r = await ops({op: 'reuniao', id: 'gemini:' + n.id, grupo: n.grupo, dia, fonte: 'Anotações do Gemini', participantes: n.participantes || undefined,
            resumo: [n.resumo, n.proximos ? 'Próximos passos: ' + n.proximos : ''].filter(Boolean).join('\n'), acoes: Array.isArray(n.acoes) ? n.acoes : []});
          st.acoes = (st.acoes || 0) + await salvarAcoes(r.tarefas_criadas, 'gemini:' + n.id);
          await sql`update fn_reunioes_notas set status = ${r.status === 'ok' ? 'feito' : 'sem_destino'}, destino = ${String(r.cliente || '').slice(0, 200) || null}, erro = null, updated_at = now() where id = ${n.id}`;
          if (!r.repetido) st.avisos += await queue([linhaReuniao('notaops:' + n.id, 'reuniao_gemini', avReuniaoOpsLinha(dia, r), String(r.status === 'ok' && r.cliente ? r.cliente : n.grupo), n.grupo, quem(r, n.grupo))]);
        } else {
          docs ??= (await crmCall({op: 'load'})).docs || [];
          const lead = avLeadDaReuniao(docs, {dia, titulo: String(n.titulo || ''), lead_hint: n.lead_hint});
          if (lead) {
            const notes = avNotasComReuniao(lead.data.notes, {id: String(n.id), dia, resumo: n.resumo, proximos: n.proximos});
            if (notes !== lead.data.notes) await crmCall({op: 'set', col: 'leads', id: lead.id, data: {...lead.data, notes, updatedAt: new Date().toISOString()}});
          }
          await sql`update fn_reunioes_notas set status = ${lead ? 'feito' : 'sem_destino'}, destino = ${lead ? lead.id : null}, erro = null, updated_at = now() where id = ${n.id}`;
          st.avisos += await queue([{id: 'notalead:' + n.id, canal: 'comercial', tipo: 'reuniao_lead', texto: avNotaLeadText({titulo: String(n.titulo || ''), dia, resumo: n.resumo}, lead ? lead.data : null)}]);
        }
        st.notas++;
      } catch (e) {
        if (e instanceof OpsAusente) throw e;
        await sql`update fn_reunioes_notas set tries = tries + 1, status = case when tries + 1 >= 3 then 'erro' else status end, erro = ${errText(e).slice(0, 300)}, updated_at = now() where id = ${n.id}`;
      }
    }
  } catch (e) {
    if (e instanceof OpsAusente) return {...st, aguardando: e.message};
    throw e;
  }
  return st;
}
// 7. Ações das reuniões: lê o AVISOS - OPERACIONAIS atrás de "feito 12" (de um gestor ou do Renan) e conclui a ação no OPS,
// com a confirmação no grupo; e, a cada 30 min, atualiza a situação das ações abertas pelo OPS (concluída lá, arquivada ou
// apagada sai da lista). Cursor das mensagens em fn_config (k = 'tarefas_state').
async function sincronizaAcoes(ops: (body: Row) => Promise<Row>, forcar = false){
  const st = await getConf('tarefas_state');
  if (!forcar && Date.now() - (Date.parse(st.sync || '') || 0) < 30 * 60e3) return 0;
  const abertas = await sql`select codigo, ops_id from fn_tarefas where status in ('pendente', 'em_andamento') order by codigo limit 300`;
  if (abertas.length) {
    const r = await ops({op: 'tarefas_status', ids: abertas.map((a: Row) => String(a.ops_id))});
    const porId = new Map((Array.isArray(r.tarefas) ? r.tarefas : []).map((t: Row) => [String(t.id), t]));
    for (const a of abertas) {
      const t = porId.get(String(a.ops_id));
      const status = !t ? 'sumiu' : t.arquivada ? 'arquivada' : String(t.status || 'pendente');
      await sql`update fn_tarefas set status = ${status}, prazo = ${t && t.prazo ? String(t.prazo).slice(0, 10) : null}, titulo = coalesce(${t ? String(t.titulo || '') || null : null}, titulo),
        concluida_em = case when ${status} = 'concluida' and concluida_em is null then now() else concluida_em end, sincronizada_em = now() where codigo = ${a.codigo}`;
    }
  }
  await setConf('tarefas_state', {...st, sync: brIso(Date.now())});
  return abertas.length;
}
async function acoes(c: Row, ctx: Ctx){
  const ops = await opsReunioes(), grupos = c.groups || {};
  if (!ops || !grupos.operacional) return {skipped: 'sem OPS ou sem o grupo operacional'};
  const st = await getConf('tarefas_state'), now = Date.now();
  // "feito 12" vale no AVISOS - OPERACIONAIS e no grupo do Renan (Organização - BRASE). Ação da assistida confirma só no do Renan.
  const fontes: [string, 'operacional' | 'renan', string][] = [[String(grupos.operacional), 'operacional', 'cursor']];
  if (grupos.renan) fontes.push([String(grupos.renan), 'renan', 'cursorRenan']);
  let lidas = 0, concluidas = 0;
  const cursores: Row = {};
  for (const [ns, origem, chave] of fontes) {
    const desde = Number(st[chave]) || Math.floor(now / 1000);
    const j = await nico(OPS_KEY, 'subscriber/chat-messages', {user_ns: ns, limit: 40});
    const msgs = (Array.isArray(j.data) ? j.data : []).filter((m: Row) => m && typeof m.ts === 'number' && m.ts > desde && (m.type === 'in' || m.type === 'agent') && typeof m.content === 'string').sort((a: Row, b: Row) => a.ts - b.ts);
    let maxTs = desde;
    lidas += msgs.length;
    for (const m of msgs) {
      maxTs = Math.max(maxTs, m.ts);
      const codigo = avFeito(m.content);
      if (!codigo) continue;
      // No Organização o Renan escreve anotações livres ("feito 2 posts"): lá só vale a mensagem que é só "feito 12".
      if (origem === 'renan' && !/^\s*(?:✅\s*)?(?:feito|feita|conclu[ií]d[oa]|pronto|pronta)\s*#?\s*\d{1,5}\s*[.!]?\s*$/i.test(String(m.content))) continue;
      const g = grpMsg(m), por = m.type === 'agent' ? 'Renan' : String((g && g.author) || '').split(/\s+-\s+/)[0].trim();
      const [t] = await sql`select codigo, ops_id, titulo, status, cliente from fn_tarefas where codigo = ${codigo}`;
      const canal = origem === 'renan' || (t && ctx.destino(t.cliente) === 'assistida') ? 'renan' as const : 'operacional' as const;
      let texto: string;
      if (!t) texto = `⚠️ Ação #${codigo} não existe. Confira o número no resumo das 9h.`;
      else {
        const r = await ops({op: 'concluir_tarefa', id: String(t.ops_id), por});
        if (r.ok || r.motivo === 'já estava concluída') {
          await sql`update fn_tarefas set status = 'concluida', concluida_em = coalesce(concluida_em, now()), concluida_por = coalesce(concluida_por, ${por || null}) where codigo = ${codigo}`;
          texto = r.ok ? avAcaoConcluidaText(codigo, String(r.titulo || t.titulo), por) : `ℹ️ Ação #${codigo} já estava concluída: ${String(t.titulo).slice(0, 140)}`;
          if (r.ok) concluidas++;
        } else {
          await sql`update fn_tarefas set status = 'sumiu' where codigo = ${codigo}`;
          texto = `⚠️ Ação #${codigo} ${String(r.motivo || 'não foi encontrada no OPS')}.`;
        }
      }
      // Ação da assistida concluída no AVISOS: a confirmação (com o título) não sai lá.
      await queue([{id: `feito:${m.mid || m.id || m.ts}`, canal, tipo: 'acao_concluida', texto}]);
    }
    cursores[chave] = maxTs;
  }
  await setConf('tarefas_state', {...(await getConf('tarefas_state')), ...cursores});
  const sincronizadas = await sincronizaAcoes(ops);
  return {lidas, concluidas, sincronizadas};
}
// 8. Resumo das 9h (seg a sex) no AVISOS - OPERACIONAIS: uma mensagem por gestor, marcando ele, só com as lojas dele. Do estado
// desta rodada: atendimento pendente, grupo parado, reunião a marcar; da fila (canal 'resumo'): reuniões registradas ou não no
// OPS desde o último resumo. fn_config avisos.resumo = {ligado, hora: '09:00', dias: [1..5]}; o dia enviado fica em resumo_state.
async function resumo(c: Row, ctx: Ctx){
  const cfg = c.resumo || {};
  if (cfg.ligado === false) return {skipped: 'desligado'};
  const now = Date.now(), ult = await getConf('resumo_state');
  const dia = avResumoDue(now, ult.dia, String(cfg.hora || '09:00'), Array.isArray(cfg.dias) && cfg.dias.length ? cfg.dias.map(Number) : [1, 2, 3, 4, 5]);
  if (!dia) return {skipped: 'fora da hora'};
  if (!ctx.gruposOk) return {skipped: 'grupos não leram nesta rodada; tenta na próxima'};
  const porGestor = new Map<string, {nome: string; itens: AvResumoItem[]}>();
  const add = (nomes: unknown, item: AvResumoItem) => { for (const n of avQuemCuida(nomes, cfgGestores(c))) { const k = n.toLowerCase(); if (!porGestor.has(k)) porGestor.set(k, {nome: n, itens: []}); porGestor.get(k)!.itens.push(item) } };
  // A assistida nunca entra no resumo do AVISOS (vai para o pacote da manhã do Renan).
  for (const e of ctx.estado) {
    if (e.assistida) continue;
    if (e.atendimento) add(e.gestores, {tipo: 'atendimento', grupo: e.grupo, texto: e.atendimento});
    if (e.parado) add(e.gestores, {tipo: 'parado', grupo: e.grupo, texto: e.parado});
    if (e.reuniao30) add(e.gestores, {tipo: 'reuniao30', grupo: e.grupo, texto: e.reuniao30});
  }
  // Ações das reuniões (aba Ações): situação fresca do OPS antes de montar.
  const opsR = await opsReunioes();
  if (opsR) { try { await sincronizaAcoes(opsR, true) } catch (e) { console.error('sincroniza ações', errText(e)) } }
  const hoje = brIso(now).slice(0, 10), novasIds: number[] = [];
  for (const t of await sql`select codigo, titulo, cliente, responsavel, prazo::text as prazo, anunciada_em from fn_tarefas where status in ('pendente', 'em_andamento') order by prazo nulls last, codigo`) {
    const p = String(t.prazo || ''), tipo: AvResumoItem['tipo'] | null = p && p < hoje ? 'vencida' : p === hoje ? 'hoje' : !t.anunciada_em ? 'nova' : null;
    if (!tipo || ctx.destino(t.cliente) === 'assistida') continue;
    if (!t.anunciada_em) novasIds.push(Number(t.codigo));
    add(t.responsavel ? [t.responsavel] : [], {tipo, grupo: String(t.cliente || 'Sem cliente'), texto: avAcaoLinha({codigo: Number(t.codigo), titulo: String(t.titulo), prazo: p}, hoje)});
  }
  const fila = await sql`select id, grupo, gestores, texto from fn_avisos where canal = 'resumo' and sent_at is null and tries < 3 order by created_at`;
  for (const f of fila) if (ctx.destino(f.grupo) === 'avisos' && !avTextoFora(f.texto, ctx.gcfg, ctx.assistidaGrupos, ctx.avisosGrupos)) add(f.gestores || [], {tipo: 'ops', grupo: String(f.grupo || ''), texto: String(f.texto)});
  const rows: AvRow[] = [...porGestor.values()].map(g => ({id: `resumo:${dia}:${g.nome.toLowerCase().replace(/\W+/g, '-')}`, canal: 'operacional', tipo: 'resumo', texto: avResumoText(ctx.marca(g.nome), g.itens, now)}));
  const queued = await queue(rows);
  if (fila.length) await sql`update fn_avisos set sent_at = now() where id = any(${fila.map((f: Row) => String(f.id))})`;
  if (novasIds.length) await sql`update fn_tarefas set anunciada_em = now() where codigo = any(${novasIds})`;
  await setConf('resumo_state', {dia, at: brIso(now), gestores: rows.length});
  return {dia, gestores: rows.length, queued, fila: fila.length};
}
// 8. Pacote do resumo do dia do Renan. A rotina do Claude "Resumo do dia do Renan" (6h53, pela assinatura) lê o pacote,
// escreve a mensagem no formato das anotações dele e põe na fila com canal 'renan', que sai no grupo "Organização - BRASE"
// (fn_config avisos.groups.renan). Aqui só se junta o que ela precisa, das 6h15 às 6h50, uma vez por dia, em fn_config
// (k = 'manha_pacote'): as anotações do grupo Organização dos últimos 7 dias; as conversas com mensagem nas últimas 24 h
// (privados, grupos de cliente e grupos em que o Renan escreveu; nunca os grupos AVISOS), até 20 mensagens de 48 h cada; a
// agenda do dia na Central; os horários sugeridos que ainda não viraram reunião marcada; e as rotinas do dia.
const MANHA_CONVERSAS = 45;
async function manha(c: Row, contacts: Row[], ctx: Ctx){
  const cfg = c.manha || {};
  if (cfg.ligado === false) return {skipped: 'desligado'};
  const now = Date.now(), prev = await getConf('manha_pacote');
  const dia = avManhaDue(now, prev.dia, String(cfg.de || '06:15'), String(cfg.ate || '06:50'));
  if (!dia) return {skipped: 'fora da hora'};
  const grupos = c.groups || {}, notasNs = String(grupos.renan || ''), avisos = new Set([grupos.comercial, grupos.operacional].filter(Boolean).map(String));
  const quando = (ts: number) => brIso(ts * 1000).slice(5, 16).replace('T', ' ');
  // Anotações do Renan (o que ele manda para si mesmo).
  let notas: Row[] = [];
  if (notasNs) {
    const j = await nico(OPS_KEY, 'subscriber/chat-messages', {user_ns: notasNs, limit: 60});
    notas = (Array.isArray(j.data) ? j.data : []).filter((m: Row) => m && m.type === 'agent' && typeof m.ts === 'number' && m.ts * 1000 > now - 7 * 864e5 && typeof m.content === 'string')
      .sort((a: Row, b: Row) => a.ts - b.ts).map((m: Row) => ({quando: quando(m.ts), texto: avTextoPacote(m.content)})).filter((n: Row) => n.texto);
  }
  // Central: leads (telefone → card), agenda do dia e horários bloqueados pelo que o Renan sugeriu.
  const docs: Row[] = (await crmCall({op: 'load'})).docs || [];
  const idx = leadIndex(docs);
  const leads = docs.filter(d => d && d.col === 'leads' && !d.deleted && d.data);
  const agenda = leads.filter(d => String(d.data.meetingAt || '').startsWith(dia)).map(d => ({hora: String(d.data.meetingAt).slice(11, 16), lead: d.data.name || '', empresa: d.data.company || '', etapa: d.data.stage || ''}))
    .concat(docs.filter(d => d && d.col === 'holds' && !d.deleted && d.data && String(d.data.start || '').startsWith(dia)).map(d => ({hora: String(d.data.start).slice(11, 16), lead: '', empresa: String(d.data.label || 'bloqueio'), etapa: 'bloqueio na agenda'})))
    .sort((a, b) => a.hora.localeCompare(b.hora));
  const ate7 = brIso(now + 7 * 864e5).slice(0, 16), agoraBr = brIso(now).slice(0, 16);
  const sugeridas: Row[] = docs.filter(d => d && d.col === 'holds' && !d.deleted && d.data && d.data.by === 'avisos' && String(d.data.start || '') > agoraBr && String(d.data.start || '') <= ate7)
    .map(d => ({quem: 'Renan', quando: String(d.data.start).replace('T', ' '), onde: String(d.data.label || '').replace(/^Renan:\s*/, '')}));
  // Só horário do Lipe com lead que tem card na Central (conversa dele com o Renan não conta).
  for (const a of await sql`select texto, created_at from fn_avisos where tipo = 'horario_sdr' and created_at > now() - interval '3 days' and texto not ilike '%sem card na Central%' order by created_at`)
    sugeridas.push({quem: 'Lipe (SDR)', quando: brIso(new Date(a.created_at).getTime()).slice(0, 16).replace('T', ' '), aviso: String(a.texto).replace(/\n/g, ' | ')});
  // Conversas das últimas 24 h.
  const conversas: Row[] = [];
  const lista = contacts.filter(x => !avisos.has(String(x.user_ns)) && String(x.user_ns) !== notasNs && !/avisos/i.test(String(x.name || '')))
    .sort((a, b) => nicoTime(b.last_message_at) - nicoTime(a.last_message_at)).slice(0, 80);
  for (const x of lista) {
    if (conversas.length >= MANHA_CONVERSAS) break;
    const grupo = /^\s*g:/i.test(String(x.name || '')), cliente = avClientGroup(x.name);
    const j = await nico(OPS_KEY, 'subscriber/chat-messages', {user_ns: String(x.user_ns), limit: 30});
    const msgs = (Array.isArray(j.data) ? j.data : []).filter((m: Row) => m && (m.type === 'in' || m.type === 'agent') && typeof m.ts === 'number').sort((a: Row, b: Row) => a.ts - b.ts);
    // Grupo que não é de cliente só entra se o Renan escreveu nele nos últimos 7 dias (os de promoção ficam de fora).
    if (grupo && !cliente && !msgs.some((m: Row) => m.type === 'agent' && m.ts * 1000 > now - 7 * 864e5)) continue;
    const recentes = msgs.filter((m: Row) => m.ts * 1000 > now - 48 * 3600e3).slice(-20);
    if (!recentes.length) continue;
    const mids = recentes.map((m: Row) => String(m.mid || m.id || m.ts));
    const aud = new Map((await sql`select mid, texto from fn_audios where mid = any(${mids}) and status = 'ok'`).map((r: Row) => [String(r.mid), String(r.texto || '')]));
    const lead = grupo ? null : idx.get(waPhoneKey(x.phone || String(x.user_id || '').split('-')[0]));
    conversas.push({
      conversa: avGroupLabel(x.name).replace(/^[~\s]*$/, '') || `Contato sem nome (final ${String(x.phone || '').replace(/\D/g, '').slice(-4) || '?'})`, tipo: cliente ? 'grupo de cliente' : grupo ? 'grupo' : lead ? 'lead da Central' : 'privado',
      lead: lead ? {nome: lead.data.name || '', empresa: lead.data.company || '', etapa: lead.data.stage || '', reuniao: lead.data.meetingAt || null} : undefined,
      mensagens: recentes.map((m: Row) => {
        const g = grpMsg(m), mid = String(m.mid || m.id || m.ts), a = aud.get(mid);
        return {quem: m.type === 'agent' ? 'Renan' : (g && g.author) || avGroupLabel(x.name) || 'Contato', quando: quando(m.ts), texto: a ? '🎤 ' + a.slice(0, 500) : avTextoPacote(m.content) || (g ? g.text : '')};
      }),
    });
  }
  // Ações das reuniões que estão com o Renan (aba Ações do OPS), abertas.
  const acoesRenan = (await sql`select codigo, titulo, cliente, prazo::text as prazo from fn_tarefas where status in ('pendente', 'em_andamento') and responsavel ilike 'renan%' order by prazo nulls last limit 20`)
    .map((t: Row) => ({numero: t.codigo, acao: t.titulo, cliente: t.cliente, prazo: t.prazo}));
  // Oferta assistida (o Renan atende): situação de cada grupo nesta rodada, os avisos que saíram no grupo dele nas últimas
  // 24 h e as ações abertas das lojas da assistida.
  const doAssist = (t: Row) => ctx.destino(t.cliente) === 'assistida';
  const assistida = {
    lojas: ctx.gcfg.lojas || [],
    grupos: ctx.estado.filter(e => e.assistida).map(e => ({grupo: e.grupo, atendimento: e.atendimento || null, parado: e.parado || null, reuniao30: e.reuniao30 || null})),
    avisos24h: (await sql`select tipo, grupo, texto, created_at from fn_avisos where canal = 'renan' and tipo not in ('manha', 'placar') and created_at > now() - interval '24 hours' order by created_at`)
      .map((a: Row) => ({quando: brIso(new Date(a.created_at).getTime()).slice(5, 16).replace('T', ' '), tipo: a.tipo, grupo: a.grupo, texto: String(a.texto).replace(/\n/g, ' | ').slice(0, 600)})),
    acoes: (await sql`select codigo, titulo, cliente, responsavel, prazo::text as prazo from fn_tarefas where status in ('pendente', 'em_andamento') order by prazo nulls last limit 200`)
      .filter(doAssist).map((t: Row) => ({numero: t.codigo, acao: t.titulo, cliente: t.cliente, responsavel: t.responsavel, prazo: t.prazo})),
    // Mensalidades vencidas e não pagas (espelho do Asaas, consultado de hora em hora).
    mensalidadesAtrasadas: ((await getConf('cobrancas_state')).lista || []).map((a: Row) => ({contrato: a.contrato, valor: a.valor, vencimento: a.vencimento, dias: a.dias})),
  };
  const pacote = {dia, geradoEm: brIso(now), notas, agenda, sugeridas, rotinas: avRotinasDoDia(cfg.rotinas, now), acoes: acoesRenan, assistida, conversas};
  await setConf('manha_pacote', pacote);
  return {dia, notas: notas.length, agenda: agenda.length, sugeridas: sugeridas.length, assistida: assistida.grupos.length, conversas: conversas.length};
}
// Mensalidades atrasadas da assistida (OPS, op "cobrancas_assistida"): no máximo uma consulta por hora; cada cobrança
// vencida vira um aviso só no grupo do Renan (o id da cobrança não deixa repetir). A lista do momento fica em
// fn_config (k = 'cobrancas_state') e entra no pacote da manhã.
async function cobrancas(){
  const st = await getConf('cobrancas_state');
  if (Date.now() - (Date.parse(st.at || '') || 0) < 60 * 60e3) return {skipped: 'consultado há menos de 1 h'};
  const conf = await getConf('ops_pedidos');
  if (!conf.url || !conf.key) return {skipped: 'sem a configuração do OPS'};
  const r = await opsPedidos(conf, {op: 'cobrancas_assistida'});
  const lista = (Array.isArray(r.atrasadas) ? r.atrasadas : []).filter((a: Row) => a && a.id);
  const queued = await queue(lista.map((a: Row) => ({id: 'cobranca:' + a.id, canal: 'renan' as const, tipo: 'cobranca', texto: avCobrancaText({contrato: String(a.contrato), valor: Number(a.valor) || 0, vencimento: String(a.vencimento), dias: Number(a.dias) || 0}), grupo: String(a.contrato)})));
  await setConf('cobrancas_state', {at: brIso(Date.now()), lista});
  return {atrasadas: lista.length, queued};
}
// 9. Placar da semana (segunda, a partir das 8h; fn_config avisos.placar = {ligado, dia: 1, hora: '08:00'}): conta o que a
// semana anterior rendeu e manda só no grupo do Renan (canal 'renan'). A semana enviada fica em fn_config placar_state.
const PLACAR_SEM_ENVIO = ['pedido_nada', 'horario_sem_card', 'teste'];
async function comercialDaSemana(ini: string): Promise<AvComercial> {
  const [r] = await sql`with d as (select ${ini}::date as ini, ${ini}::date + 7 as fim),
    br as (select (created_at at time zone 'America/Sao_Paulo')::date c, (booked_at at time zone 'America/Sao_Paulo')::date b,
      (met_at at time zone 'America/Sao_Paulo')::date m, (closed_at at time zone 'America/Sao_Paulo')::date f, value from fn_crm_leads)
    select (select coalesce(sum(spend), 0) from fn_ad_spend, d where day >= d.ini and day < d.fim)::float as gasto,
      (select count(*) from br, d where c >= d.ini and c < d.fim)::int as leads,
      (select count(*) from br, d where b >= d.ini and b < d.fim)::int as marcadas,
      (select count(*) from br, d where m >= d.ini and m < d.fim)::int as feitas,
      (select count(*) from br, d where f >= d.ini and f < d.fim)::int as vendas,
      (select coalesce(sum(value), 0) from br, d where f >= d.ini and f < d.fim)::float as valor`;
  return {gasto: Number(r.gasto) || 0, leads: r.leads, marcadas: r.marcadas, feitas: r.feitas, vendas: r.vendas, valor: Number(r.valor) || 0};
}
async function placar(c: Row, ctx: Ctx){
  const cfg = c.placar || {};
  if (cfg.ligado === false) return {skipped: 'desligado'};
  const now = Date.now(), ult = await getConf('placar_state');
  const ini = avPlacarDue(now, ult.semana, Number.isInteger(cfg.dia) ? cfg.dia : 1, String(cfg.hora || '08:00'));
  if (!ini) return {skipped: 'fora da hora'};
  if (!ctx.gruposOk) return {skipped: 'grupos não leram nesta rodada; tenta na próxima'};
  const fimD = new Date(Date.parse(ini + 'T00:00:00-03:00') + 6 * 864e5).toISOString().slice(0, 10);
  const de = new Date(ini + 'T00:00:00-03:00'), ate = new Date(Date.parse(ini + 'T00:00:00-03:00') + 7 * 864e5);
  const anteriorIni = new Date(Date.parse(ini + 'T12:00:00Z') - 7 * 864e5).toISOString().slice(0, 10);
  const [comercial, anterior] = [await comercialDaSemana(ini), await comercialDaSemana(anteriorIni)];
  // Atendimento: cada aviso "Cliente precisa de atendimento" e quanto tempo (horário comercial) a Brase levou para responder
  // depois dele, pelas mensagens guardadas do grupo (as 40 últimas; aviso de grupo muito movimentado pode ficar sem medida).
  const exp = avExpediente((c.op || {}).expediente);
  const atend = await sql`select id, sent_at from fn_avisos where tipo = 'atendimento' and sent_at >= ${de} and sent_at < ${ate}`;
  const nsList = [...new Set(atend.map((a: Row) => String(a.id).split(':')[1]))];
  const facts = new Map<string, GrpMsg[]>((nsList.length ? await sql`select user_ns, facts->'msgs' as msgs from fn_grupos where user_ns = any(${nsList})` : []).map((r: Row) => [String(r.user_ns), Array.isArray(r.msgs) ? r.msgs : []]));
  const tempos: number[] = [];
  for (const a of atend) {
    const [, ns, ...resto] = String(a.id).split(':'), mid = resto.join(':');
    const resp = avRespostaDepois(facts.get(ns) || [], mid, ctx.team);
    if (resp != null) tempos.push(avMsUteis(new Date(a.sent_at).getTime(), resp, exp));
  }
  const [riscos] = await sql`select count(*)::int as n from fn_avisos where tipo = 'risco' and sent_at >= ${de} and sent_at < ${ate}`;
  const pedidos = await sql`select texto from fn_avisos where tipo = 'pedido_ifood' and sent_at >= ${de} and sent_at < ${ate}`;
  const feitos = pedidos.filter((p: Row) => /^🛠 \*Alteração feita/u.test(String(p.texto))).length;
  const [ac] = await sql`select (select count(*) from fn_tarefas where criada_em >= ${de} and criada_em < ${ate})::int as criadas,
    (select count(*) from fn_tarefas where concluida_em >= ${de} and concluida_em < ${ate})::int as concluidas`;
  const hoje = brIso(now).slice(0, 10);
  const vencidas = (await sql`select coalesce(responsavel, 'sem responsável') as responsavel, count(*)::int as n from fn_tarefas where status in ('pendente', 'em_andamento') and prazo < ${hoje}::date group by 1 order by 2 desc`)
    .map((v: Row) => ({responsavel: String(v.responsavel), n: v.n}));
  const envios = (await sql`select canal, tipo, count(*)::int as n from fn_avisos where sent_at >= ${de} and sent_at < ${ate} and canal <> 'resumo' and tipo <> all(${PLACAR_SEM_ENVIO}) and erro is null group by 1, 2`)
    .map((e: Row) => ({canal: String(e.canal), tipo: String(e.tipo), n: e.n}));
  const p: AvPlacar = {ini, fim: fimD, comercial, anterior, atendimento: {avisos: atend.length, respondidos: tempos.length, medianaMs: avMediana(tempos)}, riscos: riscos.n,
    pedidos: {total: pedidos.length, feitos, mao: pedidos.length - feitos}, acoes: {criadas: ac.criadas, concluidas: ac.concluidas, vencidas}, envios};
  const queued = await queue([{id: 'placar:' + ini, canal: 'renan', tipo: 'placar', texto: avPlacarText(p)}]);
  await setConf('placar_state', {semana: ini, at: brIso(now)});
  return {semana: ini, queued};
}
// Acha os grupos de aviso pelo nome ("AVISOS - COMERCIAIS" e "AVISOS - OPERACIONAIS") e guarda o id deles na configuração.
async function targets(c: Row){
  const g = {...(c.groups || {})};
  if (g.comercial && g.operacional) return g;
  const j = await nico(OPS_KEY, 'subscribers', {limit: 50, name: 'AVISOS'});
  for (const x of Array.isArray(j.data) ? j.data : []) {
    const n = String(x.name || '').toLowerCase();
    if (!/^g:/.test(n) || !n.includes('avisos')) continue;
    if (!g.comercial && n.includes('comerc')) g.comercial = String(x.user_ns);
    if (!g.operacional && n.includes('operac')) g.operacional = String(x.user_ns);
  }
  await sql`update fn_config set v = jsonb_set(v, '{groups}', ${json(g)}), updated_at = now() where k = 'avisos'`;
  return g;
}
async function send(groups: Row, mode: string, ctx: Ctx, op: Row = {}){
  if (mode !== 'on') return {sent: 0, pending: Number((await sql`select count(*)::int as n from fn_avisos where sent_at is null and tries < 3 and canal <> 'resumo'`)[0].n)};
  // AVISOS - OPERACIONAIS marca os gestores: fora da janela (padrão 8h às 20h) os avisos esperam e saem no começo da próxima.
  const opAberto = avNaJanela(Date.now(), String(op.envioDe || '08:00'), String(op.envioAte || '20:00'));
  const rows = opAberto
    ? await sql`select id, canal, texto from fn_avisos where sent_at is null and tries < 3 and canal <> 'resumo' order by created_at, id limit ${SEND_MAX}`
    // Fora da janela também esperam os avisos da assistida no grupo do Renan; só o resumo da manhã (6h53) sai antes das 8h.
    : await sql`select id, canal, texto from fn_avisos where sent_at is null and tries < 3 and canal not in ('resumo', 'operacional') and not (canal = 'renan' and tipo <> 'manha') order by created_at, id limit ${SEND_MAX}`;
  if (!rows.length) return {sent: 0, failed: 0};
  // Trava: só sai mensagem para os grupos AVISOS. Nada é enviado no grupo do cliente (decisão do dono).
  const clientes = new Set((await sql`select user_ns from fn_grupos`).map((r: Row) => String(r.user_ns)));
  let sent = 0, failed = 0;
  for (const r of rows) {
    // Trava: aviso que cita grupo fora dos avisos (assessoria, ignorado) ou da assistida (Texas, BRASE -, lojas "reservado"
    // do OPS) nunca sai nos grupos AVISOS, venha de onde vier. No grupo do Renan pode.
    if (r.canal !== 'renan' && avTextoFora(r.texto, ctx.gcfg, ctx.assistidaGrupos, ctx.avisosGrupos)) { await sql`update fn_avisos set tries = 99, erro = 'não enviado: cita grupo fora dos avisos ou da assistida' where id = ${r.id}`; continue }
    const to = groups[r.canal];
    if (!to || clientes.has(String(to))) { failed++; await sql`update fn_avisos set tries = tries + 1, erro = ${to ? 'destino é grupo de cliente: bloqueado' : 'grupo de aviso não encontrado'} where id = ${r.id}`; continue }
    try { await nicoSend(String(to), String(r.texto)); sent++; await sql`update fn_avisos set sent_at = now(), erro = null where id = ${r.id}` }
    catch (e) { failed++; await sql`update fn_avisos set tries = tries + 1, erro = ${errText(e).slice(0, 300)} where id = ${r.id}` }
  }
  return {sent, failed};
}
async function run(){
  const c = await getConf('avisos'), mode = c.mode === 'on' || c.mode === 'preview' ? String(c.mode) : 'off';
  if (mode === 'off') return {skipped: 'desligado'};
  const t0 = Date.now(), prev = await getConf('avisos_state');
  if (!OPS_KEY) {
    // Só os nomes dos segredos parecidos (nunca o valor), para achar nome digitado diferente.
    const parecidos = Object.keys(Deno.env.toObject()).filter(k => /nico|ops/i.test(k)).sort();
    const st = {ok: false, at: brIso(t0), mode, error: 'Falta o segredo NICOCHAT_OPS_KEY (chave da API do canal Operacional).', parecidos};
    await setConf('avisos_state', st); return st;
  }
  // 1ª rodada com a chave: grava o início. Nada antes dele vira aviso.
  if (!Date.parse(c.since || '')) { c.since = brIso(t0); await sql`update fn_config set v = jsonb_set(v, '{since}', ${json(c.since)}), updated_at = now() where k = 'avisos'` }
  c.sinceMs = Date.parse(c.since);
  const st: Row = {ok: true, at: brIso(t0), mode, since: c.since};
  const step = async (k: string, fn: () => Promise<Row>) => { try { st[k] = await fn() } catch (e) { st.ok = false; st[k] = {error: errText(e)} } };
  let groups: Row = c.groups || {};
  await step('alvos', async () => { groups = await targets(c); return {comercial: !!groups.comercial, operacional: !!groups.operacional} });
  await step('horarios', () => horarios(c, prev));
  const mudou: Row[] = [];
  await step('reunioes', () => reunioes(c, prev, mudou));
  st.lojasDesde = prev.lojasDesde || brIso(t0);
  await step('lojas', () => lojas(c, prev, mudou, Date.parse(st.lojasDesde)));
  let contacts: Row[] | null = null;
  await step('contatos', async () => { contacts = await opsContacts(); return {n: contacts.length} });
  const ctx = novoCtx(c, await getConf('ops_gestores'));
  if (contacts) {
    const list: Row[] = contacts;
    const sink: Row[] = [];
    await step('grupos', () => grupos(c, list, sink, ctx));
    await step('pedidos', () => pedidos(sink, ctx));
    await step('reunioesOps', () => reunioesOps(ctx, c));
    await step('acoes', () => acoes(c, ctx));
    await step('resumo', () => resumo(c, ctx));
    await step('placar', () => placar(c, ctx));
    await step('cobrancas', () => cobrancas());
    await step('manha', () => manha(c, list, ctx));
    await step('agenda', () => agenda(c, list, prev, ctx));
    await step('agendaFila', () => agendaFila(c));
  }
  await step('envio', () => send(groups, mode, ctx, c.op || {}));
  st.waCursor = (st.horarios && st.horarios.cursor) || prev.waCursor || null;
  st.renanCursor = (st.agenda && st.agenda.cursor) || prev.renanCursor || null;
  st.crmCursor = (st.reunioes && st.reunioes.cursor) || prev.crmCursor || null;
  st.ms = Date.now() - t0;
  await setConf('avisos_state', st);
  return st;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return reply(405, {error: 'Use POST.'});
  const cron = await getConf('cron');
  if (!cron.key || !sameKey(req.headers.get('x-fn-cron') || '', String(cron.key))) return reply(401, {error: 'Chave inválida.'});
  let body: Row = {};
  try { body = JSON.parse(await req.text() || '{}') } catch { return reply(400, {error: 'JSON inválido.'}) }
  try {
    if (body.op === 'cron.avisos') return reply(200, await run());
    if (body.op === 'avisos.status') return reply(200, {conf: await getConf('avisos'), state: await getConf('avisos_state')});
    return reply(400, {error: 'Operação desconhecida.'});
  } catch (e) {
    console.error(body.op, e);
    return reply(500, {error: 'Erro interno: ' + errText(e)});
  }
});
