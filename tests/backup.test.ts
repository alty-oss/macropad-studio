import { describe, expect, test } from 'bun:test';
import { parseBackup, serializeBackup } from '../src/device/backup-file.ts';
import type { Binding, MobileButton } from '../src/device/protocol.ts';

const layout = { keys: 12, knobs: 3 };
const controls = new Map<number, Binding>([
  [4, { kind: 'key', mods: 3, code: 0x16 }],
  [8, { kind: 'media', media: 0xe9 }],
  [12, { kind: 'empty' }],
  [22, {
    kind: 'app', multi: true, mode: 'normal', alt: [], profiles: [],
    steps: [{ type: 'open', path: 'C:\\Windows\\notepad.exe', args: '', focus: false }, { type: 'delay', ms: 300 }, { type: 'hotkey', mods: 1, code: 0x06 }]
  }]
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

  test('preserva modo, etapas alternativas, perfis e legendas', () => {
    const binding: Binding = {
      kind: 'app', multi: true, mode: 'toggle',
      steps: [{ type: 'obs', action: 'scene', scene: 'Jogo', source: '', amount: 0 }],
      alt: [{ type: 'obs', action: 'scene', scene: 'Câmera', source: '', amount: 0 }],
      profiles: [{ app: 'photoshop.exe', steps: [{ type: 'hotkey', mods: 1, code: 0x1d }] }]
    };
    const labels = [{ layer: 1, slot: 4, text: 'Cena', icon: 'video', color: '#3286ff' }, { layer: 2, slot: 40, text: 'fora', icon: '', color: '' }];
    const parsed = parseBackup(serializeBackup(layout, new Map([[1, new Map([[4, binding]])]]), labels), layout);
    expect(parsed.layers.get(1)?.get(4)).toEqual(binding);
    expect(parsed.labels).toEqual([labels[0]]);
  });

  test('exporta e importa a página exclusiva do celular', () => {
    const mobile: MobileButton[] = [{ slot: 1, folder: 0, text: 'Cena', icon: 'obs', color: '#3286ff', image: '', fit: '', multi: false, mode: 'normal', alt: [], profiles: [], steps: [{ type: 'obs', action: 'scene', scene: 'Jogo', source: '', amount: 0 }] }];
    const parsed = parseBackup(serializeBackup(layout, new Map(), [], { buttons: mobile, folders: [] }), layout);
    expect(parsed.mobile.buttons).toEqual(mobile);
  });

  test('exporta e importa pastas do celular e descarta atalhos para pastas ausentes', () => {
    const scene: MobileButton = { slot: 2, folder: 0, text: 'Jogo', icon: '', color: '', image: 'data:image/png;base64,AAAA', fit: 'cover', multi: false, mode: 'normal', alt: [], profiles: [], steps: [{ type: 'obs', action: 'scene', scene: 'Jogo', source: '', amount: 0 }] };
    const folder: MobileButton = { slot: 3, folder: 4, text: 'Cenas', icon: '', color: '#2f6bff', image: '', fit: '', multi: false, mode: 'normal', alt: [], profiles: [], steps: [] };
    const orphan: MobileButton = { ...folder, slot: 5, folder: 9 };
    const page = { buttons: [folder, orphan], folders: [{ id: 4, name: 'Cenas', buttons: [scene, { ...scene, slot: 1 }] }] };
    const parsed = parseBackup(serializeBackup(layout, new Map(), [], page), layout);
    expect(parsed.mobile.buttons).toEqual([folder]);
    // O botão 1 de uma pasta é o "Voltar" e não pode ser importado.
    expect(parsed.mobile.folders).toEqual([{ id: 4, name: 'Cenas', buttons: [scene] }]);
  });

  test('lê arquivos da versão 1, sem os campos novos', () => {
    const text = JSON.stringify({
      format: 'macropad-studio', version: 1, exportedAt: '', layout,
      layers: [{ layer: 1, controls: { 3: { kind: 'app', multi: false, steps: [{ type: 'text', text: 'oi' }] } } }]
    });
    expect(parseBackup(text, layout).layers.get(1)?.get(3)).toEqual({ kind: 'app', multi: false, mode: 'normal', alt: [], profiles: [], steps: [{ type: 'text', text: 'oi', paste: false }] });
  });

  test('recusa arquivos que não são do Macropad Studio', () => {
    expect(() => parseBackup('isso não é json', layout)).toThrow(/JSON/);
    expect(() => parseBackup('{"layers": []}', layout)).toThrow(/Macropad Studio/);
    expect(() => parseBackup('{"format": "macropad-studio", "version": 99, "layers": []}', layout)).toThrow(/mais nova/);
  });
});
