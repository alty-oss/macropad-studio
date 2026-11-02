// Moldura da janela: tela de conexão, cabeçalho (camadas, gravar), faixa de aviso e rodapé.
import { invoke } from '@tauri-apps/api/core';
import { transport } from '../device/transport.ts';
import { $, h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { plural } from '../lib/text.ts';
import { canRedo, canUndo } from './editing.ts';
import { connect, switchLayer } from './session.ts';
import { dirtyCount, state, tauri } from './state.ts';

export function renderLayers() {
  $('#layers').replaceChildren(...state.layers.map((layer, index) => {
    const number = index + 1;
    // A camada ativa no aparelho é inferida da última entrada identificada.
    const live = number === state.detectedLayer;
    const parts = [`Camada ${number}`, live ? 'ativa no macropad' : '', layer.drafts.size ? plural(layer.drafts.size, 'alteração não gravada', 'alterações não gravadas') : ''];
    return h('button', {
      type: 'button', role: 'radio', class: `segment${live ? ' live' : ''}`, 'aria-checked': String(number === state.layer), disabled: state.busy,
      'aria-label': parts.filter(Boolean).join(' · '), title: live ? 'Camada ativa no macropad (detectada pela última entrada)' : null,
      onclick: () => switchLayer(number)
    }, String(number), layer.drafts.size ? h('span', { class: 'segment-dot' }) : null, live ? h('span', { class: 'segment-live' }) : null);
  }));
}

export function renderChrome() {
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

  const count = dirtyCount();
  $('#sync-state').textContent = state.progress || (count ? plural(count, 'alteração não gravada', 'alterações não gravadas') : connected ? 'Tudo gravado' : '');
  $('#sync-state').classList.toggle('pending', Boolean(count) && !state.progress);
  $<HTMLButtonElement>('#save').disabled = state.busy || !connected || !count;
  $<HTMLButtonElement>('#read').disabled = state.busy || !connected;
  $<HTMLButtonElement>('#undo').disabled = state.busy || !canUndo();
  $<HTMLButtonElement>('#redo').disabled = state.busy || !canRedo();

  const offlineBanner = !connected && (state.everConnected
    ? 'Macropad desconectado. Suas alterações continuam aqui; reconecte o cabo para gravar.'
    : state.offline ? 'Modo sem dispositivo: prepare as ações e conecte o macropad para gravar.' : '');
  const pausedBanner = state.keysPaused ? 'Teclas virtuais pausadas: as ações do app não são executadas até você retomar.' : '';
  const banner = offlineBanner || pausedBanner;
  $('#banner').hidden = !banner || state.editorMode === 'mobile';
  $('#banner-text').textContent = banner || '';
  $('#banner').querySelector('button')?.remove();
  if (offlineBanner && !transport.native && transport.supported) $('#banner').append(h('button', { type: 'button', class: 'btn btn-small', onclick: connect }, 'Conectar'));
  else if (!offlineBanner && pausedBanner) $('#banner').append(h('button', { type: 'button', class: 'btn btn-small', onclick: () => setKeysPaused(false) }, 'Retomar'));

  $('#status-device').replaceChildren(h('span', { class: `status-dot${state.editorMode === 'mobile' || connected ? ' on' : ''}` }), state.editorMode === 'mobile' ? 'Página do celular · 15 botões por página, com pastas' : connected ? 'Macropad conectado · USB 1189:8840' : state.connection === 'connecting' ? 'Conectando…' : 'Sem dispositivo');
  const obs = state.obs.connected ? ['OBS conectado', state.obs.recording ? '● Gravando' : '', state.obs.streaming ? '● Ao vivo' : ''].filter(Boolean).join(' · ') : '';
  $('#status-mode').textContent = tauri
    ? [obs, plural(state.macros.length, 'tecla virtual ativa', 'teclas virtuais ativas')].filter(Boolean).join('  ·  ')
    : 'Navegador · ações do app indisponíveis';
}

export async function setKeysPaused(paused: boolean) {
  if (tauri) await invoke('keys_paused_set', { paused });
  state.keysPaused = paused;
  renderChrome();
}
