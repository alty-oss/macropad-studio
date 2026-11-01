const DEVICE = { vendorId: 0x1189, productId: 0x8840, usagePage: 0xff00, usage: 1, reportId: 3, reportLength: 64 };
const $ = selector => document.querySelector(selector);
const state = {
  device: null,
  layout: { keys: 12, knobs: 3 },
  layer: 1,
  selected: null,
  modalInitial: null,
  collector: null,
  busy: false,
  layers: Array.from({ length: 3 }, () => ({ records: new Map(), drafts: new Map(), loaded: false }))
};

const media = new Map([
  ['Volume +', 0x00e9], ['Volume −', 0x00ea], ['Silenciar', 0x00e2],
  ['Tocar / pausar', 0x00cd], ['Próxima faixa', 0x00b5], ['Faixa anterior', 0x00b6]
]);
const mediaNames = new Map([...media].map(([name, code]) => [code, name]));
const keyNames = new Map();
const K = (label, code, span = 1) => ({ label, code, span });
const M = (label, mod, span = 1) => ({ label, mod, span });
const letters = row => [...row].map(label => K(label, 4 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(label)));
const numberKeys = [...'1234567890'].map((label, index) => K(label, 0x1e + index));
const functionGroups = [
  [K('Esc', 0x29)],
  Array.from({ length: 4 }, (_, i) => K(`F${i + 1}`, 0x3a + i)),
  Array.from({ length: 4 }, (_, i) => K(`F${i + 5}`, 0x3e + i)),
  Array.from({ length: 4 }, (_, i) => K(`F${i + 9}`, 0x42 + i)),
  [K('PrtSc', 0x46), K('Scroll', 0x47), K('Pause', 0x48)]
];
const mainRows = [
  [K('`', 0x35), ...numberKeys, K('-', 0x2d), K('=', 0x2e), K('Backspace', 0x2a, 2)],
  [K('Tab', 0x2b, 1.5), ...letters('QWERTYUIOP'), K('[', 0x2f), K(']', 0x30), K('\\', 0x31, 1.5)],
  [K('Caps', 0x39, 1.75), ...letters('ASDFGHJKL'), K(';', 0x33), K("'", 0x34), K('Enter', 0x28, 2.25)],
  [M('Shift', 2, 2.25), ...letters('ZXCVBNM'), K(',', 0x36), K('.', 0x37), K('/', 0x38), M('Shift D', 0x20, 2.75)],
  [M('Ctrl', 1, 1.5), M('Win', 8, 1.25), M('Alt', 4, 1.25), K('Espaço', 0x2c, 6), M('AltGr', 0x40, 1.25), M('Win D', 0x80, 1.25), K('Menu', 0x65, 1.25), M('Ctrl D', 0x10, 1.5)]
];
const navigationRows = [
  [K('Ins', 0x49), K('Home', 0x4a), K('PgUp', 0x4b)],
  [K('Del', 0x4c), K('End', 0x4d), K('PgDn', 0x4e)],
  [K('↑', 0x52)],
  [K('←', 0x50), K('↓', 0x51), K('→', 0x4f)]
];
const numpadKeys = [
  K('Num', 0x53), K('/', 0x54), K('*', 0x55), K('-', 0x56),
  K('7', 0x5f), K('8', 0x60), K('9', 0x61), { ...K('+', 0x57), tall: true },
  K('4', 0x5c), K('5', 0x5d), K('6', 0x5e),
  K('1', 0x59), K('2', 0x5a), K('3', 0x5b), { ...K('Enter', 0x58), tall: true },
  { ...K('0', 0x62), wide: true }, K('.', 0x63)
];
for (const spec of [...functionGroups.flat(), ...mainRows.flat(), ...navigationRows.flat(), ...numpadKeys]) {
  if (spec.code !== undefined && !keyNames.has(spec.code)) keyNames.set(spec.code, spec.label);
}
const modifierOptions = [['Ctrl', 1], ['Shift', 2], ['Alt', 4], ['Win', 8], ['Ctrl D', 0x10], ['Shift D', 0x20], ['AltGr', 0x40], ['Win D', 0x80]];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const layerData = (number = state.layer) => state.layers[number - 1];
const knobSlot = (index, action) => 16 + index * 3 + action;
// Nesta orientação física, as teclas são numeradas pelo firmware por coluna,
// de baixo para cima: linha superior 4/8/12, linha inferior 1/5/9.
function keySlotForPosition(index, keyCount = state.layout.keys) {
  const rows = Math.ceil(keyCount / 3);
  const row = Math.floor(index / 3);
  const column = index % 3;
  const slot = column * rows + (rows - row);
  return slot <= keyCount ? slot : null;
}
const bindingAt = (slot, layer = state.layer) => layerData(layer).drafts.get(slot) || layerData(layer).records.get(slot) || { kind: 'empty' };

