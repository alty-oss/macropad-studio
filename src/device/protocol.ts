// Protocolo do macropad CH57x (USB 1189:8840): slots, teclas virtuais e codificação dos registros.
// Não acessa o DOM, para que os testes possam importá-lo diretamente.
import { comboLabel, isKnownKey, keyNames, mediaNames } from './keys.ts';
import { stepError, stepNames, stepSummary, type Step } from './steps.ts';

export { newStep, stepNames, stepSummary, type Step, type StepOf, type StepType } from './steps.ts';

export const DEVICE = { vendorId: 0x1189, productId: 0x8840, usagePage: 0xff00, usage: 1, reportId: 3, reportLength: 64 };

// Modo de uma ação do app: "toggle" alterna entre "steps" e "alt" a cada pressão; "hold" executa
// "steps" num toque e "alt" ao segurar a tecla.
export type AppMode = 'normal' | 'toggle' | 'hold';
// Etapas usadas quando o programa em foco é "app" (nome do executável, como photoshop.exe).
export interface Profile { app: string; steps: Step[] }

// O que um controle faz. "app" é gravado no macropad como tecla virtual; "raw" é uma ação
// existente que o editor não representa e apenas preserva.
export type Binding =
  | { kind: 'empty' }
  | { kind: 'key'; mods: number; code: number | null }
  | { kind: 'media'; media: number }
  | { kind: 'app'; multi: boolean; steps: Step[]; mode?: AppMode; alt?: Step[]; profiles?: Profile[] }
  | { kind: 'raw'; label: string };
export type BindingOf<K extends Binding['kind']> = Extract<Binding, { kind: K }>;

// Macro salva pelo app (struct Macro em src-tauri/src/config.rs).
export interface Macro { layer: number; slot: number; mods: number; code: number; multi: boolean; steps: Step[]; mode: AppMode; alt: Step[]; profiles: Profile[] }

// Ação do app com os campos opcionais preenchidos, para comparar e salvar.
export function appParts(binding: BindingOf<'app'>) {
  return { multi: binding.multi, steps: binding.steps, mode: binding.mode ?? 'normal', alt: binding.alt ?? [], profiles: binding.profiles ?? [] };
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
    case 'app': return JSON.stringify(appParts(a)) === JSON.stringify(appParts(b as typeof a));
    case 'raw': return false;
    case 'empty': return true;
  }
}
// Erro que impede gravar uma ação do app, ou null quando ela está completa.
export function appBindingError(binding: BindingOf<'app'>): string | null {
  const { steps, mode, alt, profiles } = appParts(binding);
  const firstError = (list: Step[]) => list.map(stepError).find(Boolean) ?? null;
  if (!steps.length) return 'Adicione pelo menos uma etapa.';
  const main = firstError(steps);
  if (main) return main;
  if (mode !== 'normal') {
    if (!alt.length) return mode === 'toggle' ? 'Adicione as etapas da segunda pressão.' : 'Adicione as etapas de segurar a tecla.';
    const second = firstError(alt);
    if (second) return second;
  }
  for (const profile of profiles) {
    if (!profile.app.trim()) return 'Informe o programa de cada perfil, como photoshop.exe.';
    if (!profile.steps.length) return `Adicione etapas ao perfil de ${profile.app}.`;
    const error = firstError(profile.steps);
    if (error) return `Perfil de ${profile.app}: ${error}`;
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
