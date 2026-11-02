import { invoke } from '@tauri-apps/api/core';
import { equivalentSteps } from '../device/protocol.ts';
import { allSlots, labelAt, state, tauri } from './state.ts';

// Espelho das camadas para o celular. Ações do app disparam a tecla virtual; atalhos e mídia
// gravados no aparelho seguem com as etapas equivalentes, que o app executa no toque. Os giros dos
// knobs repetem enquanto o botão é segurado no celular.
export async function syncMobileMirror() {
  if (!tauri) return;
  const layers = state.layers.map((layer, index) => ({
    layer: index + 1,
    loaded: layer.loaded,
    slots: allSlots().map(slot => {
      const binding = layer.loaded ? layer.records.get(slot) || { kind: 'empty' as const } : { kind: 'raw' as const, label: 'Não sincronizado' };
      const label = labelAt(slot, index + 1);
      const app = binding.kind === 'app';
      const steps = app ? [] : equivalentSteps(binding) ?? [];
      const executable = app || steps.length > 0;
      return {
        slot,
        kind: app ? 'app' : binding.kind === 'empty' ? 'empty' : 'hid',
        label: label?.text || '',
        icon: label?.icon || '',
        color: label?.color || '',
        executable,
        repeat: executable && slot >= 16 && (slot - 16) % 3 !== 1,
        steps,
        loaded: layer.loaded
      };
    })
  }));
  await invoke('mobile_mirror_sync', { mirror: { layers, detectedLayer: state.detectedLayer, devicePresent: state.connection === 'connected' } }).catch(() => {});
}
