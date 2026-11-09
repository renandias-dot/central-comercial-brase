// API de Conversões da Meta (eventos de CRM): as partes que não dependem do Deno nem do banco, para poder testar no Node.
// Formato: https://developers.facebook.com/docs/marketing-api/conversions-api/crm-integration (action_source "system_generated",
// custom_data.event_source "crm", e-mail e telefone em SHA-256).
export type Doc = Record<string, any>;

export type StageCfg = { on: boolean; name: string };
// Etapas do CRM que viram evento. Os nomes começam com "CRM_" para não se misturarem com os eventos do pixel (Lead, LeadQualificado…)
// que já existem no mesmo conjunto de dados. Tudo isso pode ser trocado em Configurações › Meta.
export const DEFAULT_STAGES: Record<string, StageCfg> = {
  novo: { on: true, name: 'CRM_Lead' },
  link: { on: false, name: 'CRM_LinkRecebido' },
  print: { on: false, name: 'CRM_PrintEnviado' },
  qualificando: { on: true, name: 'CRM_Qualificando' },
  agendando: { on: false, name: 'CRM_Agendando' },
  marcada: { on: true, name: 'CRM_ReuniaoMarcada' },
  feita: { on: true, name: 'CRM_ReuniaoFeita' },
  fechado: { on: true, name: 'CRM_Fechado' },
  desqualificado: { on: false, name: 'CRM_Desqualificado' },
  perdido: { on: false, name: 'CRM_Perdido' },
  frio: { on: false, name: 'CRM_Frio' },
  morno: { on: false, name: 'CRM_Morno' },
};
export const MAX_AGE_DAYS = 7; // a Meta recusa evento de CRM mais antigo que isso

export type CapiCfg = { mode: 'off' | 'test' | 'on'; testCode: string; stages: Record<string, StageCfg> };
export function capiCfg(raw: any): CapiCfg {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Doc, st = (c.stages && typeof c.stages === 'object' ? c.stages : {}) as Doc;
  const stages: Record<string, StageCfg> = {};
  for (const [k, d] of Object.entries(DEFAULT_STAGES)) {
    const o = (st[k] && typeof st[k] === 'object' ? st[k] : {}) as Doc;
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 50) : '';
    stages[k] = { on: typeof o.on === 'boolean' ? o.on : d.on, name: name || d.name };
  }
  return { mode: c.mode === 'on' || c.mode === 'test' ? c.mode : 'off', testCode: String(c.testCode ?? '').trim().slice(0, 40), stages };
}

export async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}
// Normalização pedida pela Meta antes do hash.
export const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
// Telefone: só dígitos, com o código do país (Brasil = 55) e sem zeros à esquerda. Retorna '' se não parecer um número.
export function normPhone(p: unknown) {
  let d = String(p ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length < 10) return '';
  if (d.length <= 11) d = '55' + d;
  return d.length >= 12 && d.length <= 13 ? d : '';
}
export const normName = (n: unknown) => String(n ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, '').replace(/\s+/g, ' ').trim();

// fbclid do anúncio: guardado em lead.meta.fbclid (webhook novo) ou, nos leads antigos, dentro das observações ("fbclid: …").
export function fbclidOf(lead: Doc): string {
  const m = lead.meta && typeof lead.meta === 'object' ? String((lead.meta as Doc).fbclid ?? '') : '';
  if (m) return m;
  const r = /(?:^|\n)fbclid: (\S+)/.exec(String(lead.notes ?? ''));
  return r ? r[1] : '';
}
// _fbc no formato da Meta: fb.<índice do domínio>.<momento do clique em ms>.<fbclid>. O momento do clique não é guardado:
// usa a hora em que o lead entrou (poucos minutos depois do clique).
export function fbcOf(lead: Doc): string {
  const id = fbclidOf(lead); if (!id) return '';
  const t = Date.parse(String(lead.createdAt ?? ''));
  return `fb.1.${isNaN(t) ? Date.now() : t}.${id}`;
}

export async function userData(lead: Doc, leadId: string): Promise<Doc> {
  const u: Doc = {};
  const em = normEmail(lead.email); if (em && /^\S+@\S+\.\S+$/.test(em)) u.em = [await sha256(em)];
  const ph = normPhone(lead.phone); if (ph) u.ph = [await sha256(ph)];
  const person = normName(lead.contact).split(' ').filter(Boolean);
  if (person[0]) u.fn = [await sha256(person[0])];
  if (person.length > 1) u.ln = [await sha256(person.slice(1).join(' '))];
  u.external_id = [await sha256(String(leadId))];
  u.country = [await sha256('br')];
  const fbc = fbcOf(lead); if (fbc) u.fbc = fbc;
  const mid = lead.meta && typeof lead.meta === 'object' ? String((lead.meta as Doc).leadId ?? '') : '';
  if (/^\d{15,17}$/.test(mid)) u.lead_id = Number(mid);
  return u;
}

// Quando a etapa foi atingida: a última entrada daquela etapa no histórico do lead (segundos desde 1970).
export function eventTimeOf(lead: Doc, stage: string, nowMs = Date.now()): number {
  const h = Array.isArray(lead.history) ? (lead.history as { s?: string; at?: string }[]) : [];
  for (let i = h.length - 1; i >= 0; i--) if (h[i] && h[i].s === stage) { const t = Date.parse(String(h[i].at)); if (!isNaN(t)) return Math.floor(t / 1000); }
  if (stage === 'novo') { const t = Date.parse(String(lead.createdAt ?? '')); if (!isNaN(t)) return Math.floor(t / 1000); }
  return Math.floor(nowMs / 1000);
}

export const eventKey = (leadId: string, name: string, test: boolean) => (test ? 'test|' : '') + leadId + '|' + name;

// Um item de "data" no formato do exemplo da Meta (mais o event_id, que evita contar duas vezes o mesmo evento).
export async function buildEvent(lead: Doc, leadId: string, stage: string, name: string, eventTime: number): Promise<Doc> {
  return {
    action_source: 'system_generated',
    custom_data: { event_source: 'crm', lead_event_source: 'Brase CRM' },
    event_name: name,
    event_time: eventTime,
    event_id: leadId + '.' + name,
    user_data: await userData(lead, leadId),
  };
}

// O evento deve ser enviado? Só quando a etapa mudou (ou o lead foi criado), a etapa está ligada, o lead não é de exemplo e a data é recente.
export function shouldEmit(cfg: CapiCfg, before: Doc | null | undefined, after: Doc, nowMs = Date.now()): { stage: string; name: string; time: number } | null {
  if (cfg.mode === 'off' || !after || after.example) return null;
  const stage = String(after.stage ?? ''), prev = before ? String(before.stage ?? '') : null;
  if (!stage || prev === stage) return null;
  const sc = cfg.stages[stage]; if (!sc || !sc.on) return null;
  const time = eventTimeOf(after, stage, nowMs);
  if (nowMs / 1000 - time > MAX_AGE_DAYS * 86400 - 600) return null;
  return { stage, name: sc.name, time };
}
