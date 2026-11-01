// Painel de propriedades do controle selecionado: cabeçalho, miniatura e o formulário de cada ação.
import { invoke } from '@tauri-apps/api/core';
import { media } from '../device/keys.ts';
import { appBindingError, knobParts, newStep, stepNames, type BindingOf, type Step, type StepType } from '../device/protocol.ts';
import { $, h, inputValue, type Child } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { errorText } from '../lib/text.ts';
import { setDraft } from './editing.ts';
import { toast } from './feedback.ts';
import { bindingMeta, keycapLegend, PROGRAM_PATH, stepIcon } from './legend.ts';
import { renderLibrary } from './library.ts';
import { showMenu } from './menu.ts';
import { comboControl } from './shortcuts.ts';
import { bindingAt, controlLabel, layerData, state, tauri } from './state.ts';

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
      binding.kind === 'app' && tauri ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => testSelected() }, icon('play'), 'Testar') : null,
      binding.kind !== 'empty' ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => setDraft(slot, { kind: 'empty' }) }, icon('trash'), 'Remover') : null)));
}

const emptyState = (title: string, text: string, name: IconName = 'empty') => h('div', { class: 'empty-state' }, h('span', { class: 'empty-icon' }, icon(name)), h('strong', {}, title), h('p', {}, text));
const field = (label: string, ...control: Child[]) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), h('div', { class: 'field-control' }, ...control));
const note = (text: string, tone: 'info' | 'warning' = 'info') => h('p', { class: `note note-${tone}` }, icon(tone === 'warning' ? 'warning' : 'info'), h('span', {}, text));

