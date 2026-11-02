// Biblioteca de ações à direita: categorias, busca e atribuição por clique ou arrastar.
import { media } from '../device/keys.ts';
import { newStep, type Binding, type Step, type StepOf, type StepType } from '../device/protocol.ts';
import { $, h } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { normalize } from '../lib/text.ts';
import { DRAG_ACTION } from './board.ts';
import { assign } from './editing.ts';
import { toast } from './feedback.ts';
import { mediaIcons } from './legend.ts';
import { bindingAt, controlLabel, state, tauri } from './state.ts';

interface ActionItem { id: string; name: string; description?: string; icon: IconName; make: () => Binding; is: (binding: Binding) => boolean; rotaryOnly?: boolean; mobileOnly?: boolean }
// "color" pinta o ícone da categoria e os das ações, como nos apps de stream decks.
interface ActionGroup { title: string; icon: IconName; color: string; app?: boolean; items: ActionItem[] }

// Ação do app de uma etapa só, já preenchida. "is" reconhece a ação atribuída ao controle selecionado,
// para destacá-la na lista; "match" distingue itens do mesmo tipo de etapa (OBS, áudio…).
function appItem(id: string, name: string, description: string, glyph: IconName, step: Step, match: (step: Step) => boolean = () => true): ActionItem {
  return {
    id, name, description, icon: glyph,
    make: () => ({ kind: 'app', multi: false, steps: [structuredClone(step)] }),
    is: binding => binding.kind === 'app' && !binding.multi && binding.steps[0]?.type === step.type && match(binding.steps[0])
  };
}
function rotaryItem(id: string, name: string, description: string, glyph: IconName, step: Step, match: (step: Step) => boolean = () => true): ActionItem {
  return { ...appItem(id, name, description, glyph, step, match), rotaryOnly: true };
}
const fresh = (type: StepType) => newStep(type);
const obs = (action: StepOf<'obs'>['action']): Step => ({ ...newStep('obs') as StepOf<'obs'>, action });
const isObs = (...actions: string[]) => (step: Step) => step.type === 'obs' && actions.includes(step.action);
const audio = (target: StepOf<'audio'>['target'], action: StepOf<'audio'>['action']): Step => ({ ...newStep('audio') as StepOf<'audio'>, target, action });
const voicemeeter = (mode: StepOf<'voicemeeter'>['mode']): Step => ({ ...newStep('voicemeeter') as StepOf<'voicemeeter'>, mode });
const isAudio = (target: string) => (step: Step) => step.type === 'audio' && step.target === target;

