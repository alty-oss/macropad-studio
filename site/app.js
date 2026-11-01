import { transport } from './transport.js';
import {
  media, mediaNames, keyNames, functionGroups, mainRows, navigationRows, numpadKeys, codeToHid, modifierCodes,
  knobSlot, keySlotForPosition, virtualCode, comboLabel, stepNames, stepSummary, labelFor, equalBinding, appBindingError, decode, encode
} from './protocol.js';

const $ = selector => document.querySelector(selector);
const tauri = window.__TAURI__;
const invoke = tauri?.core.invoke;
const NOT_FOUND = 'Macropad não encontrado';
const DRAG_ACTION = 'application/x-macropad-action';
const DRAG_SLOT = 'application/x-macropad-slot';
const state = {
  // searching | idle | connecting | connected | disconnected | error | unsupported
  connection: 'searching',
  connectError: '',
  everConnected: false,
  offline: false,
  layout: { keys: 12, knobs: 3 },
  layer: 1,
  selected: null,
  busy: false,
  progress: '',
  macros: [],
  clipboard: null,
  collapsed: new Set(),
  layers: Array.from({ length: 3 }, () => ({ records: new Map(), drafts: new Map(), loaded: false }))
};

// Ícones de traço, 24 × 24.
const icons = {
  logo: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 9h.01M12 9h.01M15 9h.01M9 13h.01M12 13h.01M15 13h.01M9 17h.01M12 17h.01M15 17h.01"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  warning: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 16.8h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  bolt: '<path d="M13 3 5 13.5h6.5L10.5 21 19 10.5h-6.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
  volumeUp: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12"/>',
  volumeDown: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>',
  mute: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="m21 9.5-5 5M16 9.5l5 5"/>',
  playPause: '<path d="m4 6 8 6-8 6z"/><path d="M16 6v12M20 6v12"/>',
  next: '<path d="m5 6 9 6-9 6z"/><path d="M18 6v12"/>',
  prev: '<path d="m19 6-9 6 9 6z"/><path d="M6 6v12"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.3 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.3-3.4-8.5s1-6.1 3.4-8.5z"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  multi: '<rect x="3.5" y="4" width="17" height="4.5" rx="1.2"/><rect x="3.5" y="10" width="17" height="4.5" rx="1.2"/><rect x="3.5" y="16" width="11" height="4" rx="1.2"/>',
  empty: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  play: '<path d="m7 5 12 7-12 7z"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>',
  arrowUp: '<path d="m6 14 6-6 6 6"/>',
  arrowDown: '<path d="m6 10 6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  rotateLeft: '<path d="M4 5v5h5"/><path d="M4.6 14.5A7.5 7.5 0 1 0 6 7.4L4 10"/>',
  rotateRight: '<path d="M20 5v5h-5"/><path d="M19.4 14.5A7.5 7.5 0 1 1 18 7.4l2 2.6"/>',
  press: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'
};
function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = icons[name] || '';
  return svg;
}
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'value') element.value = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value === true ? '' : value);
  }
  element.append(...children.flat().filter(child => child != null && child !== false));
  return element;
}

const mediaIcons = new Map([[0xe9, 'volumeUp'], [0xea, 'volumeDown'], [0xe2, 'mute'], [0xcd, 'playPause'], [0xb5, 'next'], [0xb6, 'prev']]);
const mediaShort = new Map([[0xe9, 'Vol +'], [0xea, 'Vol −'], [0xe2, 'Mudo'], [0xcd, 'Play'], [0xb5, 'Próx.'], [0xb6, 'Ant.']]);
const stepIcons = { open: 'folder', website: 'globe', text: 'text', hotkey: 'keyboard', delay: 'clock' };
const newStep = type => ({
  open: { type, path: '', args: '' }, website: { type, url: '' }, text: { type, text: '' },
  hotkey: { type, mods: 0, code: null }, delay: { type, ms: 300 }
})[type];
const appAction = step => ({ kind: 'app', multi: false, steps: [newStep(step)] });
const library = [
  { title: 'Teclado', items: [{ id: 'key', name: 'Atalho de teclado', description: 'Combinação gravada no macropad', icon: 'keyboard', make: () => ({ kind: 'key', mods: 0, code: null }) }] },
  { title: 'Multimídia', items: [...media].map(([name, code]) => ({ id: `media-${code}`, name, icon: mediaIcons.get(code), make: () => ({ kind: 'media', media: code }) })) },
  {
    title: 'Sistema', app: true, items: [
      { id: 'open', name: 'Abrir', description: 'Arquivo, pasta ou programa', icon: 'folder', make: () => appAction('open') },
      { id: 'website', name: 'Site', description: 'Abre no navegador padrão', icon: 'globe', make: () => appAction('website') },
      { id: 'text', name: 'Digitar texto', description: 'Escreve um texto pronto', icon: 'text', make: () => appAction('text') },
      { id: 'multi', name: 'Multi-ação', description: 'Várias etapas em sequência', icon: 'multi', make: () => ({ kind: 'app', multi: true, steps: [] }) }
    ]
  },
  { title: 'Geral', items: [{ id: 'empty', name: 'Sem ação', description: 'Limpa o controle', icon: 'empty', make: () => ({ kind: 'empty' }) }] }
];
const actionById = new Map(library.flatMap(group => group.items.map(item => [item.id, item])));

