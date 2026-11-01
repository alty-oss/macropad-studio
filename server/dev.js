// Mantém o Tailwind e o servidor em execução com um único comando.
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tailwind = fileURLToPath(new URL('../node_modules/@tailwindcss/cli/dist/index.mjs', import.meta.url));

if (!await Bun.file(tailwind).exists()) {
  console.error('Dependências ausentes. Execute bun install antes de bun run dev.');
  process.exit(1);
}

const commands = [
  [process.execPath, tailwind, '-i', './site/tailwind.input.css', '-o', './site/tailwind.css', '--watch=always', '--minify'],
  [process.execPath, '--hot', './server/serve.js', '--dev'],
];
const children = commands.map(cmd => Bun.spawn(cmd, {
  cwd: root,
  env: { ...process.env },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
}));

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

const { index, code } = await Promise.race(children.map(async (child, index) => ({ index, code: await child.exited })));
const wasStopping = stopping;
if (!wasStopping) console.error(`${index === 0 ? 'Tailwind' : 'Servidor'} encerrou inesperadamente (código ${code}).`);
stop();
await Promise.allSettled(children.map(child => child.exited));
process.exitCode = wasStopping ? 0 : code || 1;
