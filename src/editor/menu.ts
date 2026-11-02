// Menu flutuante: usado no clique direito dos controles e no botão "Procurar" do campo de caminho.
import { $, h } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { clearSelected, copySelected, pasteSelected } from './editing.ts';
import { testSelected } from './inspector.ts';
import { bindingAt, state, tauri } from './state.ts';

export type MenuEntry ={ label: string; shortcut?: string; icon?: IconName; disabled?: boolean; action: () => void } | '-' | false;

export function closeContextMenu() { $('#context-menu').hidden = true; }

// Entradas falsas são ignoradas; '-' vira um separador.
export function showMenu(x: number, y: number, entries: MenuEntry[]) {
  const menu = $('#context-menu');
  menu.replaceChildren(...entries.flatMap((entry): HTMLElement[] => !entry ? [] : entry === '-' ? [h('hr')] : [h('button', {
    type: 'button', role: 'menuitem', disabled: entry.disabled, onclick: () => { closeContextMenu(); entry.action(); }
  }, h('span', { class: 'menu-label' }, entry.icon ? icon(entry.icon) : null, entry.label), entry.shortcut ? h('kbd', {}, entry.shortcut) : null)]));
  menu.hidden = false;
  menu.style.left = `${Math.min(x, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - menu.offsetHeight - 8)}px`;
  menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
}

export function openContextMenu(x: number, y: number) {
  if (!state.selected) return;
  const binding = bindingAt(state.selected);
  const testable = binding.kind !== 'empty' && binding.kind !== 'raw' && tauri;
  showMenu(x, y, [
    { label: 'Copiar', shortcut: 'Ctrl+C', disabled: binding.kind === 'empty' || binding.kind === 'raw', action: copySelected },
    { label: 'Colar', shortcut: 'Ctrl+V', disabled: !state.clipboard, action: pasteSelected },
    { label: 'Limpar', shortcut: 'Del', disabled: binding.kind === 'empty', action: clearSelected },
    testable && '-',
    testable && { label: 'Testar ação', action: testSelected }
  ]);
}
