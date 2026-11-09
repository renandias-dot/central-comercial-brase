// Recebe leads de formulários (Inlead, landing pages, Meta) e cria o card em "Lead Novo"
// com a cadência de toques, o responsável por rodízio e as UTMs.
// Chamada: POST https://<projeto>.supabase.co/functions/v1/crm-lead-webhook com Authorization: Bearer <CRM_LEAD_WEBHOOK_SECRET>
// (ou ?token=<CRM_LEAD_WEBHOOK_SECRET> quando o formulário não tem campo de token).
import { buildCadence, findLeadByPhone, getDoc, iso, json, listDocs, log, pickOwner, putDoc, uid, type Doc } from '../_shared/crm.ts';
import { notifyNewLeads } from '../_shared/push.ts';
import '../_shared/capi.ts'; // registra o gancho que manda o lead novo (e cada mudança de etapa) à API de Conversões da Meta

const SECRET = Deno.env.get('CRM_LEAD_WEBHOOK_SECRET') ?? '';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
function flatten(o: unknown, prefix = '', out: Record<string, string> = {}) {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = norm(prefix ? `${prefix}_${k}` : k);
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else if (v != null && v !== '') out[key] = Array.isArray(v) ? v.join(', ') : String(v);
    }
  }
  return out;
}
const splitUtm = (v: string) => { const s = (v || '').trim(); const k = s.lastIndexOf('|'); return k > 0 && /^\d{6,}$/.test(s.slice(k + 1)) ? { name: s.slice(0, k).trim(), id: s.slice(k + 1) } : { name: s, id: '' }; };
const money = (v: string) => { if (!v) return null; const n = parseFloat(v.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')); if (!isFinite(n)) return null; return /mil|k\b/i.test(v) && n < 1000 ? n * 1000 : n; };

// Letras do quiz da Inlead e a tradução usada no fluxo "clickup" do NicoChat (canal IA do Asaas).
const DOR: Record<string, string> = {
  A: 'Silêncio Total: Minhas visitas e vendas caíram do nada.', B: 'Visita sem Venda: Muita gente entra, mas poucos compram.',
  C: 'Lucro Baixo: Vendo bem, mas sobra pouco dinheiro.', D: 'Estou começando: Quero crescer do jeito certo desde o início.',
};
const EQUIPE: Record<string, string> = {
  A: 'Eu faço tudo sozinho: (E estou sem tempo / sem estratégia)', B: 'Já paguei agência/gestor/consultoria: (Mas não tive resultado)',
  C: 'Tenho equipe/freela: (Mas sinto que dava pra vender mais)', D: 'Nunca fiz nada: (Estou começando agora)',
};
const tr = (v: string, map: Record<string, string>) => (/^[A-Da-d]$/.test(v.trim()) ? map[v.trim().toUpperCase()] : v);

const USED = new Set<string>();
function pick(f: Record<string, string>, ...aliases: string[]) {
  for (const a of aliases) {
    const key = Object.keys(f).find(k => k === a || k.endsWith('_' + a));
    if (key && f[key]) { USED.add(key); return f[key].slice(0, 500); }
  }
  return '';
}

// Perguntas do quiz da Inlead (componentes): chave exata, para não pegar "score_..." ou "responses_..." do mesmo componente.
function pickKey(f: Record<string, string>, key: string) {
  if (f[key]) { USED.add(key); return f[key].slice(0, 500); }
  return '';
}

async function createFrom(item: unknown, cfg: Doc, sellers: { id: string; data: Doc }[], leads: { id: string; data: Doc }[]) {
  USED.clear();
  const f = flatten(item);
  const phone = pick(f, 'telefone', 'whatsapp', 'celular', 'phone', 'phone_number', 'fone', 'l5lzbe');
  // A Inlead manda um "code" único por pessoa: evita card repetido se o mesmo quiz disparar de novo.
  const code = pick(f, 'code');
  const dup = findLeadByPhone(leads, phone) ?? (code ? leads.find(l => l.data.inleadCode === code) ?? null : null);
  if (dup) return { duplicate: dup.id };
  const biz = pick(f, 'empresa', 'negocio', 'nome_do_negocio', 'nome_da_empresa', 'restaurante', 'company', 'kvvzki');
  const person = pick(f, 'nome', 'name', 'full_name', 'nome_completo', 'contato', 'ukieyt');
  // No fluxo do NicoChat/ClickUp, utm_campaign = campanha, utm_medium = conjunto ("nome|id") e utm_content = criativo.
  // Quando utm_medium traz "nome|id", é o conjunto; quando traz só texto (ex.: link_in_bio), é o meio.
  const C = splitUtm(pick(f, 'utm_campaign', 'campanha')), S0 = splitUtm(pick(f, 'utm_term', 'conjunto', 'adset')), A = splitUtm(pick(f, 'utm_content', 'criativo', 'anuncio', 'ad'));
  const src = pick(f, 'utm_source').toLowerCase(), med = pick(f, 'utm_medium'), medSplit = splitUtm(med);
  const S = S0.name ? S0 : medSplit.id ? medSplit : S0, medium = S === medSplit ? '' : med;
  const utm = C.name || A.name || src
    ? { source: /insta|social/.test(src) ? 'instagram' : (/face|meta|fb|ig/.test(src) || C.id || A.id ? 'meta' : src), medium, campaign: C.name, campaignId: C.id, adset: S.name, adsetId: S.id, ad: A.name || (/insta|social/.test(src) ? 'Link na bio' : ''), adId: A.id }
    : null;
  const ownerName = pick(f, 'responsavel', 'owner', 'sdr').toLowerCase();
  const owner = (ownerName && sellers.find(s => String(s.data.name).toLowerCase().includes(ownerName))?.id) || (cfg.autoAssign !== false ? pickOwner(sellers, leads) : '');
  const revenue = money(pickKey(f, 'opcoes_cu6gxu') || pick(f, 'faturamento', 'faturamento_mensal', 'revenue'));
  const pain = tr(pickKey(f, 'opcoes_sz3hdb') || pick(f, 'dor', 'pain', 'problema'), DOR);
  const team = tr(pickKey(f, 'opcoes_8hsuvt') || pick(f, 'estrutura', 'equipe', 'team', 'status_mkt'), EQUIPE);
  // Fotos e Cardápio são as outras duas perguntas de letra; "De onde vem as vendas" só aparece para quem fatura de 5 a 10 mil.
  const quiz = [['Fotos', pickKey(f, 'opcoes_baoglh')], ['Cardápio', pickKey(f, 'opcoes_v8j0wv')], ['De onde vem as vendas', pickKey(f, 'opcoes_26i6it')]]
    .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  const email = pick(f, 'email', 'e_mail'), instagram = pick(f, 'instagram');
  // Identificação do clique no anúncio (fbclid) e, se vier de formulário nativo da Meta, a identificação do lead: ligam o lead ao anúncio na API de Conversões.
  const fbclid = pick(f, 'fbclid'), metaLeadId = /^\d{15,17}$/.test(pick(f, 'leadgen_id', 'meta_lead_id')) ? pick(f, 'leadgen_id', 'meta_lead_id') : '';
  const rest = Object.entries(f).filter(([k]) => !USED.has(k) && !/token|secret|password|senha|^score|^responses|^tracking_|^(wtitgm|vt19s2)$/.test(k)).map(([k, v]) => `${k}: ${v}`);
  const now = iso(), id = uid('w');
  const lead: Doc = {
    name: biz || person || 'Lead sem nome', company: '', contact: biz ? person : '', phone, email, instagram,
    source: utm ? (utm.source === 'meta' ? 'Meta Ads' : utm.source === 'instagram' ? 'Instagram' : utm.source) : pick(f, 'origem', 'source') || 'Webhook',
    notes: [quiz.length ? 'Respostas do quiz:\n' + quiz.join('\n') : '', rest.length ? 'Outras respostas do formulário:\n' + rest.join('\n') : ''].filter(Boolean).join('\n\n'), value: null, revenue, pain, team,
    ownerId: owner, stage: 'novo', createdAt: now, updatedAt: now, stageAt: now, history: [{ s: 'novo', at: now }],
    touches: buildCadence(cfg), bookedAt: null, meetingAt: null, meetingDoneAt: null, closedAt: null, lostReason: '',
  };
  if (utm) lead.utm = utm;
  if (fbclid || metaLeadId) lead.meta = { ...(fbclid ? { fbclid } : {}), ...(metaLeadId ? { leadId: metaLeadId } : {}) };
  if (code) lead.inleadCode = code;
  await putDoc('leads', id, lead);
  leads.push({ id, data: lead });
  return { created: id, ownerId: owner };
}

// Repassa o corpo original para outra ferramenta (Configurações › Webhook › "Reenviar também para"),
// para formulários que só aceitam um webhook, como a Inlead.
async function forward(url: unknown, raw: string, ct: string) {
  if (typeof url !== 'string' || !/^https:\/\/\S+$/.test(url)) return null;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': ct || 'application/json' }, body: raw, signal: AbortSignal.timeout(8000) });
    return { status: r.status };
  } catch (e) { return { error: String(e) }; }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const token = bearer || req.headers.get('x-webhook-secret') || new URL(req.url).searchParams.get('token');
  if (!SECRET || token !== SECRET) return json({ error: 'unauthorized' }, 401);
  const ct = req.headers.get('content-type') ?? '';
  const raw = await req.text();
  let body: unknown = null;
  try { body = ct.includes('form') ? Object.fromEntries(new URLSearchParams(raw).entries()) : JSON.parse(raw); } catch { /* corpo inválido */ }
  const cfg = await getDoc('config', 'main') ?? {};
  const fwd = forward(cfg.webhookForward, raw, ct); // corre junto; o CRM não atrasa o outro destino
  if (!body || typeof body !== 'object') { await log('crm-lead-webhook', { raw: raw.slice(0, 5000) }, { error: 'corpo inválido', forward: await fwd }); return json({ error: 'Corpo vazio ou inválido' }, 400); }
  const b = body as Record<string, unknown>;
  const items = Array.isArray(body) ? body : Array.isArray(b.leads) ? b.leads as unknown[] : [body];
  try {
    const [sellers, leads] = await Promise.all([listDocs('sellers'), listDocs('leads')]);
    const results = [];
    for (const item of items.slice(0, 200)) results.push(await createFrom(item, cfg, sellers, leads));
    // Aviso no celular (app fechado) para o responsável pelo lead novo; qualquer falha aqui não atrapalha o recebimento.
    let push: unknown = null;
    try {
      const made = results.filter(r => 'created' in r).map(r => ({ id: (r as { created: string }).created })).map(({ id }) => ({ id, data: leads.find(l => l.id === id)!.data }));
      push = await notifyNewLeads(made, cfg);
    } catch (e) { push = { error: String(e) }; }
    await log('crm-lead-webhook', body, { results, push, forward: await fwd });
    return json({ ok: true, results });
  } catch (e) {
    await log('crm-lead-webhook', body, { error: String(e), forward: await fwd });
    return json({ ok: false, error: String(e) }, 500);
  }
});
