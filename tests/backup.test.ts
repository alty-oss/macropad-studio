import { describe, expect, test } from 'bun:test';
import { parseBackup, serializeBackup } from '../src/device/backup-file.ts';
import type { Binding } from '../src/device/protocol.ts';

const layout = { keys: 12, knobs: 3 };
const controls = new Map<number, Binding>([
  [4, { kind: 'key', mods: 3, code: 0x16 }],
  [8, { kind: 'media', media: 0xe9 }],
  [12, { kind: 'empty' }],
  [22, { kind: 'app', multi: true, steps: [{ type: 'open', path: 'C:\\Windows\\notepad.exe', args: '' }, { type: 'delay', ms: 300 }, { type: 'hotkey', mods: 1, code: 0x06 }] }]
]);

describe('arquivo de configuração', () => {
  test('exporta e importa sem perder nada', () => {
    const text = serializeBackup(layout, new Map([[1, controls], [3, new Map([[1, { kind: 'empty' } as Binding]])]]));
    const parsed = parseBackup(text, layout);
    expect(parsed.skipped).toBe(0);
    expect(parsed.layers.get(1)).toEqual(controls);
    expect(parsed.layers.get(3)?.get(1)).toEqual({ kind: 'empty' });
  });

  test('ignora slots fora do layout e ações inválidas', () => {
    const text = JSON.stringify({
      format: 'macropad-studio', version: 1, exportedAt: '', layout,
      layers: [{
        layer: 2, controls: {
          13: { kind: 'empty' },                                  // não existe num macropad de 12 teclas
          5: { kind: 'key', mods: 1, code: 9999 },                // tecla desconhecida
          6: { kind: 'raw', label: 'Macro de 3 passos' },         // o editor não sabe regravar
          7: { kind: 'app', multi: false, steps: [] },            // ação simples sem etapa
          9: { kind: 'media', media: 0xe2 }
        }
      }, { layer: 7, controls: {} }]
    });
    const parsed = parseBackup(text, layout);
    expect([...parsed.layers.get(2)!]).toEqual([[9, { kind: 'media', media: 0xe2 }]]);
    expect(parsed.skipped).toBe(5);
  });

  test('recusa arquivos que não são do Macropad Studio', () => {
    expect(() => parseBackup('isso não é json', layout)).toThrow(/JSON/);
    expect(() => parseBackup('{"layers": []}', layout)).toThrow(/Macropad Studio/);
    expect(() => parseBackup('{"format": "macropad-studio", "version": 99, "layers": []}', layout)).toThrow(/mais nova/);
  });
});
