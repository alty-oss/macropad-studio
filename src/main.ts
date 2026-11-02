// Ponto de entrada: liga os controles fixos do HTML, os eventos do app nativo e conecta ao macropad.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Macro } from './device/protocol.ts';
import { transport } from './device/transport.ts';
import { exportConfig, importConfig } from './editor/backup.ts';
import { bindBoardKeyboard, flash, renderBoard } from './editor/board.ts';
import { exportCheatSheet } from './editor/cheatsheet.ts';
import { renderChrome, renderLayers } from './editor/chrome.ts';
import { clearSelected, copyLayer, copySelected, deselect, discardAll, pasteSelected, redo, swapLayers, undo } from './editor/editing.ts';
import { log, toast } from './editor/feedback.ts';
import { renderInspector } from './editor/inspector.ts';
import { kitMenuEntries } from './editor/kits.ts';
import { loadLabels } from './editor/labels.ts';
import { renderLibrary } from './editor/library.ts';
import { bindMobileEditor, openMobileEditor } from './editor/mobile-editor.ts';
import { closeContextMenu, showMenu, type MenuEntry } from './editor/menu.ts';
import { connect, onDeviceChange, readCurrent, save, switchLayer } from './editor/session.ts';
import { bindSettings, checkForUpdate, openSettings, renderObsState, savedLegends, savedTheme, setLegends, setTheme, watchMobileStatus } from './editor/settings.ts';
import { closeKeyboard, renderKeyboard } from './editor/shortcuts.ts';
import { controlLabel, dirtyCount, slotsForInput, state, tauri, type DeviceInput, type ObsStatus } from './editor/state.ts';
import { $ } from './lib/dom.ts';
import { icon, type IconName } from './lib/icons.ts';
import { errorText } from './lib/text.ts';

// Menu "Mais": arquivo, kits, cola e operações com camadas inteiras.
function openMoreMenu(event: MouseEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const others = [1, 2, 3].filter(number => number !== state.layer);
  const entries: MenuEntry[] = [
    { label: 'Exportar configuração…', icon: 'download', action: exportConfig },
    { label: 'Importar configuração…', icon: 'upload', action: importConfig },
    '-',
    ...kitMenuEntries(),
    '-',
    { label: 'Salvar cola para impressão…', icon: 'image', action: exportCheatSheet },
    '-',
    ...others.map((number): MenuEntry => ({ label: `Copiar camada ${state.layer} para a ${number}`, icon: 'copy', disabled: state.busy, action: () => copyLayer(state.layer, number) })),
    ...others.map((number): MenuEntry => ({ label: `Trocar camadas ${state.layer} e ${number}`, icon: 'swap', disabled: state.busy, action: () => swapLayers(state.layer, number) })),
    '-',
    { label: 'Descartar todas as alterações', icon: 'trash', disabled: !dirtyCount(), action: discardAll }
  ];
  showMenu(box.right - 260, box.bottom + 6, entries);
}

async function switchEditorMode(mode: 'macropad' | 'mobile') {
  if (mode === 'mobile' && !tauri) return;
  state.editorMode = mode;
  document.body.dataset.editor = mode;
  if (mode === 'mobile' && !state.everConnected) state.offline = true;
  const mobile = mode === 'mobile';
  document.querySelectorAll<HTMLButtonElement>('.editor-tab').forEach(button => {
    const active = button.dataset.editorTab === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  for (const id of ['#editor-macropad', '#inspector', '#physical-layer-group', '#sync-state', '#undo', '#redo', '#read', '#save', '#open-backup']) $(id).hidden = mobile;
  for (const id of ['#editor-mobile', '#mobile-inspector', '#mobile-editor-save']) $(id).hidden = !mobile;
  renderChrome();
  renderLibrary();
  watchMobileStatus(mobile);
  if (mobile) await openMobileEditor();
}

function bindControls() {
  const search = $<HTMLInputElement>('#action-search');
  $('#legends').addEventListener('change', event => setLegends((event.target as HTMLInputElement).checked));
  search.addEventListener('input', renderLibrary);
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape' && search.value) { event.stopPropagation(); search.value = ''; renderLibrary(); }
  });
  $('#clear-search').addEventListener('click', () => { search.value = ''; renderLibrary(); search.focus(); });
  $('#connect').addEventListener('click', connect);
  $('#offline').addEventListener('click', () => { state.offline = true; renderChrome(); });
  $('#mobile-from-connect').addEventListener('click', () => void switchEditorMode('mobile'));
  document.querySelectorAll<HTMLButtonElement>('.editor-tab').forEach(button => button.addEventListener('click', () => void switchEditorMode(button.dataset.editorTab as 'macropad' | 'mobile')));
  $('#read').addEventListener('click', readCurrent);
  $('#save').addEventListener('click', save);
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#open-backup').addEventListener('click', openMoreMenu);
  $('#open-settings').addEventListener('click', openSettings);
  $('#close-settings').addEventListener('click', () => $<HTMLDialogElement>('#settings-modal').close());
  $('#close-welcome').addEventListener('click', () => $<HTMLDialogElement>('#welcome-modal').close());
  $('#autostart').addEventListener('change', async event => {
    const checkbox = event.target as HTMLInputElement;
    try { await invoke('autostart_set', { enabled: checkbox.checked }); }
    catch (error) { checkbox.checked = !checkbox.checked; toast(errorText(error), 'error'); }
  });
  bindSettings();
  bindMobileEditor();
  $('#clear-log').addEventListener('click', () => { $('#log').textContent = 'Pronto.'; });
  $('#close-keyboard').addEventListener('click', () => closeKeyboard(false));
  $('#cancel-keyboard').addEventListener('click', () => closeKeyboard(false));
  $('#confirm-keyboard').addEventListener('click', () => closeKeyboard(true));
  $('#keyboard-modal').addEventListener('cancel', event => { event.preventDefault(); closeKeyboard(false); });
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('#keyboard-modal, #settings-modal, #mobile-connection-modal, #welcome-modal')) {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      if (dialog.id === 'keyboard-modal') closeKeyboard(false);
      else dialog.close();
    });
  }
  document.addEventListener('pointerdown', event => { if (!(event.target as Element).closest('#context-menu')) closeContextMenu(); });
  window.addEventListener('blur', closeContextMenu);
  // Clicar numa área vazia do preview (fundo, carcaça, vãos entre as teclas) desfaz a seleção.
  $('.canvas').addEventListener('click', event => {
    if (!(event.target as Element).closest('button, input, label')) deselect();
  });
  bindBoardKeyboard();
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#context-menu').hidden) { closeContextMenu(); return; }
    const inDialog = Boolean(document.querySelector('dialog[open]'));
    const inField = Boolean((event.target as Element).closest('input, textarea, select'));
    if (event.ctrlKey && event.code === 'KeyF' && !inDialog) { event.preventDefault(); search.focus(); search.select(); return; }
    if (state.editorMode === 'mobile') {
      if (event.ctrlKey && event.code === 'KeyS' && !inDialog) { event.preventDefault(); $<HTMLButtonElement>('#mobile-editor-save').click(); }
      return;
    }
    // Nos campos de texto, Ctrl+Z desfaz a digitação do próprio campo.
    if (event.ctrlKey && !inDialog && !inField && !state.busy) {
      if (event.code === 'KeyZ' && !event.shiftKey) { event.preventDefault(); undo(); return; }
      if (event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey)) { event.preventDefault(); redo(); return; }
    }
    if (!state.selected || inDialog || inField) return;
    if (event.ctrlKey && event.code === 'KeyC') { event.preventDefault(); copySelected(); }
    else if (event.ctrlKey && event.code === 'KeyV') { event.preventDefault(); pasteSelected(); }
    else if (event.key === 'Delete') { event.preventDefault(); clearSelected(); }
    else if (event.key === 'Escape') deselect();
  });
}

