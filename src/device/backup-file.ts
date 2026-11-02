// Arquivo de configuração exportado pelo Macropad Studio: as ações de cada camada, incluindo as
// etapas das ações do app e as legendas personalizadas. A leitura valida tudo e descarta o que
// este editor não sabe gravar.
import { mediaNames, isKnownKey } from './keys.ts';
import type { AppMode, Binding, Profile } from './protocol.ts';
import { isByte, parseSteps } from './steps.ts';

const FORMAT = 'macropad-studio';
// Versão 2: etapas novas, modo das ações do app, perfis por programa e legendas.
const VERSION = 2;

// Legenda, ícone e cor escolhidos pelo usuário (struct Label em src-tauri/src/config.rs).
export interface Label { layer: number; slot: number; text: string; icon: string; color: string }
export interface BackupLayer { layer: number; controls: Record<string, Binding> }
export interface Backup { format: typeof FORMAT; version: number; exportedAt: string; layout: { keys: number; knobs: number }; layers: BackupLayer[]; labels?: Label[] }

export function serializeBackup(layout: { keys: number; knobs: number }, layers: Map<number, Map<number, Binding>>, labels: Label[] = []): string {
  const backup: Backup = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    layout,
    layers: [...layers].map(([layer, controls]) => ({ layer, controls: Object.fromEntries([...controls].map(([slot, binding]) => [String(slot), binding])) })),
    labels
  };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const modes = new Set<string>(['normal', 'toggle', 'hold']);

function parseProfiles(value: unknown): Profile[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const profiles = value.map(item => {
    if (!isObject(item) || typeof item.app !== 'string') return null;
    const steps = parseSteps(item.steps);
    return steps ? { app: item.app, steps } : null;
  });
  return profiles.some(profile => !profile) ? null : profiles as Profile[];
}

// Ações existentes ("raw") não entram: o editor não consegue regravá-las.
function parseBinding(value: unknown): Binding | null {
  if (!isObject(value)) return null;
  switch (value.kind) {
    case 'empty': return { kind: 'empty' };
    case 'key': return isByte(value.mods) && isKnownKey(value.code as number) ? { kind: 'key', mods: value.mods, code: value.code as number } : null;
    case 'media': return typeof value.media === 'number' && mediaNames.has(value.media) ? { kind: 'media', media: value.media } : null;
    case 'app': {
      if (typeof value.multi !== 'boolean') return null;
      const steps = parseSteps(value.steps);
      if (!steps || (!value.multi && steps.length !== 1)) return null;
      const mode = value.mode === undefined ? 'normal' : typeof value.mode === 'string' && modes.has(value.mode) ? value.mode as AppMode : null;
      const alt = value.alt === undefined ? [] : parseSteps(value.alt);
      const profiles = parseProfiles(value.profiles);
      if (!mode || !alt || !profiles) return null;
      return { kind: 'app', multi: value.multi, steps, mode, alt, profiles };
    }
    default: return null;
  }
}

function parseLabels(value: unknown, validSlot: (slot: number) => boolean): Label[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isObject(item) || !Number.isInteger(item.layer) || !Number.isInteger(item.slot)) return [];
    const layer = item.layer as number, slot = item.slot as number;
    if (layer < 1 || layer > 3 || !validSlot(slot)) return [];
    const text = (field: unknown) => typeof field === 'string' ? field : '';
    return [{ layer, slot, text: text(item.text).slice(0, 24), icon: text(item.icon), color: /^#[0-9a-f]{6}$/i.test(text(item.color)) ? text(item.color) : '' }];
  });
}

export interface ParsedBackup { layers: Map<number, Map<number, Binding>>; labels: Label[]; skipped: number }

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
  return { layers, labels: parseLabels(data.labels, validSlot), skipped };
}
