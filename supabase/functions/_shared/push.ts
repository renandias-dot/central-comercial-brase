// Avisos no celular com o app fechado: inscrições, envio e as regras de quem recebe o quê.
// Quem chama: crm-api (ligar/desligar/testar), crm-lead-webhook (lead novo) e crm-push-tick (print vencido, lead esperando).
// Segredos: CRM_VAPID_PUBLIC_KEY, CRM_VAPID_PRIVATE_KEY, CRM_VAPID_SUBJECT.
import { getDoc, iso, sb, type Doc } from './crm.ts';
import { sendWebPush } from './webpush.ts';

const PUB = Deno.env.get('CRM_VAPID_PUBLIC_KEY') ?? '';
const PRIV = Deno.env.get('CRM_VAPID_PRIVATE_KEY') ?? '';
const SUBJECT = Deno.env.get('CRM_VAPID_SUBJECT') ?? 'https://app.brasemarketing.com.br';
export const vapidPublic = PUB;
export const pushReady = () => !!(PUB && PRIV);

// Só os serviços de push dos navegadores (Chrome/Android, Firefox, Safari, Edge): o servidor nunca chama outro endereço.
const SERVICES = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/;

export type Payload = { t: string; b: string; tag?: string; url?: string; id?: string; k?: string };
type Sub = { endpoint: string; p256dh: string; auth: string; seller_id: string; fail_count: number };

export async function pushSubscribe(b: Record<string, any>) {
  const s = b.subscription ?? {}, endpoint = String(s.endpoint ?? ''), p256dh = String(s.keys?.p256dh ?? ''), auth = String(s.keys?.auth ?? '');
  let host = ''; try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch { /* endereço inválido */ }
  if (!host || endpoint.length > 1000 || !SERVICES.test(host)) throw new Error('Endereço de aviso não aceito.');
  if (!/^[\w-]{86,88}$/.test(p256dh) || !/^[\w-]{21,24}$/.test(auth)) throw new Error('Chaves do aviso inválidas.');
  const { error } = await sb.from('crm_push_subs').upsert({
    endpoint, p256dh, auth, seller_id: String(b.sellerId ?? '').slice(0, 100), ua: String(b.ua ?? '').slice(0, 200), updated_at: iso(), fail_count: 0, last_error: null,
  }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);
}
export async function pushUnsubscribe(endpoint: unknown) {
  const { error } = await sb.from('crm_push_subs').delete().eq('endpoint', String(endpoint ?? ''));
  if (error) throw new Error(error.message);
}

async function allSubs(): Promise<Sub[]> {
  const { data, error } = await sb.from('crm_push_subs').select('endpoint,p256dh,auth,seller_id,fail_count');
  if (error) throw new Error(error.message);
  return (data ?? []) as Sub[];
}
// Quem recebe o aviso de um lead: o responsável dele e a gestão (inscrição sem vendedor); lead sem responsável vai para todos.
const targets = (subs: Sub[], ownerId: unknown) => subs.filter(s => s.seller_id === '' || !ownerId || s.seller_id === ownerId);

export async function pushTo(subs: Sub[], payload: Payload) {
  const out = { sent: 0, gone: 0, failed: 0, errors: [] as string[] };
  if (!pushReady()) { out.errors.push('Chaves de aviso não configuradas'); return out; }
  await Promise.all(subs.map(async s => {
    try {
      const r = await sendWebPush(s, payload, { pub: PUB, priv: PRIV, subject: SUBJECT });
      if (r.ok) { out.sent++; await sb.from('crm_push_subs').update({ last_ok_at: iso(), fail_count: 0, last_error: null }).eq('endpoint', s.endpoint); }
      else if (r.gone) { out.gone++; out.errors.push(`${r.status} ${r.text}`.trim()); await sb.from('crm_push_subs').delete().eq('endpoint', s.endpoint); }
      else {
        out.failed++; out.errors.push(`${r.status} ${r.text}`.trim());
        // Falhas seguidas (7 ou mais) apagam a inscrição; ela volta sozinha quando o app for aberto de novo.
        if (s.fail_count >= 6) await sb.from('crm_push_subs').delete().eq('endpoint', s.endpoint);
        else await sb.from('crm_push_subs').update({ fail_count: s.fail_count + 1, last_error: `${r.status} ${r.text}`.slice(0, 200) }).eq('endpoint', s.endpoint);
      }
    } catch (e) { out.failed++; out.errors.push(String((e as Error).message ?? e)); }
  }));
  return out;
}

export async function pushTest(endpoint: unknown) {
  const { data, error } = await sb.from('crm_push_subs').select('endpoint,p256dh,auth,seller_id,fail_count').eq('endpoint', String(endpoint ?? ''));
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Este celular não está inscrito nos avisos. Ative de novo.');
  return await pushTo(data as Sub[], { t: 'Teste dos avisos', b: 'Se você está vendo isto, os avisos com o app fechado estão funcionando.', tag: 'teste', url: './#hoje' });
}

// Expediente (horário de Brasília, com a mesma configuração do timer do print): só nele os avisos de lead novo saem na hora.
export function inShift(cfg: Doc, at = Date.now()) {
  const P = { start: '09:00', end: '19:00', skipWeekends: true, ...((cfg.printTimer as Doc) ?? {}) } as { start: string; end: string; skipWeekends: boolean };
  const d = new Date(at - 3 * 3600e3), m = d.getUTCHours() * 60 + d.getUTCMinutes(), wd = d.getUTCDay();
  const tm = (s: string) => { const [h, mi] = String(s).split(':').map(Number); return (h || 0) * 60 + (mi || 0); };
  if (P.skipWeekends !== false && (wd === 0 || wd === 6)) return false;
  return m >= tm(P.start) && m < tm(P.end);
}

