// Biblioteca de ações à direita: categorias, busca e atribuição por clique ou arrastar.
import { media } from '../device/keys.ts';
import { newStep, type Binding, type StepType } from '../device/protocol.ts';
import { $, h } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { normalize } from '../lib/text.ts';
import { DRAG_ACTION } from './board.ts';
import { assign } from './editing.ts';
import { toast } from './feedback.ts';
import { mediaIcons } from './legend.ts';
import { bindingAt, controlLabel, state, tauri } from './state.ts';

interface ActionItem { id: string; name: string; description?: string; icon: IconName; make: () => Binding; is: (binding: Binding) => boolean }
interface ActionGroup { title: string; app?: boolean; items: ActionItem[] }

const appAction = (type: StepType): Binding => ({ kind: 'app', multi: false, steps: [newStep(type)] });
// "is" reconhece a ação já atribuída ao controle selecionado, para destacá-la na lista.
const isApp = (type: StepType) => (binding: Binding) => binding.kind === 'app' && !binding.multi && binding.steps[0]?.type === type;
const library: ActionGroup[] = [
  { title: 'Teclado', items: [{ id: 'key', name: 'Atalho de teclado', description: 'Combinação gravada no macropad', icon: 'keyboard', make: () => ({ kind: 'key', mods: 0, code: null }), is: binding => binding.kind === 'key' }] },
  {
    title: 'Multimídia', items: [...media].map(([name, code]): ActionItem => ({
      id: `media-${code}`, name, icon: mediaIcons.get(code) ?? 'volumeUp', make: () => ({ kind: 'media', media: code }), is: binding => binding.kind === 'media' && binding.media === code
    }))
  },
  {
    title: 'Sistema', app: true, items: [
      { id: 'open', name: 'Abrir', description: 'Arquivo, pasta ou programa', icon: 'folder', make: () => appAction('open'), is: isApp('open') },
      { id: 'website', name: 'Site', description: 'Abre no navegador padrão', icon: 'globe', make: () => appAction('website'), is: isApp('website') },
      { id: 'text', name: 'Digitar texto', description: 'Escreve um texto pronto', icon: 'text', make: () => appAction('text'), is: isApp('text') },
      { id: 'multi', name: 'Multi-ação', description: 'Várias etapas em sequência', icon: 'multi', make: () => ({ kind: 'app', multi: true, steps: [] }), is: binding => binding.kind === 'app' && binding.multi }
    ]
  },
  { title: 'Geral', items: [{ id: 'empty', name: 'Sem ação', description: 'Limpa o controle', icon: 'empty', make: () => ({ kind: 'empty' }), is: binding => binding.kind === 'empty' }] }
];
export const actionById = new Map(library.flatMap(group => group.items.map(item => [item.id, item] as const)));

export function renderLibrary() {
  const query = normalize($<HTMLInputElement>('#action-search').value.trim());
  const current = state.selected ? bindingAt(state.selected) : null;
  $('#clear-search').hidden = !query;
  $('.search-hint').hidden = Boolean(query);
  // Diz o que o clique faz: atribuir ao controle selecionado ou, sem seleção, arrastar.
  $('#library-context').replaceChildren(...(state.selected
    ? [icon('chevron'), h('span', {}, 'Atribuir a'), h('strong', {}, controlLabel(state.selected))]
    : [icon('info'), h('span', {}, 'Arraste uma ação até uma tecla ou knob')]));
  $('#library-context').classList.toggle('active', Boolean(state.selected));
  const groups = library.flatMap(group => {
    const items = group.items.filter(item => !query || normalize(`${item.name} ${item.description || ''} ${group.title}`).includes(query));
    if (!items.length) return [];
    const details = h('details', { class: 'action-group', open: Boolean(query) || !state.collapsed.has(group.title) },
      h('summary', {}, icon('chevron', 'icon chevron'), h('span', {}, group.title), group.app ? h('span', { class: 'badge' }, 'App') : null,
        h('span', { class: 'group-count' }, String(items.length))),
      items.map(item => actionItem(item, group, current)));
    details.addEventListener('toggle', () => {
      if (query) return;
      if (details.open) state.collapsed.delete(group.title);
      else state.collapsed.add(group.title);
    });
    return [details];
  });
  $('#action-list').replaceChildren(...(groups.length ? groups : [h('p', { class: 'library-empty' }, 'Nenhuma ação encontrada.')]));
}

function actionItem(item: ActionItem, group: ActionGroup, current: Binding | null) {
  const unavailable = Boolean(group.app) && !tauri;
  const active = Boolean(current && item.is(current));
  const button = h('button', {
    type: 'button', class: `action-item${active ? ' active' : ''}`, draggable: unavailable ? null : 'true', disabled: unavailable, 'aria-current': active ? 'true' : null
  }, h('span', { class: 'action-icon' }, icon(item.icon)), h('span', { class: 'action-text' }, h('span', {}, item.name), item.description ? h('small', {}, item.description) : null),
    active ? icon('check', 'icon action-check') : null);
  button.addEventListener('click', () => {
    if (!state.selected) { toast('Selecione uma tecla ou um knob primeiro.'); return; }
    // Clicar na ação que o controle já tem não deve apagar a configuração dela.
    if (!active) assign(state.selected, item.make());
  });
  button.addEventListener('dragstart', event => {
    event.dataTransfer?.setData(DRAG_ACTION, item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  });
  return button;
}
