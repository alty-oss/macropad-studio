// Protocolo do macropad CH57x (USB 1189:8840): slots, teclas virtuais e codificação dos registros.
// Não acessa o DOM, para que os testes possam importá-lo diretamente.
import { comboLabel, isKnownKey, keyNames, mediaNames } from './keys.ts';

export const DEVICE = { vendorId: 0x1189, productId: 0x8840, usagePage: 0xff00, usage: 1, reportId: 3, reportLength: 64 };

// Etapas executadas pelo app; o formato é o mesmo do enum Step em src-tauri/src/config.rs.
export type Step =
  | { type: 'open'; path: string; args: string }
  | { type: 'website'; url: string }
  | { type: 'text'; text: string }
  | { type: 'hotkey'; mods: number; code: number | null }
  | { type: 'delay'; ms: number };
export type StepType = Step['type'];

// O que um controle faz. "app" é gravado no macropad como tecla virtual; "raw" é uma ação
// existente que o editor não representa e apenas preserva.
export type Binding =
  | { kind: 'empty' }
  | { kind: 'key'; mods: number; code: number | null }
  | { kind: 'media'; media: number }
  | { kind: 'app'; multi: boolean; steps: Step[] }
  | { kind: 'raw'; label: string };
export type BindingOf<K extends Binding['kind']> = Extract<Binding, { kind: K }>;

// Macro salva pelo app (struct Macro em src-tauri/src/config.rs).
export interface Macro { layer: number; slot: number; mods: number; code: number; multi: boolean; steps: Step[] }

export function newStep(type: StepType): Step {
  switch (type) {
    case 'open': return { type, path: '', args: '' };
    case 'website': return { type, url: '' };
    case 'text': return { type, text: '' };
    case 'hotkey': return { type, mods: 0, code: null };
    case 'delay': return { type, ms: 300 };
  }
}

export const knobSlot = (index: number, action: number) => 16 + index * 3 + action;
// Ordem física confirmada no aparelho: em cada knob, o slot 0 gira à esquerda e o slot 2, à direita.
export const knobParts = [
  { name: 'Girar à esquerda', icon: 'rotateLeft' },
  { name: 'Pressionar', icon: 'press' },
  { name: 'Girar à direita', icon: 'rotateRight' }
] as const;
// Nesta orientação física, as teclas são numeradas pelo firmware por coluna,
// de baixo para cima: linha superior 4/8/12, linha inferior 1/5/9.
export function keySlotForPosition(index: number, keyCount = 12): number | null {
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
export function virtualCode(layer: number, slot: number): { mods: number; code: number } {
  const index = (layer - 1) * 24 + (slot >= 16 ? 15 + slot - 16 : slot - 1);
  return { mods: VIRTUAL_MODS[Math.floor(index / 12)], code: 0x68 + index % 12 };
}

export const stepNames: Record<StepType, string> = { open: 'Abrir', website: 'Site', text: 'Digitar texto', hotkey: 'Atalho', delay: 'Aguardar' };
export function stepSummary(step: Step): string {
  switch (step.type) {
    case 'open': return step.path ? step.path.split(/[\\/]/).filter(Boolean).pop() ?? step.path : 'Escolha um arquivo';
    case 'website': return step.url ? step.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Informe o endereço';
    case 'text': return step.text ? `“${step.text.length > 24 ? `${step.text.slice(0, 24)}…` : step.text}”` : 'Informe o texto';
    case 'hotkey': return comboLabel(step.mods, step.code).join(' + ') || 'Escolha a combinação';
    case 'delay': return `${step.ms} ms`;
  }
}
export function labelFor(binding: Binding): string {
  switch (binding.kind) {
    case 'key': return comboLabel(binding.mods, binding.code).join(' + ') || 'Escolha uma tecla';
    case 'media': return mediaNames.get(binding.media) || 'Mídia';
    case 'app': {
      if (binding.multi) return `Multi-ação · ${binding.steps.length} ${binding.steps.length === 1 ? 'etapa' : 'etapas'}`;
      const [step] = binding.steps;
      return step ? `${stepNames[step.type]} · ${stepSummary(step)}` : 'Macro do app sem ação';
    }
    case 'raw': return binding.label || 'Ação existente';
    case 'empty': return 'Sem ação';
  }
}
export function equalBinding(a: Binding | undefined, b: Binding | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'key': { const other = b as typeof a; return a.mods === other.mods && a.code === other.code; }
    case 'media': return a.media === (b as typeof a).media;
    case 'app': { const other = b as typeof a; return a.multi === other.multi && JSON.stringify(a.steps) === JSON.stringify(other.steps); }
    case 'raw': return false;
    case 'empty': return true;
  }
}
// Erro que impede gravar uma ação do app, ou null quando ela está completa.
export function appBindingError(binding: BindingOf<'app'>): string | null {
  if (!binding.steps.length) return 'Adicione pelo menos uma etapa.';
  for (const step of binding.steps) {
    if (step.type === 'open' && !step.path.trim()) return 'Escolha o arquivo, pasta ou programa a abrir.';
    if (step.type === 'website' && !step.url.trim()) return 'Informe o endereço do site.';
    if (step.type === 'text' && !step.text) return 'Informe o texto a digitar.';
    if (step.type === 'hotkey' && !isKnownKey(step.code)) return 'Escolha a tecla principal do atalho.';
  }
  return null;
}

// Um registro 0xFA lido do dispositivo. As etapas de uma ação "app" vêm da configuração do app.
export function decode(record: ArrayLike<number>, layer: number): Binding {
  const type = record[3];
  if (type === 1) {
    const count = record[9], mods = record[10], code = record[11];
    if (count === 1 && !mods && !code) return { kind: 'empty' };
    const virtual = virtualCode(layer, record[1]);
    if (count === 1 && mods === virtual.mods && code === virtual.code) return { kind: 'app', multi: false, steps: [] };
    if (count === 1 && keyNames.has(code)) return { kind: 'key', mods, code };
    return { kind: 'raw', label: count > 1 ? `Macro de ${count} passos` : 'Atalho especial existente' };
  }
  if (type === 2) {
    const code = record[10] | record[11] << 8;
    return mediaNames.has(code) ? { kind: 'media', media: code } : { kind: 'raw', label: `Mídia 0x${code.toString(16)}` };
  }
  return { kind: 'raw', label: `Ação especial (tipo ${type})` };
}
export function encode(slot: number, layer: number, binding: Binding): number[] {
  const head = [0xfe, slot, layer];
  if (binding.kind === 'empty') return [...head, 1, 0, 0, 0, 0, 0, 1, 0, 0];
  if (binding.kind === 'key') {
    if (!isKnownKey(binding.code)) throw new Error(`Slot ${slot}: selecione uma tecla principal.`);
    return [...head, 1, 0, 0, 0, 0, 0, 1, binding.mods, binding.code];
  }
  if (binding.kind === 'app') {
    const { mods, code } = virtualCode(layer, slot);
    return [...head, 1, 0, 0, 0, 0, 0, 1, mods, code];
  }
  if (binding.kind === 'media' && mediaNames.has(binding.media)) return [...head, 2, 0, 0, 0, 0, 0, 0, binding.media & 255, binding.media >> 8];
  throw new Error(`Slot ${slot}: esta ação não pode ser gravada por este editor.`);
}
