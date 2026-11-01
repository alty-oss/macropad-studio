// Pré-visualização do aparelho: teclas e knobs clicáveis, arrastar e soltar e os botões das
// funções em volta do knob selecionado.
import { knobParts, knobSlot, keySlotForPosition, labelFor } from '../device/protocol.ts';
import { $, h, type Child } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { assign, select, swap } from './editing.ts';
import { keycapLegend } from './legend.ts';
import { actionById } from './library.ts';
import { openContextMenu } from './menu.ts';
import { bindingAt, controlLabel, layerData, state } from './state.ts';

export const DRAG_ACTION = 'application/x-macropad-action';
export const DRAG_SLOT = 'application/x-macropad-slot';

// Aceita ações arrastadas da biblioteca (atribui) e controles arrastados do aparelho (troca).
export function makeDropTarget(element: HTMLElement, slot: number) {
  element.addEventListener('dragover', event => {
    const transfer = event.dataTransfer;
    if (!transfer || (!transfer.types.includes(DRAG_ACTION) && !transfer.types.includes(DRAG_SLOT))) return;
    event.preventDefault();
    transfer.dropEffect = transfer.types.includes(DRAG_SLOT) ? 'move' : 'copy';
    element.classList.add('drop-target');
  });
  element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
  element.addEventListener('drop', event => {
    event.preventDefault();
    element.classList.remove('drop-target');
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const item = actionById.get(transfer.getData(DRAG_ACTION));
    const from = Number(transfer.getData(DRAG_SLOT));
    if (item) assign(slot, item.make());
    else if (from && from !== slot) swap(from, slot);
  });
}

function controlButton(slot: number, className: string, ...content: Child[]) {
  const binding = bindingAt(slot);
  const button = h('button', {
    type: 'button', class: className, draggable: 'true', 'data-slot': slot, 'aria-pressed': String(state.selected === slot),
    'aria-label': `${controlLabel(slot)}: ${labelFor(binding)}`
  }, ...content);
  button.classList.toggle('selected', state.selected === slot);
  button.classList.toggle('dirty', layerData().drafts.has(slot));
  button.classList.toggle('assigned', binding.kind !== 'empty');
  button.addEventListener('click', () => select(slot));
  button.addEventListener('contextmenu', event => { event.preventDefault(); select(slot); openContextMenu(event.clientX, event.clientY); });
  button.addEventListener('dragstart', event => {
    event.dataTransfer?.setData(DRAG_SLOT, String(slot));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  makeDropTarget(button, slot);
  return button;
}

// Botões em volta do knob selecionado: girar à esquerda fica à esquerda, pressionar em cima e
// girar à direita à direita. Também aceitam ações arrastadas da biblioteca.
function knobPicker(knob: number) {
  const sides = ['left', 'press', 'right'];
  return h('div', { class: 'knob-picker', role: 'group', 'aria-label': `Funções do knob ${knob + 1}` }, knobParts.map(({ name, icon: glyph }, action) => {
    const target = knobSlot(knob, action);
    const button = h('button', {
      type: 'button', class: `knob-pick pick-${sides[action]}`, 'aria-label': `${name}: ${labelFor(bindingAt(target))}`,
      'aria-pressed': String(target === state.selected), onclick: () => select(target)
    }, icon(glyph));
    button.classList.toggle('assigned', bindingAt(target).kind !== 'empty');
    button.classList.toggle('dirty', layerData().drafts.has(target));
    makeDropTarget(button, target);
    return button;
  }));
}

export function renderBoard() {
  const active = (document.activeElement as HTMLElement | null)?.dataset ?? {};
  const focused = active.knob ? `.knob-press[data-knob="${active.knob}"]` : active.slot ? `.keycap[data-slot="${active.slot}"]` : null;
  const knobs: HTMLElement[] = [], keys: HTMLElement[] = [];
  for (let i = 0; i < state.layout.knobs; i++) {
    // O knob abre na função usada por último; selecionado, mostra os botões das três funções.
    const slots = [0, 1, 2].map(action => knobSlot(i, action));
    const isSelected = state.selected !== null && slots.includes(state.selected);
    const button = controlButton(knobSlot(i, state.knobPart[i]), 'knob-press', h('span', { class: 'knob-indicator' }));
    button.dataset.knob = String(i);
    button.setAttribute('aria-label', `Knob ${i + 1}`);
    button.classList.toggle('selected', isSelected);
    button.classList.toggle('dirty', slots.some(slot => layerData().drafts.has(slot)));
    knobs.push(h('div', { class: 'knob-unit' }, button, isSelected ? knobPicker(i) : null));
  }
  for (let i = 0; i < state.layout.keys; i++) {
    const slot = keySlotForPosition(i, state.layout.keys);
    if (!slot) continue;
    keys.push(controlButton(slot, 'keycap', keycapLegend(bindingAt(slot))));
  }
  $('#knobs').replaceChildren(...knobs);
  $('#keys').replaceChildren(...keys);
  $('#layout-name').textContent = `${state.layout.keys} teclas · ${state.layout.knobs} knobs`;
  if (focused) document.querySelector<HTMLElement>(focused)?.focus();
}

// Destaca o controle acionado por uma tecla virtual.
export function flash(slot: number) {
  const target = slot >= 16 ? `.knob-press[data-knob="${Math.floor((slot - 16) / 3)}"]` : `.keycap[data-slot="${slot}"]`;
  for (const element of document.querySelectorAll(target)) {
    element.classList.add('pressed');
    setTimeout(() => element.classList.remove('pressed'), 220);
  }
}
