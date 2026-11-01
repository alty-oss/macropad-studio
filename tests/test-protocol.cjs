const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const site = require('node:path').join(__dirname, '..', 'site');
const source = fs.readFileSync(require('node:path').join(site, 'app.js'), 'utf8').replace(/\binitialize\(\);\s*$/, '');
const html = fs.readFileSync(require('node:path').join(site, 'index.html'), 'utf8');
for (const [, id] of source.matchAll(/\$\('#([^']+)'\)/g)) {
  assert.ok(html.includes(`id="${id}"`), `Elemento #${id} usado no JavaScript não existe no HTML`);
}
const context = vm.createContext({});
vm.runInContext(source, context);

const from = expression => vm.runInContext(expression, context);
assert.deepEqual(Array.from(from('encode(1, 1, {kind:"key", mods:3, code:0x16})')),
  [0xfe, 1, 1, 1, 0, 0, 0, 0, 0, 1, 3, 0x16]);
assert.deepEqual(Array.from(from('encode(18, 2, {kind:"media", media:0xe9})')),
  [0xfe, 18, 2, 2, 0, 0, 0, 0, 0, 0, 0xe9, 0]);
assert.equal(from('decode(Uint8Array.from([0xfa,1,1,1,0,0,0,0,0,2,1,4,1,5])).kind'), 'raw');
assert.equal(from('knobSlot(0,2)'), 18);
assert.equal(from('knobSlot(2,0)'), 22);
assert.deepEqual(Array.from(from('Array.from({length:12},(_,i)=>keySlotForPosition(i,12))')),
  [4, 8, 12, 3, 7, 11, 2, 6, 10, 1, 5, 9]);
assert.equal(from('functionGroups.flat().length + mainRows.flat().length + navigationRows.flat().length + numpadKeys.length'), 104);
assert.deepEqual(Array.from(from('modifierOptions.map(([,bit]) => bit)')),
  [1, 2, 4, 8, 16, 32, 64, 128]);
assert.equal(from('keyNames.has(0x33) && keyNames.has(0x58) && keyNames.has(0x65)'), true);
console.log('Protocolo: atalhos, mídia, macros e slots verificados.');
