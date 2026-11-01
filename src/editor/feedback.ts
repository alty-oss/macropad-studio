// Retorno ao usuário: registro de atividade, avisos flutuantes e diálogo de confirmação.
import { $, h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';

export function log(message: string) {
  const element = $('#log');
  if (element.textContent === 'Pronto.') element.textContent = '';
  element.textContent += `[${new Date().toLocaleTimeString('pt-BR')}] ${message}\n`;
  element.scrollTop = element.scrollHeight;
  $('#status-message').textContent = message;
}

export function toast(message: string, tone: 'info' | 'success' | 'error' = 'info') {
  const element = h('div', { class: `toast toast-${tone}`, role: tone === 'error' ? 'alert' : 'status' },
    icon(tone === 'error' ? 'warning' : tone === 'success' ? 'check' : 'info'), h('span', {}, message));
  $('#toasts').append(element);
  setTimeout(() => { element.classList.add('leaving'); setTimeout(() => element.remove(), 200); }, tone === 'error' ? 6000 : 3500);
}

export function confirmDialog(title: string, text: string, confirmLabel = 'Confirmar'): Promise<boolean> {
  const dialog = $<HTMLDialogElement>('#confirm-modal');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = confirmLabel;
  dialog.showModal();
  $('#confirm-ok').focus();
  return new Promise(resolve => {
    const listeners = new AbortController();
    const done = (value: boolean) => { listeners.abort(); dialog.close(); resolve(value); };
    $('#confirm-ok').addEventListener('click', () => done(true), { signal: listeners.signal });
    $('#confirm-cancel').addEventListener('click', () => done(false), { signal: listeners.signal });
    dialog.addEventListener('cancel', event => { event.preventDefault(); done(false); }, { signal: listeners.signal });
  });
}
