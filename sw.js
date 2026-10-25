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

// Aviso do servidor (lead novo, print vencido), mesmo com o app fechado. Se o app já está na tela, ele mesmo avisa
// (faixa, som) e só atualiza os dados; senão aparece a notificação do sistema.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { t: 'Central Brase', b: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    if (wins.some(c => c.focused && c.visibilityState === 'visible')) { wins.forEach(c => c.postMessage(Object.assign({type: 'push'}, d))); return; }
    const opt = {body: d.b || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png', vibrate: [200, 100, 200, 100, 200],
      requireInteraction: d.k === 'new' || d.k === 'print', data: {id: d.id, ct: d.ct, url: d.url || './'}};
    if (d.tag) { opt.tag = d.tag; opt.renotify = true; }
    await self.registration.showNotification(d.t || 'Central Brase', opt);
  })());
});

// Toque na notificação: traz a Central para a frente e abre o lead (ou o carrossel para aprovar) do aviso; com o app fechado, abre pelo endereço.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {}, target = d.url || './';
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) if ('focus' in c) { if (d.id) c.postMessage({type: 'open-lead', id: d.id}); else if (d.ct) c.postMessage({type: 'open-ct', id: d.ct}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
