// Service worker do app do celular. Guarda a página e os ícones para o app abrir mesmo com o
// computador desligado: ela mostra "Reconectando…" e volta sozinha quando o servidor responde.
// O navegador só registra service workers em HTTPS ou em endereços liberados como seguros.
const CACHE = 'macropad-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Rede primeiro, para sempre pegar a versão do computador; o cache só entra quando ele não responde.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request)
    .then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
      return response;
    })
    .catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match('/'))));
});