function renderInspectorBody() {
  const slot = state.selected;
  const body = $('#inspector-body');
  if (!slot) {
    body.replaceChildren(emptyState('Selecione uma tecla ou um knob', 'Arraste uma ação da lista à direita até um controle, ou selecione o controle e clique na ação.', 'logo'));
    return;
  }
  const binding = bindingAt(slot);
  // Miniatura do controle à esquerda e o formulário ao lado, num bloco só.
  const layout = (...main: Child[]) => body.replaceChildren(h('div', { class: 'inspector-grid' }, controlPreview(slot), h('div', { class: 'inspector-main' }, ...main)));
  const onDevice = note('Fica gravado no macropad e funciona em qualquer computador, mesmo com o app fechado.');
  switch (binding.kind) {
    case 'empty':
      layout(h('div', { class: 'inspector-hint' }, h('strong', {}, 'Sem ação'), h('p', {}, 'Arraste uma ação da lista à direita até este controle, ou clique em uma ação para atribuí-la.')));
      break;
    case 'key':
      layout(h('div', { class: 'form' }, field('Combinação', comboControl(binding, combo => setDraft(slot, { kind: 'key', ...combo })))), onDevice);
      break;
    case 'media': {
      const picker = h('select', { class: 'input', onchange: event => setDraft(slot, { kind: 'media', media: Number(inputValue(event)) }) },
        [...media].map(([name, code]) => h('option', { value: code, selected: code === binding.media }, name)));
      layout(h('div', { class: 'form' }, field('Ação', picker)), onDevice);
      break;
    }
    case 'raw':
      layout(note(`${binding.label}. Foi gravada por outro programa e este editor não a representa; ela será mantida até você atribuir outra ação.`, 'warning'));
      break;
    case 'app':
      layout(...appEditor(slot, binding), tauri ? null : note('Ações do app só funcionam no Macropad Studio para Windows.', 'warning'));
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
  return h('div', { class: 'control-preview' },
    h('div', { class: 'preview-stage' }, h('div', { class: 'keycap preview-key' }, keycapLegend(bindingAt(slot)))));
}

// Alterações parciais de uma etapa; Object.assign aplica só os campos do tipo dela.
type StepPatch = Partial<{ path: string; args: string; url: string; text: string; mods: number; code: number | null; ms: number }>;
type EditStep = (index: number, patch: StepPatch, rerender?: boolean) => void;
type SetSteps = (change: (steps: Step[]) => void, rerender?: boolean) => void;
function appEditor(slot: number, binding: BindingOf<'app'>): Child[] {
  // Lê sempre a versão atual: os campos de texto não redesenham o painel a cada tecla.
  const setSteps: SetSteps = (change, rerender = false) => {
    const current = bindingAt(slot);
    if (current.kind !== 'app') return;
    const steps = structuredClone(current.steps);
    change(steps);
    setDraft(slot, { ...current, steps }, { keepBody: !rerender });
  };
  const edit: EditStep = (index, patch, rerender) => setSteps(steps => { Object.assign(steps[index], patch); }, rerender);
  return binding.multi ? stepList(binding, edit, setSteps) : [h('div', { class: 'form' }, binding.steps[0] ? stepFields(binding.steps[0], 0, edit) : null)];
}

// Caminho de "Abrir": o ícone e a linha de status dizem o que foi encontrado no disco, e os
// argumentos só aparecem para programas.
const URI_PATH = /^[a-z][a-z0-9+.-]+:(?![\\/])/i;
const pathKinds = {
  empty: { icon: 'folder', text: 'Escolha um arquivo, uma pasta ou um programa.' },
  dir: { icon: 'folder', text: 'Pasta encontrada', tone: 'ok' },
  program: { icon: 'app', text: 'Programa encontrado', tone: 'ok' },
  file: { icon: 'file', text: 'Arquivo encontrado: abre no programa padrão', tone: 'ok' },
  uri: { icon: 'globe', text: 'Endereço do Windows, como ms-settings: ou shell:startup' },
  missing: { icon: 'warning', text: 'Caminho não encontrado. Confira se ele existe neste computador.', tone: 'warning' },
  unknown: { icon: 'file', text: '' }
} satisfies Record<string, { icon: IconName; text: string; tone?: string }>;
type PathKind = keyof typeof pathKinds;
async function pathKind(path: string): Promise<PathKind> {
  const trimmed = path.trim();
  if (!trimmed) return 'empty';
  if (URI_PATH.test(trimmed)) return 'uri';
  if (!tauri) return 'unknown';
  const kind = await invoke<'dir' | 'file' | 'missing'>('path_kind', { path: trimmed }).catch((): PathKind => 'unknown');
  return kind === 'file' && PROGRAM_PATH.test(trimmed) ? 'program' : kind;
}
function openFields(step: Extract<Step, { type: 'open' }>, index: number, edit: EditStep) {
  const kindIcon = h('span', { class: 'path-icon' });
  const status = h('span', { class: 'path-status' });
  const argsField = field('Argumentos', h('input', { class: 'input', value: step.args, placeholder: 'Opcional, por exemplo --new-window', spellcheck: 'false', oninput: event => edit(index, { args: inputValue(event) }) }));
  let checking = 0;
  const check = async (path: string) => {
    const ticket = ++checking;
    const kind = await pathKind(path);
    if (ticket !== checking) return;
    const info: { icon: IconName; text: string; tone?: string } = pathKinds[kind];
    kindIcon.replaceChildren(icon(info.icon));
    kindIcon.dataset.tone = info.tone || '';
    status.textContent = info.text;
    status.dataset.tone = info.tone || '';
    argsField.hidden = kind === 'dir' || kind === 'file';
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const input = h('input', {
    class: 'input path-input', value: step.path, placeholder: 'C:\\Programas\\app.exe', spellcheck: 'false', 'aria-label': 'Caminho',
    oninput: event => {
      const path = inputValue(event);
      edit(index, { path });
      clearTimeout(timer);
      timer = setTimeout(() => check(path), 250);
    }
  });
  const browse = h('button', {
    type: 'button', class: 'btn btn-small', disabled: !tauri, 'aria-haspopup': 'menu',
    onclick: event => {
      const pick = (folder: boolean) => async () => {
        const path = await invoke<string | null>('pick_path', { folder });
        if (path) edit(index, { path }, true);
      };
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      showMenu(box.left, box.bottom + 4, [
        { label: 'Escolher arquivo ou programa…', icon: 'file', action: pick(false) },
        { label: 'Escolher pasta…', icon: 'folder', action: pick(true) }
      ]);
    }
  }, 'Procurar', icon('arrowDown'));
  check(step.path);
  return [
    field('Caminho', h('div', { class: 'path-field' }, h('div', { class: 'path-box' }, kindIcon, input, browse), status)),
    argsField
  ];
}
function stepFields(step: Step, index: number, edit: EditStep): HTMLElement[] {
  switch (step.type) {
    case 'open': return openFields(step, index, edit);
    case 'website':
      return [field('Endereço', h('input', {
        class: 'input', type: 'url', value: step.url, placeholder: 'https://', spellcheck: 'false',
        oninput: event => edit(index, { url: inputValue(event) }),
        onchange: event => {
          const target = event.target as HTMLInputElement;
          const url = target.value.trim();
          if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) { target.value = `https://${url}`; edit(index, { url: target.value }); }
        }
      }))];
    case 'text':
      return [field('Texto', h('textarea', { class: 'input', rows: 3, value: step.text, placeholder: 'Texto que será digitado na janela em foco', oninput: event => edit(index, { text: inputValue(event) }) }))];
    case 'hotkey':
      return [field('Combinação', comboControl(step, combo => edit(index, combo, true)))];
    case 'delay':
      return [field('Aguardar', h('div', { class: 'input-group input-short' },
        h('input', { class: 'input', type: 'number', min: 0, max: 60000, step: 50, value: step.ms, oninput: event => edit(index, { ms: Math.max(0, Math.min(60000, Number(inputValue(event)) || 0)) }) }),
        h('span', { class: 'input-suffix' }, 'ms')))];
  }
}
function stepList(binding: BindingOf<'app'>, edit: EditStep, setSteps: SetSteps): Child[] {
  const last = binding.steps.length - 1;
  const tool = (name: IconName, label: string, disabled: boolean, action: () => void) =>
    h('button', { type: 'button', class: 'btn btn-icon btn-tiny', 'aria-label': label, disabled, onclick: action }, icon(name));
  const items = binding.steps.map((step, index) => h('li', { class: 'step' },
    h('div', { class: 'step-head' },
      h('span', { class: 'step-index' }, String(index + 1)), icon(stepIcon(step)), h('strong', {}, stepNames[step.type]),
      h('span', { class: 'step-tools' },
        tool('arrowUp', 'Mover para cima', index === 0, () => setSteps(steps => { steps.splice(index - 1, 0, ...steps.splice(index, 1)); }, true)),
        tool('arrowDown', 'Mover para baixo', index === last, () => setSteps(steps => { steps.splice(index + 1, 0, ...steps.splice(index, 1)); }, true)),
        tool('trash', 'Remover etapa', false, () => setSteps(steps => { steps.splice(index, 1); }, true)))),
    h('div', { class: 'form' }, stepFields(step, index, edit))));
  const add = h('select', { class: 'input add-step', 'aria-label': 'Adicionar etapa', onchange: event => setSteps(steps => { steps.push(newStep(inputValue(event) as StepType)); }, true) },
    h('option', { value: '' }, '+ Adicionar etapa'), Object.entries(stepNames).map(([type, name]) => h('option', { value: type }, name)));
  return [
    items.length ? h('ol', { class: 'step-list' }, items) : emptyState('Nenhuma etapa', 'Adicione etapas para executá-las em sequência: abrir um programa, aguardar, digitar um texto…'),
    add
  ];
}

// Executa a ação do app selecionada, sem precisar gravar no macropad.
export async function testSelected() {
  const binding = state.selected ? bindingAt(state.selected) : null;
  if (binding?.kind !== 'app') return;
  const error = appBindingError(binding);
  if (error) { toast(error, 'error'); return; }
  // Texto e atalhos vão para a janela em foco; damos tempo para trocar de janela.
  const typed = binding.steps.some(step => step.type === 'text' || step.type === 'hotkey');
  if (typed) toast('Mude para a janela de destino: a ação começa em 3 segundos.');
  try { await invoke('macro_test', { steps: typed ? [{ type: 'delay', ms: 3000 }, ...binding.steps] : binding.steps }); }
  catch (failure) { toast(errorText(failure), 'error'); }
}
