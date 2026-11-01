// Tabelas de teclas: nomes dos usos HID, layout do teclado virtual, modificadores e mídia.
export interface KeySpec { label: string; code?: number; mod?: number; span: number; tall?: boolean; wide?: boolean }

export const media = new Map<string, number>([
  ['Volume +', 0x00e9], ['Volume −', 0x00ea], ['Silenciar', 0x00e2],
  ['Tocar / pausar', 0x00cd], ['Próxima faixa', 0x00b5], ['Faixa anterior', 0x00b6]
]);
export const mediaNames = new Map([...media].map(([name, code]) => [code, name]));
export const keyNames = new Map<number, string>();
const K = (label: string, code: number, span = 1): KeySpec => ({ label, code, span });
const M = (label: string, mod: number, span = 1): KeySpec => ({ label, mod, span });
const letters = (row: string) => [...row].map(label => K(label, 4 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(label)));
const numberKeys = [...'1234567890'].map((label, index) => K(label, 0x1e + index));
export const functionGroups: KeySpec[][] = [
  [K('Esc', 0x29)],
  Array.from({ length: 4 }, (_, i) => K(`F${i + 1}`, 0x3a + i)),
  Array.from({ length: 4 }, (_, i) => K(`F${i + 5}`, 0x3e + i)),
  Array.from({ length: 4 }, (_, i) => K(`F${i + 9}`, 0x42 + i)),
  [K('PrtSc', 0x46), K('Scroll', 0x47), K('Pause', 0x48)]
];
export const mainRows: KeySpec[][] = [
  [K('`', 0x35), ...numberKeys, K('-', 0x2d), K('=', 0x2e), K('Backspace', 0x2a, 2)],
  [K('Tab', 0x2b, 1.5), ...letters('QWERTYUIOP'), K('[', 0x2f), K(']', 0x30), K('\\', 0x31, 1.5)],
  [K('Caps', 0x39, 1.75), ...letters('ASDFGHJKL'), K(';', 0x33), K("'", 0x34), K('Enter', 0x28, 2.25)],
  [M('Shift', 2, 2.25), ...letters('ZXCVBNM'), K(',', 0x36), K('.', 0x37), K('/', 0x38), M('Shift D', 0x20, 2.75)],
  [M('Ctrl', 1, 1.25), M('Win', 8, 1.25), M('Alt', 4, 1.25), K('Espaço', 0x2c, 6.25), M('AltGr', 0x40, 1.25), M('Win D', 0x80, 1.25), K('Menu', 0x65, 1.25), M('Ctrl D', 0x10, 1.25)]
];
export const navigationRows: KeySpec[][] = [
  [K('Ins', 0x49), K('Home', 0x4a), K('PgUp', 0x4b)],
  [K('Del', 0x4c), K('End', 0x4d), K('PgDn', 0x4e)],
  [K('↑', 0x52)],
  [K('←', 0x50), K('↓', 0x51), K('→', 0x4f)]
];
export const numpadKeys: KeySpec[] = [
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
// Uma tecla principal que o firmware e o editor sabem representar.
export const isKnownKey = (code: number | null | undefined): code is number => code != null && keyNames.has(code);
export const modifierOptions: [string, number][] = [['Ctrl', 1], ['Shift', 2], ['Alt', 4], ['Win', 8], ['Ctrl D', 0x10], ['Shift D', 0x20], ['AltGr', 0x40], ['Win D', 0x80]];

// KeyboardEvent.code → uso HID, para gravar atalhos pressionando as teclas de verdade.
export const codeToHid = new Map<string, number>([
  ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter, i): [string, number] => [`Key${letter}`, 4 + i]),
  ...[...'1234567890'].map((digit, i): [string, number] => [`Digit${digit}`, 0x1e + i]),
  ['Enter', 0x28], ['Escape', 0x29], ['Backspace', 0x2a], ['Tab', 0x2b], ['Space', 0x2c], ['Minus', 0x2d], ['Equal', 0x2e],
  ['BracketLeft', 0x2f], ['BracketRight', 0x30], ['Backslash', 0x31], ['Semicolon', 0x33], ['Quote', 0x34], ['Backquote', 0x35],
  ['Comma', 0x36], ['Period', 0x37], ['Slash', 0x38], ['CapsLock', 0x39],
  ...Array.from({ length: 12 }, (_, i): [string, number] => [`F${i + 1}`, 0x3a + i]),
  ['PrintScreen', 0x46], ['ScrollLock', 0x47], ['Pause', 0x48], ['Insert', 0x49], ['Home', 0x4a], ['PageUp', 0x4b],
  ['Delete', 0x4c], ['End', 0x4d], ['PageDown', 0x4e], ['ArrowRight', 0x4f], ['ArrowLeft', 0x50], ['ArrowDown', 0x51], ['ArrowUp', 0x52],
  ['NumLock', 0x53], ['NumpadDivide', 0x54], ['NumpadMultiply', 0x55], ['NumpadSubtract', 0x56], ['NumpadAdd', 0x57], ['NumpadEnter', 0x58],
  ...[...'123456789'].map((digit, i): [string, number] => [`Numpad${digit}`, 0x59 + i]), ['Numpad0', 0x62], ['NumpadDecimal', 0x63],
  ['IntlBackslash', 0x64], ['ContextMenu', 0x65], ['IntlRo', 0x87]
]);
export const modifierCodes = new Map<string, number>([
  ['ControlLeft', 1], ['ShiftLeft', 2], ['AltLeft', 4], ['MetaLeft', 8],
  ['ControlRight', 0x10], ['ShiftRight', 0x20], ['AltRight', 0x40], ['MetaRight', 0x80]
]);

export function comboLabel(mods: number, code: number | null): string[] {
  const parts = modifierOptions.filter(([, bit]) => mods & bit).map(([name]) => name);
  if (code) parts.push(keyNames.get(code) || `0x${code.toString(16)}`);
  return parts;
}
