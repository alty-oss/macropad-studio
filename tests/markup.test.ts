import { expect, test } from 'bun:test';
import { Glob } from 'bun';

const root = new URL('../src/', import.meta.url);
const html = await Bun.file(new URL('index.html', root)).text();

test("todo $('#id') usado nos módulos existe no index.html", async () => {
  const ids = new Set<string>();
  for await (const path of new Glob('**/*.ts').scan(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    const source = await Bun.file(new URL(path, root)).text();
    for (const [, id] of source.matchAll(/\$(?:<[^>]+>)?\('#([^']+)'\)/g)) ids.add(id);
  }
  expect(ids.size).toBeGreaterThan(30);
  const missing = [...ids].filter(id => !html.includes(`id="${id}"`));
  expect(missing).toEqual([]);
});
