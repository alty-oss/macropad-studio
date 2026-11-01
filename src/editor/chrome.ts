// Moldura da janela: tela de conexão, cabeçalho (camadas, gravar), faixa de aviso e rodapé.
import { transport } from '../device/transport.ts';
import { $, h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { plural } from '../lib/text.ts';
import { connect, switchLayer } from './session.ts';
import { dirtyCount, state, tauri } from './state.ts';

export function renderLayers() {
  $('#layers').replaceChildren(...state.layers.map((layer, index) => {
    const number = index + 1;
    return h('button', {
      type: 'button', role: 'radio', class: 'segment', 'aria-checked': String(number === state.layer), disabled: state.busy,
      'aria-label': layer.drafts.size ? `Camada ${number} · ${plural(layer.drafts.size, 'alteração não gravada', 'alterações não gravadas')}` : `Camada ${number}`,
      onclick: () => switchLayer(number)
    }, String(number), layer.drafts.size ? h('span', { class: 'segment-dot' }) : null);
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

  const banner = !connected && (state.everConnected
    ? 'Macropad desconectado. Suas alterações continuam aqui; reconecte o cabo para gravar.'
    : state.offline ? 'Modo sem dispositivo: prepare as ações e conecte o macropad para gravar.' : '');
  $('#banner').hidden = !banner;
  $('#banner-text').textContent = banner || '';
  $('#banner').querySelector('button')?.remove();
  if (banner && !transport.native && transport.supported) $('#banner').append(h('button', { type: 'button', class: 'btn btn-small', onclick: connect }, 'Conectar'));

  $('#status-device').replaceChildren(h('span', { class: `status-dot${connected ? ' on' : ''}` }), connected ? 'Macropad conectado · USB 1189:8840' : state.connection === 'connecting' ? 'Conectando…' : 'Sem dispositivo');
  $('#status-mode').textContent = tauri ? `${plural(state.macros.length, 'tecla virtual ativa', 'teclas virtuais ativas')}` : 'Navegador · ações do app indisponíveis';
}
