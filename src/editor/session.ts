// Sessão com o dispositivo: conexão, leitura das camadas e gravação das alterações.
import { invoke } from '@tauri-apps/api/core';
import { appBindingError, appParts, decode, encode, equalBinding, virtualCode, type Binding } from '../device/protocol.ts';
import { transport } from '../device/transport.ts';
import { errorText, plural } from '../lib/text.ts';
import { renderBoard } from './board.ts';
import { renderChrome, renderLayers } from './chrome.ts';
import { confirmDialog, log, toast } from './feedback.ts';
import { renderInspector } from './inspector.ts';
import { stopCapture } from './shortcuts.ts';
import { allSlots, controlLabel, dirtyCount, layerData, macroBinding, state, tauri } from './state.ts';

// Mensagem do Rust (device.rs) quando o macropad não está ligado.
const NOT_FOUND = 'Macropad não encontrado';

function setBusy(busy: boolean) {
  state.busy = busy;
  if (!busy) state.progress = '';
  renderChrome();
  renderLayers();
}

async function readLayer(number: number, discardDrafts = false) {
  const expected = state.layout.keys + state.layout.knobs * 3;
  const replies = await transport.ask([0xfa, state.layout.keys, state.layout.knobs, number], expected, 2800);
  const knownSlots = new Set(allSlots());
  const records = new Map<number, Binding>();
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

export async function connect() {
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

export function onDeviceChange(present: boolean) {
  if (present) { connect(); return; }
  if (state.connection === 'connected') { log('Dispositivo desconectado.'); toast('Macropad desconectado.', 'error'); }
  state.connection = state.everConnected ? 'disconnected' : transport.native ? 'searching' : 'idle';
  renderChrome();
}

export async function readCurrent() {
  if (state.connection !== 'connected' || state.busy) return;
  const layer = layerData();
  if (layer.drafts.size && !await confirmDialog('Descartar alterações?', `As ${plural(layer.drafts.size, 'alteração não gravada', 'alterações não gravadas')} da camada ${state.layer} serão substituídas pelo que está no macropad.`, 'Ler dispositivo')) return;
  setBusy(true);
  try { await readLayer(state.layer, true); }
  catch (error) { log(errorText(error)); toast(errorText(error), 'error'); }
  finally { setBusy(false); }
}

// Lê as camadas que ainda não foram abertas, para exportar a configuração completa.
export async function loadAllLayers() {
  if (state.connection !== 'connected' || state.busy) return;
  const pending = state.layers.flatMap((layer, index) => layer.loaded ? [] : [index + 1]);
  if (!pending.length) return;
  setBusy(true);
  try { for (const number of pending) await readLayer(number); }
  finally { setBusy(false); }
}

export async function switchLayer(number: number) {
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

interface Change { layer: number; slot: number; binding: Binding; payload: number[] | null }

async function persistMacros(changes: Change[]) {
  const touched = new Set(changes.map(change => `${change.layer}:${change.slot}`));
  const macros = state.macros.filter(item => !touched.has(`${item.layer}:${item.slot}`));
  for (const change of changes) {
    if (change.binding.kind !== 'app') continue;
    macros.push({ layer: change.layer, slot: change.slot, ...virtualCode(change.layer, change.slot), ...appParts(change.binding) });
  }
  await invoke('macros_save', { macros });
  state.macros = macros;
}

// O dispositivo confirma a tecla virtual de uma ação do app; as etapas são conferidas no app.
function confirmedBy(records: Map<number, Binding>, change: Change) {
  const record = records.get(change.slot);
  return change.binding.kind === 'app' ? record?.kind === 'app' : equalBinding(record, change.binding);
}

export async function save() {
  if (state.connection !== 'connected' || state.busy || !dirtyCount()) return;
  let changes: Change[];
  try {
    // Valida tudo antes de enviar o primeiro pacote ao dispositivo.
    changes = state.layers.flatMap((layer, index) => [...layer.drafts].map(([slot, binding]): Change => {
      const number = index + 1;
      if (binding.kind === 'app') {
        const error = tauri ? appBindingError(binding) : 'ações do app exigem o Macropad Studio para Windows.';
        if (error) throw new Error(`Camada ${number}, ${controlLabel(slot)}: ${error}`);
      }
      // Se o slot já envia sua tecla virtual, basta atualizar as etapas no app.
      const programmed = binding.kind === 'app' && layer.records.get(slot)?.kind === 'app';
      return { layer: number, slot, binding, payload: programmed ? null : encode(slot, number, binding) };
    }));
  } catch (error) { toast(errorText(error), 'error'); return; }
  const writes = changes.filter((change): change is Change & { payload: number[] } => change.payload !== null);
  const text = writes.length
    ? `${plural(writes.length, 'controle será gravado', 'controles serão gravados')} no macropad, substituindo a configuração atual.`
    : 'As etapas ficam salvas no app; o macropad já envia as teclas virtuais desses controles.';
  if (!await confirmDialog(`Gravar ${plural(changes.length, 'alteração', 'alterações')}?`, text, 'Gravar')) return;
  setBusy(true);
  // As etapas só vão para o app depois que o macropad confirma o controle: se a gravação falhar no
  // meio, app e dispositivo continuam de acordo e o rascunho fica para tentar de novo.
  const confirmed = changes.filter(change => !change.payload);
  let interrupted = false;
  try {
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
    for (const number of new Set(writes.map(change => change.layer))) {
      const records = await readLayer(number);
      confirmed.push(...writes.filter(change => change.layer === number && confirmedBy(records, change)));
    }
  } catch (error) {
    interrupted = true;
    log(`Gravação interrompida: ${errorText(error)}`);
    toast(`Gravação interrompida: ${errorText(error)}`, 'error');
  }
  try {
    if (tauri && confirmed.length) await persistMacros(confirmed);
    for (const change of confirmed) {
      if (change.binding.kind !== 'app') continue;
      layerData(change.layer).records.set(change.slot, structuredClone(change.binding));
      layerData(change.layer).drafts.delete(change.slot);
    }
    log(`${confirmed.length}/${changes.length} alterações confirmadas.`);
    if (!interrupted) {
      if (confirmed.length === changes.length) toast(`${plural(confirmed.length, 'alteração gravada', 'alterações gravadas')}.`, 'success');
      else toast(`O dispositivo confirmou ${confirmed.length} de ${changes.length} alterações. As demais continuam marcadas para revisão.`, 'error');
    }
  } catch (error) {
    log(`Etapas não salvas no app: ${errorText(error)}`);
    toast(`O macropad foi gravado, mas as etapas não foram salvas no app: ${errorText(error)}. Clique em Gravar de novo.`, 'error');
  } finally {
    setBusy(false);
    renderBoard(); renderLayers(); renderChrome(); renderInspector();
  }
}
