/**
 * Service worker de la Copa Navideña Austral - Prosein: permite instalar el portal como app.
 * Estrategia "red primero": siempre se intenta la versión más nueva del sitio y,
 * si no hay conexión, se usa la última guardada. Las llamadas al Web App de
 * Apps Script (otro dominio) nunca pasan por aquí.
 */
const CACHE = 'copa-v3';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req)
    .then((res) => {
      if (res.ok) {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
      }
      return res;
    })
    .catch(() => caches.match(req).then((r) => r || caches.match('./'))));
});
