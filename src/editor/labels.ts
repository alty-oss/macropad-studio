// Legendas personalizadas (texto, ícone e cor de cada controle). Não vão para o macropad: ficam na
// configuração do app, ou no localStorage na pré-visualização pelo navegador, e valem na hora.
import { invoke } from '@tauri-apps/api/core';
import type { Label } from '../device/backup-file.ts';
import { errorText } from '../lib/text.ts';
import { renderBoard } from './board.ts';
import { toast } from './feedback.ts';
import { state, tauri } from './state.ts';

const STORAGE_KEY = 'labels';

export async function loadLabels() {
  try {
    state.labels = tauri ? await invoke<Label[]>('labels_get') : JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { state.labels = []; }
}

const isBlank = (label: Label) => !label.text.trim() && !label.icon && !label.color;

export async function saveLabels(labels: Label[]) {
  const kept = labels.filter(label => !isBlank(label));
  const previous = state.labels;
  state.labels = kept;
  try {
    if (tauri) await invoke('labels_save', { labels: kept });
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch (error) {
    state.labels = previous;
    toast(`Não foi possível salvar a legenda: ${errorText(error)}`, 'error');
  }
  renderBoard();
}

export function setLabel(slot: number, patch: Partial<Pick<Label, 'text' | 'icon' | 'color'>>, layer = state.layer) {
  const current = state.labels.find(label => label.layer === layer && label.slot === slot) ?? { layer, slot, text: '', icon: '', color: '' };
  const others = state.labels.filter(label => label !== current);
  return saveLabels([...others, { ...current, ...patch }]);
}