function log(message) {
  const element = $('#log');
  if (element.textContent === 'Pronto.') element.textContent = '';
  element.textContent += `[${new Date().toLocaleTimeString('pt-BR')}] ${message}\n`;
  element.scrollTop = element.scrollHeight;
}
function hex(data) { return [...data].map(value => value.toString(16).padStart(2, '0')).join(' '); }
function setStatus(message, connected = false) {
  $('#connection-indicator').classList.toggle('connected', connected);
  $('#connection-indicator').lastChild.textContent = connected ? 'Conectado' : 'Desconectado';
  $('#device-status').textContent = message;
  $('.device-foot').classList.toggle('connected', connected);
}
function setBusy(busy) {
  state.busy = busy;
  $('#connect').disabled = busy || !('hid' in navigator);
  $('#layer').disabled = busy || !state.device;
  $('#read').disabled = busy || !state.device;
  $('#save').disabled = busy || !state.device || !dirtyCount();
}
function dirtyCount() { return state.layers.reduce((total, layer) => total + layer.drafts.size, 0); }
function updateSave() {
  const count = dirtyCount();
  $('#save-count').textContent = count ? `(${count})` : '';
  $('#save').disabled = state.busy || !state.device || !count;
}
function labelFor(binding) {
  if (binding.kind === 'key') {
    const parts = modifierOptions.filter(([, bit]) => binding.mods & bit).map(([name]) => name);
    if (binding.code) parts.push(keyNames.get(binding.code) || `0x${binding.code.toString(16)}`);
    return parts.join(' + ') || 'Escolha uma tecla';
  }
  if (binding.kind === 'media') return mediaNames.get(binding.media) || 'Mídia';
  if (binding.kind === 'raw') return binding.label || 'Ação existente';
  return 'Sem ação';
}
function equalBinding(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'key') return a.mods === b.mods && a.code === b.code;
  if (a.kind === 'media') return a.media === b.media;
  return a.kind === 'empty';
}
function setDraft(slot, next) {
  const layer = layerData();
  const original = layer.records.get(slot) || { kind: 'empty' };
  if (equalBinding(original, next)) layer.drafts.delete(slot);
  else layer.drafts.set(slot, next);
  renderBoard();
  renderEditor();
  updateSave();
}

