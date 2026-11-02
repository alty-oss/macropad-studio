// Pré-visualização do aparelho: teclas e knobs clicáveis, arrastar e soltar e os botões das
// funções em volta do knob selecionado.
import { knobParts, knobSlot, keySlotForPosition, labelFor } from '../device/protocol.ts';
import { $, h, type Child } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { assign, select, swap } from './editing.ts';
import { keycapLegend } from './legend.ts';
import { actionById } from './library.ts';
import { openContextMenu } from './menu.ts';
import { bindingAt, controlLabel, labelAt, layerData, state } from './state.ts';

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
  const color = binding.kind === 'empty' ? '' : labelAt(slot)?.color;
  const button = h('button', {
    type: 'button', class: className, draggable: 'true', 'data-slot': slot, 'aria-pressed': String(state.selected === slot),
    'aria-label': `${controlLabel(slot)}: ${labelFor(binding)}`
  }, ...content);
  button.classList.toggle('selected', state.selected === slot);
  button.classList.toggle('dirty', layerData().drafts.has(slot));
  button.classList.toggle('assigned', binding.kind !== 'empty');
  if (color) button.style.setProperty('--keycap-accent', color);
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
    const dial = h('span', { class: 'knob-dial' }, h('span', { class: 'knob-indicator' }));
    dial.style.rotate = `${state.knobAngle[i]}deg`;
    const button = controlButton(knobSlot(i, state.knobPart[i]), 'knob-press', dial);
    button.dataset.knob = String(i);
    button.setAttribute('aria-label', `Knob ${i + 1}`);
    button.classList.toggle('selected', isSelected);
    button.classList.toggle('dirty', slots.some(slot => layerData().drafts.has(slot)));
    knobs.push(h('div', { class: 'knob-unit' }, button, isSelected ? knobPicker(i) : null));
  }
  for (let i = 0; i < state.layout.keys; i++) {
    const slot = keySlotForPosition(i, state.layout.keys);
    if (!slot) continue;
    keys.push(controlButton(slot, 'keycap', keycapLegend(bindingAt(slot), labelAt(slot))));
  }
  $('#knobs').replaceChildren(...knobs);
  $('#keys').replaceChildren(...keys);
  $('#layout-name').textContent = `${state.layout.keys} teclas · ${state.layout.knobs} knobs`;
  if (focused) document.querySelector<HTMLElement>(focused)?.focus();
}

// Graus que o indicador do knob anda a cada clique do encoder.
const DETENT = 24;

// Acompanha o controle acionado por uma tecla virtual: a tecla e o knob pressionado afundam, e o
// indicador do knob gira para o mesmo lado que o knob do aparelho.
export function flash(slot: number) {
  if (slot >= 16) {
    const knob = Math.floor((slot - 16) / 3), part = (slot - 16) % 3;
    if (part !== 1) {
      state.knobAngle[knob] += part === 0 ? -DETENT : DETENT;
      for (const dial of document.querySelectorAll<HTMLElement>(`.knob-press[data-knob="${knob}"] .knob-dial`)) dial.style.rotate = `${state.knobAngle[knob]}deg`;
      return;
    }
  }
  const target = slot >= 16 ? `.knob-press[data-knob="${Math.floor((slot - 16) / 3)}"]` : `.keycap[data-slot="${slot}"]`;
  for (const element of document.querySelectorAll(target)) {
    element.classList.add('pressed');
    setTimeout(() => element.classList.remove('pressed'), 220);
  }
}

// Navegação pelo teclado na pré-visualização: as setas levam ao controle mais próximo naquela
// direção na tela (o aparelho aparece deitado, então a ordem do DOM não ajuda); Shift+F10 ou a
// tecla de menu abrem o menu do controle.
export function bindBoardKeyboard() {
  $('.device-body').addEventListener('keydown', event => {
    const current = (event.target as HTMLElement).closest<HTMLElement>('.keycap, .knob-press');
    if (!current) return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const box = current.getBoundingClientRect();
      current.click();
      openContextMenu(box.left + box.width / 2, box.top + box.height / 2);
      return;
    }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const center = (element: Element) => { const box = element.getBoundingClientRect(); return [box.left + box.width / 2, box.top + box.height / 2]; };
    const [x, y] = center(current);
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const candidate of document.querySelectorAll<HTMLElement>('.device-body .keycap, .device-body .knob-press')) {
      if (candidate === current) continue;
      const [cx, cy] = center(candidate);
      const along = (cx - x) * direction[0] + (cy - y) * direction[1];
      if (along <= 4) continue;
      const across = Math.abs((cx - x) * direction[1] + (cy - y) * direction[0]);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    best?.focus();
  });
}
