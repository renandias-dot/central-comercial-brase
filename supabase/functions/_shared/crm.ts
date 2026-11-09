// Regras do CRM usadas pelas funções: datas no horário de Brasília, cadência de toques, rodízio e telefones.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const sb: SupabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

export type Doc = Record<string, unknown>;
export const iso = () => new Date().toISOString();
export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Datas "YYYY-MM-DD" em America/Sao_Paulo (UTC-3, sem horário de verão).
export const brDay = (ms = Date.now()) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const skipWeekend = (s: string, on: boolean) => { if (!on) return s; const w = new Date(s + 'T12:00:00Z').getUTCDay(); return w === 6 ? addDays(s, 2) : w === 0 ? addDays(s, 1) : s; };

export const DEFAULT_CADENCE = [
  { title: 'Primeiro contato', gap: 0 }, { title: 'Follow-up', gap: 2 },
  { title: 'Prova social / print', gap: 2 }, { title: 'Última tentativa', gap: 2 },
];

export function buildCadence(cfg: Doc, start = brDay()) {
  const cad = Array.isArray(cfg.cadence) && cfg.cadence.length ? cfg.cadence as { title: string; gap: number }[] : DEFAULT_CADENCE;
  const skip = cfg.skipWeekends !== false;
  let d = start;
  return cad.map((t, i) => {
    d = i === 0 ? skipWeekend(addDays(start, +t.gap || 0), skip) : skipWeekend(addDays(d, Math.max(1, +t.gap || 1)), skip);
    return { id: uid('t'), title: t.title || `Toque ${i + 1}`, due: d, done: false, doneAt: null };
  });
}

// Chave de telefone que casa números com e sem o 9 extra: DDD + 8 últimos dígitos.
export function phoneKey(p: unknown) {
  let d = String(p ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return '';
  return d.slice(0, 2) + d.slice(-8);
}

export async function getDoc(col: string, id: string): Promise<Doc | null> {
  const { data } = await sb.from('crm_docs').select('data').eq('col', col).eq('id', id).eq('deleted', false).maybeSingle();
  return (data?.data as Doc) ?? null;
}
export async function putDoc(col: string, id: string, data: Doc) {
  const { error } = await sb.from('crm_docs').upsert({ col, id, data, deleted: false });
  if (error) throw new Error(error.message);
}
// A API do Supabase devolve no máximo 1000 linhas por consulta: busca em páginas.
export type Row = { col: string; id: string; data: Doc; deleted: boolean };
export async function docRows(since?: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('crm_docs').select('col,id,data,deleted').order('col').order('id').range(from, from + 999);
    q = since ? q.gt('updated_at', since) : q.eq('deleted', false);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...(data ?? []) as Row[]);
    if (!data || data.length < 1000) return out;
  }
}
export async function listDocs(col: string): Promise<{ id: string; data: Doc }[]> {
  const out: { id: string; data: Doc }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('crm_docs').select('id,data').eq('col', col).eq('deleted', false).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []) as { id: string; data: Doc }[]);
    if (!data || data.length < 1000) return out;
  }
}

const CLOSED = new Set(['fechado', 'perdido', 'desqualificado']);

// Vendedor com menos leads em aberto (SDRs primeiro; gestores ficam fora).
export function pickOwner(sellers: { id: string; data: Doc }[], leads: { id: string; data: Doc }[]) {
  const el = sellers.filter(s => s.data.role !== 'Gestor' && s.data.active !== false);
  const pool = el.filter(s => s.data.role === 'SDR');
  const list = pool.length ? pool : el;
  if (!list.length) return '';
  const open = (id: string) => leads.filter(l => l.data.ownerId === id && !CLOSED.has(String(l.data.stage))).length;
  return list.slice().sort((a, b) => open(a.id) - open(b.id))[0].id;
}

export function findLeadByPhone(leads: { id: string; data: Doc }[], phone: unknown) {
  const k = phoneKey(phone);
  if (!k) return null;
  return leads.find(l => phoneKey(l.data.phone) === k) ?? null;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function log(source: string, payload: unknown, result: unknown) {
  await sb.from('crm_webhook_log').insert({ source, payload, result });
}
