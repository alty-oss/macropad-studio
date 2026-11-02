// Painel de propriedades do controle selecionado: cabeçalho, miniatura, o formulário de cada ação
// e a aparência (legenda, ícone e cor) da tecla.
import { invoke } from '@tauri-apps/api/core';
import { media } from '../device/keys.ts';
import { appBindingError, appParts, equivalentSteps, knobParts, newStep, rotaryOnlyError, stepNames, type AppMode, type Binding, type BindingOf, type Step, type StepType } from '../device/protocol.ts';
import { $, h, inputValue, type Child } from '../lib/dom.ts';
import { customIcons, icon, type IconName } from '../lib/icons.ts';
import { errorText } from '../lib/text.ts';
import { setDraft } from './editing.ts';
import { toast } from './feedback.ts';
import { setLabel } from './labels.ts';
import { bindingMeta, keycapLegend, stepIcon } from './legend.ts';
import { renderLibrary } from './library.ts';
import { comboControl } from './shortcuts.ts';
import { appSuggestions, field, note, stepFields, type EditStep } from './step-forms.ts';
import { bindingAt, controlLabel, labelAt, layerData, state, tauri } from './state.ts';

export function renderInspector() { renderInspectorHead(); renderInspectorBody(); }

export function renderInspectorHead() {
  const slot = state.selected;
  // A biblioteca acompanha a seleção: destaca a ação atual e diz onde o clique vai atribuir.
  renderLibrary();
  if (!slot) { $('#inspector-head').replaceChildren(h('h2', { id: 'inspector-title', class: 'inspector-placeholder' }, 'Propriedades')); return; }
  const binding = bindingAt(slot), meta = bindingMeta(binding);
  $('#inspector-head').replaceChildren(h('div', { class: 'inspector-head-row' },
    h('span', { class: `inspector-icon${meta.where === 'app' ? ' via-app' : ''}` }, icon(meta.icon)),
    h('div', { class: 'inspector-title' },
      h('div', { class: 'inspector-title-row' },
        h('h2', { id: 'inspector-title' }, meta.title),
        meta.where === 'device' ? h('span', { class: 'chip' }, icon('logo'), 'No macropad') : null,
        meta.where === 'app' ? h('span', { class: 'chip chip-app' }, icon('bolt'), 'Via app') : null,
        layerData().drafts.has(slot) ? h('span', { class: 'chip chip-pending' }, 'Não gravado')
          // Ativa: o macropad já envia a tecla virtual deste controle e as etapas estão salvas no app.
          : binding.kind === 'app' && tauri && layerData().records.get(slot)?.kind === 'app' ? h('span', { class: 'chip chip-live' }, 'Ativa') : null),
      h('p', {}, `${controlLabel(slot)} · Camada ${state.layer}`)),
    h('div', { class: 'inspector-tools' },
      testableSteps(binding) && tauri ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => testSelected() }, icon('play'), 'Testar') : null,
      binding.kind !== 'empty' ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => setDraft(slot, { kind: 'empty' }) }, icon('trash'), 'Remover') : null)));
}

const emptyState = (title: string, text: string, name: IconName = 'empty') => h('div', { class: 'empty-state' }, h('span', { class: 'empty-icon' }, icon(name)), h('strong', {}, title), h('p', {}, text));
const section = (title: string, ...content: Child[]) => h('section', { class: 'inspector-section' }, h('h3', {}, title), ...content);

