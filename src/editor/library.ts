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

interface ActionItem { id: string; name: string; description?: string; icon: IconName; make: () => Binding; is: (binding: Binding) => boolean }
interface ActionGroup { title: string; app?: boolean; items: ActionItem[] }

// Ação do app de uma etapa só, já preenchida. "is" reconhece a ação atribuída ao controle selecionado,
// para destacá-la na lista; "match" distingue itens do mesmo tipo de etapa (OBS, áudio…).
function appItem(id: string, name: string, description: string, glyph: IconName, step: Step, match: (step: Step) => boolean = () => true): ActionItem {
  return {
    id, name, description, icon: glyph,
    make: () => ({ kind: 'app', multi: false, steps: [structuredClone(step)] }),
    is: binding => binding.kind === 'app' && !binding.multi && binding.steps[0]?.type === step.type && match(binding.steps[0])
  };
}
const fresh = (type: StepType) => newStep(type);
const obs = (action: StepOf<'obs'>['action']): Step => ({ ...newStep('obs') as StepOf<'obs'>, action });
const isObs = (...actions: string[]) => (step: Step) => step.type === 'obs' && actions.includes(step.action);
const audio = (target: StepOf<'audio'>['target'], action: StepOf<'audio'>['action']): Step => ({ ...newStep('audio') as StepOf<'audio'>, target, action });
const isAudio = (target: string) => (step: Step) => step.type === 'audio' && step.target === target;

const library: ActionGroup[] = [
  { title: 'Teclado', items: [{ id: 'key', name: 'Atalho de teclado', description: 'Combinação gravada no macropad', icon: 'keyboard', make: () => ({ kind: 'key', mods: 0, code: null }), is: binding => binding.kind === 'key' }] },
  {
    title: 'Multimídia', items: [...media].map(([name, code]): ActionItem => ({
      id: `media-${code}`, name, icon: mediaIcons.get(code) ?? 'volumeUp', make: () => ({ kind: 'media', media: code }), is: binding => binding.kind === 'media' && binding.media === code
    }))
  },
  {
    title: 'Sistema', app: true, items: [
      appItem('open', 'Abrir', 'Arquivo, pasta ou programa', 'folder', fresh('open')),
      appItem('website', 'Site', 'Abre no navegador padrão', 'globe', fresh('website')),
      appItem('text', 'Digitar texto', 'Escreve um texto pronto', 'text', fresh('text')),
      { id: 'multi', name: 'Multi-ação', description: 'Etapas em sequência, alternar, segurar, perfis', icon: 'multi', make: () => ({ kind: 'app', multi: true, steps: [] }), is: binding => binding.kind === 'app' && binding.multi },
      appItem('command', 'Comando', 'cmd, PowerShell ou script', 'terminal', fresh('command')),
      appItem('window', 'Janela', 'Minimizar, maximizar, mover…', 'window', fresh('window')),
      appItem('system', 'Sistema', 'Bloquear, suspender, tema…', 'power', fresh('system')),
      appItem('mouse', 'Mouse', 'Cliques e rolagem', 'mouse', fresh('mouse')),
      appItem('brightness', 'Brilho do monitor', 'DDC/CI, ótimo num knob', 'sun', fresh('brightness'))
    ]
  },
  {
    title: 'Áudio', app: true, items: [
      appItem('mic', 'Mudo do microfone', 'Em qualquer app de chamada', 'mic', audio('mic', 'toggle'), isAudio('mic')),
      appItem('output-volume', 'Volume do sistema', 'Saída padrão, em passos', 'volumeUp', audio('output', 'up'), isAudio('output')),
      appItem('app-volume', 'Volume de um programa', 'Spotify, Discord, jogo…', 'volumeUp', audio('app', 'up'), isAudio('app')),
      appItem('player', 'Player', 'Controla um player específico', 'playPause', fresh('player')),
      appItem('media-key', 'Tecla de mídia', 'Para usar em multi-ações', 'next', fresh('media')),
      appItem('sound', 'Tocar som', 'Soundboard (MP3, WAV)', 'music', fresh('sound'))
    ]
  },
  {
    title: 'Streaming', app: true, items: [
      appItem('obs-scene', 'OBS · Trocar de cena', 'Cena do OBS Studio', 'obs', obs('scene'), isObs('scene')),
      appItem('obs-record', 'OBS · Gravação', 'Iniciar, parar, pausar', 'obs', obs('record'), isObs('record', 'recordStart', 'recordStop', 'recordPause', 'chapter')),
      appItem('obs-stream', 'OBS · Transmissão', 'Entrar e sair do ar', 'obs', obs('stream'), isObs('stream', 'streamStart', 'streamStop')),
      appItem('obs-mute', 'OBS · Silenciar fonte', 'Microfone, áudio do desktop', 'mic', obs('mute'), isObs('mute')),
      appItem('obs-volume', 'OBS · Volume de fonte', 'Em dB, ótimo num knob', 'volumeUp', obs('volume'), isObs('volume')),
      appItem('obs-visibility', 'OBS · Mostrar / esconder', 'Câmera, overlay, "volto já"', 'eye', obs('visibility'), isObs('visibility')),
      appItem('obs-replay', 'OBS · Salvar replay', 'Clipe dos últimos segundos', 'obs', obs('replay'), isObs('replay', 'virtualcam', 'transition')),
      appItem('counter', 'Contador', 'Número num arquivo de texto', 'hash', fresh('counter'))
    ]
  },
  {
    title: 'Integrações', app: true, items: [
      appItem('http', 'Requisição HTTP', 'Webhooks, n8n, IFTTT, APIs', 'link', fresh('http')),
      appItem('homeassistant', 'Home Assistant', 'Luzes, tomadas, cenas', 'home', fresh('homeassistant')),
      appItem('midi', 'MIDI', 'Control change para DAWs', 'sliders', fresh('midi')),
      appItem('voicemeeter', 'Voicemeeter', 'Ganho e mudo de strips e buses', 'sliders', fresh('voicemeeter'))
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
