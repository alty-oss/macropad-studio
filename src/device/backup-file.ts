// Arquivo de configuração exportado pelo Macropad Studio: as ações de cada camada, incluindo as
// etapas das ações do app e as legendas personalizadas. A leitura valida tudo e descarta o que
// este editor não sabe gravar.
import { mediaNames, isKnownKey } from './keys.ts';
import { MOBILE_MAX_FOLDER, type AppMode, type Binding, type ImageFit, type MobileButton, type MobileFolder, type MobilePage, type Profile } from './protocol.ts';
import { isByte, parseSteps } from './steps.ts';

const FORMAT = 'macropad-studio';
// Versão 2: etapas novas, modo das ações do app, perfis por programa e legendas.
const VERSION = 3;

// Legenda, ícone e cor escolhidos pelo usuário (struct Label em src-tauri/src/config.rs).
export interface Label { layer: number; slot: number; text: string; icon: string; color: string }
export interface BackupLayer { layer: number; controls: Record<string, Binding> }
export interface Backup { format: typeof FORMAT; version: number; exportedAt: string; layout: { keys: number; knobs: number }; layers: BackupLayer[]; labels?: Label[]; mobile?: MobileButton[]; mobileFolders?: MobileFolder[] }

export function serializeBackup(layout: { keys: number; knobs: number }, layers: Map<number, Map<number, Binding>>, labels: Label[] = [], mobile: MobilePage = { buttons: [], folders: [] }): string {
  const backup: Backup = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    layout,
    layers: [...layers].map(([layer, controls]) => ({ layer, controls: Object.fromEntries([...controls].map(([slot, binding]) => [String(slot), binding])) })),
    labels,
    mobile: mobile.buttons,
    mobileFolders: mobile.folders
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

// Botões de uma página do celular. Nas pastas (first = 2) o slot 1 é o "Voltar".
function parseMobileButtons(value: unknown, first = 1): MobileButton[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap(item => {
    if (!isObject(item) || !Number.isInteger(item.slot) || (item.slot as number) < first || (item.slot as number) > 15 || seen.has(item.slot as number)) return [];
    const text = typeof item.text === 'string' ? item.text.slice(0, 48) : '';
    const icon = typeof item.icon === 'string' ? item.icon : '';
    const color = typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '';
    // Mesmas regras do app (config::decode_image): PNG, JPEG, WebP ou GIF em data URL, sem SVG.
    const image = typeof item.image === 'string' && item.image.length <= 600_000 && /^data:image\/(png|jpeg|webp|gif);base64,/.test(item.image) ? item.image : '';
    const fit: ImageFit = image ? (item.fit === 'cover' ? 'cover' : 'icon') : '';
    const folder = Number.isInteger(item.folder) && (item.folder as number) > 0 && (item.folder as number) <= MOBILE_MAX_FOLDER ? item.folder as number : 0;
    if (folder) { seen.add(item.slot as number); return [{ slot: item.slot as number, folder, text, icon, color, image, fit, multi: false, steps: [], mode: 'normal' as const, alt: [], profiles: [] }]; }
    if (typeof item.multi !== 'boolean') return [];
    const binding = parseBinding({ kind: 'app', multi: item.multi, steps: item.steps, mode: item.mode, alt: item.alt, profiles: item.profiles });
    if (!binding || binding.kind !== 'app' || !binding.steps.length) return [];
    seen.add(item.slot as number);
    return [{ slot: item.slot as number, folder: 0, text, icon, color, image, fit, ...{ multi: binding.multi, steps: binding.steps, mode: binding.mode ?? 'normal', alt: binding.alt ?? [], profiles: binding.profiles ?? [] } }];
  });
}

function parseMobile(buttons: unknown, folders: unknown): MobilePage {
  const ids = new Set<number>();
  const parsed: MobileFolder[] = (Array.isArray(folders) ? folders : []).flatMap(item => {
    if (!isObject(item) || !Number.isInteger(item.id) || (item.id as number) < 1 || (item.id as number) > MOBILE_MAX_FOLDER || ids.has(item.id as number)) return [];
    ids.add(item.id as number);
    return [{ id: item.id as number, name: typeof item.name === 'string' ? item.name.slice(0, 48) : '', buttons: parseMobileButtons(item.buttons, 2) }];
  });
  // Atalhos para pastas que não vieram no arquivo são descartados.
  const valid = (list: MobileButton[]) => list.filter(button => !button.folder || ids.has(button.folder));
  return { buttons: valid(parseMobileButtons(buttons)), folders: parsed.map(folder => ({ ...folder, buttons: valid(folder.buttons) })) };
}

export interface ParsedBackup { layers: Map<number, Map<number, Binding>>; labels: Label[]; mobile: MobilePage; skipped: number }

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
  return { layers, labels: parseLabels(data.labels, validSlot), mobile: parseMobile(data.mobile, data.mobileFolders), skipped };
}