function buttonFor(slot, className, label, content) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.slot = String(slot);
  button.setAttribute('aria-label', `${label}: ${labelFor(bindingAt(slot))}`);
  button.title = `${label} · ${labelFor(bindingAt(slot))}`;
  button.setAttribute('aria-pressed', String(state.selected?.slot === slot));
  if (state.selected?.slot === slot) button.classList.add('selected');
  if (layerData().drafts.has(slot)) button.classList.add('dirty');
  button.append(content);
  button.addEventListener('click', () => selectControl(slot, label));
  return button;
}
function span(text, className) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}
function renderBoard() {
  const knobs = $('#knobs'), keys = $('#keys'), actions = $('#knob-actions');
  knobs.replaceChildren();
  keys.replaceChildren();
  actions.replaceChildren();
  for (let i = 0; i < state.layout.knobs; i++) {
    const unit = document.createElement('div');
    unit.className = 'knob-unit';
    const press = buttonFor(knobSlot(i, 1), 'knob-press', `Controle ${i + 1}, pressionar`, span('', 'knob-indicator'));
    unit.append(press);
    knobs.append(unit);
    const group = document.createElement('div');
    group.className = 'knob-action-group';
    group.append(span(`Rodinha ${i + 1}`, 'knob-action-label'));
    const choices = document.createElement('div');
    choices.className = 'knob-action-row';
    // O sentido físico deste modelo é inverso à ordem numérica dos slots.
    choices.append(
      buttonFor(knobSlot(i, 2), 'knob-action', `Rodinha ${i + 1}, girar à esquerda`, document.createTextNode('↶')),
      buttonFor(knobSlot(i, 1), 'knob-action', `Rodinha ${i + 1}, pressionar`, document.createTextNode('●')),
      buttonFor(knobSlot(i, 0), 'knob-action', `Rodinha ${i + 1}, girar à direita`, document.createTextNode('↷'))
    );
    group.append(choices);
    actions.append(group);
  }
  for (let i = 0; i < state.layout.keys; i++) {
    const slot = keySlotForPosition(i);
    if (!slot) continue;
    keys.append(buttonFor(slot, 'keycap', `Tecla na posição ${i + 1}`, document.createTextNode('')));
  }
  $('#layout-name').textContent = `${state.layout.keys} teclas · ${state.layout.knobs} controles`;
}
function selectControl(slot, label) {
  state.selected = { slot, label };
  const layer = layerData();
  state.modalInitial = { slot, layer: state.layer, hadDraft: layer.drafts.has(slot), draft: layer.drafts.get(slot) };
  renderBoard();
  renderEditor();
  if (!$('#editor-modal').open) $('#editor-modal').showModal();
}
function cancelEditor() {
  const original = state.modalInitial;
  if (original) {
    const drafts = layerData(original.layer).drafts;
    if (original.hadDraft) drafts.set(original.slot, original.draft);
    else drafts.delete(original.slot);
  }
  state.modalInitial = null;
  $('#editor-modal').close();
  renderBoard(); renderEditor(); updateSave();
  focusSelectedBoard();
}
function finishEditor() {
  const binding = bindingAt(state.selected.slot);
  if (binding.kind === 'key' && !keyNames.has(binding.code)) {
    $('#editor-note').textContent = 'Escolha uma tecla principal no teclado para concluir.';
    return;
  }
  state.modalInitial = null;
  $('#editor-modal').close();
  renderBoard(); renderEditor(); updateSave();
  focusSelectedBoard();
}
function focusSelectedBoard() {
  const slot = state.selected?.slot;
  if (slot) requestAnimationFrame(() => document.querySelector(`[data-slot="${slot}"]`)?.focus());
}
function virtualKey(spec) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'virtual-key';
  button.textContent = spec.label;
  button.style.setProperty('--span', spec.span);
  button.setAttribute('aria-pressed', 'false');
  if (spec.mod !== undefined) {
    button.classList.add('modifier');
    button.dataset.mod = String(spec.mod);
    button.setAttribute('aria-label', `Modificar atalho com ${spec.label}`);
  } else {
    button.dataset.code = String(spec.code);
    button.setAttribute('aria-label', `Tecla ${spec.label}${spec.code >= 0x53 && spec.code <= 0x63 ? ' do teclado numérico' : ''}`);
  }
  button.addEventListener('click', () => {
    if (!state.selected) return;
    const current = bindingAt(state.selected.slot);
    if (spec.mod !== undefined) {
      setDraft(state.selected.slot, { kind: 'key', mods: (current.kind === 'key' ? current.mods : 0) ^ spec.mod, code: current.kind === 'key' ? current.code : null });
    } else {
      setDraft(state.selected.slot, { kind: 'key', mods: current.kind === 'key' ? current.mods : 0, code: spec.code });
    }
  });
  return button;
}
function renderKeyboard() {
  const root = $('#virtual-keyboard');
  const top = document.createElement('div');
  top.className = 'function-row';
  for (const group of functionGroups) {
    const element = document.createElement('div');
    element.className = 'function-group';
    for (const key of group) element.append(virtualKey(key));
    top.append(element);
  }
  const columns = document.createElement('div');
  columns.className = 'keyboard-columns';
  const main = document.createElement('div');
  main.className = 'keyboard-main';
  for (const row of mainRows) {
    const element = document.createElement('div');
    element.className = 'keyboard-row';
    for (const key of row) element.append(virtualKey(key));
    main.append(element);
  }
  const navigation = document.createElement('div');
  navigation.className = 'navigation-cluster';
  for (const [index, row] of navigationRows.entries()) {
    const element = document.createElement('div');
    element.className = 'navigation-row';
    if (index === 2) element.classList.add('arrow-up');
    if (index === 2) element.classList.add('arrow-cluster');
    for (const key of row) element.append(virtualKey(key));
    navigation.append(element);
  }
  const numpad = document.createElement('div');
  numpad.className = 'numpad-grid';
  for (const key of numpadKeys) {
    const button = virtualKey(key);
    if (key.tall) button.classList.add('tall');
    if (key.wide) button.classList.add('span-two');
    numpad.append(button);
  }
  columns.append(main, navigation, numpad);
  root.append(top, columns);
}
function renderEditor() {
  const selected = state.selected;
  $('#selection-heading').textContent = selected ? selected.label : 'Clique em uma tecla';
  $('#selection-value').textContent = selected ? labelFor(bindingAt(selected.slot)) : 'Nenhum controle selecionado';
  $('#edit-selected').disabled = !selected;
  if (!selected) return;
  const binding = bindingAt(selected.slot);
  $('#editor-heading').textContent = selected.label;
  $('#slot-number').textContent = `SLOT ${String(selected.slot).padStart(2, '0')}`;
  $('#modal-layer').textContent = String(state.layer).padStart(2, '0');
  $('#editor-description').textContent = layerData().loaded ? `Camada ${state.layer} · ${layerData().drafts.has(selected.slot) ? 'Alteração pendente' : 'Atribuição atual'}` : `Camada ${state.layer} · conecte para ler a atribuição atual`;
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === binding.kind));
  $('#key-editor').hidden = binding.kind !== 'key';
  $('#media-editor').hidden = binding.kind !== 'media';
  $('#empty-editor').hidden = binding.kind !== 'empty';
  for (const button of document.querySelectorAll('[data-mod]')) button.setAttribute('aria-pressed', String(binding.kind === 'key' && Boolean(binding.mods & Number(button.dataset.mod))));
  for (const button of document.querySelectorAll('[data-code]')) button.setAttribute('aria-pressed', String(binding.kind === 'key' && binding.code === Number(button.dataset.code)));
  if (binding.kind === 'media' && media.has(mediaNames.get(binding.media))) $('#media-action').value = String(binding.media);
  $('#binding-summary').textContent = labelFor(binding);
  $('#editor-note').textContent = binding.kind === 'raw'
    ? 'Esta ação existente não é representada pelo editor. Ela será mantida até você escolher um novo tipo.'
    : !state.device ? 'Você pode preparar o atalho agora. Conecte o macropad para gravar.'
    : 'A mudança será aplicada somente quando você clicar em Gravar.';
}