const layerData = (number = state.layer) => state.layers[number - 1];
const bindingAt = (slot, layer = state.layer) => layerData(layer).drafts.get(slot) || layerData(layer).records.get(slot) || { kind: 'empty' };
const dirtyCount = () => state.layers.reduce((total, layer) => total + layer.drafts.size, 0);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const errorText = error => String(error?.message ?? error);
const normalize = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function controlInfo(slot) {
  if (slot >= 16) {
    const knob = Math.floor((slot - 16) / 3);
    return { name: `Knob ${knob + 1}`, part: ['Girar à direita', 'Pressionar', 'Girar à esquerda'][(slot - 16) % 3] };
  }
  const position = Array.from({ length: state.layout.keys }, (_, i) => keySlotForPosition(i, state.layout.keys)).indexOf(slot);
  return { name: `Tecla ${String(position + 1).padStart(2, '0')}` };
}
function controlLabel(slot) {
  const info = controlInfo(slot);
  return info.part ? `${info.name} · ${info.part}` : info.name;
}
// where: 'device' para ações gravadas no macropad, 'app' para as executadas por teclas virtuais.
function bindingMeta(binding) {
  if (binding.kind === 'key') return { title: 'Atalho de teclado', icon: 'keyboard', where: 'device' };
  if (binding.kind === 'media') return { title: mediaNames.get(binding.media) || 'Mídia', icon: mediaIcons.get(binding.media) || 'volumeUp', where: 'device' };
  if (binding.kind === 'app') {
    const type = binding.steps[0]?.type;
    return binding.multi ? { title: 'Multi-ação', icon: 'multi', where: 'app' }
      : { title: stepNames[type] || 'Ação do app', icon: stepIcons[type] || 'multi', where: 'app' };
  }
  if (binding.kind === 'raw') return { title: 'Ação existente', icon: 'warning', where: 'device' };
  return { title: 'Sem ação', icon: 'empty', where: null };
}
// Legenda como numa tecla impressa: ícone ou modificadores em cima, texto principal embaixo.
function legendFor(binding) {
  if (binding.kind === 'key') {
    const parts = comboLabel(binding.mods, binding.code);
    return [null, parts.pop() || '', parts.join(' ')];
  }
  if (binding.kind === 'media') return [mediaIcons.get(binding.media), mediaShort.get(binding.media)];
  if (binding.kind === 'app') {
    if (binding.multi) return ['multi', plural(binding.steps.length, 'etapa', 'etapas')];
    const step = binding.steps[0];
    return step ? [stepIcons[step.type], stepSummary(step)] : ['warning', 'Macro'];
  }
  if (binding.kind === 'raw') return ['warning', 'Existente'];
  return [null, ''];
}

function log(message) {
  const element = $('#log');
  if (element.textContent === 'Pronto.') element.textContent = '';
  element.textContent += `[${new Date().toLocaleTimeString('pt-BR')}] ${message}\n`;
  element.scrollTop = element.scrollHeight;
  $('#status-message').textContent = message;
}
function toast(message, tone = 'info') {
  const element = h('div', { class: `toast toast-${tone}`, role: tone === 'error' ? 'alert' : 'status' },
    icon(tone === 'error' ? 'warning' : tone === 'success' ? 'check' : 'info'), h('span', {}, message));
  $('#toasts').append(element);
  setTimeout(() => { element.classList.add('leaving'); setTimeout(() => element.remove(), 200); }, tone === 'error' ? 6000 : 3500);
}
function confirmDialog(title, text, confirmLabel = 'Confirmar') {
  const dialog = $('#confirm-modal');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = confirmLabel;
  dialog.showModal();
  $('#confirm-ok').focus();
  return new Promise(resolve => {
    const listeners = new AbortController();
    const done = value => { listeners.abort(); dialog.close(); resolve(value); };
    $('#confirm-ok').addEventListener('click', () => done(true), { signal: listeners.signal });
    $('#confirm-cancel').addEventListener('click', () => done(false), { signal: listeners.signal });
    dialog.addEventListener('cancel', event => { event.preventDefault(); done(false); }, { signal: listeners.signal });
  });
}

function setDraft(slot, next, { keepBody = false } = {}) {
  const layer = layerData();
  const original = layer.records.get(slot) || { kind: 'empty' };
  if (equalBinding(original, next)) layer.drafts.delete(slot);
  else layer.drafts.set(slot, next);
  renderBoard(); renderLayers(); renderChrome();
  if (keepBody) renderInspectorHead();
  else renderInspector();
}
function assign(slot, binding) {
  stopCapture();
  state.selected = slot;
  setDraft(slot, binding);
}
function swap(from, to) {
  const a = bindingAt(from), b = bindingAt(to);
  if (a.kind === 'raw' || b.kind === 'raw') { toast('Ações existentes do dispositivo não podem ser movidas.', 'error'); return; }
  state.selected = to;
  setDraft(from, structuredClone(b));
  setDraft(to, structuredClone(a));
}
function select(slot) {
  stopCapture();
  state.selected = slot;
  renderBoard();
  renderInspector();
}

