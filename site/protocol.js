// Protocolo do macropad CH57x (USB 1189:8840) e tabelas de teclas. Não acessa o DOM,
// para que os testes possam importá-lo diretamente.
export const DEVICE = { vendorId: 0x1189, productId: 0x8840, usagePage: 0xff00, usage: 1, reportId: 3, reportLength: 64 };

export const media = new Map([
  ['Volume +', 0x00e9], ['Volume −', 0x00ea], ['Silenciar', 0x00e2],
  ['Tocar / pausar', 0x00cd], ['Próxima faixa', 0x00b5], ['Faixa anterior', 0x00b6]
]);
export const mediaNames = new Map([...media].map(([name, code]) => [code, name]));
export const keyNames = new Map();
const K = (label, code, span = 1) => ({ label, code, span });
const M = (label, mod, span = 1) => ({ label, mod, span });
const letters = row => [...row].map(label => K(label, 4 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(label)));
const numberKeys = [...'1234567890'].map((label, index) => K(label, 0x1e + index));
export const functionGroups = [
  [K('Esc', 0x29)],
  Array.from({ length: 4 }, (_, i) => K(`F${i + 1}`, 0x3a + i)),
  Array.from({ length: 4 }, (_, i) => K(`F${i + 5}`, 0x3e + i)),
  Array.from({ length: 4 }, (_, i) => K(`F${i + 9}`, 0x42 + i)),
  [K('PrtSc', 0x46), K('Scroll', 0x47), K('Pause', 0x48)]
];
export const mainRows = [
  [K('`', 0x35), ...numberKeys, K('-', 0x2d), K('=', 0x2e), K('Backspace', 0x2a, 2)],
  [K('Tab', 0x2b, 1.5), ...letters('QWERTYUIOP'), K('[', 0x2f), K(']', 0x30), K('\\', 0x31, 1.5)],
  [K('Caps', 0x39, 1.75), ...letters('ASDFGHJKL'), K(';', 0x33), K("'", 0x34), K('Enter', 0x28, 2.25)],
  [M('Shift', 2, 2.25), ...letters('ZXCVBNM'), K(',', 0x36), K('.', 0x37), K('/', 0x38), M('Shift D', 0x20, 2.75)],
  [M('Ctrl', 1, 1.25), M('Win', 8, 1.25), M('Alt', 4, 1.25), K('Espaço', 0x2c, 6.25), M('AltGr', 0x40, 1.25), M('Win D', 0x80, 1.25), K('Menu', 0x65, 1.25), M('Ctrl D', 0x10, 1.25)]
];
export const navigationRows = [
  [K('Ins', 0x49), K('Home', 0x4a), K('PgUp', 0x4b)],
  [K('Del', 0x4c), K('End', 0x4d), K('PgDn', 0x4e)],
  [K('↑', 0x52)],
  [K('←', 0x50), K('↓', 0x51), K('→', 0x4f)]
];
export const numpadKeys = [
  K('Num', 0x53), K('/', 0x54), K('*', 0x55), K('-', 0x56),
  K('7', 0x5f), K('8', 0x60), K('9', 0x61), { ...K('+', 0x57), tall: true },
  K('4', 0x5c), K('5', 0x5d), K('6', 0x5e),
  K('1', 0x59), K('2', 0x5a), K('3', 0x5b), { ...K('Enter', 0x58), tall: true },
  { ...K('0', 0x62), wide: true }, K('.', 0x63)
];
// Fora do teclado virtual: teclas extras do ABNT2 e F13–F24, que reservamos às teclas virtuais.
const extraKeys = [K('\\ ABNT', 0x64), K('/ ABNT', 0x87), ...Array.from({ length: 12 }, (_, i) => K(`F${i + 13}`, 0x68 + i))];
for (const spec of [...functionGroups.flat(), ...mainRows.flat(), ...navigationRows.flat(), ...numpadKeys, ...extraKeys]) {
  if (spec.code !== undefined && !keyNames.has(spec.code)) keyNames.set(spec.code, spec.label);
}
export const modifierOptions = [['Ctrl', 1], ['Shift', 2], ['Alt', 4], ['Win', 8], ['Ctrl D', 0x10], ['Shift D', 0x20], ['AltGr', 0x40], ['Win D', 0x80]];

