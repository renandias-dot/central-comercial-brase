// funis-cdn — mantém a cópia publicada de cada funil no Storage público (CDN). A página do funil (funis/f/) abre a partir
// dessa cópia, sem esperar a funis-api nem o banco (nada de servidor "frio" na primeira visita).
// POST {slug} ou {slugs: [...]}: lê o que está publicado no banco e regrava a cópia (ou apaga, se não estiver publicado).
// POST {slug, v}: só regrava se a versão publicada (published_at) for diferente de v.
// Não pede código: só copia o que já está publicado (e já é público). O editor chama ao publicar e despublicar; a página
// do funil chama quando não acha a cópia e, em segundo plano, para conferir se a cópia que abriu ainda é a atual.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm do Supabase.

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = 'funis', DIR = 'publicados';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
// Quanto tempo o CDN e o navegador podem guardar a cópia: depois de publicar, a versão nova aparece em até 30 s.
const MAX_AGE = 30;
const CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '86400'};
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {status, headers: {...CORS, 'content-type': 'application/json; charset=utf-8'}});
const auth = {authorization: 'Bearer ' + KEY, apikey: KEY};
const objectUrl = (slug: string) => `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${DIR}/${slug}.json`;
const iso = (d: unknown) => d ? new Date(d as string).toISOString() : '';
// No máximo uma gravação a cada 10 s por funil (a conferência das visitas não vira uma enxurrada de gravações).
const lastWrite: Record<string, number> = {};

async function readFunnel(slug: string, cols: string){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/fn_funnels?slug=eq.${slug}&select=${cols}`, {headers: auth});
  if (!r.ok) throw new Error('banco ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const rows = await r.json();
  return rows[0] || null;
}

async function sync(slug: string, v?: string){
  if (v !== undefined) {
    const cur = await readFunnel(slug, 'published_at');
    if (cur && cur.published_at && iso(cur.published_at) === v) return {slug, current: true};
  }
  if (Date.now() - (lastWrite[slug] || 0) < 10e3) return {slug, skipped: true};
  lastWrite[slug] = Date.now();
  try {
    const f = await readFunnel(slug, 'slug,published,published_at');
    if (!f || !f.published) {
      const d = await fetch(objectUrl(slug), {method: 'DELETE', headers: auth});
      await d.body?.cancel();
      return {slug, published: false};
    }
    const published_at = iso(f.published_at) || null;
    const w = await fetch(objectUrl(slug), {
      method: 'POST',
      headers: {...auth, 'content-type': 'application/json', 'x-upsert': 'true', 'cache-control': `max-age=${MAX_AGE}`},
      body: JSON.stringify({...f.published, slug: f.slug, published_at}),
    });
    if (!w.ok) throw new Error('storage ' + w.status + ' ' + (await w.text()).slice(0, 200));
    await w.body?.cancel();
    return {slug, published: true, published_at};
  } catch (e) { delete lastWrite[slug]; throw e }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: CORS});
  if (req.method !== 'POST') return reply(405, {error: 'Use POST.'});
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(await req.text() || '{}') } catch { return reply(400, {error: 'JSON inválido.'}) }
  const slugs = (Array.isArray(b.slugs) ? b.slugs : [b.slug]).map(s => String(s ?? '').toLowerCase()).filter(s => SLUG_RE.test(s)).slice(0, 20);
  if (!slugs.length) return reply(400, {error: 'Funil não encontrado.'});
  const v = typeof b.v === 'string' ? b.v : undefined;
  const results = [];
  for (const slug of slugs) {
    try { results.push(await sync(slug, v)) } catch (e) { console.error('cópia do funil', slug, e); results.push({slug, error: e instanceof Error ? e.message : String(e)}) }
  }
  return reply(results.some(r => 'error' in r) ? 502 : 200, {ok: !results.some(r => 'error' in r), results});
});