function decode(record) {
  const type = record[3];
  if (type === 1) {
    const count = record[9], mods = record[10], code = record[11];
    if (count === 1 && !mods && !code) return { kind: 'empty' };
    if (count === 1 && keyNames.has(code)) return { kind: 'key', mods, code };
    return { kind: 'raw', label: count > 1 ? `Macro de ${count} passos` : 'Atalho especial existente' };
  }
  if (type === 2) {
    const code = record[10] | record[11] << 8;
    return mediaNames.has(code) ? { kind: 'media', media: code } : { kind: 'raw', label: `Mídia 0x${code.toString(16)}` };
  }
  return { kind: 'raw', label: `Ação especial (tipo ${type})` };
}
function encode(slot, layer, binding) {
  const head = [0xfe, slot, layer];
  if (binding.kind === 'empty') return [...head, 1, 0, 0, 0, 0, 0, 1, 0, 0];
  if (binding.kind === 'key') {
    if (!keyNames.has(binding.code)) throw new Error(`Slot ${slot}: selecione uma tecla principal.`);
    return [...head, 1, 0, 0, 0, 0, 0, 1, binding.mods, binding.code];
  }
  if (binding.kind === 'media' && mediaNames.has(binding.media)) return [...head, 2, 0, 0, 0, 0, 0, 0, binding.media & 255, binding.media >> 8];
  throw new Error(`Slot ${slot}: esta ação não pode ser gravada por este editor.`);
}