const library: ActionGroup[] = [
  {
    title: 'Navegação', icon: 'folder', color: '#f5b83d', items: [
      { id: 'folder', name: 'Pasta', description: 'Abre outra página de botões', icon: 'folder', make: () => ({ kind: 'empty' }), is: () => false, mobileOnly: true }
    ]
  },
  { title: 'Teclado', icon: 'keyboard', color: '#9aa3b5', items: [{ id: 'key', name: 'Atalho de teclado', description: 'Combinação gravada no macropad', icon: 'keyboard', make: () => ({ kind: 'key', mods: 0, code: null }), is: binding => binding.kind === 'key' }] },
  {
    title: 'Multimídia', icon: 'playPause', color: '#ff7a59', items: [...media].map(([name, code]): ActionItem => ({
      id: `media-${code}`, name, icon: mediaIcons.get(code) ?? 'volumeUp', make: () => ({ kind: 'media', media: code }), is: binding => binding.kind === 'media' && binding.media === code
    }))
  },
  {
    title: 'Sistema', icon: 'monitor', color: '#4c9bff', app: true, items: [
      appItem('open', 'Abrir', 'Arquivo, pasta ou programa', 'folder', fresh('open')),
      appItem('website', 'Site', 'Abre no navegador padrão', 'globe', fresh('website')),
      appItem('text', 'Digitar texto', 'Escreve um texto pronto', 'text', fresh('text')),
      { id: 'multi', name: 'Multi-ação', description: 'Etapas em sequência, alternar, segurar, perfis', icon: 'multi', make: () => ({ kind: 'app', multi: true, steps: [] }), is: binding => binding.kind === 'app' && binding.multi },
      appItem('command', 'Comando', 'cmd, PowerShell ou script', 'terminal', fresh('command')),
      appItem('window', 'Janela', 'Minimizar, maximizar, mover…', 'window', fresh('window')),
      appItem('system', 'Sistema', 'Bloquear, suspender, tema…', 'power', fresh('system')),
      appItem('mouse', 'Mouse', 'Cliques e rolagem', 'mouse', fresh('mouse'))
    ]
  },
  {
    title: 'Áudio', icon: 'music', color: '#2fd27f', app: true, items: [
      appItem('mic', 'Mudo do microfone', 'Em qualquer app de chamada', 'mic', audio('mic', 'toggle'), isAudio('mic')),
      appItem('media-key', 'Tecla de mídia', 'Para usar em multi-ações', 'next', fresh('media')),
      appItem('sound', 'Tocar som', 'Soundboard (MP3, WAV)', 'music', fresh('sound'))
    ]
  },
  {
    title: 'OBS Studio', icon: 'obs', color: '#c9cdd6', app: true, items: [
      appItem('obs-scene', 'Trocar de cena', 'Cena do OBS Studio', 'monitor', obs('scene'), isObs('scene')),
      appItem('obs-record', 'Gravação', 'Iniciar, parar, pausar', 'record', obs('record'), isObs('record', 'recordStart', 'recordStop', 'recordPause', 'chapter')),
      appItem('obs-stream', 'Transmissão', 'Entrar e sair do ar', 'broadcast', obs('stream'), isObs('stream', 'streamStart', 'streamStop')),
      appItem('obs-mute', 'Silenciar fonte', 'Microfone, áudio do desktop', 'mic', obs('mute'), isObs('mute')),
      appItem('obs-visibility', 'Mostrar / esconder', 'Câmera, overlay, "volto já"', 'eye', obs('visibility'), isObs('visibility')),
      appItem('obs-screenshot', 'Screenshot da fonte', 'Salva a fonte atual em PNG', 'image', obs('screenshot'), isObs('screenshot')),
      appItem('obs-replay', 'Replay, câmera virtual…', 'Replay buffer e transição', 'replay', obs('replay'), isObs('replay', 'virtualcam', 'transition')),
      appItem('counter', 'Contador', 'Número num arquivo de texto', 'hash', fresh('counter'))
    ]
  },
  {
    title: 'Knobs', icon: 'rotateRight', color: '#b07cf2', app: true, items: [
      rotaryItem('knob-brightness', 'Brilho do monitor', 'Ajuste incremental por rotação', 'sun', fresh('brightness')),
      rotaryItem('knob-output-volume', 'Volume do sistema', 'Saída padrão, em passos', 'volumeUp', audio('output', 'up'), isAudio('output')),
      rotaryItem('knob-app-volume', 'Volume de um programa', 'Spotify, Discord, jogo…', 'volumeUp', audio('app', 'up'), isAudio('app')),
      rotaryItem('knob-obs-volume', 'OBS · Volume de fonte', 'Ajuste em dB por rotação', 'obs', obs('volume'), isObs('volume')),
      rotaryItem('knob-scroll', 'Rolar conteúdo', 'Vertical ou horizontal', 'mouse', fresh('mouse'), step => step.type === 'mouse' && step.action.startsWith('scroll')),
      rotaryItem('knob-voicemeeter', 'Voicemeeter incremental', 'Somar ao valor anterior', 'mixer', voicemeeter('add'))
    ]
  },
  {
    title: 'Integrações', icon: 'link', color: '#18c3ff', app: true, items: [
      appItem('http', 'Requisição HTTP', 'Webhooks, n8n, IFTTT, APIs', 'link', fresh('http')),
      appItem('voicemeeter', 'Voicemeeter', 'Ganho e mudo de strips e buses', 'mixer', voicemeeter('set'))
    ]
  },
  { title: 'Geral', icon: 'empty', color: '#7d808a', items: [{ id: 'empty', name: 'Sem ação', description: 'Limpa o controle', icon: 'empty', make: () => ({ kind: 'empty' }), is: binding => binding.kind === 'empty' }] }
];
export const actionById = new Map(library.flatMap(group => group.items.map(item => [item.id, item] as const)));

