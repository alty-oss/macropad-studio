// Edição: rascunhos por controle, seleção, área de transferência, desfazer/refazer e operações
// com camadas inteiras. Cada mudança redesenha as partes da tela que dependem dela.
import { equalBinding, labelFor, rotaryOnlyError, type Binding } from '../device/protocol.ts';
import { plural } from '../lib/text.ts';
import { renderBoard } from './board.ts';
import { renderChrome, renderLayers } from './chrome.ts';
import { confirmDialog, toast } from './feedback.ts';
import { controlPreview, renderInspector, renderInspectorHead } from './inspector.ts';
import { saveLabels } from './labels.ts';
import { loadAllLayers } from './session.ts';
import { stopCapture } from './shortcuts.ts';
import { allSlots, bindingAt, dirtyCount, layerData, state } from './state.ts';

// Histórico dos rascunhos das três camadas. Edições seguidas no mesmo campo (digitação) viram
// um passo só.
interface Snapshot { drafts: Map<number, Binding>[]; selected: number | null }
const history = { past: [] as Snapshot[], future: [] as Snapshot[], lastKey: '', lastAt: 0 };
const MERGE_MS = 800;
const LIMIT = 100;

const snapshot = (): Snapshot => ({ drafts: state.layers.map(layer => structuredClone(layer.drafts)), selected: state.selected });

// Guarda o estado atual antes de uma mudança. Com "key", mudanças seguidas na mesma chave se juntam.
export function remember(key = '') {
  const now = Date.now();
  if (key && key === history.lastKey && now - history.lastAt < MERGE_MS) { history.lastAt = now; return; }
  history.past.push(snapshot());
  if (history.past.length > LIMIT) history.past.shift();
  history.future = [];
  history.lastKey = key;
  history.lastAt = now;
}
export const canUndo = () => history.past.length > 0;
export const canRedo = () => history.future.length > 0;

function restore(target: Snapshot) {
  stopCapture();
  // Os registros podem ter mudado desde então (gravação, leitura): o rascunho igual ao dispositivo some.
  target.drafts.forEach((drafts, index) => {
    layerData(index + 1).drafts.clear();
    for (const [slot, binding] of drafts) stageDraft(index + 1, slot, binding);
  });
  state.selected = target.selected;
  history.lastKey = '';
  renderAll();
}
export function undo() {
  const previous = history.past.pop();
  if (!previous) return;
  history.future.push(snapshot());
  restore(previous);
}
export function redo() {
  const next = history.future.pop();
  if (!next) return;
  history.past.push(snapshot());
  restore(next);
}

export function renderAll() { renderBoard(); renderLayers(); renderChrome(); renderInspector(); }

// Prepara o rascunho de um controle numa camada, sem redesenhar. Igual ao que está no dispositivo,
// o rascunho é descartado.
export function stageDraft(layerNumber: number, slot: number, next: Binding) {
  const layer = layerData(layerNumber);
  const original = layer.records.get(slot) || { kind: 'empty' };
  if (equalBinding(original, next)) layer.drafts.delete(slot);
  else layer.drafts.set(slot, next);
}
export function setDraft(slot: number, next: Binding, { keepBody = false } = {}) {
  const restriction = rotaryOnlyError(slot, next);
  if (restriction) { toast(restriction, 'error'); return; }
  remember(keepBody ? `${state.layer}:${slot}` : '');
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
  remember();
  setSelected(to);
  stageDraft(state.layer, from, structuredClone(b));
  stageDraft(state.layer, to, structuredClone(a));
  renderAll();
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

export async function discardAll() {
  const count = dirtyCount();
  if (!count) return;
  if (!await confirmDialog('Descartar alterações?', `${plural(count, 'alteração não gravada será desfeita', 'alterações não gravadas serão desfeitas')} em todas as camadas. Dá para recuperar com Ctrl+Z.`, 'Descartar')) return;
  remember();
  for (const layer of state.layers) layer.drafts.clear();
  renderAll();
}

// Copia todas as ações (e legendas) de uma camada para outra, como alterações não gravadas.
export async function copyLayer(from: number, to: number) {
  await loadAllLayers();
  remember();
  let skipped = 0;
  for (const slot of allSlots()) {
    const binding = bindingAt(slot, from);
    if (binding.kind === 'raw') { skipped++; continue; }
    stageDraft(to, slot, structuredClone(binding));
  }
  const copied = state.labels.filter(label => label.layer === from).map(label => ({ ...label, layer: to }));
  await saveLabels([...state.labels.filter(label => label.layer !== to), ...copied]);
  renderAll();
  toast(`Camada ${from} copiada para a camada ${to}${skipped ? ` (${plural(skipped, 'ação existente ficou', 'ações existentes ficaram')} de fora)` : ''}. Revise e grave.`, 'success');
}

export async function swapLayers(a: number, b: number) {
  await loadAllLayers();
  const raw = allSlots().some(slot => bindingAt(slot, a).kind === 'raw' || bindingAt(slot, b).kind === 'raw');
  if (raw) { toast('Uma das camadas tem ações existentes que o editor não consegue mover.', 'error'); return; }
  remember();
  for (const slot of allSlots()) {
    const first = structuredClone(bindingAt(slot, a)), second = structuredClone(bindingAt(slot, b));
    stageDraft(a, slot, second);
    stageDraft(b, slot, first);
  }
  await saveLabels(state.labels.map(label => label.layer === a ? { ...label, layer: b } : label.layer === b ? { ...label, layer: a } : label));
  renderAll();
  toast(`Camadas ${a} e ${b} trocadas. Revise e grave.`, 'success');
}