// Reserva o aviso: só quem conseguir gravar a chave envia (nunca sai duas vezes).
async function claim(key: string) {
  const { data, error } = await sb.from('crm_push_sent').upsert({ key }, { onConflict: 'key', ignoreDuplicates: true }).select('key');
  return !error && (data?.length ?? 0) > 0;
}
const dur = (ms: number) => { const m = Math.max(1, Math.round(ms / 6e4)); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : ''); };
const nm = (l: Doc) => String(l.name || 'Lead sem nome');
const newPayload = (id: string, l: Doc, extra = ''): Payload => ({ t: 'Lead novo', b: nm(l) + (l.contact ? ' · ' + l.contact : '') + extra, tag: 'new|' + id, url: './#lead=' + id, id, k: 'new' });
const digest = (n: number, names: string[]): Payload => ({ t: n + ' leads novos esperando', b: names.slice(0, 4).join(', ') + (n > 4 ? ' e mais ' + (n - 4) : ''), tag: 'new|lote', url: './#hoje', k: 'new' });

// Lead que acabou de entrar pelo webhook. Fora do expediente não avisa agora: o relógio (crm-push-tick) avisa quando o expediente abrir.
export async function notifyNewLeads(created: { id: string; data: Doc }[], cfg: Doc) {
  if (!pushReady() || !created.length || (cfg.alerts as Doc | undefined)?.newLead === false || !inShift(cfg)) return null;
  const subs = await allSubs(); if (!subs.length) return null;
  const fresh: { id: string; data: Doc }[] = [];
  for (const l of created) if (!l.data.example && await claim('new|' + l.id)) fresh.push(l);
  if (!fresh.length) return null;
  if (fresh.length > 3) return await pushTo(subs, digest(fresh.length, fresh.map(l => nm(l.data))));
  const res = [];
  for (const l of fresh) res.push(await pushTo(targets(subs, l.data.ownerId), newPayload(l.id, l.data)));
  return res;
}

// Roda a cada minuto (pg_cron): print vencido, leads esperando desde antes do expediente e lead parado além do limite.
export async function runTick() {
  let nPrint = 0, nNovos = 0, nSla = 0;
  const out: Record<string, unknown> = {};
  if (!pushReady()) return { skipped: 'chaves de aviso não configuradas' };
  const now = Date.now(), cfg = await getDoc('config', 'main') ?? {};
  await sb.from('crm_push_sent').delete().lt('sent_at', new Date(now - 14 * 864e5).toISOString());
  const subs = await allSubs(); out.inscricoes = subs.length;
  if (!subs.length) return out;
  const { data, error } = await sb.from('crm_docs').select('id,data').eq('col', 'leads').eq('deleted', false).in('data->>stage', ['link', 'novo']);
  if (error) throw new Error(error.message);
  const leads = (data ?? []) as { id: string; data: Doc }[];
  const A = { newLead: true, newLeadHours: 6, slaMin: 5, ...((cfg.alerts as Doc) ?? {}) } as { newLead: boolean; newLeadHours: number; slaMin: number };
  const printOn = (cfg.printTimer as Doc | undefined)?.on !== false;

  // 1. Print vencido (o prazo já foi calculado dentro do expediente quando o lead entrou em "Link recebido").
  if (printOn) for (const { id, data: l } of leads) {
    if (l.stage !== 'link' || l.example || !l.printDue) continue;
    const due = Date.parse(String(l.printDue));
    if (isNaN(due) || due > now || now - due > 3 * 3600e3) continue;
    if (!await claim(`print|${id}|${l.printDue}`)) continue;
    await pushTo(targets(subs, l.ownerId), { t: 'Hora de enviar o print', b: nm(l), tag: `print|${id}|${l.printDue}`, url: './#lead=' + id, id, k: 'print' });
    nPrint++;
  }

  // 2. Lead novo sem 1º contato.
  if (A.newLead && inShift(cfg, now)) {
    const waiting = leads.filter(({ data: l }) => l.stage === 'novo' && !l.example && !l.ackAt && !l.handoff && l.createdAt && now - Date.parse(String(l.createdAt)) <= A.newLeadHours * 36e5
      && !((l.touches as { done?: boolean }[] | undefined)?.[0]?.done));
    const keys = waiting.map(w => 'new|' + w.id);
    const { data: sent } = keys.length ? await sb.from('crm_push_sent').select('key,sent_at').in('key', keys) : { data: [] };
    const at = new Map((sent ?? []).map((r: { key: string; sent_at: string }) => [r.key, Date.parse(r.sent_at)]));
    // 2a. ainda não avisados (entraram fora do expediente ou o aviso falhou)
    const fresh: typeof waiting = [];
    for (const w of waiting) if (!at.has('new|' + w.id) && await claim('new|' + w.id)) { fresh.push(w); at.set('new|' + w.id, now); }
    if (fresh.length > 3) await pushTo(subs, digest(fresh.length, fresh.map(w => nm(w.data))));
    else for (const w of fresh) await pushTo(targets(subs, w.data.ownerId), newPayload(w.id, w.data));
    nNovos = fresh.length;
    // 2b. avisado há mais de slaMin minutos e continua sem 1º contato: segundo aviso, uma vez só
    if (A.slaMin > 0) for (const w of waiting) {
      const t = at.get('new|' + w.id); if (!t || now - t < A.slaMin * 60e3 || fresh.includes(w)) continue;
      if (!await claim('sla|' + w.id)) continue;
      await pushTo(targets(subs, w.data.ownerId), newPayload(w.id, w.data, ` · espera há ${dur(now - Date.parse(String(w.data.createdAt)))}`));
      nSla++;
    }
  }
  return { ...out, print: nPrint, novos: nNovos, sla: nSla };
}
