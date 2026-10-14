// Cloudflare Pages (brasemarketing.com.br). Em diagnostico.<domínio> só o funil público fica no ar, com endereço limpo:
// /brase-2-otimizado?utm_source=… abre funis/f/ com esse funil; a Central e os editores não existem nesse endereço.
// A Central e os editores ficam em app.<domínio>, protegido pelo login da Cloudflare (Access).
// No GitHub Pages esta pasta é ignorada. Os cabeçalhos dos arquivos estáticos estão em /_headers.
const PUBLIC_HOST = /^diagnostico\./i;
const SLUG = /^\/([a-z0-9][a-z0-9-]{0,59})\/?$/;
// O que a página do funil carrega: o motor, a mídia, o arquivo estático de reserva e o endereço antigo (/funis/f/?f=…).
const FUNNEL_FILES = /^\/funis\/(runtime\.js$|media\/|data\/[a-z0-9-]+\.json$|f\/?$|f\/index\.html$)/;
export const SECURITY = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "frame-ancestors 'self'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-robots-tag': 'noindex, nofollow',
};
const notFound = () => new Response('Página não encontrada.', {status: 404, headers: {...SECURITY, 'content-type': 'text/plain; charset=utf-8'}});

export async function onRequest({request, next, env}){
  const url = new URL(request.url);
  if (!PUBLIC_HOST.test(url.hostname)) return next();
  if (FUNNEL_FILES.test(url.pathname)) return next();
  const m = SLUG.exec(url.pathname);
  if (!m || request.method !== 'GET' && request.method !== 'HEAD') return notFound();
  // A página do funil com a base dos arquivos em /funis/ (o endereço continua /<funil>).
  const page = await env.ASSETS.fetch(new Request(new URL('/funis/f/', url)));
  if (!page.ok) return notFound();
  const html = (await page.text()).replace('<base href="../">', '<base href="/funis/">');
  return new Response(html, {status: 200, headers: {...SECURITY, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache'}});
}