// Pré-visualização física: teclas sem legenda impressa, salvo a opção "Legendas".
function makeDropTarget(element, slot) {
  element.addEventListener('dragover', event => {
    const { types } = event.dataTransfer;
    if (!types.includes(DRAG_ACTION) && !types.includes(DRAG_SLOT)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = types.includes(DRAG_SLOT) ? 'move' : 'copy';
    element.classList.add('drop-target');
  });
  element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
  element.addEventListener('drop', event => {
    event.preventDefault();
    element.classList.remove('drop-target');
    const item = actionById.get(event.dataTransfer.getData(DRAG_ACTION));
    const from = Number(event.dataTransfer.getData(DRAG_SLOT));
    if (item) assign(slot, item.make());
    else if (from && from !== slot) swap(from, slot);
  });
}
function controlButton(slot, className, ...content) {
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
  button.addEventListener('dragstart', event => { event.dataTransfer.setData(DRAG_SLOT, String(slot)); event.dataTransfer.effectAllowed = 'move'; });
  makeDropTarget(button, slot);
  return button;
}
function renderBoard() {
  const focused = document.activeElement?.dataset?.slot ? `.${document.activeElement.classList[0]}[data-slot="${document.activeElement.dataset.slot}"]` : null;
  const knobs = [], strip = [], keys = [];
  for (let i = 0; i < state.layout.knobs; i++) {
    knobs.push(h('div', { class: 'knob-unit' }, controlButton(knobSlot(i, 1), 'knob-press', h('span', { class: 'knob-indicator' }))));
    // O sentido físico deste modelo é inverso à ordem numérica dos slots.
    strip.push(h('div', { class: 'knob-group' }, h('span', { class: 'knob-group-label' }, `Knob ${i + 1}`), h('div', { class: 'knob-parts' },
      controlButton(knobSlot(i, 2), 'knob-part', icon('rotateLeft')),
      controlButton(knobSlot(i, 1), 'knob-part', icon('press')),
      controlButton(knobSlot(i, 0), 'knob-part', icon('rotateRight')))));
  }
  for (let i = 0; i < state.layout.keys; i++) {
    const slot = keySlotForPosition(i, state.layout.keys);
    if (!slot) continue;
    const [legendIcon, legendText, legendMods] = legendFor(bindingAt(slot));
    keys.push(controlButton(slot, 'keycap', h('span', { class: 'keycap-legend' },
      legendIcon ? icon(legendIcon) : null,
      legendMods ? h('small', {}, legendMods) : null,
      legendText ? h('span', {}, legendText) : null)));
  }
  $('#knobs').replaceChildren(...knobs);
  $('#knob-actions').replaceChildren(...strip);
  $('#keys').replaceChildren(...keys);
  $('#layout-name').textContent = `${state.layout.keys} teclas · ${state.layout.knobs} knobs`;
  if (focused) document.querySelector(focused)?.focus();
}
function flash(slot) {
  for (const element of document.querySelectorAll(`[data-slot="${slot}"]`)) {
    element.classList.add('pressed');
    setTimeout(() => element.classList.remove('pressed'), 220);
  }
}
function renderLayers() {
  $('#layers').replaceChildren(...state.layers.map((layer, index) => {
    const number = index + 1;
    return h('button', {
      type: 'button', role: 'radio', class: 'segment', 'aria-checked': String(number === state.layer), disabled: state.busy,
      'aria-label': layer.drafts.size ? `Camada ${number} · ${plural(layer.drafts.size, 'alteração não gravada', 'alterações não gravadas')}` : `Camada ${number}`,
      onclick: () => switchLayer(number)
    }, String(number), layer.drafts.size ? h('span', { class: 'segment-dot' }) : null);
  }));
}
function renderChrome() {
  const connected = state.connection === 'connected';
  document.body.dataset.view = state.everConnected || state.offline ? 'editor' : 'connect';

  const waiting = state.connection === 'searching' || state.connection === 'connecting';
  $('#connect-status').hidden = !waiting && state.connection !== 'error' && state.connection !== 'unsupported';
  $('#connect-status').classList.toggle('error', state.connection === 'error' || state.connection === 'unsupported');
  $('#connect-status').replaceChildren(
    waiting ? h('span', { class: 'spinner' }) : icon('warning'),
    h('span', {}, state.connection === 'connecting' ? 'Conectando…' : waiting ? 'Aguardando dispositivo…' : state.connectError)
  );
  $('#connect').hidden = transport.native ? state.connection !== 'error' : !transport.supported || waiting;
  $('#connect').textContent = state.connection === 'error' ? 'Tentar novamente' : 'Conectar dispositivo';
  $('#connect-text').textContent = transport.native
    ? 'Ligue o macropad ao computador pelo cabo USB. O Macropad Studio detecta o dispositivo automaticamente.'
    : 'Ligue o macropad pelo cabo USB, clique em Conectar e escolha USB Composite Device na janela do navegador.';

  $('#device-chip').classList.toggle('connected', connected);
  $('#device-name').textContent = connected ? 'Macropad conectado' : state.connection === 'connecting' ? 'Conectando…' : 'Desconectado';
  const count = dirtyCount();
  $('#sync-state').textContent = state.progress || (count ? plural(count, 'alteração não gravada', 'alterações não gravadas') : connected ? 'Tudo gravado' : '');
  $('#sync-state').classList.toggle('pending', Boolean(count) && !state.progress);
  $('#save').disabled = state.busy || !connected || !count;
  $('#read').disabled = state.busy || !connected;

  const banner = !connected && (state.everConnected
    ? 'Macropad desconectado. Suas alterações continuam aqui; reconecte o cabo para gravar.'
    : state.offline ? 'Modo sem dispositivo: prepare as ações e conecte o macropad para gravar.' : '');
  $('#banner').hidden = !banner;
  $('#banner-text').textContent = banner || '';
  $('#banner').querySelector('button')?.remove();
  if (banner && !transport.native && transport.supported) $('#banner').append(h('button', { type: 'button', class: 'btn btn-small', onclick: connect }, 'Conectar'));

  $('#status-device').replaceChildren(h('span', { class: `status-dot${connected ? ' on' : ''}` }), connected ? 'Conectado · USB 1189:8840' : 'Sem dispositivo');
  $('#status-mode').textContent = tauri ? `${plural(state.macros.length, 'tecla virtual ativa', 'teclas virtuais ativas')}` : 'Navegador · ações do app indisponíveis';
}

// Propriedades do controle selecionado.
function renderInspector() { renderInspectorHead(); renderInspectorBody(); }
function renderInspectorHead() {
  const slot = state.selected;
  if (!slot) { $('#inspector-head').replaceChildren(h('h2', { id: 'inspector-title', class: 'inspector-placeholder' }, 'Propriedades')); return; }
  const binding = bindingAt(slot), meta = bindingMeta(binding);
  // h() descarta os filhos nulos; replaceChildren os transformaria no texto "null".
  $('#inspector-head').replaceChildren(h('div', { class: 'inspector-head-row' },
    h('span', { class: `inspector-icon${meta.where === 'app' ? ' app' : ''}` }, icon(meta.icon)),
    h('div', { class: 'inspector-title' },
      h('div', { class: 'inspector-title-row' },
        h('h2', { id: 'inspector-title' }, meta.title),
        meta.where === 'device' ? h('span', { class: 'chip' }, icon('logo'), 'No macropad') : null,
        meta.where === 'app' ? h('span', { class: 'chip chip-app' }, icon('bolt'), 'Via app') : null,
        layerData().drafts.has(slot) ? h('span', { class: 'chip chip-pending' }, 'Não gravado') : null),
      h('p', {}, `${controlLabel(slot)} · Camada ${state.layer}`)),
    h('div', { class: 'inspector-tools' },
      binding.kind === 'app' && tauri ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => testBinding(bindingAt(slot)) }, icon('play'), 'Testar') : null,
      binding.kind !== 'empty' ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => setDraft(slot, { kind: 'empty' }) }, icon('trash'), 'Remover') : null)));
}
const emptyState = (title, text, name = 'empty') => h('div', { class: 'empty-state' }, h('span', { class: 'empty-icon' }, icon(name)), h('strong', {}, title), h('p', {}, text));
const keycaps = (mods, code) => h('div', { class: 'keycaps' }, comboLabel(mods, code).map(part => h('span', { class: 'keycap-chip' }, part)));
const aside = (title, text, ...extra) => h('aside', { class: 'inspector-aside' }, h('strong', {}, title), ...extra, h('p', {}, text));
const field = (label, ...control) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), h('div', { class: 'field-control' }, ...control));
const note = (text, tone = 'info') => h('p', { class: `note note-${tone}` }, icon(tone === 'warning' ? 'warning' : 'info'), h('span', {}, text));
function renderInspectorBody() {
  const slot = state.selected;
  const body = $('#inspector-body');
  if (!slot) {
    body.replaceChildren(emptyState('Selecione uma tecla ou um knob', 'Arraste uma ação da lista à direita até um controle, ou selecione o controle e clique na ação.', 'logo'));
    return;
  }
  const binding = bindingAt(slot);
  const onDevice = 'Fica na memória do macropad e funciona em qualquer computador, mesmo com o app fechado.';
  const layout = (main, side) => body.replaceChildren(h('div', { class: 'inspector-grid' }, h('div', { class: 'inspector-main' }, main), side));
  if (binding.kind === 'empty') body.replaceChildren(emptyState('Este controle está sem ação', 'Arraste uma ação da lista à direita até ele, ou clique em uma ação para atribuí-la.'));
  else if (binding.kind === 'key') {
    layout(h('div', { class: 'form' }, field('Combinação', comboControl(binding, combo => setDraft(slot, { kind: 'key', ...combo })))),
      aside('Gravado no macropad', onDevice, binding.code ? keycaps(binding.mods, binding.code) : null));
  } else if (binding.kind === 'media') {
    const select = h('select', { class: 'input', onchange: event => setDraft(slot, { kind: 'media', media: Number(event.target.value) }) },
      [...media].map(([name, code]) => h('option', { value: code, selected: code === binding.media }, name)));
    layout(h('div', { class: 'form' }, field('Ação', select)), aside('Gravado no macropad', onDevice));
  } else if (binding.kind === 'raw') {
    layout(note(`${binding.label}. Este editor não representa essa ação; ela será mantida até você atribuir outra.`, 'warning'),
      aside('Ação existente', 'Foi gravada por outro programa. Atribua uma nova ação para substituí-la.'));
  } else {
    const virtual = virtualCode(state.layer, slot);
    layout(appEditor(slot, binding), aside('Tecla virtual', tauri
      ? 'Ao gravar, o macropad passa a enviar esta tecla. O Macropad Studio a intercepta e executa a ação, mesmo minimizado na bandeja.'
      : 'Ações do app só funcionam no Macropad Studio para Windows.', keycaps(virtual.mods, virtual.code)));
  }
}
function kbdRow(mods, code, placeholder) {
  const parts = comboLabel(mods, code);
  return parts.length ? parts.map(part => h('kbd', {}, part)) : [h('span', { class: 'placeholder' }, placeholder)];
}
function comboControl(value, onChange) {
  return h('div', { class: 'combo-control' }, shortcutField(value, onChange),
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => openKeyboard(value, onChange) }, icon('keyboard'), 'Teclado virtual'));
}
let capture = null;
function shortcutField(value, onChange) {
  const element = h('button', { type: 'button', class: 'shortcut-field' },
    ...kbdRow(value.mods, value.code, 'Clique e pressione a combinação'));
  element.addEventListener('click', () => startCapture(element, onChange));
  return element;
}
function startCapture(element, onChange) {
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
function stopCapture() { capture?.(); capture = null; }

function appEditor(slot, binding) {
  // Lê sempre a versão atual: os campos de texto não redesenham o painel a cada tecla.
  const setSteps = (change, rerender = false) => {
    const current = bindingAt(slot);
    const steps = structuredClone(current.steps);
    change(steps);
    setDraft(slot, { ...current, steps }, { keepBody: !rerender });
  };
  const edit = (index, patch, rerender) => setSteps(steps => Object.assign(steps[index], patch), rerender);
  return binding.multi ? stepList(binding, edit, setSteps) : [h('div', { class: 'form' }, stepFields(binding.steps[0], 0, edit))];
}
function stepFields(step, index, edit) {
  if (step.type === 'open') {
    const browse = folder => async () => {
      const path = await invoke?.('pick_path', { folder });
      if (path) edit(index, { path }, true);
    };
    return [
      field('Caminho', h('div', { class: 'input-group' },
        h('input', { class: 'input', value: step.path, placeholder: 'C:\\Programas\\app.exe', spellcheck: 'false', oninput: event => edit(index, { path: event.target.value }) }),
        h('button', { type: 'button', class: 'btn btn-small', disabled: !tauri, onclick: browse(false) }, 'Arquivo…'),
        h('button', { type: 'button', class: 'btn btn-small', disabled: !tauri, onclick: browse(true) }, 'Pasta…'))),
      field('Argumentos', h('input', { class: 'input', value: step.args, placeholder: 'Opcional', spellcheck: 'false', oninput: event => edit(index, { args: event.target.value }) }))
    ];
  }
  if (step.type === 'website') {
    return [field('Endereço', h('input', {
      class: 'input', type: 'url', value: step.url, placeholder: 'https://', spellcheck: 'false',
      oninput: event => edit(index, { url: event.target.value }),
      onchange: event => {
        const url = event.target.value.trim();
        if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) { event.target.value = `https://${url}`; edit(index, { url: event.target.value }); }
      }
    }))];
  }
  if (step.type === 'text') return [field('Texto', h('textarea', { class: 'input', rows: 3, value: step.text, placeholder: 'Texto que será digitado na janela em foco', oninput: event => edit(index, { text: event.target.value }) }))];
  if (step.type === 'hotkey') return [field('Combinação', comboControl(step, combo => edit(index, combo, true)))];
  return [field('Aguardar', h('div', { class: 'input-group input-short' },
    h('input', { class: 'input', type: 'number', min: 0, max: 60000, step: 50, value: step.ms, oninput: event => edit(index, { ms: Math.max(0, Math.min(60000, Number(event.target.value) || 0)) }) }),
    h('span', { class: 'input-suffix' }, 'ms')))];
}
function stepList(binding, edit, setSteps) {
  const last = binding.steps.length - 1;
  const tool = (name, label, disabled, action) => h('button', { type: 'button', class: 'btn btn-icon btn-tiny', 'aria-label': label, disabled, onclick: action }, icon(name));
  const items = binding.steps.map((step, index) => h('li', { class: 'step' },
    h('div', { class: 'step-head' },
      h('span', { class: 'step-index' }, String(index + 1)), icon(stepIcons[step.type]), h('strong', {}, stepNames[step.type]),
      h('span', { class: 'step-tools' },
        tool('arrowUp', 'Mover para cima', index === 0, () => setSteps(steps => steps.splice(index - 1, 0, ...steps.splice(index, 1)), true)),
        tool('arrowDown', 'Mover para baixo', index === last, () => setSteps(steps => steps.splice(index + 1, 0, ...steps.splice(index, 1)), true)),
        tool('trash', 'Remover etapa', false, () => setSteps(steps => steps.splice(index, 1), true)))),
    h('div', { class: 'form' }, stepFields(step, index, edit))));
  const add = h('select', { class: 'input add-step', 'aria-label': 'Adicionar etapa', onchange: event => setSteps(steps => steps.push(newStep(event.target.value)), true) },
    h('option', { value: '' }, '+ Adicionar etapa'), Object.entries(stepNames).map(([type, name]) => h('option', { value: type }, name)));
  return [
    items.length ? h('ol', { class: 'step-list' }, items) : emptyState('Nenhuma etapa', 'Adicione etapas para executá-las em sequência: abrir um programa, aguardar, digitar um texto…'),
    add
  ];
}
async function testBinding(binding) {
  const error = appBindingError(binding);
  if (error) { toast(error, 'error'); return; }
  // Texto e atalhos vão para a janela em foco; damos tempo para trocar de janela.
  const typed = binding.steps.some(step => step.type === 'text' || step.type === 'hotkey');
  if (typed) toast('Mude para a janela de destino: a ação começa em 3 segundos.');
  try { await invoke('macro_test', { steps: typed ? [{ type: 'delay', ms: 3000 }, ...binding.steps] : binding.steps }); }
  catch (failure) { toast(errorText(failure), 'error'); }
}

