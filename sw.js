// Service worker da Central Comercial Brase.
// Só cuida da própria Central: a página inicial (rede primeiro, a cópia guardada só quando está sem internet)
// e os arquivos do app (ícones, manifesto). Tudo o mais passa direto — as chamadas ao banco nunca são guardadas,
// e as outras páginas do mesmo site (funis, restaurantes) não são tocadas.
const SHELL = 'brase-shell-v1';
const FILES = ['./manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const isApp = p => p === '/' || p === '/index.html';
const isAsset = p => p === '/manifest.webmanifest' || p.startsWith('/icons/');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('brase-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (r.mode === 'navigate' && isApp(u.pathname)) {
    e.respondWith(fetch(r).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put('/', copy)).catch(() => {}) }
      return res;
    }).catch(async () => (await caches.match('/')) || new Response('Sem internet. Abra de novo quando a conexão voltar.', {status: 503, headers: {'content-type': 'text/plain; charset=utf-8'}})));
    return;
  }
  if (isAsset(u.pathname)) {
    e.respondWith(caches.match(r).then(hit => {
      const net = fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(r, copy)).catch(() => {}) } return res }).catch(() => hit);
      return hit || net;
    }));
  }
});

// Toque na notificação: traz a Central para a frente e abre o lead do aviso (ou abre o app, se estiver fechado).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {}, target = d.url || './';
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) if ('focus' in c) { if (d.id) c.postMessage({type: 'open-lead', id: d.id}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
