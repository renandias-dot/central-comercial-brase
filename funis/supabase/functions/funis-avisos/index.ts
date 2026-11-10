// funis-avisos — avisos automáticos nos grupos de WhatsApp da Brase, 24 h por dia, pelo canal Operacional do NicoChat
// (o número do Renan, conexão não oficial). Chamada pelo pg_cron a cada 2 min (op cron.avisos, cabeçalho x-fn-cron).
//   AVISOS - COMERCIAIS: horário sugerido na conversa do SDR (pelo SDR ou pelo lead) e reunião marcada/remarcada na Central.
//   AVISOS - OPERACIONAIS: grupos dos clientes ("BRASE - " e "DI "): sem resposta da Brase, sinal de risco e silêncio longo.
// Configuração em fn_config (k = 'avisos'); estado da última rodada em fn_config (k = 'avisos_state'); fila em fn_avisos
// (id = a chave do evento, então nada sai duas vezes); grupos dos clientes em fn_grupos. Segredos: NICOCHAT_OPS_KEY (canal
// Operacional, lê os grupos e envia) e NICOCHAT_API_KEY (canal do SDR, o mesmo da ponte cron.wa da funis-api); GROQ_API_KEY
// (opcional, plano gratuito) transcreve os áudios dos grupos dos clientes com o Whisper (fn_audios). Só envia para os grupos
// AVISOS: nunca no grupo do cliente.
// SUPABASE_DB_URL já vem do Supabase. Função separada da funis-api para publicar e mexer sem tocar nos funis públicos.
// deno-lint-ignore-file no-explicit-any
import postgres from 'npm:postgres@3.4.5';
import {avClientGroup, avGroupLabel, avGroupState, avHorarioText, avMeetingDue, avReuniaoText, avRiscoText, avSemRespostaText, avSilencioText, avTimeOffers, brIso, grpMsg, leadIndex, nicoTime, avMeetings, avReuniao30Due, avReuniao30Text, avParseSlots, avAgendaText, avHoldId, avHoldStart, avIsDi, avClientOf, avNameIn, waPhoneKey, AV_DI_MIN, avPedidoCandidato, avPedidoText, avAgendadoText, avAudioUrl, avAudioTexto, avComAudios, avQuemPeloTexto, AV_AUDIO_SEM_AUTOR, avReuniaoOpsText, avLeadDaReuniao, avExpediente, avMsUteis, avNotasComReuniao, avNotaLeadText, type AvAudio, type AvAgendaKind, type GrpMsg} from './avisos.ts';

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
type AvRow = {id: string; canal: 'comercial' | 'operacional'; tipo: string; texto: string};
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
  const ins = await sql`insert into fn_avisos ${sql(rows as unknown as Row[], 'id', 'canal', 'tipo', 'texto')} on conflict (id) do nothing returning id`;
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
  if (fresh.length) {
    const docs = (await crmCall({op: 'load'})).docs || [];
    await sellersFrom(docs);
    const idx = leadIndex(docs);
    queued = await queue(fresh.map(({phone, t}) => ({id: 'horario:' + t.mid, canal: 'comercial' as const, tipo: t.who === 'sdr' ? 'horario_sdr' : 'horario_lead',
      texto: avHorarioText(t, (idx.get(phone) || {data: null}).data, '', String((c.com && c.com.sdrNome) || 'Lipe'))})));
  }
  return {read: rows.length, found: found.length, queued, cursor: new Date(rows[rows.length - 1].updated_at).toISOString()};
}
// 2. Reunião marcada ou remarcada: lê na Central só os documentos que mudaram (com folga de 12 min para esperar o horário).
async function reunioes(c: Row, prev: Row){
  if (c.com && c.com.reunioes === false) return {skipped: 'desligado'};
  const now = Date.now(), cursor = Date.parse(prev.crmCursor || '') || now;
  const since = new Date(Math.max(now - 864e5, Math.min(cursor, now - 12 * 60e3))).toISOString();
  const j = await crmCall({op: 'changes', since});
  const docs: Row[] = j.docs || [];
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
async function audios(c: Row, lidos: Lido[], team: string[], ignore: string[], sink: Row[]){
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
        try { ({quem, motivo} = await quemFalou(String(a.texto || ''), antes, team, clientes, String(op.audioQuemModelo || 'openai/gpt-oss-20b'))) }
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
  const cand = classificados.filter(a => a.quem !== 'equipe' && Number(a.ts) * 1000 >= desde && avPedidoCandidato(a.texto));
  if (cand.length) {
    const ns = [...new Set(cand.map(a => String(a.group_ns)))];
    const fatos = new Map<string, GrpMsg[]>((await sql`select user_ns, facts->'msgs' as msgs from fn_grupos where user_ns = any(${ns})`).map((r: Row) => [String(r.user_ns), r.msgs || []]));
    for (const a of cand) {
      const msgs = avComAudios((lidos.find(l => l.ns === String(a.group_ns)) || {msgs: fatos.get(String(a.group_ns)) || []}).msgs, mapa, team);
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
async function gestoresDosGrupos(nomes: string[]): Promise<{de: Gestores; st: Row}> {
  const lista = [...new Set(nomes.map(n => String(n || '').trim()).filter(Boolean))];
  const cache = await getConf('ops_gestores');
  let mapa: Row = cache.grupos && typeof cache.grupos === 'object' ? cache.grupos : {};
  const st: Row = {grupos: lista.length, fonte: 'guardado'};
  const velho = Date.now() - (Date.parse(cache.at || '') || 0) >= GESTORES_TTL, novo = lista.some(n => !(n in mapa));
  if (lista.length && (velho || novo)) {
    const conf = await getConf('ops_pedidos');
    if (conf.url && conf.key) {
      try {
        const r = await opsPedidos(conf, {op: 'gestores', grupos: lista});
        if (r.grupos && typeof r.grupos === 'object') { mapa = {...mapa, ...r.grupos}; await setConf('ops_gestores', {at: brIso(Date.now()), grupos: mapa}); st.fonte = 'OPS' }
      } catch (e) { st.erro = errText(e).slice(0, 200) }
    }
  }
  // Grupo de loja que não está no OPS: gestor definido à mão em fn_config avisos.gestoresGrupo = {"nome do grupo": ["Nome"]}.
  const manual: Row = (await getConf('avisos')).gestoresGrupo || {};
  const de: Gestores = (grupo) => {
    const k = String(grupo || '').trim(), m = manual[k], g = mapa[k];
    if (Array.isArray(m) && m.length) return m.map(String);
    return g && Array.isArray(g.gestores) ? g.gestores.map(String) : [];
  };
  st.semGestor = lista.filter(n => !de(n).length);
  return {de, st};
}
async function grupos(c: Row, contacts: Row[], sink: Row[] = [], ctx: {gestores: Gestores} = {gestores: () => []}){
  const flow = String(c.flow || 'f316913'), op = c.op || {}, now = Date.now();
  const waitMin = Number(op.semRespostaMin) || 120, quietDays = Number(op.silencioDias) || 5, minGroups = Number(op.equipeGrupos) || 4;
  const groups = contacts.filter(x => avClientGroup(x.name));
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
  const all = await sql`select user_ns, nome, facts from fn_grupos where flow_ns = ${flow}`;
  const count = new Map<string, number>();
  for (const r of all) for (const a of new Set<string>((r.facts && r.facts.authors) || [])) count.set(a, (count.get(a) || 0) + 1);
  const team = [...(c.team || []), ...[...count].filter(([, n]) => n >= minGroups).map(([a]) => a)], ignore = c.ignore || [];
  // Áudios: transcreve e já põe no passo "pedidos" os que pedem alteração; os textos entram nos avisos abaixo.
  const aud = await audios(c, lidos, team, ignore, sink);
  // Mensagens do cliente que parecem pedido de alteração no iFood: vão para o passo "pedidos" (OPS), com as anteriores de contexto.
  for (const l of lidos) for (const m of l.msgs) {
    if (m.own || !m.author || avNameIn(m.author, team) || avNameIn(m.author, ignore) || /brase/i.test(m.author) || m.ts * 1000 < Math.max(c.sinceMs, now - 6 * 3600e3)) continue;
    const raw = l.raw.find((r: Row) => String(r.mid || r.id || r.ts) === m.mid), texto = typeof raw?.content === 'string' ? raw.content.replace(/^\s*👤[^\n]*\n?/u, '').trim() : '';
    if (!texto || !avPedidoCandidato(texto)) continue;
    const contexto = l.msgs.filter(x => x.ts < m.ts).slice(-8).map(x => ({autor: x.own ? 'Renan (Brase)' : x.author, texto: x.text, quando: brIso(x.ts * 1000)}));
    sink.push({mid: m.mid, grupo: l.name, autor: m.author, texto, ts: m.ts, contexto});
  }
  const rows: AvRow[] = [], meetDays = Number(op.reuniaoDias) || 30, exp = avExpediente(op.expediente);
  const gest = await gestoresDosGrupos(all.map((r: Row) => String(r.nome || (r.facts || {}).name || '')));
  ctx.gestores = gest.de;
  // Última reunião de cada grupo (provável ou realizada), para o aviso de 30 dias.
  const lastMeet = new Map<string, Row>((await sql`select distinct on (group_ns) group_ns, dia::text as dia, status from fn_reunioes_clientes where status <> 'nao_realizada' order by group_ns, dia desc`).map((r: Row) => [String(r.group_ns), r]));
  for (const r of all) {
    const f = r.facts || {}, name = String(r.nome || f.name || 'Grupo'), st = avGroupState(avComAudios(f.msgs || [], aud.mapa, team), team, ignore), quem = gest.de(name);
    const lm = lastMeet.get(String(r.user_ns));
    if (op.reuniao30 !== false && lm && avReuniao30Due(lm.dia, now, meetDays))
      rows.push({id: `reuniao30:${r.user_ns}:${lm.dia}`, canal: 'operacional', tipo: 'reuniao_30d', texto: avReuniao30Text(name, lm.dia, lm.status, meetDays, quem)});
    // Espera do cliente: só conta o tempo dentro do horário comercial (mensagem da noite começa a contar às 9h do dia útil).
    const util = st.waiting && st.waiting.ts * 1000 >= c.sinceMs ? avMsUteis(st.waiting.ts * 1000, now, exp) : 0;
    if (st.waiting && util >= waitMin * 60e3)
      rows.push({id: `semresp:${r.user_ns}:${st.waiting.mid}`, canal: 'operacional', tipo: 'sem_resposta', texto: avSemRespostaText(name, st.waiting, util, now, quem)});
    // Risco: no máximo um aviso por grupo a cada 6 h (a 1ª mensagem da janela).
    if (op.risco !== false) for (const m of st.risks) if (m.ts * 1000 >= c.sinceMs) rows.push({id: `risco:${r.user_ns}:${Math.floor(m.ts / 21600)}`, canal: 'operacional', tipo: 'risco', texto: avRiscoText(name, m, quem)});
    const ref = st.lastBrase ? st.lastBrase * 1000 : Date.parse(f.firstSeen || '') || now;
    if (now - ref >= quietDays * 864e5) rows.push({id: `silencio:${r.user_ns}:${st.lastBrase || 'nunca'}`, canal: 'operacional', tipo: 'silencio', texto: avSilencioText(name, Math.floor((now - ref) / 864e5), quem)});
  }
  return {contacts: contacts.length, groups: groups.length, read: changed.length, known: all.length, team: team.length, audios: aud.st, gestores: gest.st, queued: await queue(rows)};
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
async function agenda(c: Row, contacts: Row[], prev: Row){
  if (c.com && c.com.renan === false) return {skipped: 'desligado'};
  const now = Date.now(), cursor = Math.max(Date.parse(prev.renanCursor || '') || 0, c.sinceMs);
  const list = contacts.filter(x => (avClientGroup(x.name) || !/^\s*g:/i.test(String(x.name || ''))) && nicoTime(x.last_message_at) > cursor)
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
    if (avClientGroup(x.name)) { where = avGroupLabel(x.name); kind = avIsDi(x.name) ? 'di' : 'cliente' }
    else if (avNameIn(String(x.name || ''), team.filter(n => !/^renan$/i.test(String(n).trim())))) { porContexto.equipe_nome = (porContexto.equipe_nome || 0) + 1 }
    else {
      clientGroups ??= (await sql`select nome, facts->'authors' as authors from fn_grupos`).map((r: Row) => ({nome: String(r.nome), authors: (r.authors || []).filter((a: string) => !avNameIn(a, team))}));
      const g = avClientOf(x.name, clientGroups);
      if (g) { where = `${x.name} (${g}), no privado`; kind = avIsDi(g) ? 'di' : 'cliente' }
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
async function pedidos(sink: Row[], gestores: Gestores){
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
    avisos += await queue([{id, canal: 'operacional', tipo: 'pedido_ifood', texto: avPedidoText(p.grupo, p.autor, p.texto, r, gestores(p.grupo))}]);
  }
  let horaMarcada = 0;
  if (conf.mode === 'on') {
    const ag = await opsPedidos(conf, {op: 'agendados'});
    for (const e of Array.isArray(ag.executados) ? ag.executados : []) { horaMarcada++; avisos += await queue([{id: 'agendado:' + crypto.randomUUID(), canal: 'operacional', tipo: 'pedido_agendado', texto: avAgendadoText(e)}]) }
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
async function reunioesOps(gestores: Gestores){
  const conf = await getConf('ops_pedidos');
  if (!conf.url || !conf.key) return {skipped: 'sem a configuração do OPS (fn_config ops_pedidos)'};
  const url = String(conf.urlReunioes || String(conf.url).replace(/whatsapp-pedidos\/?$/, 'reunioes-clientes'));
  const ops = async (body: Row) => {
    const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', 'x-pedidos-key': String(conf.key)}, body: JSON.stringify(body), signal: AbortSignal.timeout(60000)});
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 && !j.status) throw new OpsAusente('função reunioes-clientes ainda não publicada no OPS');
    if (!r.ok) throw new Error('OPS respondeu ' + r.status + (j && j.error ? ': ' + String(j.error).slice(0, 200) : ''));
    return j as Row;
  };
  const st: Row = {meet: 0, notas: 0, avisos: 0};
  try {
    // (a) Reuniões confirmadas pela rotina (dos últimos 45 dias).
    const reais = await sql`select id, grupo, dia::text as dia from fn_reunioes_clientes where status = 'realizada' and ops_at is null and dia >= current_date - 45 order by dia limit ${REUNIOES_MAX}`;
    for (const m of reais) {
      let r: Row;
      try { r = await ops({op: 'reuniao', id: 'meet:' + m.id, grupo: m.grupo, dia: m.dia, fonte: 'rotina dos grupos'}) }
      catch (e) { if (e instanceof OpsAusente) throw e; await sql`update fn_reunioes_clientes set ops_status = 'erro', ops_info = ${errText(e).slice(0, 300)} where id = ${m.id}`; continue }
      st.meet++;
      await sql`update fn_reunioes_clientes set ops_status = ${r.status === 'ok' ? 'ok' : String(r.status || 'erro')}, ops_info = ${String(r.reuniao || r.cliente || '').slice(0, 200)}, ops_at = now() where id = ${m.id}`;
      if (!r.repetido && !(r.status === 'ok' && r.ja_estava_feita)) st.avisos += await queue([{id: 'reuniaoops:' + m.id, canal: 'operacional', tipo: 'reuniao_ops', texto: avReuniaoOpsText(String(m.grupo), String(m.dia), r, 'meet', gestores(m.grupo))}]);
    }
    // (b) Anotações do Gemini.
    const notas = await sql`select * from fn_reunioes_notas where status = 'novo' and tries < 3 order by created_at limit ${REUNIOES_MAX}`;
    let docs: Row[] | null = null;
    for (const n of notas) {
      const dia = n.dia instanceof Date ? n.dia.toISOString().slice(0, 10) : String(n.dia).slice(0, 10);
      try {
        if (n.tipo === 'interna') { await sql`update fn_reunioes_notas set status = 'ignorado', updated_at = now() where id = ${n.id}`; continue }
        if (n.tipo === 'cliente') {
          if (!n.grupo) { await sql`update fn_reunioes_notas set status = 'sem_destino', erro = 'sem o grupo do cliente', updated_at = now() where id = ${n.id}`; continue }
          const r = await ops({op: 'reuniao', id: 'gemini:' + n.id, grupo: n.grupo, dia, fonte: 'Anotações do Gemini', participantes: n.participantes || undefined,
            resumo: [n.resumo, n.proximos ? 'Próximos passos: ' + n.proximos : ''].filter(Boolean).join('\n'), acoes: Array.isArray(n.acoes) ? n.acoes : []});
          await sql`update fn_reunioes_notas set status = ${r.status === 'ok' ? 'feito' : 'sem_destino'}, destino = ${String(r.cliente || '').slice(0, 200) || null}, erro = null, updated_at = now() where id = ${n.id}`;
          if (!r.repetido) st.avisos += await queue([{id: 'notaops:' + n.id, canal: 'operacional', tipo: 'reuniao_gemini', texto: avReuniaoOpsText(String(n.grupo), dia, r, 'gemini', gestores(n.grupo))}]);
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
async function send(groups: Row, mode: string){
  if (mode !== 'on') return {sent: 0, pending: Number((await sql`select count(*)::int as n from fn_avisos where sent_at is null and tries < 3`)[0].n)};
  const rows = await sql`select id, canal, texto from fn_avisos where sent_at is null and tries < 3 order by created_at, id limit ${SEND_MAX}`;
  if (!rows.length) return {sent: 0, failed: 0};
  // Trava: só sai mensagem para os grupos AVISOS. Nada é enviado no grupo do cliente (decisão do dono).
  const clientes = new Set((await sql`select user_ns from fn_grupos`).map((r: Row) => String(r.user_ns)));
  let sent = 0, failed = 0;
  for (const r of rows) {
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
  await step('reunioes', () => reunioes(c, prev));
  let contacts: Row[] | null = null;
  await step('contatos', async () => { contacts = await opsContacts(); return {n: contacts.length} });
  if (contacts) {
    const list: Row[] = contacts;
    const sink: Row[] = [], ctx: {gestores: Gestores} = {gestores: () => []};
    await step('grupos', () => grupos(c, list, sink, ctx));
    await step('pedidos', () => pedidos(sink, ctx.gestores));
    await step('reunioesOps', () => reunioesOps(ctx.gestores));
    await step('agenda', () => agenda(c, list, prev));
    await step('agendaFila', () => agendaFila(c));
  }
  await step('envio', () => send(groups, mode));
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