// KeyboardEvent.code → uso HID, para gravar atalhos pressionando as teclas de verdade.
export const codeToHid = new Map([
  ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter, i) => [`Key${letter}`, 4 + i]),
  ...[...'1234567890'].map((digit, i) => [`Digit${digit}`, 0x1e + i]),
  ['Enter', 0x28], ['Escape', 0x29], ['Backspace', 0x2a], ['Tab', 0x2b], ['Space', 0x2c], ['Minus', 0x2d], ['Equal', 0x2e],
  ['BracketLeft', 0x2f], ['BracketRight', 0x30], ['Backslash', 0x31], ['Semicolon', 0x33], ['Quote', 0x34], ['Backquote', 0x35],
  ['Comma', 0x36], ['Period', 0x37], ['Slash', 0x38], ['CapsLock', 0x39],
  ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 0x3a + i]),
  ['PrintScreen', 0x46], ['ScrollLock', 0x47], ['Pause', 0x48], ['Insert', 0x49], ['Home', 0x4a], ['PageUp', 0x4b],
  ['Delete', 0x4c], ['End', 0x4d], ['PageDown', 0x4e], ['ArrowRight', 0x4f], ['ArrowLeft', 0x50], ['ArrowDown', 0x51], ['ArrowUp', 0x52],
  ['NumLock', 0x53], ['NumpadDivide', 0x54], ['NumpadMultiply', 0x55], ['NumpadSubtract', 0x56], ['NumpadAdd', 0x57], ['NumpadEnter', 0x58],
  ...[...'123456789'].map((digit, i) => [`Numpad${digit}`, 0x59 + i]), ['Numpad0', 0x62], ['NumpadDecimal', 0x63],
  ['IntlBackslash', 0x64], ['ContextMenu', 0x65], ['IntlRo', 0x87]
]);
export const modifierCodes = new Map([
  ['ControlLeft', 1], ['ShiftLeft', 2], ['AltLeft', 4], ['MetaLeft', 8],
  ['ControlRight', 0x10], ['ShiftRight', 0x20], ['AltRight', 0x40], ['MetaRight', 0x80]
]);

export const knobSlot = (index, action) => 16 + index * 3 + action;
// Nesta orientação física, as teclas são numeradas pelo firmware por coluna,
// de baixo para cima: linha superior 4/8/12, linha inferior 1/5/9.
export function keySlotForPosition(index, keyCount = 12) {
  const rows = Math.ceil(keyCount / 3);
  const row = Math.floor(index / 3);
  const column = index % 3;
  const slot = column * rows + (rows - row);
  return slot <= keyCount ? slot : null;
}

// Teclas virtuais: cada (camada, slot) recebe um código fixo de F13–F24, combinado com
// Ctrl/Shift esquerdos ou direitos. Nenhum teclado comum envia esses códigos, então o app
// pode interceptá-los sem conflito. Alt e Win ficam de fora porque abrem menus sozinhos.
const VIRTUAL_MODS = [0, 0x02, 0x01, 0x03, 0x20, 0x10, 0x30];
export function virtualCode(layer, slot) {
  const index = (layer - 1) * 24 + (slot >= 16 ? 15 + slot - 16 : slot - 1);
  return { mods: VIRTUAL_MODS[Math.floor(index / 12)], code: 0x68 + index % 12 };
}