async function send(payload) {
  const bytes = new Uint8Array(DEVICE.reportLength);
  bytes.set(payload);
  await state.device.sendReport(DEVICE.reportId, bytes);
  await sleep(8);
}
function onInput(event) {
  const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
  if (state.collector) state.collector.push(bytes);
}
async function ask(payload, expected, timeout) {
  const answers = [];
  state.collector = answers;
  try {
    await send(payload);
    const started = Date.now();
    while (answers.length < expected && Date.now() - started < timeout) await sleep(15);
    return answers;
  } finally { state.collector = null; }
}
function isConfigurationInterface(device) {
  return device.vendorId === DEVICE.vendorId && device.productId === DEVICE.productId &&
    device.collections.some(collection => collection.usagePage === DEVICE.usagePage && collection.usage === DEVICE.usage &&
      collection.outputReports.some(report => report.reportId === DEVICE.reportId));
}
async function readLayer(number, discardDrafts = false) {
  const expected = state.layout.keys + state.layout.knobs * 3;
  const replies = await ask([0xfa, state.layout.keys, state.layout.knobs, number], expected, 2800);
  const knownSlots = new Set([
    ...Array.from({ length: state.layout.keys }, (_, i) => i + 1),
    ...Array.from({ length: state.layout.knobs * 3 }, (_, i) => 16 + i)
  ]);
  const records = new Map();
  for (const reply of replies) if (reply[0] === 0xfa && knownSlots.has(reply[1])) records.set(reply[1], decode(reply));
  if (records.size !== expected) throw new Error(`Leitura incompleta da camada ${number}: ${records.size}/${expected} controles. Os dados anteriores foram mantidos.`);
  const layer = layerData(number);
  layer.records = records;
  layer.loaded = true;
  if (discardDrafts) layer.drafts.clear();
  if (number === state.layer) { renderBoard(); renderEditor(); }
  updateSave();
  log(`Camada ${number}: ${records.size} ações lidas.`);
  return records;
}
async function connect() {
  if (state.busy) return;
  setBusy(true);
  try {
    const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: DEVICE.vendorId, productId: DEVICE.productId, usagePage: DEVICE.usagePage, usage: DEVICE.usage }] });
    const device = devices.find(isConfigurationInterface);
    if (!device) { log('Nenhuma interface de configuração selecionada.'); return; }
    if (state.device && state.device !== device) state.device.removeEventListener('inputreport', onInput);
    state.device = device;
    if (!device.opened) await device.open();
    device.removeEventListener('inputreport', onInput);
    device.addEventListener('inputreport', onInput);
    await state.device.sendReport(DEVICE.reportId, new Uint8Array(DEVICE.reportLength));
    const replies = await ask([0xfb, 0xfb, 0xfb], 1, 900);
    const layout = replies.find(reply => reply[0] === 0xfb);
    if (!layout || layout[1] < 1 || layout[1] > 15 || layout[2] > 3) throw new Error('O dispositivo não confirmou um layout compatível.');
    state.layout = { keys: layout[1], knobs: layout[2] };
    for (const layer of state.layers) { layer.records.clear(); layer.loaded = false; }
    setStatus(`${layout[1]} teclas e ${layout[2]} controles identificados`, true);
    log(`Macropad conectado: ${layout[1]} teclas, ${layout[2]} controles.`);
    renderBoard();
    await readLayer(state.layer);
  } catch (error) { log(`Conexão: ${error.message}`); setStatus(error.message); state.device = null; }
  finally { setBusy(false); renderEditor(); }
}
async function readCurrent() {
  if (!state.device || state.busy) return;
  const layer = layerData();
  if (layer.drafts.size && !confirm(`Descartar as ${layer.drafts.size} alterações pendentes da camada ${state.layer} e ler o teclado?`)) return;
  setBusy(true);
  try { await readLayer(state.layer, true); }
  catch (error) { log(error.message); alert(error.message); }
  finally { setBusy(false); }
}
async function switchLayer(event) {
  const next = Number(event.target.value);
  state.layer = next;
  state.selected = null;
  renderBoard(); renderEditor();
  if (state.device && !layerData(next).loaded) {
    setBusy(true);
    try { await readLayer(next); }
    catch (error) { log(error.message); setStatus(error.message, true); }
    finally { setBusy(false); }
  }
}
async function save() {
  if (!state.device || state.busy || !dirtyCount()) return;
  try {
    // Valida todos os atalhos antes de enviar o primeiro pacote ao dispositivo.
    const changes = state.layers.flatMap((layer, index) => [...layer.drafts].map(([slot, binding]) => ({ layer: index + 1, slot, binding, payload: encode(slot, index + 1, binding) })));
    const count = changes.length;
    if (!confirm(`Gravar ${count} ${count === 1 ? 'ação' : 'ações'} no macropad?\n\nA configuração atual desses controles será substituída.`)) return;
    setBusy(true);
    for (const change of changes) {
      await send(change.payload);
      await send([0xaa, 0xaa]);
      await send([0xfd, 0xfe, 0xff]);
      await send([0xaa, 0xaa]);
      log(`Gravado: camada ${change.layer}, slot ${change.slot}.`);
    }
    let verified = 0;
    for (const number of new Set(changes.map(change => change.layer))) {
      const records = await readLayer(number);
      for (const change of changes.filter(item => item.layer === number)) {
        if (equalBinding(records.get(change.slot), change.binding)) {
          layerData(number).drafts.delete(change.slot);
          verified++;
        }
      }
    }
    renderBoard(); renderEditor(); updateSave();
    log(`${verified}/${count} registros confirmados na memória do dispositivo. Teste as posições físicas e confira a camada ativa no macropad.`);
    if (verified !== count) alert(`O dispositivo confirmou ${verified} de ${count} registros. Os demais continuam marcados para revisão.`);
  } catch (error) { log(`Gravação interrompida: ${error.message}`); alert(`Gravação interrompida: ${error.message}`); }
  finally { setBusy(false); }
}

