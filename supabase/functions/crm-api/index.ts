// Porta de entrada do app hospedado: confere o código de acesso da equipe e lê/grava os documentos do CRM.
// Também busca a lista CRM do ClickUp para o botão "Atualizar do ClickUp", enquanto o time usa os dois.
// Chamada: POST https://<projeto>.supabase.co/functions/v1/crm-api com o cabeçalho x-crm-key: <CRM_ACCESS_KEY>
import { brDay, docRows, getDoc, leadHooks, putDoc, sb } from '../_shared/crm.ts';
import { parseIcs } from '../_shared/ics.ts';
import { backfill, capiConfigured, capiDataset, flush as capiFlush, ping as capiPing, recent as capiRecent, sendTest as capiSendTest } from '../_shared/capi.ts';
import { pushReady, pushSubscribe, pushTest, pushUnsubscribe, vapidPublic } from '../_shared/push.ts';

const KEY = Deno.env.get('CRM_ACCESS_KEY') ?? '';
const CLICKUP = Deno.env.get('CLICKUP_TOKEN') ?? '';
const CU_LIST = '901324302434';
const META = Deno.env.get('META_ACCESS_TOKEN') ?? ''; // token só de leitura (ads_read) da conta de anúncios
const GCAL = Deno.env.get('GOOGLE_CALENDAR_ICS_URL') ?? ''; // endereço secreto (iCal) da agenda do Google, só leitura
const CAL_TTL_MS = 90_000; // no máximo uma ida ao Google a cada 90 s, não importa quantas pessoas estejam com a agenda aberta
const COLS = new Set(['sellers', 'leads', 'tasks', 'routines', 'routineLog', 'docs', 'adjustments', 'config', 'meta', 'wa_stats', 'holds']);
const OVERLAP_MS = 15_000; // folga para gravações que terminaram perto da consulta anterior

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-crm-key',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
function sameText(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

// ClickUp: só a lista CRM, no mesmo formato que o conector do Claude devolve.
async function cu(path: string) {
  const r = await fetch('https://api.clickup.com/api/v2' + path, { headers: { authorization: CLICKUP } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ClickUp ${r.status}: ${j.err ?? j.error ?? 'erro'}`);
  return j;
}
const descOf = (t: Record<string, any>) => {
  const d = [t.markdown_description, t.text_content, t.description].find(v => typeof v === 'string');
  return d === undefined ? {} : { markdown_description: d };
};
// Investimento das campanhas no mesmo formato guardado em meta/spend: mensal antes de `from` e por dia a partir dele.
async function metaSpend(campaigns: string[], from: string) {
  const rows: Record<string, unknown>[] = []; let account = '';
  const cutMonth = from.slice(0, 7), todayBr = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const fields = 'account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions';
  const pull = async (cid: string, q: string, daily: boolean) => {
    let url: string | null | undefined = `https://graph.facebook.com/v21.0/${cid}/insights?level=ad&${q}&limit=500&fields=${fields}&access_token=${encodeURIComponent(META)}`;
    for (let page = 0; url && page < 10; page++) {
      const r: Response = await fetch(url);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Meta ${r.status}: ${j?.error?.message ?? 'erro'}`);
      for (const x of j.data ?? []) {
        const month = String(x.date_start).slice(0, 7);
        if (!daily && month >= cutMonth) continue;
        const act = (k: string) => +((x.actions ?? []).find((a: Record<string, string>) => a.action_type === k)?.value ?? 0) || 0;
        if (!account && x.account_name) account = `${x.account_name} (act_${x.account_id})`;
        rows.push({
          adId: x.ad_id, ad: x.ad_name, adsetId: x.adset_id, adset: x.adset_name, campaignId: x.campaign_id, campaign: x.campaign_name,
          ...(daily ? { day: String(x.date_start) } : {}), month, spend: Math.round(+x.spend * 100) / 100 || 0, impressions: +x.impressions || 0, clicks: +x.clicks || 0,
          lpv: act('landing_page_view'), metaLeads: act('lead'),
        });
      }
      url = j.paging?.next ?? null;
    }
  };
  for (const cid of campaigns.map(c => String(c).replace(/\D/g, '')).filter(Boolean).slice(0, 30)) {
    await pull(cid, 'time_increment=monthly&date_preset=maximum', false);
    await pull(cid, `time_increment=1&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: todayBr }))}`, true);
  }
  return { rows, account };
}

// Agenda do Google: baixa o endereço secreto, expande repetições e guarda só os intervalos ocupados em meta/calendar.
// Os títulos só são guardados se Configurações › Agenda estiver com "Mostrar nomes dos compromissos".
async function calendar(force: boolean) {
  const cached = await getDoc('meta', 'calendar') as Record<string, any> | null;
  const age = (v: unknown) => v ? Date.now() - Date.parse(String(v)) : Infinity;
  if (!force && cached && ((!cached.error && age(cached.fetchedAt) < CAL_TTL_MS) || (cached.error && age(cached.errorAt) < 30_000))) return cached;
  const url = GCAL.replace(/^webcal:/i, 'https:');
  try {
    if (!/^https:\/\/calendar\.google\.com\/calendar\/ical\//.test(url)) throw new Error('O segredo GOOGLE_CALENDAR_ICS_URL precisa ser o endereço iCal (secreto ou público) do Google Agenda.');
    // O Google às vezes responde 429 (muitas consultas vindas do mesmo servidor) ou 5xx por um instante: tenta de novo 2 vezes.
    let r = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
    for (let n = 0; n < 2 && (r.status === 429 || r.status >= 500); n++) {
      await new Promise(res => setTimeout(res, 1500 * (n + 1)));
      r = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
    }
    if (!r.ok) throw new Error(r.status === 429 ? 'O Google limitou as consultas à agenda por um instante (429). Tente de novo em alguns minutos.'
      : url.includes('/public/') && (r.status === 404 || r.status === 403)
        ? 'A agenda não está pública (o Google respondeu ' + r.status + '). Em Configurações da agenda › Permissões de acesso, marque "Disponibilizar publicamente" (pode ser só disponibilidade) ou use o endereço secreto no formato iCal.'
        : 'O Google respondeu ' + r.status + '. Confira o endereço da agenda.');
    const text = await r.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('O endereço não devolveu uma agenda no formato iCal.');
    const cfg = await getDoc('config', 'main') as Record<string, any> | null;
    const fromMs = Date.parse(brDay(Date.now() - 864e5) + 'T00:00:00-03:00'), toMs = fromMs + 48 * 864e5;
    // Importada só aqui: se a biblioteca falhar, só a agenda para de funcionar, não o resto da API.
    const { default: ICAL } = await import('npm:ical.js@2.2.1');
    const events = parseIcs(ICAL, text, fromMs, toMs, cfg?.agenda?.showTitles === true);
    const doc = { fetchedAt: new Date().toISOString(), from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), events };
    await putDoc('meta', 'calendar', doc);
    return doc;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    await putDoc('meta', 'calendar', { ...(cached ?? { events: [] }), error: msg, errorAt: new Date().toISOString() }).catch(() => {});
    throw new Error(msg);
  }
}

async function clickup(tool: string, input: Record<string, any>) {
  if (tool === 'clickup_filter_tasks') {
    const page = Math.max(0, Math.min(50, Number(input.page) || 0));
    const j = await cu(`/list/${CU_LIST}/task?include_closed=true&subtasks=false&include_markdown_description=true&page=${page}`);
    const tasks = (j.tasks ?? []).map((t: Record<string, any>) => ({
      id: t.id, name: t.name, status: t.status?.status ?? '', date_created: t.date_created, date_updated: t.date_updated,
      assignees: (t.assignees ?? []).map((a: Record<string, any>) => ({ username: a.username })), ...descOf(t),
    }));
    return { tasks, has_more: j.last_page === false && tasks.length > 0 };
  }
  if (tool === 'clickup_get_task') {
    const id = String(input.task_id ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    const t = await cu(`/task/${id}?include_markdown_description=true`);
    if (String(t.list?.id) !== CU_LIST) throw new Error('Tarefa fora da lista CRM');
    return { id: t.id, date_created: t.date_created, ...descOf(t) };
  }
  throw new Error('Operação do ClickUp não permitida');
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!KEY || !sameText(req.headers.get('x-crm-key') ?? '', KEY)) return json({ error: 'Código inválido.' }, 401);
  let b: Record<string, any>; try { b = await req.json(); } catch { return json({ error: 'Corpo inválido' }, 400); }
  try {
    const now = new Date().toISOString();
    switch (b.op) {
      case 'load':
        return json({ docs: (await docRows()).map(({ col, id, data }) => ({ col, id, data })), cursor: now, clickup: !!CLICKUP, meta: !!META, calendar: !!GCAL, vapid: pushReady() ? vapidPublic : '', capi: { configured: capiConfigured(), dataset: capiDataset } });
      // API de Conversões da Meta (eventos de CRM): teste, envio dos leads recentes, reenvio da fila e a lista dos últimos eventos.
      case 'capi_test': return json(await capiSendTest());
      case 'capi_ping': return json(await capiPing());
      case 'capi_backfill': return json({ ok: true, ...(await backfill(Number(b.days) || 7)) });
      case 'capi_flush': return json({ ok: true, ...(await capiFlush(200)) });
      case 'capi_log': return json(await capiRecent(Number(b.limit) || 30));
      // Avisos no celular com o app fechado: a inscrição do aparelho (chave pública VAPID vem no "load").
      case 'push_subscribe':
        if (!pushReady()) return json({ error: 'Avisos no celular não configurados no servidor.', code: 'not_configured' }, 400);
        await pushSubscribe(b);
        return json({ ok: true });
      case 'push_unsubscribe':
        await pushUnsubscribe(b.endpoint);
        return json({ ok: true });
      case 'push_test':
        if (!pushReady()) return json({ error: 'Avisos no celular não configurados no servidor.', code: 'not_configured' }, 400);
        return json({ ok: true, ...(await pushTest(b.endpoint)) });
      case 'changes': {
        const since = new Date(new Date(String(b.since)).getTime() - OVERLAP_MS);
        if (isNaN(+since)) return json({ error: 'since inválido' }, 400);
        return json({ docs: await docRows(since.toISOString()), cursor: now });
      }
      case 'set':
      case 'delete': {
        const col = String(b.col ?? ''), id = String(b.id ?? '');
        if (!COLS.has(col) || !id || id.length > 200) return json({ error: 'Documento inválido' }, 400);
        if (b.op === 'set' && (!b.data || typeof b.data !== 'object' || Array.isArray(b.data))) return json({ error: 'Dados inválidos' }, 400);
        const row = b.op === 'set' ? { col, id, data: b.data, deleted: false } : { col, id, data: {}, deleted: true };
        // Lead que mudou de etapa vira evento da Meta (se a integração estiver ligada): lê o lead antigo antes de gravar.
        const hooked = col === 'leads' && b.op === 'set' && !!leadHooks.after;
        const before = hooked && leadHooks.before ? await leadHooks.before(id).catch(() => undefined) : undefined;
        const { error } = await sb.from('crm_docs').upsert(row);
        if (error) throw new Error(error.message);
        if (hooked && before !== undefined) leadHooks.after!(id, before, b.data);
        return json({ ok: true });
      }
      case 'meta':
        if (!META) return json({ error: 'Meta não configurada no servidor.', code: 'not_configured' }, 400);
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(b.from ?? '')) ? String(b.from) : new Date(Date.now() - 3 * 3600e3 - 62 * 864e5).toISOString().slice(0, 7) + '-01';
        return json(await metaSpend(Array.isArray(b.campaigns) ? b.campaigns : [], from));
      case 'calendar':
        if (!GCAL) return json({ error: 'Agenda do Google não configurada no servidor.', code: 'not_configured' }, 400);
        return json(await calendar(b.force === true));
      case 'clickup':
        if (!CLICKUP) return json({ error: 'ClickUp não configurado no servidor.', code: 'not_configured' }, 400);
        return json(await clickup(String(b.tool), b.input ?? {}));
      default:
        return json({ error: 'Operação desconhecida' }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e), code: 'server_error' }, 500);
  }
});
