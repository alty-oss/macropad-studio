import { describe, expect, test } from 'bun:test';
import { functionGroups, keyNames, mainRows, modifierOptions, navigationRows, numpadKeys } from '../src/device/keys.ts';
import {
  appBindingError, decode, encode, equalBinding, keySlotForPosition, knobParts, knobSlot, labelFor, virtualCode, type BindingOf
} from '../src/device/protocol.ts';

describe('registros do dispositivo', () => {
  test('codifica atalho e mídia', () => {
    expect(encode(1, 1, { kind: 'key', mods: 3, code: 0x16 })).toEqual([0xfe, 1, 1, 1, 0, 0, 0, 0, 0, 1, 3, 0x16]);
    expect(encode(18, 2, { kind: 'media', media: 0xe9 })).toEqual([0xfe, 18, 2, 2, 0, 0, 0, 0, 0, 0, 0xe9, 0]);
  });
  test('macro de vários passos é preservada como ação existente', () => {
    expect(decode(Uint8Array.from([0xfa, 1, 1, 1, 0, 0, 0, 0, 0, 2, 1, 4, 1, 5]), 1).kind).toBe('raw');
  });
});

describe('slots', () => {
  test('knobs começam no slot 16', () => {
    expect(knobSlot(0, 2)).toBe(18);
    expect(knobSlot(2, 0)).toBe(22);
  });
  test('primeiro slot de cada knob é o giro à esquerda (confirmado no aparelho)', () => {
    expect(knobParts.map(part => part.name)).toEqual(['Girar à esquerda', 'Pressionar', 'Girar à direita']);
  });
  test('teclas numeradas por coluna, de baixo para cima', () => {
    expect(Array.from({ length: 12 }, (_, i) => keySlotForPosition(i, 12))).toEqual([4, 8, 12, 3, 7, 11, 2, 6, 10, 1, 5, 9]);
  });
});

describe('teclado virtual', () => {
  test('tem 104 teclas e os 8 modificadores HID', () => {
    expect(functionGroups.flat().length + mainRows.flat().length + navigationRows.flat().length + numpadKeys.length).toBe(104);
    expect(modifierOptions.map(([, bit]) => bit)).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
  });
  test('reconhece teclas fora do layout, como as do ABNT2', () => {
    expect([0x33, 0x58, 0x65, 0x87].every(code => keyNames.has(code))).toBe(true);
  });
});

describe('teclas virtuais', () => {
  const slots = [...Array.from({ length: 15 }, (_, i) => i + 1), ...Array.from({ length: 9 }, (_, i) => 16 + i)];
  test('cada (camada, slot) tem um código F13–F24 único, sem Alt nem Win', () => {
    const codes = new Set<string>();
    for (const layer of [1, 2, 3]) {
      for (const slot of slots) {
        const { mods, code } = virtualCode(layer, slot);
        expect(code).toBeGreaterThanOrEqual(0x68);
        expect(code).toBeLessThanOrEqual(0x73);
        expect(mods & 0xcc).toBe(0);
        codes.add(`${mods}:${code}`);
      }
    }
    expect(codes.size).toBe(3 * slots.length);
    expect(virtualCode(1, 1)).toEqual({ mods: 0, code: 0x68 });
  });

  const appBinding: BindingOf<'app'> = { kind: 'app', multi: false, steps: [{ type: 'website', url: 'https://example.com' }] };
  test('o registro gravado é reconhecido como ação do app só na própria camada', () => {
    const record = Uint8Array.from([0xfa, ...encode(7, 2, appBinding).slice(1)]);
    expect(decode(record, 2).kind).toBe('app');
    expect(decode(record, 1).kind).toBe('key');
  });
  test('compara e valida ações do app', () => {
    expect(equalBinding(appBinding, structuredClone(appBinding))).toBe(true);
    expect(equalBinding(appBinding, { ...appBinding, multi: true })).toBe(false);
    expect(appBindingError(appBinding)).toBeNull();
    expect(appBindingError({ kind: 'app', multi: true, steps: [] })).toMatch(/etapa/);
    expect(appBindingError({ kind: 'app', multi: false, steps: [{ type: 'hotkey', mods: 1, code: null }] })).toMatch(/tecla principal/);
    expect(labelFor(appBinding)).toBe('Site · example.com');
  });
});