function initialize() {
  for (const [name, code] of media) $('#media-action').add(new Option(name, String(code)));
  $('#media-action').addEventListener('change', event => { if (state.selected) setDraft(state.selected.slot, { kind: 'media', media: Number(event.target.value) }); });
  for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
    if (!state.selected) return;
    const current = bindingAt(state.selected.slot);
    if (button.dataset.mode === 'key') setDraft(state.selected.slot, current.kind === 'key' ? current : { kind: 'key', mods: 0, code: null });
    if (button.dataset.mode === 'media') setDraft(state.selected.slot, current.kind === 'media' ? current : { kind: 'media', media: 0x00e9 });
    if (button.dataset.mode === 'empty') setDraft(state.selected.slot, { kind: 'empty' });
  });
  renderKeyboard(); renderBoard(); renderEditor(); updateSave();
  $('#edit-selected').addEventListener('click', () => {
    if (state.selected) selectControl(state.selected.slot, state.selected.label);
  });
  $('#close-editor').addEventListener('click', cancelEditor);
  $('#cancel-editor').addEventListener('click', cancelEditor);
  $('#confirm-editor').addEventListener('click', finishEditor);
  $('#editor-modal').addEventListener('cancel', event => { event.preventDefault(); cancelEditor(); });
  $('#editor-modal').addEventListener('click', event => {
    if (event.target === $('#editor-modal')) cancelEditor();
  });
  if (!('hid' in navigator)) { $('#connect').disabled = true; setStatus('Abra no Chrome ou Edge em http://localhost:8000'); }
  navigator.hid?.addEventListener('disconnect', event => {
    if (event.device !== state.device) return;
    state.device = null;
    setStatus('Macropad desconectado');
    setBusy(false);
    log('Dispositivo desconectado.');
  });
  $('#connect').addEventListener('click', connect);
  $('#read').addEventListener('click', readCurrent);
  $('#save').addEventListener('click', save);
  $('#layer').addEventListener('change', switchLayer);
  $('#clear-log').addEventListener('click', () => { $('#log').textContent = 'Pronto.'; });
}
initialize();