function renderInspectorBody() {
  const slot = state.selected;
  const body = $('#inspector-body');
  if (!slot) {
    body.replaceChildren(emptyState('Selecione uma tecla ou um knob', 'Arraste uma ação da lista à direita até um controle, ou selecione o controle e clique na ação.', 'logo'));
    return;
  }
  const binding = bindingAt(slot);
  // Miniatura do controle à esquerda, o formulário ao lado e a aparência numa coluna à direita.
  const layout = (main: Child[], side: Child = null) => body.replaceChildren(h('div', { class: 'inspector-grid' }, controlPreview(slot), h('div', { class: 'inspector-main' }, ...main), side ? h('div', { class: 'inspector-side' }, side) : null));
  const onDevice = note('Fica gravado no macropad e funciona em qualquer computador, mesmo com o app fechado.');
  const looks = binding.kind === 'empty' || binding.kind === 'raw' ? null : appearance(slot);
  switch (binding.kind) {
    case 'empty':
      layout([h('div', { class: 'inspector-hint' }, h('strong', {}, 'Sem ação'), h('p', {}, 'Arraste uma ação da lista à direita até este controle, ou clique em uma ação para atribuí-la.'))]);
      break;
    case 'key':
      layout([h('div', { class: 'form' }, field('Combinação', comboControl(binding, combo => setDraft(slot, { kind: 'key', ...combo })))), onDevice], looks);
      break;
    case 'media': {
      const picker = h('select', { class: 'input', onchange: event => setDraft(slot, { kind: 'media', media: Number(inputValue(event)) }) },
        [...media].map(([name, code]) => h('option', { value: code, selected: code === binding.media }, name)));
      layout([h('div', { class: 'form' }, field('Ação', picker)), onDevice], looks);
      break;
    }
    case 'raw':
      layout([note(`${binding.label}. Foi gravada por outro programa e este editor não a representa; ela será mantida até você atribuir outra ação.`, 'warning')]);
      break;
    case 'app':
      layout([...appEditor(slot, binding), rotaryOnlyError(slot, binding) ? note(rotaryOnlyError(slot, binding)!, 'warning') : null,
        tauri ? null : note('Ações do app só funcionam no Macropad Studio para Windows.', 'warning')], looks);
  }
}

// Miniatura do controle selecionado, com o mesmo acabamento da pré-visualização do aparelho.
export function controlPreview(slot: number) {
  if (slot >= 16) {
    const part = knobParts[(slot - 16) % 3];
    return h('div', { class: 'control-preview' },
      h('div', { class: 'preview-stage' }, h('div', { class: 'knob-press preview-knob' }, h('span', { class: 'knob-indicator' })),
        h('span', { class: 'preview-badge' }, icon(part.icon))));
  }
  const key = h('div', { class: 'keycap preview-key' }, keycapLegend(bindingAt(slot), labelAt(slot)));
  const color = labelAt(slot)?.color;
  if (color) key.style.setProperty('--keycap-accent', color);
  return h('div', { class: 'control-preview' }, h('div', { class: 'preview-stage' }, key));
}

// Qual lista de etapas um editor altera: as principais, as alternativas (segunda pressão ou
// segurar) ou as de um perfil.
type ListKey = { list: 'steps' } | { list: 'alt' } | { list: 'profile'; index: number };
type Update = (change: (binding: Required<BindingOf<'app'>>) => void, rerender?: boolean) => void;
function listOf(binding: Required<BindingOf<'app'>>, key: ListKey): Step[] {
  return key.list === 'steps' ? binding.steps : key.list === 'alt' ? binding.alt : binding.profiles[key.index].steps;
}