// Biblioteca de ações.
function renderLibrary() {
  const query = normalize($('#action-search').value.trim());
  const groups = library.map(group => {
    const items = group.items.filter(item => !query || normalize(`${item.name} ${item.description || ''} ${group.title}`).includes(query));
    if (!items.length) return null;
    const details = h('details', { class: 'action-group', open: query || !state.collapsed.has(group.title) },
      h('summary', {}, icon('chevron', 'icon chevron'), h('span', {}, group.title), group.app ? h('span', { class: 'badge' }, 'App') : null),
      items.map(item => actionItem(item, group)));
    details.addEventListener('toggle', () => { if (!query) state.collapsed[details.open ? 'delete' : 'add'](group.title); });
    return details;
  }).filter(Boolean);
  $('#action-list').replaceChildren(...(groups.length ? groups : [h('p', { class: 'library-empty' }, 'Nenhuma ação encontrada.')]));
}
function actionItem(item, group) {
  const unavailable = group.app && !tauri;
  const button = h('button', {
    type: 'button', class: 'action-item', draggable: unavailable ? null : 'true', disabled: unavailable
  }, h('span', { class: 'action-icon' }, icon(item.icon)), h('span', { class: 'action-text' }, h('span', {}, item.name), item.description ? h('small', {}, item.description) : null));
  button.addEventListener('click', () => {
    if (!state.selected) { toast('Selecione uma tecla ou um knob primeiro.'); return; }
    assign(state.selected, item.make());
  });
  button.addEventListener('dragstart', event => { event.dataTransfer.setData(DRAG_ACTION, item.id); event.dataTransfer.effectAllowed = 'copy'; });
  return button;
}