export function renderLibrary() {
  const query = normalize($<HTMLInputElement>('#action-search').value.trim());
  const mobile = state.editorMode === 'mobile';
  const collapsed = mobile ? state.mobileCollapsed : state.collapsed;
  const current = !mobile && state.selected ? bindingAt(state.selected) : null;
  $('#clear-search').hidden = !query;
  $('.search-hint').hidden = Boolean(query);
  // Diz o que o clique faz: atribuir ao controle selecionado ou, sem seleção, arrastar.
  $('#library-context').replaceChildren(...(mobile
    ? [icon('chevron'), h('span', {}, 'Atribuir ao'), h('strong', {}, `Botão ${state.mobileSelected}`)]
    : state.selected
    ? [icon('chevron'), h('span', {}, 'Atribuir a'), h('strong', {}, controlLabel(state.selected))]
    : [icon('info'), h('span', {}, 'Arraste uma ação até uma tecla ou knob')]));
  $('#library-context').classList.toggle('active', mobile || Boolean(state.selected));
  const groups = library.flatMap(group => {
    // No celular tudo funciona: atalhos e mídia viram etapas do app e as ações de knob, botões que repetem.
    const items = group.items.filter(item => (mobile || !item.mobileOnly)
      && (!query || normalize(`${item.name} ${item.description || ''} ${group.title}`).includes(query)));
    if (!items.length) return [];
    const details = h('details', { class: 'action-group', open: Boolean(query) || !collapsed.has(group.title) },
      h('summary', {}, icon('chevron', 'icon chevron'), h('span', { class: 'group-icon' }, icon(group.icon)), h('span', { class: 'group-title' }, group.title), h('span', { class: 'group-count' }, String(items.length))),
      items.map(item => actionItem(item, group, current)));
    details.style.setProperty('--group-color', group.color);
    details.addEventListener('toggle', () => {
      if (query) return;
      if (details.open) collapsed.delete(group.title);
      else collapsed.add(group.title);
    });
    return [details];
  });
  $('#action-list').replaceChildren(...(groups.length ? groups : [h('p', { class: 'library-empty' }, 'Nenhuma ação encontrada.')]));
}

function actionItem(item: ActionItem, group: ActionGroup, current: Binding | null) {
  const mobile = state.editorMode === 'mobile';
  const selectedRotary = state.selected !== null && state.selected >= 16 && (state.selected - 16) % 3 !== 1;
  const unavailable = (Boolean(group.app) && !tauri) || (!mobile && item.rotaryOnly === true && state.selected !== null && !selectedRotary);
  const active = Boolean(current && item.is(current));
  const button = h('button', {
    type: 'button', class: `action-item${active ? ' active' : ''}`, draggable: unavailable ? null : 'true', disabled: unavailable, 'aria-current': active ? 'true' : null
  }, h('span', { class: 'action-icon' }, icon(item.icon)), h('span', { class: 'action-text' }, h('span', {}, item.name), item.description ? h('small', {}, item.description) : null),
    active ? icon('check', 'icon action-check') : null);
  button.addEventListener('click', () => {
    if (mobile) { document.dispatchEvent(new CustomEvent('mobile-assign-action', { detail: { id: item.id } })); return; }
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