function appEditor(slot: number, binding: BindingOf<'app'>): Child[] {
  // Lê sempre a versão atual: os campos de texto não redesenham o painel a cada tecla.
  const update: Update = (change, rerender = false) => {
    const current = bindingAt(slot);
    if (current.kind !== 'app') return;
    const next = { kind: 'app' as const, ...structuredClone(appParts(current)) };
    change(next);
    setDraft(slot, next, { keepBody: !rerender });
  };
  if (!binding.multi) {
    const [step] = binding.steps;
    const edit: EditStep = (patch, rerender) => update(next => { Object.assign(next.steps[0], patch); }, rerender);
    return [
      h('div', { class: 'form' }, step ? stepFields(step, edit) : null),
      h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn-link', onclick: () => update(next => { next.multi = true; }, true) },
        'Converter em multi-ação (etapas, alternar, segurar e perfis por programa)'))
    ];
  }
  const parts = appParts(binding);
  const modeSelect = h('select', { class: 'input', onchange: event => update(next => { next.mode = inputValue(event) as AppMode; }, true) },
    ([['normal', 'Executar as etapas a cada pressão'], ['toggle', 'Alternar: cada pressão executa uma lista'], ['hold', 'Tocar ou segurar a tecla']] as const)
      .map(([value, name]) => h('option', { value, selected: parts.mode === value }, name)));
  const altTitle = parts.mode === 'toggle' ? 'Segunda pressão' : 'Ao segurar';
  return [
    stepList(parts.steps, { list: 'steps' }, update),
    section('Comportamento', h('div', { class: 'form' }, field('Modo', modeSelect)),
      parts.mode === 'hold' ? note('Segurar por meio segundo executa a segunda lista. Funciona quando o macropad mantém a tecla pressionada enquanto você segura.') : null,
      parts.mode === 'normal' ? null : h('div', { class: 'subsection' }, h('h4', {}, altTitle), stepList(parts.alt, { list: 'alt' }, update))),
    profilesEditor(parts.profiles, update)
  ];
}

function profilesEditor(profiles: { app: string; steps: Step[] }[], update: Update) {
  const items = profiles.map((profile, index) => {
    const [listId, list] = appSuggestions();
    return h('div', { class: 'profile' },
      h('div', { class: 'profile-head' }, icon('app'),
        h('input', { class: 'input', value: profile.app, placeholder: 'photoshop.exe', spellcheck: 'false', list: listId, 'aria-label': 'Programa', oninput: event => update(next => { next.profiles[index].app = inputValue(event).trim(); }) }), list,
        h('button', { type: 'button', class: 'btn btn-icon btn-tiny', 'aria-label': 'Remover perfil', onclick: () => update(next => { next.profiles.splice(index, 1); }, true) }, icon('trash'))),
      stepList(profile.steps, { list: 'profile', index }, update));
  });
  return section('Perfis por programa',
    note('Quando a janela em foco for de um destes programas, a tecla executa as etapas do perfil em vez das etapas acima.'),
    ...items,
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => update(next => { next.profiles.push({ app: '', steps: [] }); }, true) }, icon('app'), 'Adicionar perfil'));
}

function stepList(steps: Step[], key: ListKey, update: Update): Child[] {
  const last = steps.length - 1;
  const change = (mutate: (list: Step[]) => void, rerender = true) => update(next => mutate(listOf(next, key)), rerender);
  const tool = (name: IconName, label: string, disabled: boolean, action: () => void) =>
    h('button', { type: 'button', class: 'btn btn-icon btn-tiny', 'aria-label': label, disabled, onclick: action }, icon(name));
  const items = steps.map((step, index) => {
    const edit: EditStep = (patch, rerender) => change(list => { Object.assign(list[index], patch); }, rerender);
    return h('li', { class: 'step' },
      h('div', { class: 'step-head' },
        h('span', { class: 'step-index' }, String(index + 1)), icon(stepIcon(step)), h('strong', {}, stepNames[step.type]),
        h('span', { class: 'step-tools' },
          tool('arrowUp', 'Mover para cima', index === 0, () => change(list => { list.splice(index - 1, 0, ...list.splice(index, 1)); })),
          tool('arrowDown', 'Mover para baixo', index === last, () => change(list => { list.splice(index + 1, 0, ...list.splice(index, 1)); })),
          tool('copy', 'Duplicar etapa', false, () => change(list => { list.splice(index + 1, 0, structuredClone(list[index])); })),
          tool('trash', 'Remover etapa', false, () => change(list => { list.splice(index, 1); })))),
      h('div', { class: 'form' }, stepFields(step, edit)));
  });
  const rotary = state.selected !== null && state.selected >= 16 && (state.selected - 16) % 3 !== 1;
  const makeStep = (type: StepType): Step => {
    const step = newStep(type);
    if (!rotary && step.type === 'mouse' && step.action.startsWith('scroll')) step.action = 'left';
    if (!rotary && step.type === 'voicemeeter' && step.mode === 'add') step.mode = 'set';
    return step;
  };
  const add = h('select', { class: 'input add-step', 'aria-label': 'Adicionar etapa', onchange: event => change(list => { list.push(makeStep(inputValue(event) as StepType)); }) },
    h('option', { value: '' }, '+ Adicionar etapa'), Object.entries(stepNames).map(([type, name]) => h('option', { value: type, disabled: !rotary && type === 'brightness' }, name)));
  return [
    items.length ? h('ol', { class: 'step-list' }, items) : emptyState('Nenhuma etapa', 'Adicione etapas para executá-las em sequência: abrir um programa, aguardar, digitar um texto…'),
    add
  ];
}