export function comboLabel(mods, code) {
  const parts = modifierOptions.filter(([, bit]) => mods & bit).map(([name]) => name);
  if (code) parts.push(keyNames.get(code) || `0x${code.toString(16)}`);
  return parts;
}
export const stepNames = { open: 'Abrir', website: 'Site', text: 'Digitar texto', hotkey: 'Atalho', delay: 'Aguardar' };
export function stepSummary(step) {
  if (step.type === 'open') return step.path ? step.path.split(/[\\/]/).filter(Boolean).pop() : 'Escolha um arquivo';
  if (step.type === 'website') return step.url ? step.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Informe o endereço';
  if (step.type === 'text') return step.text ? `“${step.text.length > 24 ? `${step.text.slice(0, 24)}…` : step.text}”` : 'Informe o texto';
  if (step.type === 'hotkey') return comboLabel(step.mods, step.code).join(' + ') || 'Escolha a combinação';
  if (step.type === 'delay') return `${step.ms} ms`;
  return step.type;
}
export function labelFor(binding) {
  if (binding.kind === 'key') return comboLabel(binding.mods, binding.code).join(' + ') || 'Escolha uma tecla';
  if (binding.kind === 'media') return mediaNames.get(binding.media) || 'Mídia';
  if (binding.kind === 'app') {
    if (binding.multi) return `Multi-ação · ${binding.steps.length} ${binding.steps.length === 1 ? 'etapa' : 'etapas'}`;
    return binding.steps[0] ? `${stepNames[binding.steps[0].type]} · ${stepSummary(binding.steps[0])}` : 'Macro do app sem ação';
  }
  if (binding.kind === 'raw') return binding.label || 'Ação existente';
  return 'Sem ação';
}
export function equalBinding(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'key') return a.mods === b.mods && a.code === b.code;
  if (a.kind === 'media') return a.media === b.media;
  if (a.kind === 'app') return Boolean(a.multi) === Boolean(b.multi) && JSON.stringify(a.steps) === JSON.stringify(b.steps);
  return a.kind === 'empty';
}
// Erro que impede gravar uma ação do app, ou null quando ela está completa.
export function appBindingError(binding) {
  if (!binding.steps.length) return 'Adicione pelo menos uma etapa.';
  for (const step of binding.steps) {
    if (step.type === 'open' && !step.path.trim()) return 'Escolha o arquivo, pasta ou programa a abrir.';
    if (step.type === 'website' && !step.url.trim()) return 'Informe o endereço do site.';
    if (step.type === 'text' && !step.text) return 'Informe o texto a digitar.';
    if (step.type === 'hotkey' && !keyNames.has(step.code)) return 'Escolha a tecla principal do atalho.';
  }
  return null;
}

export function decode(record, layer) {
  const type = record[3];
  if (type === 1) {
    const count = record[9], mods = record[10], code = record[11];
    if (count === 1 && !mods && !code) return { kind: 'empty' };
    const virtual = virtualCode(layer, record[1]);
    if (count === 1 && mods === virtual.mods && code === virtual.code) return { kind: 'app' };
    if (count === 1 && keyNames.has(code)) return { kind: 'key', mods, code };
    return { kind: 'raw', label: count > 1 ? `Macro de ${count} passos` : 'Atalho especial existente' };
  }
  if (type === 2) {
    const code = record[10] | record[11] << 8;
    return mediaNames.has(code) ? { kind: 'media', media: code } : { kind: 'raw', label: `Mídia 0x${code.toString(16)}` };
  }
  return { kind: 'raw', label: `Ação especial (tipo ${type})` };
}
export function encode(slot, layer, binding) {
  const head = [0xfe, slot, layer];
  if (binding.kind === 'empty') return [...head, 1, 0, 0, 0, 0, 0, 1, 0, 0];
  if (binding.kind === 'key') {
    if (!keyNames.has(binding.code)) throw new Error(`Slot ${slot}: selecione uma tecla principal.`);
    return [...head, 1, 0, 0, 0, 0, 0, 1, binding.mods, binding.code];
  }
  if (binding.kind === 'app') {
    const { mods, code } = virtualCode(layer, slot);
    return [...head, 1, 0, 0, 0, 0, 0, 1, mods, code];
  }
  if (binding.kind === 'media' && mediaNames.has(binding.media)) return [...head, 2, 0, 0, 0, 0, 0, 0, binding.media & 255, binding.media >> 8];
  throw new Error(`Slot ${slot}: esta ação não pode ser gravada por este editor.`);
}
