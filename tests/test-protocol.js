import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encode, decode, knobSlot, knobParts, keySlotForPosition, virtualCode, functionGroups, mainRows, navigationRows, numpadKeys,
  modifierOptions, keyNames, equalBinding, appBindingError, labelFor
} from '../site/protocol.js';

const site = new URL('../site/', import.meta.url);
const html = readFileSync(new URL('index.html', site), 'utf8');
const app = readFileSync(new URL('app.js', site), 'utf8');
for (const [, id] of app.matchAll(/\$\('#([^']+)'\)/g)) {
  assert.ok(html.includes(`id="${id}"`), `Elemento #${id} usado no JavaScript não existe no HTML`);
}

assert.deepEqual(encode(1, 1, { kind: 'key', mods: 3, code: 0x16 }), [0xfe, 1, 1, 1, 0, 0, 0, 0, 0, 1, 3, 0x16]);
assert.deepEqual(encode(18, 2, { kind: 'media', media: 0xe9 }), [0xfe, 18, 2, 2, 0, 0, 0, 0, 0, 0, 0xe9, 0]);
assert.equal(decode(Uint8Array.from([0xfa, 1, 1, 1, 0, 0, 0, 0, 0, 2, 1, 4, 1, 5]), 1).kind, 'raw');
assert.equal(knobSlot(0, 2), 18);
assert.equal(knobSlot(2, 0), 22);
// Confirmado no aparelho: o primeiro slot de cada knob é o giro à esquerda.
assert.deepEqual(knobParts.map(part => part.name), ['Girar à esquerda', 'Pressionar', 'Girar à direita']);
assert.deepEqual(Array.from({ length: 12 }, (_, i) => keySlotForPosition(i, 12)), [4, 8, 12, 3, 7, 11, 2, 6, 10, 1, 5, 9]);
assert.equal(functionGroups.flat().length + mainRows.flat().length + navigationRows.flat().length + numpadKeys.length, 104);
assert.deepEqual(modifierOptions.map(([, bit]) => bit), [1, 2, 4, 8, 16, 32, 64, 128]);
assert.equal(keyNames.has(0x33) && keyNames.has(0x58) && keyNames.has(0x65) && keyNames.has(0x87), true);

// Teclas virtuais: um código F13–F24 único por (camada, slot), sem Alt nem Win.
const slots = [...Array.from({ length: 15 }, (_, i) => i + 1), ...Array.from({ length: 9 }, (_, i) => 16 + i)];
const codes = new Set();
for (const layer of [1, 2, 3]) {
  for (const slot of slots) {
    const { mods, code } = virtualCode(layer, slot);
    assert.ok(code >= 0x68 && code <= 0x73, `camada ${layer}, slot ${slot}: código fora de F13–F24`);
    assert.equal(mods & 0xcc, 0, `camada ${layer}, slot ${slot}: Alt ou Win na tecla virtual`);
    codes.add(`${mods}:${code}`);
  }
}
assert.equal(codes.size, 3 * slots.length);
assert.deepEqual(virtualCode(1, 1), { mods: 0, code: 0x68 });
const appBinding = { kind: 'app', multi: false, steps: [{ type: 'website', url: 'https://example.com' }] };
const record = Uint8Array.from([0xfa, ...encode(7, 2, appBinding).slice(1)]);
assert.equal(decode(record, 2).kind, 'app');
assert.equal(decode(record, 1).kind, 'key');
assert.equal(equalBinding(appBinding, structuredClone(appBinding)), true);
assert.equal(equalBinding(appBinding, { ...appBinding, multi: true }), false);
assert.equal(appBindingError(appBinding), null);
assert.match(appBindingError({ kind: 'app', multi: true, steps: [] }), /etapa/);
assert.match(appBindingError({ kind: 'app', multi: false, steps: [{ type: 'hotkey', mods: 1, code: null }] }), /tecla principal/);
assert.equal(labelFor(appBinding), 'Site · example.com');
console.log('Protocolo: atalhos, mídia, teclas virtuais e slots verificados.');
