// Estado do editor: conexão, camadas (o que está no dispositivo e os rascunhos) e seleção.
import { isTauri } from '@tauri-apps/api/core';
import { knobParts, keySlotForPosition, type Binding, type Macro } from '../device/protocol.ts';

export type Connection = 'searching' | 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'unsupported';
interface LayerState { records: Map<number, Binding>; drafts: Map<number, Binding>; loaded: boolean }

// true no app para Windows; false na pré-visualização pelo navegador.
export const tauri = isTauri();

export const state = {
  connection: 'searching' as Connection,
  connectError: '',
  everConnected: false,
  offline: false,
  layout: { keys: 12, knobs: 3 },
  layer: 1,
  selected: null as number | null,
  busy: false,
  progress: '',
  macros: [] as Macro[],
  clipboard: null as Binding | null,
  collapsed: new Set<string>(),
  // Função de cada knob aberta por último (0 girar à esquerda, 1 pressionar, 2 girar à direita).
  knobPart: [1, 1, 1],
  layers: Array.from({ length: 3 }, (): LayerState => ({ records: new Map(), drafts: new Map(), loaded: false }))
};

export const layerData = (number = state.layer) => state.layers[number - 1];
export const bindingAt = (slot: number, layer = state.layer): Binding => layerData(layer).drafts.get(slot) || layerData(layer).records.get(slot) || { kind: 'empty' };
export const dirtyCount = () => state.layers.reduce((total, layer) => total + layer.drafts.size, 0);

// Ação "app" de um slot, com as etapas salvas na configuração do app.
export function macroBinding(layer: number, slot: number): Binding {
  const saved = state.macros.find(item => item.layer === layer && item.slot === slot);
  return { kind: 'app', multi: Boolean(saved?.multi), steps: saved ? structuredClone(saved.steps) : [] };
}

export function controlInfo(slot: number): { name: string; part?: string } {
  if (slot >= 16) {
    const knob = Math.floor((slot - 16) / 3);
    return { name: `Knob ${knob + 1}`, part: knobParts[(slot - 16) % 3].name };
  }
  const position = Array.from({ length: state.layout.keys }, (_, i) => keySlotForPosition(i, state.layout.keys)).indexOf(slot);
  return { name: `Tecla ${String(position + 1).padStart(2, '0')}` };
}
export function controlLabel(slot: number) {
  const info = controlInfo(slot);
  return info.part ? `${info.name} · ${info.part}` : info.name;
}
