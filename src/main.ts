// Ponto de entrada: liga os controles fixos do HTML, os eventos do app nativo e conecta ao macropad.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Macro } from './device/protocol.ts';
import { transport } from './device/transport.ts';
import { exportConfig, importConfig } from './editor/backup.ts';
import { flash, renderBoard } from './editor/board.ts';
import { renderChrome, renderLayers } from './editor/chrome.ts';
import { clearSelected, copySelected, deselect, pasteSelected } from './editor/editing.ts';
import { log, toast } from './editor/feedback.ts';
import { renderInspector } from './editor/inspector.ts';
import { renderLibrary } from './editor/library.ts';
import { closeContextMenu, showMenu } from './editor/menu.ts';
import { connect, onDeviceChange, readCurrent, save } from './editor/session.ts';
import { openSettings, savedLegends, setLegends } from './editor/settings.ts';
import { closeKeyboard, renderKeyboard } from './editor/shortcuts.ts';
import { controlLabel, state, tauri } from './editor/state.ts';
import { $ } from './lib/dom.ts';
import { icon, type IconName } from './lib/icons.ts';
import { errorText } from './lib/text.ts';

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
  $('#read').addEventListener('click', readCurrent);
  $('#save').addEventListener('click', save);
  $('#open-backup').addEventListener('click', event => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    showMenu(box.right - 220, box.bottom + 6, [
      { label: 'Exportar configuração…', icon: 'download', action: exportConfig },
      { label: 'Importar configuração…', icon: 'upload', action: importConfig }
    ]);
  });
  $('#open-settings').addEventListener('click', openSettings);
  $('#close-settings').addEventListener('click', () => $<HTMLDialogElement>('#settings-modal').close());
  $('#autostart').addEventListener('change', async event => {
    const checkbox = event.target as HTMLInputElement;
    try { await invoke('autostart_set', { enabled: checkbox.checked }); }
    catch (error) { checkbox.checked = !checkbox.checked; toast(errorText(error), 'error'); }
  });
  $('#clear-log').addEventListener('click', () => { $('#log').textContent = 'Pronto.'; });
  $('#close-keyboard').addEventListener('click', () => closeKeyboard(false));
  $('#cancel-keyboard').addEventListener('click', () => closeKeyboard(false));
  $('#confirm-keyboard').addEventListener('click', () => closeKeyboard(true));
  $('#keyboard-modal').addEventListener('cancel', event => { event.preventDefault(); closeKeyboard(false); });
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('#keyboard-modal, #settings-modal')) {
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
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#context-menu').hidden) { closeContextMenu(); return; }
    if (event.ctrlKey && event.code === 'KeyF' && !document.querySelector('dialog[open]')) { event.preventDefault(); search.focus(); search.select(); return; }
    if (!state.selected || document.querySelector('dialog[open]') || (event.target as Element).closest('input, textarea, select')) return;
    if (event.ctrlKey && event.code === 'KeyC') { event.preventDefault(); copySelected(); }
    else if (event.ctrlKey && event.code === 'KeyV') { event.preventDefault(); pasteSelected(); }
    else if (event.key === 'Delete') { event.preventDefault(); clearSelected(); }
    else if (event.key === 'Escape') deselect();
  });
}

// Eventos do Rust: tecla virtual acionada e falha ao executar uma ação do app.
async function listenToApp() {
  state.macros = await invoke<Macro[]>('macros_get').catch(() => []);
  listen<[number, number]>('macro-fired', ({ payload: [layer, slot] }) => {
    if (layer === state.layer) flash(slot);
    log(`Tecla virtual: camada ${layer}, ${controlLabel(slot)}.`);
  });
  listen<string>('macro-error', ({ payload }) => { log(`Ação do app: ${payload}`); toast(payload, 'error'); });
}

async function initialize() {
  for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) element.prepend(icon(element.dataset.icon as IconName));
  const legends = savedLegends();
  $<HTMLInputElement>('#legends').checked = legends;
  setLegends(legends);
  renderKeyboard(); renderLibrary();
  bindControls();
  if (tauri) await listenToApp();
  transport.onChange(onDeviceChange);
  if (!transport.supported) { state.connection = 'unsupported'; state.connectError = 'Abra no Chrome ou Edge, ou use o Macropad Studio para Windows.'; }
  else if (!transport.native) state.connection = 'idle';
  renderBoard(); renderLayers(); renderChrome(); renderInspector();
  if (transport.native) connect();
}
initialize();
