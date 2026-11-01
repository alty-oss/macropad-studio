// Combinações de teclas: captura pressionando as teclas de verdade ou escolha pelo teclado virtual,
// para atalhos que o Windows não deixa capturar (Win, Alt+Tab…).
import { codeToHid, comboLabel, functionGroups, isKnownKey, mainRows, modifierCodes, navigationRows, numpadKeys, type KeySpec } from '../device/keys.ts';
import { $, h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { toast } from './feedback.ts';

// Combinação completa (com tecla principal), como sai da captura ou do teclado virtual.
export interface Combo { mods: number; code: number }
type ComboValue = { mods: number; code: number | null };

function kbdRow(mods: number, code: number | null, placeholder = '') {
  const parts = comboLabel(mods, code);
  return parts.length ? parts.map(part => h('kbd', {}, part)) : [h('span', { class: 'placeholder' }, placeholder)];
}
const keycaps = (mods: number, code: number | null) => h('div', { class: 'keycaps' }, comboLabel(mods, code).map(part => h('span', { class: 'keycap-chip' }, part)));

// Campo de captura e botão do teclado virtual, lado a lado.
export function comboControl(value: ComboValue, onChange: (combo: Combo) => void) {
  return h('div', { class: 'combo-control' }, shortcutField(value, onChange),
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => openKeyboard(value, onChange) }, icon('keyboard'), 'Teclado virtual'));
}

let capture: (() => void) | null = null;
function shortcutField(value: ComboValue, onChange: (combo: Combo) => void) {
  const element = h('button', { type: 'button', class: 'shortcut-field' },
    ...kbdRow(value.mods, value.code, 'Clique e pressione a combinação'));
  element.addEventListener('click', () => startCapture(element, onChange));
  return element;
}
function startCapture(element: HTMLElement, onChange: (combo: Combo) => void) {
  stopCapture();
  const original = [...element.childNodes];
  const listeners = new AbortController();
  let mods = 0;
  const show = () => element.replaceChildren(...kbdRow(mods, null, 'Pressione a combinação…'));
  window.addEventListener('keydown', event => {
    event.preventDefault();
    event.stopPropagation();
    const bit = modifierCodes.get(event.code);
    if (bit) { mods |= bit; show(); return; }
    const code = codeToHid.get(event.code);
    if (code === undefined) return;
    stopCapture();
    element.replaceChildren(...kbdRow(mods, code));
    onChange({ mods, code });
  }, { capture: true, signal: listeners.signal });
  window.addEventListener('keyup', event => {
    const bit = modifierCodes.get(event.code);
    if (bit) { mods &= ~bit; show(); }
  }, { capture: true, signal: listeners.signal });
  element.addEventListener('blur', () => { stopCapture(); element.replaceChildren(...original); }, { signal: listeners.signal });
  element.classList.add('recording');
  show();
  capture = () => { listeners.abort(); element.classList.remove('recording'); };
}
export function stopCapture() { capture?.(); capture = null; }

// Teclado virtual: edita uma cópia e só entrega a combinação ao clicar em Concluir.
let keyboardTarget: { value: ComboValue; onChange: (combo: Combo) => void } | null = null;
function openKeyboard(value: ComboValue, onChange: (combo: Combo) => void) {
  stopCapture();
  keyboardTarget = { value: { mods: value.mods || 0, code: value.code ?? null }, onChange };
  renderKeyboardState();
  $<HTMLDialogElement>('#keyboard-modal').showModal();
}
export function closeKeyboard(commit: boolean) {
  if (!keyboardTarget) return;
  const { mods, code } = keyboardTarget.value;
  if (commit && !isKnownKey(code)) { toast('Escolha a tecla principal da combinação.', 'error'); return; }
  $<HTMLDialogElement>('#keyboard-modal').close();
  if (commit && isKnownKey(code)) keyboardTarget.onChange({ mods, code });
  keyboardTarget = null;
}
function renderKeyboardState() {
  if (!keyboardTarget) return;
  const { mods, code } = keyboardTarget.value;
  for (const button of document.querySelectorAll<HTMLElement>('[data-mod]')) button.setAttribute('aria-pressed', String(Boolean(mods & Number(button.dataset.mod))));
  for (const button of document.querySelectorAll<HTMLElement>('[data-code]')) button.setAttribute('aria-pressed', String(code === Number(button.dataset.code)));
  $('#keyboard-summary').replaceChildren(mods || code ? keycaps(mods, code) : h('span', { class: 'placeholder' }, 'Nenhuma tecla'));
}
function virtualKey(spec: KeySpec) {
  // Teclas com uma letra ou símbolo têm legenda grande; nomes como "Shift" vão menores, embaixo.
  // Espaço e setas têm a legenda centralizada.
  const word = [...spec.label].length > 1;
  const centered = spec.code !== undefined && [0x2c, 0x4f, 0x50, 0x51, 0x52].includes(spec.code);
  const button = h('button', { type: 'button', class: `virtual-key${word ? ' word' : ''}${centered ? ' centered' : ''}`, 'aria-pressed': 'false' }, h('span', { class: 'key-label' }, spec.label));
  button.style.setProperty('--span', String(spec.span));
  if (spec.mod !== undefined) {
    button.classList.add('modifier');
    button.dataset.mod = String(spec.mod);
    button.setAttribute('aria-label', `Modificar atalho com ${spec.label}`);
  } else if (spec.code !== undefined) {
    button.dataset.code = String(spec.code);
    button.setAttribute('aria-label', `Tecla ${spec.label}${spec.code >= 0x53 && spec.code <= 0x63 ? ' do teclado numérico' : ''}`);
  }
  button.addEventListener('click', () => {
    if (!keyboardTarget) return;
    const value = keyboardTarget.value;
    if (spec.mod !== undefined) value.mods ^= spec.mod;
    else if (spec.code !== undefined) value.code = spec.code;
    renderKeyboardState();
  });
  return button;
}
export function renderKeyboard() {
  // Grade de três colunas como num teclado completo: Esc e F1–F12 alinhados ao bloco principal,
  // PrtSc/Scroll/Pause sobre a navegação e os indicadores sobre o teclado numérico.
  const functionMain = h('div', { class: 'function-row' }, functionGroups.slice(0, 4).map(group => h('div', { class: 'function-group' }, group.map(virtualKey))));
  const functionNav = h('div', { class: 'function-group' }, functionGroups[4].map(virtualKey));
  const indicators = h('div', { class: 'keyboard-leds', 'aria-hidden': 'true' }, ['Num', 'Caps', 'Scroll'].map(name => h('span', {}, h('i'), name)));
  const main = h('div', { class: 'keyboard-main' }, mainRows.map(row => h('div', { class: 'keyboard-row' }, row.map(virtualKey))));
  const navigation = h('div', { class: 'navigation-cluster' }, navigationRows.map((row, index) =>
    h('div', { class: index === 2 ? 'navigation-row arrow-up arrow-cluster' : 'navigation-row' }, row.map(virtualKey))));
  const numpad = h('div', { class: 'numpad-grid' }, numpadKeys.map(key => {
    const button = virtualKey(key);
    if (key.tall) button.classList.add('tall');
    if (key.wide) button.classList.add('span-two');
    return button;
  }));
  $('#virtual-keyboard').replaceChildren(functionMain, functionNav, indicators, main, navigation, numpad);
}