// Cores sugeridas para destacar uma tecla na pré-visualização e na cola impressa.
const COLORS = ['#3286ff', '#45b58b', '#e8a948', '#e07979', '#b07cf2', '#4cc2d6'];
let labelTimer: ReturnType<typeof setTimeout> | undefined;

function appearance(slot: number) {
  const label = labelAt(slot);
  const layer = state.layer;
  const text = h('input', {
    class: 'input', value: label?.text ?? '', maxlength: 24, placeholder: 'Automática', spellcheck: 'false',
    oninput: event => {
      const value = inputValue(event);
      clearTimeout(labelTimer);
      labelTimer = setTimeout(() => setLabel(slot, { text: value }, layer).then(refreshPreview), 300);
    }
  });
  const choose = (patch: { icon?: string; color?: string }) => () => setLabel(slot, patch, layer).then(() => renderInspectorBody());
  const icons = h('div', { class: 'icon-picker', role: 'group', 'aria-label': 'Ícone' },
    h('button', { type: 'button', class: 'pick', 'aria-pressed': String(!label?.icon), 'aria-label': 'Ícone automático', onclick: choose({ icon: '' }) }, 'Auto'),
    customIcons.map(name => h('button', { type: 'button', class: 'pick', 'aria-pressed': String(label?.icon === name), 'aria-label': name, onclick: choose({ icon: name }) }, icon(name))));
  const colors = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Cor' },
    h('button', { type: 'button', class: 'swatch swatch-none', 'aria-pressed': String(!label?.color), 'aria-label': 'Sem cor', onclick: choose({ color: '' }) }),
    COLORS.map(color => {
      const swatch = h('button', { type: 'button', class: 'swatch', 'aria-pressed': String(label?.color === color), 'aria-label': `Cor ${color}`, onclick: choose({ color }) });
      swatch.style.background = color;
      return swatch;
    }));
  return section('Aparência', h('div', { class: 'form' }, field('Legenda', text), slot < 16 ? field('Ícone', icons) : null, field('Cor', colors)),
    note('A aparência fica salva no app e vale na hora, sem gravar no macropad.'));
}
function refreshPreview() {
  if (state.selected) document.querySelector('#inspector-body .control-preview')?.replaceWith(controlPreview(state.selected));
}

// Etapas que reproduzem a ação, para testar sem gravar: ações do app e também atalhos e mídia
// gravados no aparelho.
const testableSteps = equivalentSteps;

export async function testSelected() {
  const binding = state.selected ? bindingAt(state.selected) : null;
  const steps = binding && testableSteps(binding);
  if (!binding || !steps) return;
  const error = binding.kind === 'app' ? appBindingError(binding) : null;
  if (error) { toast(error, 'error'); return; }
  // Texto, atalhos e cliques vão para a janela em foco; damos tempo para trocar de janela.
  const typed = steps.some(step => step.type === 'text' || step.type === 'hotkey' || step.type === 'mouse' || step.type === 'window');
  if (typed) toast('Mude para a janela de destino: a ação começa em 3 segundos.');
  try { await invoke('macro_test', { steps: typed ? [{ type: 'delay', ms: 3000 }, ...steps] : steps }); }
  catch (failure) { toast(errorText(failure), 'error'); }
}
