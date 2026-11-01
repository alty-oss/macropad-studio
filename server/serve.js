// Servidor local do configurador; a compilação do Tailwind é feita separadamente.
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/tailwind.css', ['tailwind.css', 'text/css; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

const port = Number(Bun.env.MACROPAD_PORT || 8000);

Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const asset = assets.get(new URL(request.url).pathname);
    if (!asset) return new Response('Not found', { status: 404 });

    const [name, type] = asset;
    const file = Bun.file(new URL(`../site/${name}`, import.meta.url));
    if (!await file.exists()) return new Response('Not found', { status: 404 });

    return new Response(request.method === 'HEAD' ? null : file, {
      headers: { 'Content-Type': type, 'Cache-Control': 'no-store' },
    });
  },
});

console.log(`Abra http://localhost:${port}`);
