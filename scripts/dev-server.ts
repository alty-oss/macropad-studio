// Servidor de desenvolvimento. O Bun empacota o index.html (TypeScript e CSS) sob demanda e
// recarrega a página quando um arquivo de src/ muda. O build de release usa `bun run build:web`.
import homepage from '../src/index.html';

const port = Number(Bun.env.MACROPAD_PORT || 8000);

Bun.serve({
  hostname: '127.0.0.1',
  port,
  development: { hmr: true },
  routes: { '/': homepage },
});

console.log(`Abra http://localhost:${port}`);
