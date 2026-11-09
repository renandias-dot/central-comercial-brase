// Webhook da API oficial do WhatsApp (Cloud API da Meta).
// - GET: verificação do webhook (hub.challenge).
// - POST: grava cada mensagem, liga ao lead pelo telefone, mede o tempo de resposta do SDR
//   e aplica as regras ligadas na aba WhatsApp do CRM (marcar toque, mover card).
// Campos a assinar no app da Meta: "messages" e, no modo coexistência, "smb_message_echoes".
import { brDay, getDoc, iso, json, listDocs, log, phoneKey, putDoc, sb, type Doc } from '../_shared/crm.ts';
import '../_shared/capi.ts'; // mudança de etapa por resposta do lead também vira evento da Meta (quando a integração está ligada)

const VERIFY = Deno.env.get('CRM_WA_VERIFY_TOKEN') ?? '';
const APP_SECRET = Deno.env.get('CRM_WA_APP_SECRET') ?? '';

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function sameText(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const textOf = (m: Record<string, any>) => m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.image?.caption ?? (m.type ? `[${m.type}]` : '');

type Msg = { dir: 'in' | 'out'; id: string; lead: string; biz: string; pnid: string; ts: number; kind: string; body: string; raw: unknown };

async function handle(m: Msg, leads: { id: string; data: Doc }[], cfg: Doc) {
  const key = phoneKey(m.lead);
  const lead = leads.find(l => phoneKey(l.data.phone) === key) ?? null;
  const { data: inserted, error } = await sb.from('crm_wa_messages').upsert({
    id: m.id, direction: m.dir, lead_key: key, lead_phone: m.lead, business_phone: m.biz, phone_number_id: m.pnid,
    kind: m.kind, body: m.body.slice(0, 2000), ts: new Date(m.ts).toISOString(), lead_id: lead?.id ?? null, raw: m.raw,
  }, { onConflict: 'id', ignoreDuplicates: true }).select('id');
  if (error) throw new Error(error.message);
  if (!inserted?.length) return { message: m.id, duplicate: true }; // reenvio da Meta ou eco já gravado
  if (!lead) return { message: m.id, lead: null };

  const l = structuredClone(lead.data) as Record<string, any>;
  const wa = (l.wa ??= {});
  const at = new Date(m.ts).toISOString();
  const rules = (cfg.waRules ?? {}) as Record<string, boolean>;

  if (m.dir === 'in') {
    wa.lastInAt = at; wa.lastSnippet = m.body.slice(0, 140);
    if (!wa.waitingSince) wa.waitingSince = at;
    // Lead respondeu enquanto o print estava programado (etapa Link recebido): cancela o prazo para o SDR seguir a conversa.
    if (l.printDue) { delete l.printDue; l.repliedAt = at; }
    if (rules.moveOnReply && ['novo', 'link', 'print'].includes(l.stage)) {
      l.stage = 'qualificando'; l.stageAt = iso(); l.history = [...(l.history ?? []), { s: 'qualificando', at: iso(), by: 'whatsapp' }].slice(-80);
    }
  } else {
    wa.lastOutAt = at;
    if (wa.waitingSince) {
      // Tempo de resposta desta conversa, somado ao resumo diário do número do SDR.
      const minutes = Math.max(0, (m.ts - new Date(wa.waitingSince).getTime()) / 6e4);
      const day = brDay(m.ts), bizKey = String(m.biz).replace(/\D/g, '') || m.pnid, sid = `${day}__${bizKey}`;
      const st = (await getDoc('wa_stats', sid)) ?? { date: day, business: bizKey, count: 0, totalMin: 0, under5: 0, under60: 0 };
      st.count = Number(st.count) + 1; st.totalMin = Number(st.totalMin) + minutes;
      if (minutes <= 5) st.under5 = Number(st.under5) + 1;
      if (minutes <= 60) st.under60 = Number(st.under60) + 1;
      await putDoc('wa_stats', sid, st);
      wa.lastResponseMin = Math.round(minutes); wa.waitingSince = null;
    }
    if (rules.markTouch !== false && Array.isArray(l.touches)) {
      const today = brDay(m.ts);
      const t = l.touches.filter((x: any) => !x.done && x.due <= today).sort((a: any, b: any) => a.due.localeCompare(b.due))[0];
      if (t) { t.done = true; t.doneAt = at; t.by = 'whatsapp'; }
    }
  }
  l.updatedAt = iso();
  await putDoc('leads', lead.id, l);
  lead.data = l;
  return { message: m.id, lead: lead.id };
}

Deno.serve(async req => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && VERIFY && url.searchParams.get('hub.verify_token') === VERIFY)
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const raw = await req.text();
  if (APP_SECRET) {
    const got = req.headers.get('x-hub-signature-256') ?? '';
    if (!sameText(got, 'sha256=' + await hmacHex(APP_SECRET, raw))) return new Response('bad signature', { status: 401 });
  }
  let body: any; try { body = JSON.parse(raw); } catch { return json({ error: 'json' }, 400); }
  const msgs: Msg[] = [];
  for (const entry of body.entry ?? []) for (const ch of entry.changes ?? []) {
    const v = ch.value ?? {}, biz = v.metadata?.display_phone_number ?? '', pnid = v.metadata?.phone_number_id ?? '';
    for (const m of v.messages ?? []) msgs.push({ dir: 'in', id: m.id, lead: m.from, biz, pnid, ts: +m.timestamp * 1000, kind: m.type, body: textOf(m), raw: m });
    for (const m of v.message_echoes ?? []) msgs.push({ dir: 'out', id: m.id, lead: m.to, biz, pnid, ts: +m.timestamp * 1000, kind: m.type, body: textOf(m), raw: m });
    // Mensagens enviadas pela própria API (ex.: caixa de entrada de um parceiro) chegam como status "sent".
    for (const s of v.statuses ?? []) if (s.status === 'sent') msgs.push({ dir: 'out', id: s.id, lead: s.recipient_id, biz, pnid, ts: +s.timestamp * 1000, kind: 'enviada', body: '', raw: s });
  }
  if (!msgs.length) return new Response('ok'); // status de entrega e outros eventos
  try {
    const [cfg, leads] = await Promise.all([getDoc('config', 'main'), listDocs('leads')]);
    const results = [];
    for (const m of msgs.sort((a, b) => a.ts - b.ts)) results.push(await handle(m, leads, cfg ?? {}));
    await log('crm-whatsapp-webhook', { count: msgs.length }, results);
  } catch (e) {
    await log('crm-whatsapp-webhook', body, { error: String(e) });
  }
  return new Response('ok'); // a Meta só precisa do 200
});
