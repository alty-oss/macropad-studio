// Edição: rascunhos por controle, seleção e área de transferência. Cada mudança redesenha as
// partes da tela que dependem dela.
import { equalBinding, labelFor, type Binding } from '../device/protocol.ts';
import { renderBoard } from './board.ts';
import { renderChrome, renderLayers } from './chrome.ts';
import { toast } from './feedback.ts';
import { controlPreview, renderInspector, renderInspectorHead } from './inspector.ts';
import { stopCapture } from './shortcuts.ts';
import { bindingAt, layerData, state } from './state.ts';

// Prepara o rascunho de um controle numa camada, sem redesenhar. Igual ao que está no dispositivo,
// o rascunho é descartado.
export function stageDraft(layerNumber: number, slot: number, next: Binding) {
  const layer = layerData(layerNumber);
  const original = layer.records.get(slot) || { kind: 'empty' };
  if (equalBinding(original, next)) layer.drafts.delete(slot);
  else layer.drafts.set(slot, next);
}
export function setDraft(slot: number, next: Binding, { keepBody = false } = {}) {
  stageDraft(state.layer, slot, next);
  renderBoard(); renderLayers(); renderChrome();
  if (keepBody) {
    // Os campos continuam no lugar (e com o foco); só o cabeçalho e a miniatura acompanham a edição.
    renderInspectorHead();
    document.querySelector('#inspector-body .control-preview')?.replaceWith(controlPreview(slot));
  } else renderInspector();
}
export function assign(slot: number, binding: Binding) {
  stopCapture();
  setSelected(slot);
  setDraft(slot, binding);
}
export function swap(from: number, to: number) {
  const a = bindingAt(from), b = bindingAt(to);
  if (a.kind === 'raw' || b.kind === 'raw') { toast('Ações existentes do dispositivo não podem ser movidas.', 'error'); return; }
  setSelected(to);
  setDraft(from, structuredClone(b));
  setDraft(to, structuredClone(a));
}

// Selecionar uma função de knob também a torna a função aberta daquele knob.
function setSelected(slot: number) {
  state.selected = slot;
  if (slot >= 16) state.knobPart[Math.floor((slot - 16) / 3)] = (slot - 16) % 3;
}
export function select(slot: number) {
  stopCapture();
  setSelected(slot);
  renderBoard();
  renderInspector();
}
export function deselect() {
  if (!state.selected) return;
  stopCapture();
  state.selected = null;
  renderBoard();
  renderInspector();
}

export function copySelected() {
  if (!state.selected) return;
  const binding = bindingAt(state.selected);
  if (binding.kind === 'empty' || binding.kind === 'raw') return;
  state.clipboard = structuredClone(binding);
  toast(`${labelFor(binding)} copiado.`);
}
export function pasteSelected() { if (state.selected && state.clipboard) assign(state.selected, structuredClone(state.clipboard)); }
export function clearSelected() { if (state.selected) setDraft(state.selected, { kind: 'empty' }); }
