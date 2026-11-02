// Estado do editor: conexão, camadas (o que está no dispositivo e os rascunhos) e seleção.
import { isTauri } from '@tauri-apps/api/core';
import type { Label } from '../device/backup-file.ts';
import { knobParts, keySlotForPosition, type Binding, type Macro } from '../device/protocol.ts';

export type Connection = 'searching' | 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'unsupported';
interface LayerState { records: Map<number, Binding>; drafts: Map<number, Binding>; loaded: boolean }
export interface ObsStatus { connected: boolean; recording: boolean; streaming: boolean; scene: string; error: string }

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
  labels: [] as Label[],
  clipboard: null as Binding | null,
  collapsed: new Set<string>(),
  // Função de cada knob aberta por último (0 girar à esquerda, 1 pressionar, 2 girar à direita).
  knobPart: [1, 1, 1],
  // Ângulo do indicador de cada knob na pré-visualização, que acompanha os giros do aparelho.
  knobAngle: [0, 0, 0],
  // Camada de onde veio a última tecla virtual: é a camada ativa no macropad.
  detectedLayer: null as number | null,
  keysPaused: false,
  obs: { connected: false, recording: false, streaming: false, scene: '', error: '' } as ObsStatus,
  layers: Array.from({ length: 3 }, (): LayerState => ({ records: new Map(), drafts: new Map(), loaded: false }))
};

export const layerData = (number = state.layer) => state.layers[number - 1];
export const bindingAt = (slot: number, layer = state.layer): Binding => layerData(layer).drafts.get(slot) || layerData(layer).records.get(slot) || { kind: 'empty' };
export const dirtyCount = () => state.layers.reduce((total, layer) => total + layer.drafts.size, 0);
export const labelAt = (slot: number, layer = state.layer) => state.labels.find(item => item.layer === layer && item.slot === slot);
export const allSlots = () => [
  ...Array.from({ length: state.layout.keys }, (_, i) => i + 1),
  ...Array.from({ length: state.layout.knobs * 3 }, (_, i) => 16 + i)
];

// Ação "app" de um slot, com as etapas salvas na configuração do app.
export function macroBinding(layer: number, slot: number): Binding {
  const saved = state.macros.find(item => item.layer === layer && item.slot === slot);
  if (!saved) return { kind: 'app', multi: false, steps: [] };
  const { multi, steps, mode, alt, profiles } = structuredClone(saved);
  return { kind: 'app', multi: Boolean(multi), steps, mode: mode ?? 'normal', alt: alt ?? [], profiles: profiles ?? [] };
}

export function controlInfo(slot: number): { name: string; part?: string } {
  if (slot >= 16) {
    const knob = Math.floor((slot - 16) / 3);
    return { name: `Knob ${knob + 1}`, part: knobParts[(slot - 16) % 3].name };
  }
  // A pré-visualização mostra o aparelho deitado (girado 90° para a direita): a linha r e a coluna c
  // do aparelho em pé viram a coluna (linhas - 1 - r) e a linha c na tela. A numeração segue a
  // ordem de leitura na tela, da esquerda para a direita e de cima para baixo.
  const rows = Math.ceil(state.layout.keys / 3);
  const index = Array.from({ length: state.layout.keys }, (_, i) => keySlotForPosition(i, state.layout.keys)).indexOf(slot);
  const position = (index % 3) * rows + (rows - 1 - Math.floor(index / 3));
  return { name: `Tecla ${String(position + 1).padStart(2, '0')}` };
}
export function controlLabel(slot: number) {
  const info = controlInfo(slot);
  return info.part ? `${info.name} · ${info.part}` : info.name;
}
