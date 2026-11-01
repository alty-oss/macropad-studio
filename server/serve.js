// Servidor local. Em desenvolvimento, envia alterações ao navegador por SSE.
import { watch } from 'node:fs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/tailwind.css', ['tailwind.css', 'text/css; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

const dev = Bun.argv.includes('--dev');
const port = Number(Bun.env.MACROPAD_PORT || 8000);
const encoder = new TextEncoder();
const previous = dev ? globalThis.macropadLiveReload : null;
const clients = previous?.clients || new Set();

function broadcast(event) {
  for (const client of clients) {
    try { client.enqueue(encoder.encode(`event: ${event}\ndata: ${Date.now()}\n\n`)); }
    catch { clients.delete(client); }
  }
}

if (dev) {
  previous?.watcher.close();
  if (previous) broadcast('reload');
  const watcher = watch(new URL('../site/', import.meta.url), (_, filename) => {
    const name = String(filename || '').replaceAll('\\', '/');
    if (name.endsWith('tailwind.input.css')) return;
    if (name.endsWith('.css')) broadcast('css');
    else if (name.endsWith('.html') || name.endsWith('.js')) broadcast('reload');
  });
  globalThis.macropadLiveReload = { clients, watcher };
}

const liveReloadClient = `<script>
(() => {
  const events = new EventSource('/__dev/events');
  let connected = false;
  events.addEventListener('ready', () => {
    if (connected) location.reload();
    connected = true;
  });
  events.addEventListener('css', () => {
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const url = new URL(link.href);
      url.searchParams.set('live', String(Date.now()));
      link.href = url.href;
    }
  });
  events.addEventListener('reload', () => location.reload());
})();
</script>`;

Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request, server) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const pathname = new URL(request.url).pathname;
    if (dev && pathname === '/__dev/events' && request.method === 'GET') {
      server.timeout(request, 0);
      let controller;
      const stream = new ReadableStream({
        start(value) {
          controller = value;
          clients.add(controller);
          controller.enqueue(encoder.encode('event: ready\ndata: connected\n\n'));
          request.signal.addEventListener('abort', () => clients.delete(controller), { once: true });
        },
        cancel() { clients.delete(controller); },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
      });
    }

    const asset = assets.get(pathname);
    if (!asset) return new Response('Not found', { status: 404 });

    const [name, type] = asset;
    const file = Bun.file(new URL(`../site/${name}`, import.meta.url));
    if (!await file.exists()) return new Response('Not found', { status: 404 });

    const body = dev && name === 'index.html' && request.method === 'GET'
      ? (await file.text()).replace('</body>', `${liveReloadClient}\n</body>`)
      : request.method === 'HEAD' ? null : file;
    return new Response(body, {
      headers: { 'Content-Type': type, 'Cache-Control': 'no-store' },
    });
  },
});

console.log(`Abra http://localhost:${port}${dev ? ' (desenvolvimento)' : ''}`);