// Menu de contexto e atalhos do editor.
function closeContextMenu() { $('#context-menu').hidden = true; }
function openContextMenu(x, y) {
  const binding = bindingAt(state.selected);
  const item = (label, shortcut, disabled, action) => h('button', { type: 'button', role: 'menuitem', disabled, onclick: () => { closeContextMenu(); action(); } },
    h('span', {}, label), shortcut ? h('kbd', {}, shortcut) : null);
  const testable = binding.kind === 'app' && tauri;
  const menu = $('#context-menu');
  menu.replaceChildren(...[
    item('Copiar', 'Ctrl+C', binding.kind === 'empty' || binding.kind === 'raw', copySelected),
    item('Colar', 'Ctrl+V', !state.clipboard, pasteSelected),
    item('Limpar', 'Del', binding.kind === 'empty', clearSelected),
    testable ? h('hr') : null,
    testable ? item('Testar ação', '', false, () => testBinding(binding)) : null
  ].filter(Boolean));
  menu.hidden = false;
  menu.style.left = `${Math.min(x, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - menu.offsetHeight - 8)}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}
function copySelected() {
  const binding = bindingAt(state.selected);
  if (binding.kind === 'empty' || binding.kind === 'raw') return;
  state.clipboard = structuredClone(binding);
  toast(`${labelFor(binding)} copiado.`);
}
function pasteSelected() { if (state.clipboard) assign(state.selected, structuredClone(state.clipboard)); }
function clearSelected() { setDraft(state.selected, { kind: 'empty' }); }

// Teclado virtual para combinações que o Windows não deixa capturar (Win, Alt+Tab…).
let keyboardTarget = null;
function openKeyboard(value, onChange) {
  stopCapture();
  keyboardTarget = { value: { mods: value.mods || 0, code: value.code ?? null }, onChange };
  renderKeyboardState();
  $('#keyboard-modal').showModal();
}
function closeKeyboard(commit) {
  if (commit && !keyNames.has(keyboardTarget.value.code)) { toast('Escolha a tecla principal da combinação.', 'error'); return; }
  $('#keyboard-modal').close();
  if (commit) keyboardTarget.onChange({ ...keyboardTarget.value });
  keyboardTarget = null;
}
function renderKeyboardState() {
  const { mods, code } = keyboardTarget.value;
  for (const button of document.querySelectorAll('[data-mod]')) button.setAttribute('aria-pressed', String(Boolean(mods & Number(button.dataset.mod))));
  for (const button of document.querySelectorAll('[data-code]')) button.setAttribute('aria-pressed', String(code === Number(button.dataset.code)));
  $('#keyboard-summary').replaceChildren(mods || code ? keycaps(mods, code) : h('span', { class: 'placeholder' }, 'Nenhuma tecla'));
}
function virtualKey(spec) {
  // Teclas com uma letra ou símbolo têm legenda grande; nomes como "Shift" vão menores, embaixo.
  // Espaço e setas têm a legenda centralizada.
  const word = [...spec.label].length > 1;
  const centered = [0x2c, 0x4f, 0x50, 0x51, 0x52].includes(spec.code);
  const button = h('button', { type: 'button', class: `virtual-key${word ? ' word' : ''}${centered ? ' centered' : ''}`, 'aria-pressed': 'false' }, h('span', { class: 'key-label' }, spec.label));
  button.style.setProperty('--span', spec.span);
  if (spec.mod !== undefined) {
    button.classList.add('modifier');
    button.dataset.mod = String(spec.mod);
    button.setAttribute('aria-label', `Modificar atalho com ${spec.label}`);
  } else {
    button.dataset.code = String(spec.code);
    button.setAttribute('aria-label', `Tecla ${spec.label}${spec.code >= 0x53 && spec.code <= 0x63 ? ' do teclado numérico' : ''}`);
  }
  button.addEventListener('click', () => {
    const value = keyboardTarget.value;
    if (spec.mod !== undefined) value.mods ^= spec.mod;
    else value.code = spec.code;
    renderKeyboardState();
  });
  return button;
}
function renderKeyboard() {
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

// Comunicação com o dispositivo.
function setBusy(busy) {
  state.busy = busy;
  if (!busy) state.progress = '';
  renderChrome();
  renderLayers();
}
function macroBinding(layer, slot) {
  const saved = state.macros.find(item => item.layer === layer && item.slot === slot);
  return { kind: 'app', multi: Boolean(saved?.multi), steps: saved ? structuredClone(saved.steps) : [] };
}
async function readLayer(number, discardDrafts = false) {
  const expected = state.layout.keys + state.layout.knobs * 3;
  const replies = await transport.ask([0xfa, state.layout.keys, state.layout.knobs, number], expected, 2800);
  const knownSlots = new Set([
    ...Array.from({ length: state.layout.keys }, (_, i) => i + 1),
    ...Array.from({ length: state.layout.knobs * 3 }, (_, i) => 16 + i)
  ]);
  const records = new Map();
  for (const reply of replies) {
    if (reply[0] !== 0xfa || !knownSlots.has(reply[1])) continue;
    const binding = decode(reply, number);
    records.set(reply[1], binding.kind === 'app' ? macroBinding(number, reply[1]) : binding);
  }
  if (records.size !== expected) throw new Error(`Leitura incompleta da camada ${number}: ${records.size}/${expected} controles. Os dados anteriores foram mantidos.`);
  const layer = layerData(number);
  layer.records = records;
  layer.loaded = true;
  if (discardDrafts) layer.drafts.clear();
  for (const [slot, draft] of layer.drafts) if (equalBinding(records.get(slot), draft)) layer.drafts.delete(slot);
  renderBoard(); renderLayers(); renderChrome(); renderInspector();
  log(`Camada ${number}: ${records.size} ações lidas.`);
  return records;
}
async function connect() {
  if (state.busy || state.connection === 'connected') return;
  state.connection = 'connecting';
  setBusy(true);
  try {
    await transport.connect();
    await transport.send([]);
    const replies = await transport.ask([0xfb, 0xfb, 0xfb], 1, 900);
    const layout = replies.find(reply => reply[0] === 0xfb);
    if (!layout || layout[1] < 1 || layout[1] > 15 || layout[2] > 3) throw new Error('O dispositivo não confirmou um layout compatível.');
    state.layout = { keys: layout[1], knobs: layout[2] };
    for (const layer of state.layers) layer.loaded = false;
    state.connection = 'connected';
    state.everConnected = true;
    log(`Macropad conectado: ${layout[1]} teclas, ${layout[2]} knobs.`);
  } catch (error) {
    const message = errorText(error);
    if (message.startsWith(NOT_FOUND)) state.connection = state.everConnected ? 'disconnected' : 'searching';
    else if (!transport.native && message.startsWith('Nenhuma interface')) state.connection = state.everConnected ? 'disconnected' : 'idle';
    else { state.connection = state.everConnected ? 'disconnected' : 'error'; state.connectError = message; log(`Conexão: ${message}`); }
    setBusy(false);
    renderBoard();
    return;
  }
  try { await readLayer(state.layer); }
  catch (error) { log(errorText(error)); toast(errorText(error), 'error'); }
  finally { setBusy(false); }
}
function onDeviceChange(present) {
  if (present) { connect(); return; }
  if (state.connection === 'connected') { log('Dispositivo desconectado.'); toast('Macropad desconectado.', 'error'); }
  state.connection = state.everConnected ? 'disconnected' : transport.native ? 'searching' : 'idle';
  renderChrome();
}
async function readCurrent() {
  if (state.connection !== 'connected' || state.busy) return;
  const layer = layerData();
  if (layer.drafts.size && !await confirmDialog('Descartar alterações?', `As ${plural(layer.drafts.size, 'alteração não gravada', 'alterações não gravadas')} da camada ${state.layer} serão substituídas pelo que está no macropad.`, 'Ler dispositivo')) return;
  setBusy(true);
  try { await readLayer(state.layer, true); }
  catch (error) { log(errorText(error)); toast(errorText(error), 'error'); }
  finally { setBusy(false); }
}
async function switchLayer(number) {
  if (number === state.layer || state.busy) return;
  stopCapture();
  state.layer = number;
  renderBoard(); renderLayers(); renderInspector();
  if (state.connection === 'connected' && !layerData(number).loaded) {
    setBusy(true);
    try { await readLayer(number); }
    catch (error) { log(errorText(error)); toast(errorText(error), 'error'); }
    finally { setBusy(false); }
  }
}
async function persistMacros(changes) {
  const touched = new Set(changes.map(change => `${change.layer}:${change.slot}`));
  const macros = state.macros.filter(item => !touched.has(`${item.layer}:${item.slot}`));
  for (const change of changes) {
    if (change.binding.kind !== 'app') continue;
    macros.push({ layer: change.layer, slot: change.slot, ...virtualCode(change.layer, change.slot), multi: Boolean(change.binding.multi), steps: change.binding.steps });
  }
  await invoke('macros_save', { macros });
  state.macros = macros;
}
async function save() {
  if (state.connection !== 'connected' || state.busy || !dirtyCount()) return;
  let changes;
  try {
    // Valida tudo antes de enviar o primeiro pacote ao dispositivo.
    changes = state.layers.flatMap((layer, index) => [...layer.drafts].map(([slot, binding]) => {
      const number = index + 1;
      if (binding.kind === 'app') {
        const error = tauri ? appBindingError(binding) : 'ações do app exigem o Macropad Studio para Windows.';
        if (error) throw new Error(`Camada ${number}, ${controlLabel(slot)}: ${error}`);
      }
      // Se o slot já envia sua tecla virtual, basta atualizar as etapas no app.
      const programmed = binding.kind === 'app' && layer.records.get(slot)?.kind === 'app';
      return { layer: number, slot, binding, payload: programmed ? null : encode(slot, number, binding) };
    }));
  } catch (error) { toast(error.message, 'error'); return; }
  const writes = changes.filter(change => change.payload);
  const text = writes.length
    ? `${plural(writes.length, 'controle será gravado', 'controles serão gravados')} no macropad, substituindo a configuração atual.`
    : 'As etapas ficam salvas no app; o macropad já envia as teclas virtuais desses controles.';
  if (!await confirmDialog(`Gravar ${plural(changes.length, 'alteração', 'alterações')}?`, text, 'Gravar')) return;
  setBusy(true);
  try {
    if (tauri) await persistMacros(changes);
    for (const change of changes.filter(item => !item.payload)) {
      layerData(change.layer).records.set(change.slot, structuredClone(change.binding));
      layerData(change.layer).drafts.delete(change.slot);
    }
    for (const [index, change] of writes.entries()) {
      state.progress = `Gravando ${index + 1}/${writes.length}…`;
      renderChrome();
      await transport.send(change.payload);
      await transport.send([0xaa, 0xaa]);
      await transport.send([0xfd, 0xfe, 0xff]);
      await transport.send([0xaa, 0xaa]);
      log(`Gravado: camada ${change.layer}, slot ${change.slot}.`);
    }
    state.progress = 'Verificando…';
    renderChrome();
    let verified = changes.length - writes.length;
    for (const number of new Set(writes.map(change => change.layer))) {
      const records = await readLayer(number);
      verified += writes.filter(change => change.layer === number && equalBinding(records.get(change.slot), change.binding)).length;
    }
    log(`${verified}/${changes.length} alterações confirmadas.`);
    if (verified === changes.length) toast(`${plural(verified, 'alteração gravada', 'alterações gravadas')}.`, 'success');
    else toast(`O dispositivo confirmou ${verified} de ${changes.length} alterações. As demais continuam marcadas para revisão.`, 'error');
  } catch (error) {
    log(`Gravação interrompida: ${errorText(error)}`);
    toast(`Gravação interrompida: ${errorText(error)}`, 'error');
  } finally {
    setBusy(false);
    renderBoard(); renderInspector();
  }
}

async function openSettings() {
  $('#settings-app').hidden = !tauri;
  if (tauri) $('#autostart').checked = await invoke('autostart_get').catch(() => false);
  $('#settings-modal').showModal();
}
function setLegends(visible) {
  document.body.classList.toggle('no-legends', !visible);
  try { localStorage.setItem('legends', visible ? '1' : '0'); } catch {}
}

async function initialize() {
  for (const element of document.querySelectorAll('[data-icon]')) element.prepend(icon(element.dataset.icon));
  let legends = true;
  try { legends = localStorage.getItem('legends') !== '0'; } catch {}
  $('#legends').checked = legends;
  setLegends(legends);
  $('#library-note').textContent = tauri
    ? 'Ações marcadas com App rodam no Macropad Studio por meio de teclas virtuais. As demais ficam gravadas no macropad.'
    : 'No navegador, apenas ações gravadas no macropad estão disponíveis.';
  renderKeyboard(); renderLibrary();

  $('#legends').addEventListener('change', event => setLegends(event.target.checked));
  $('#action-search').addEventListener('input', renderLibrary);
  $('#connect').addEventListener('click', connect);
  $('#offline').addEventListener('click', () => { state.offline = true; renderChrome(); });
  $('#read').addEventListener('click', readCurrent);
  $('#save').addEventListener('click', save);
  $('#open-settings').addEventListener('click', openSettings);
  $('#close-settings').addEventListener('click', () => $('#settings-modal').close());
  $('#autostart').addEventListener('change', async event => {
    try { await invoke('autostart_set', { enabled: event.target.checked }); }
    catch (error) { event.target.checked = !event.target.checked; toast(errorText(error), 'error'); }
  });
  $('#clear-log').addEventListener('click', () => { $('#log').textContent = 'Pronto.'; });
  $('#close-keyboard').addEventListener('click', () => closeKeyboard(false));
  $('#cancel-keyboard').addEventListener('click', () => closeKeyboard(false));
  $('#confirm-keyboard').addEventListener('click', () => closeKeyboard(true));
  $('#keyboard-modal').addEventListener('cancel', event => { event.preventDefault(); closeKeyboard(false); });
  for (const dialog of document.querySelectorAll('#keyboard-modal, #settings-modal')) {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      if (dialog.id === 'keyboard-modal') closeKeyboard(false);
      else dialog.close();
    });
  }
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#context-menu')) closeContextMenu(); });
  window.addEventListener('blur', closeContextMenu);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeContextMenu();
    if (!state.selected || document.querySelector('dialog[open]') || event.target.closest('input, textarea, select')) return;
    if (event.ctrlKey && event.code === 'KeyC') { event.preventDefault(); copySelected(); }
    else if (event.ctrlKey && event.code === 'KeyV') { event.preventDefault(); pasteSelected(); }
    else if (event.key === 'Delete') { event.preventDefault(); clearSelected(); }
  });

  if (tauri) {
    state.macros = await invoke('macros_get').catch(() => []);
    tauri.event.listen('macro-fired', ({ payload: [layer, slot] }) => {
      if (layer === state.layer) flash(slot);
      log(`Tecla virtual: camada ${layer}, ${controlLabel(slot)}.`);
    });
    tauri.event.listen('macro-error', ({ payload }) => { log(`Ação do app: ${payload}`); toast(payload, 'error'); });
  }
  transport.onChange(onDeviceChange);
  if (!transport.supported) { state.connection = 'unsupported'; state.connectError = 'Abra no Chrome ou Edge, ou use o Macropad Studio para Windows.'; }
  else if (!transport.native) state.connection = 'idle';
  renderBoard(); renderLayers(); renderChrome(); renderInspector();
  if (transport.native) connect();
}
initialize();
