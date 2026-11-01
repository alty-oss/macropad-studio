// Arquivo de configuração exportado pelo Macropad Studio: as ações de cada camada, incluindo as
// etapas das ações do app. A leitura valida tudo e descarta o que este editor não sabe gravar.
import { isKnownKey, mediaNames } from './keys.ts';
import type { Binding, Step } from './protocol.ts';

const FORMAT = 'macropad-studio';
const VERSION = 1;

export interface BackupLayer { layer: number; controls: Record<string, Binding> }
export interface Backup { format: typeof FORMAT; version: number; exportedAt: string; layout: { keys: number; knobs: number }; layers: BackupLayer[] }

export function serializeBackup(layout: { keys: number; knobs: number }, layers: Map<number, Map<number, Binding>>): string {
  const backup: Backup = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    layout,
    layers: [...layers].map(([layer, controls]) => ({ layer, controls: Object.fromEntries([...controls].map(([slot, binding]) => [String(slot), binding])) }))
  };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const isByte = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255;

function parseStep(value: unknown): Step | null {
  if (!isObject(value)) return null;
  switch (value.type) {
    case 'open': return typeof value.path === 'string' ? { type: 'open', path: value.path, args: typeof value.args === 'string' ? value.args : '' } : null;
    case 'website': return typeof value.url === 'string' ? { type: 'website', url: value.url } : null;
    case 'text': return typeof value.text === 'string' ? { type: 'text', text: value.text } : null;
    case 'hotkey': return isByte(value.mods) && isKnownKey(value.code as number) ? { type: 'hotkey', mods: value.mods, code: value.code as number } : null;
    case 'delay': return Number.isInteger(value.ms) && (value.ms as number) >= 0 && (value.ms as number) <= 60000 ? { type: 'delay', ms: value.ms as number } : null;
    default: return null;
  }
}

// Ações existentes ("raw") não entram: o editor não consegue regravá-las.
function parseBinding(value: unknown): Binding | null {
  if (!isObject(value)) return null;
  switch (value.kind) {
    case 'empty': return { kind: 'empty' };
    case 'key': return isByte(value.mods) && isKnownKey(value.code as number) ? { kind: 'key', mods: value.mods, code: value.code as number } : null;
    case 'media': return typeof value.media === 'number' && mediaNames.has(value.media) ? { kind: 'media', media: value.media } : null;
    case 'app': {
      if (typeof value.multi !== 'boolean' || !Array.isArray(value.steps)) return null;
      const steps = value.steps.map(parseStep);
      if (steps.some(step => !step) || (!value.multi && steps.length !== 1)) return null;
      return { kind: 'app', multi: value.multi, steps: steps as Step[] };
    }
    default: return null;
  }
}

export interface ParsedBackup { layers: Map<number, Map<number, Binding>>; skipped: number }

// Lê um arquivo exportado. Slots que não existem neste layout ou ações inválidas são contados em
// "skipped"; um arquivo que não é do Macropad Studio gera erro.
export function parseBackup(text: string, layout: { keys: number; knobs: number }): ParsedBackup {
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new Error('O arquivo não é um JSON válido.'); }
  if (!isObject(data) || data.format !== FORMAT || !Array.isArray(data.layers)) throw new Error('O arquivo não é uma configuração do Macropad Studio.');
  if (typeof data.version !== 'number' || data.version > VERSION) throw new Error('Esta configuração foi criada por uma versão mais nova do Macropad Studio.');
  const validSlot = (slot: number) => (slot >= 1 && slot <= layout.keys) || (slot >= 16 && slot < 16 + layout.knobs * 3);
  const layers = new Map<number, Map<number, Binding>>();
  let skipped = 0;
  for (const entry of data.layers) {
    if (!isObject(entry) || !Number.isInteger(entry.layer) || (entry.layer as number) < 1 || (entry.layer as number) > 3 || !isObject(entry.controls)) { skipped++; continue; }
    const controls = layers.get(entry.layer as number) ?? new Map<number, Binding>();
    for (const [key, value] of Object.entries(entry.controls)) {
      const slot = Number(key);
      const binding = parseBinding(value);
      if (!Number.isInteger(slot) || !validSlot(slot) || !binding) { skipped++; continue; }
      controls.set(slot, binding);
    }
    layers.set(entry.layer as number, controls);
  }
  return { layers, skipped };
}