// Eventos do Rust: ação do macropad acionada, falhas das ações do app, OBS e pausa das teclas.
async function listenToApp() {
  state.macros = await invoke<Macro[]>('macros_get').catch(() => []);
  state.keysPaused = await invoke<boolean>('keys_paused_get').catch(() => false);
  state.obs = await invoke<ObsStatus>('obs_status').catch(() => state.obs);
  const problem = await invoke<string | null>('config_problem').catch(() => null);
  if (problem) { log(problem, false); toast(problem, 'error'); }
  listen<[number, number]>('macro-fired', ({ payload: [layer, slot] }) => {
    if (state.detectedLayer !== layer) { state.detectedLayer = layer; renderLayers(); }
    log(`Ação do macropad: camada ${layer}, ${controlLabel(slot)}.`, false);
    void switchLayer(layer).then(() => flash(slot));
  });
  // Ações gravadas no aparelho (atalhos e mídia) não passam pelas teclas virtuais: o app as reconhece
  // pelo que o macropad envia e anima o controle correspondente na camada aberta. Se só uma camada
  // lida tiver essa ação, ela é a camada ativa.
  listen<DeviceInput>('device-input', ({ payload }) => {
    if (payload.kind === 'key' && !payload.down) return;
    const found = slotsForInput(payload);
    if (found.size === 1) {
      const [layer] = found.keys();
      const slots = found.get(layer) ?? [];
      const changed = state.detectedLayer !== layer;
      if (changed) {
        state.detectedLayer = layer;
        renderLayers();
        if (tauri) invoke('layer_detected', { layer }).catch(() => {});
      }
      void switchLayer(layer).then(() => slots.forEach(slot => flash(slot)));
    }
  });
  listen<string>('macro-error', ({ payload }) => { log(`Ação do app: ${payload}`, false); toast(payload, 'error'); });
  listen<ObsStatus>('obs-state', ({ payload }) => { state.obs = payload; renderChrome(); renderObsState(); });
  listen<boolean>('keys-paused', ({ payload }) => { state.keysPaused = payload; renderChrome(); $<HTMLInputElement>('#keys-paused').checked = payload; });
}

function welcome() {
  try {
    if (localStorage.getItem('welcomed')) return;
    localStorage.setItem('welcomed', '1');
  } catch { return; }
  $<HTMLDialogElement>('#welcome-modal').showModal();
}

async function initialize() {
  for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) element.prepend(icon(element.dataset.icon as IconName));
  setTheme(savedTheme());
  $('#editor-tab-mobile').hidden = !tauri;
  $('#mobile-from-connect').hidden = !tauri;
  const legends = savedLegends();
  $<HTMLInputElement>('#legends').checked = legends;
  setLegends(legends);
  renderKeyboard(); renderLibrary();
  bindControls();
  await loadLabels();
  if (tauri) await listenToApp();
  transport.onChange(onDeviceChange);
  if (!transport.supported) { state.connection = 'unsupported'; state.connectError = 'Abra no Chrome ou Edge, ou use o Macropad Studio para Windows.'; }
  else if (!transport.native) state.connection = 'idle';
  renderBoard(); renderLayers(); renderChrome(); renderInspector();
  welcome();
  if (transport.native) connect();
  // Sem pressa: a procura por atualizações não deve competir com a conexão ao macropad.
  setTimeout(() => checkForUpdate(true), 8000);
}
initialize();
