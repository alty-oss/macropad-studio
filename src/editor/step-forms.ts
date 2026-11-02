// Formulários das etapas das ações do app. Cada etapa vira uma lista de campos; "edit" aplica uma
// alteração parcial (e redesenha o painel quando a forma do formulário muda).
import { invoke } from '@tauri-apps/api/core';
import {
  audioActions, audioTargets, httpMethods, mediaKeys, mouseActions, obsActions, obsNeedsScene,
  obsNeedsSource, systemActions, voicemeeterModes, windowActions, type Step, type StepOf
} from '../device/steps.ts';
import { h, inputValue, type Child } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { PROGRAM_PATH } from './legend.ts';
import { showMenu } from './menu.ts';
import { comboControl } from './shortcuts.ts';
import { state, tauri } from './state.ts';

export type EditStep = (patch: object, rerender?: boolean) => void;

export const field = (label: string, ...control: Child[]) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), h('div', { class: 'field-control' }, ...control));
export const note = (text: string, tone: 'info' | 'warning' = 'info') => h('p', { class: `note note-${tone}` }, icon(tone === 'warning' ? 'warning' : 'info'), h('span', {}, text));

function select<T extends string>(options: readonly (readonly [T, string])[], value: string, onChange: (value: T) => void) {
  return h('select', { class: 'input', onchange: (event: Event) => onChange(inputValue(event) as T) },
    options.map(([key, name]) => h('option', { value: key, selected: key === value }, name)));
}
const textInput = (value: string, placeholder: string, onInput: (value: string) => void, list?: string) =>
  h('input', { class: 'input', value, placeholder, spellcheck: 'false', list, oninput: (event: Event) => onInput(inputValue(event)) });
function numberInput(value: number, { min, max, step = 1, suffix = '', integer = true }: { min: number; max: number; step?: number; suffix?: string; integer?: boolean }, onInput: (value: number) => void) {
  const input = h('input', {
    class: 'input', type: 'number', min, max, step, value,
    oninput: (event: Event) => {
      const raw = Number(inputValue(event));
      if (!Number.isFinite(raw)) return;
      const clamped = Math.max(min, Math.min(max, integer ? Math.round(raw) : raw));
      onInput(clamped);
    }
  });
  return h('div', { class: 'input-group input-short' }, input, suffix ? h('span', { class: 'input-suffix' }, suffix) : null);
}
const checkbox = (checked: boolean, label: string, onChange: (checked: boolean) => void) =>
  h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked, onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked) }), h('span', {}, label));

// Sugestões de um campo de texto (datalist), preenchidas quando a lista chega do app.
let listIds = 0;
function suggestions(load: () => Promise<string[]>): [string, HTMLDataListElement] {
  const id = `suggestions-${++listIds}`;
  const list = h('datalist', { id });
  load().then(items => list.replaceChildren(...items.map(item => h('option', { value: item })))).catch(() => {});
  return [id, list];
}

// Listas vindas do app (cenas do OBS, fontes, programas abertos…), guardadas por alguns segundos para
// não refazer o pedido a cada tecla digitada.
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15000) return hit.value as Promise<T>;
  const value = load();
  value.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), value });
  return value;
}
const nativeList = <T>(command: string, args?: Record<string, unknown>) =>
  tauri ? cached(`${command}:${JSON.stringify(args ?? {})}`, () => invoke<T>(command, args)) : Promise.reject(new Error('Disponível no app para Windows.'));
const obsLists = () => nativeList<{ scenes: string[]; inputs: string[] }>('obs_lists');
const runningApps = () => nativeList<string[]>('running_apps');
export const appSuggestions = () => suggestions(runningApps);

function browseButton(onPick: (path: string) => void, { folder = 'both', save = false }: { folder?: 'both' | 'file' | 'folder'; save?: boolean } = {}) {
  return h('button', {
    type: 'button', class: 'btn btn-small', disabled: !tauri, 'aria-haspopup': folder === 'both' ? 'menu' : null,
    onclick: async (event: MouseEvent) => {
      const pick = (asFolder: boolean) => async () => {
        const path = await invoke<string | null>('pick_path', { folder: asFolder, save });
        if (path) onPick(path);
      };
      if (folder === 'file') { await pick(false)(); return; }
      if (folder === 'folder') { await pick(true)(); return; }
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      showMenu(box.left, box.bottom + 4, [
        { label: 'Escolher arquivo ou programa…', icon: 'file', action: pick(false) },
        { label: 'Escolher pasta…', icon: 'folder', action: pick(true) }
      ]);
    }
  }, 'Procurar', folder === 'both' ? icon('arrowDown') : null);
}
function simplePath(value: string, placeholder: string, edit: EditStep, options: { save?: boolean; folder?: 'file' | 'folder' } = {}) {
  const input = h('input', { class: 'input path-input', value, placeholder, spellcheck: 'false', oninput: (event: Event) => edit({ path: inputValue(event) }) });
  return h('div', { class: 'path-field' }, h('div', { class: 'path-box' }, h('span', { class: 'path-icon' }, icon('file')), input,
    browseButton(path => edit({ path }, true), { folder: options.folder ?? 'file', save: options.save })));
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
function openFields(step: StepOf<'open'>, edit: EditStep) {
  const kindIcon = h('span', { class: 'path-icon' });
  const status = h('span', { class: 'path-status' });
  const argsField = field('Argumentos', h('input', { class: 'input', value: step.args, placeholder: 'Opcional, por exemplo --new-window', spellcheck: 'false', oninput: event => edit({ args: inputValue(event) }) }));
  const focusField = field('', checkbox(Boolean(step.focus), 'Se já estiver aberto, trazer a janela para frente', focus => edit({ focus })));
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
    focusField.hidden = kind !== 'program' && kind !== 'missing' && kind !== 'unknown';
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const input = h('input', {
    class: 'input path-input', value: step.path, placeholder: 'C:\\Programas\\app.exe', spellcheck: 'false', 'aria-label': 'Caminho',
    oninput: event => {
      const path = inputValue(event);
      edit({ path });
      clearTimeout(timer);
      timer = setTimeout(() => check(path), 250);
    }
  });
  check(step.path);
  return [
    field('Caminho', h('div', { class: 'path-field' }, h('div', { class: 'path-box' }, kindIcon, input, browseButton(path => edit({ path }, true))), status)),
    argsField,
    focusField
  ];
}

const VOICEMEETER_PARAMETERS = [0, 1, 2, 3, 4].flatMap(i => [`Strip[${i}].Gain`, `Strip[${i}].Mute`, `Bus[${i}].Gain`, `Bus[${i}].Mute`]);

export function stepFields(step: Step, edit: EditStep): HTMLElement[] {
  switch (step.type) {
    case 'open': return openFields(step, edit);
    case 'website':
      return [field('Endereço', h('input', {
        class: 'input', type: 'url', value: step.url, placeholder: 'https://', spellcheck: 'false',
        oninput: event => edit({ url: inputValue(event) }),
        onchange: event => {
          const target = event.target as HTMLInputElement;
          const url = target.value.trim();
          if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) { target.value = `https://${url}`; edit({ url: target.value }); }
        }
      }))];
    case 'text':
      return [
        field('Texto', h('textarea', { class: 'input', rows: 3, value: step.text, placeholder: 'Texto que será digitado na janela em foco', oninput: event => edit({ text: inputValue(event) }) })),
        field('', h('div', { class: 'field-stack' },
          checkbox(Boolean(step.paste), 'Colar pela área de transferência (mais rápido para textos longos)', paste => edit({ paste })),
          h('small', { class: 'field-hint' }, 'Variáveis: {data}, {hora} e {clipboard}.')))
      ];
    case 'hotkey':
      return [field('Combinação', comboControl(step, combo => edit(combo, true)))];
    case 'delay':
      return [field('Aguardar', numberInput(step.ms, { min: 0, max: 60000, step: 50, suffix: 'ms' }, ms => edit({ ms })))];
    case 'media':
      return [field('Tecla', select(mediaKeys, step.key, key => edit({ key })))];
    case 'command':
      return [
        field('Comando', h('textarea', { class: 'input mono', rows: 2, value: step.command, placeholder: 'Por exemplo: powershell -File C:\\scripts\\backup.ps1', spellcheck: 'false', oninput: event => edit({ command: inputValue(event) }) })),
        field('', checkbox(step.hidden, 'Executar sem abrir janela', hidden => edit({ hidden })))
      ];
    case 'http':
      return [
        field('Método', h('div', { class: 'input-group' }, select(httpMethods, step.method, method => edit({ method })))),
        field('Endereço', textInput(step.url, 'https://exemplo.com/webhook', url => edit({ url }))),
        field('Cabeçalhos', h('textarea', { class: 'input mono', rows: 2, value: step.headers, placeholder: 'Authorization: Bearer …  (um por linha)', spellcheck: 'false', oninput: event => edit({ headers: inputValue(event) }) })),
        field('Corpo', h('textarea', { class: 'input mono', rows: 3, value: step.body, placeholder: '{"acao": "ligar"}', spellcheck: 'false', oninput: event => edit({ body: inputValue(event) }) }))
      ];
    case 'audio': {
      const [listId, list] = appSuggestions();
      return [
        field('Dispositivo', select(audioTargets, step.target, target => edit({ target }, true))),
        step.target === 'app' ? field('Programa', textInput(step.app, 'spotify.exe', app => edit({ app }), listId), list) : null,
        field('Ação', select(audioActions, step.action, action => edit({ action }, true))),
        step.action === 'up' || step.action === 'down' ? field('Passo', numberInput(step.amount, { min: 1, max: 100, suffix: '%' }, amount => edit({ amount }))) : null
      ].filter(Boolean) as HTMLElement[];
    }
    case 'window':
      return [field('Ação', select(windowActions, step.action, action => edit({ action }))), note('Age sobre a janela em foco.')];
    case 'system':
      return [
        field('Ação', select(systemActions, step.action, action => edit({ action }, true))),
        step.action === 'shutdown' || step.action === 'restart' ? note('O computador desliga na hora, sem pedir confirmação. Salve seu trabalho antes de usar.', 'warning') : null
      ].filter(Boolean) as HTMLElement[];
    case 'mouse':
      return [
        field('Ação', select(mouseActions, step.action, action => edit({ action }, true))),
        step.action.startsWith('scroll') ? field('Quantidade', numberInput(step.amount, { min: 1, max: 20, suffix: 'cliques' }, amount => edit({ amount }))) : null
      ].filter(Boolean) as HTMLElement[];
    case 'sound':
      return [field('Arquivo', simplePath(step.path, 'C:\\Sons\\aplausos.mp3', edit)), note('MP3 e WAV tocam sem esperar o fim: dá para usar como soundboard.')];
    case 'counter':
      return [
        field('Arquivo', simplePath(step.path, 'C:\\Stream\\contador.txt', edit, { save: true })),
        field('Somar', numberInput(step.change, { min: -1000, max: 1000 }, change => edit({ change }))),
        note('Use 0 para zerar. No OBS, adicione uma fonte de texto lendo este arquivo.')
      ];
    case 'brightness':
      return [field('Ajuste', numberInput(step.change, { min: -100, max: 100, step: 5, suffix: '%' }, change => edit({ change }))), note('Monitores externos com DDC/CI. Use valores negativos para escurecer.')];
    case 'obs': return obsFields(step, edit);
    case 'voicemeeter': {
      const listId = `voicemeeter-${++listIds}`;
      return [
        field('Parâmetro', textInput(step.parameter, 'Strip[0].Gain', parameter => edit({ parameter }), listId),
          h('datalist', { id: listId }, VOICEMEETER_PARAMETERS.map(name => h('option', { value: name })))),
        field('Modo', select(voicemeeterModes, step.mode, mode => edit({ mode }, true))),
        step.mode === 'toggle' ? null : field('Valor', numberInput(step.value, { min: -100, max: 100, step: 0.5, integer: false }, value => edit({ value })))
      ].filter(Boolean) as HTMLElement[];
    }
  }
}

function obsFields(step: StepOf<'obs'>, edit: EditStep): HTMLElement[] {
  const [scenesId, scenes] = suggestions(() => obsLists().then(lists => lists.scenes));
  const [sourcesId, sources] = suggestions(() => step.action === 'visibility' && step.scene
    ? nativeList<string[]>('obs_scene_sources', { scene: step.scene })
    : obsLists().then(lists => lists.inputs));
  const status = state.obs.connected ? null
    : note(state.obs.error ? `OBS: ${state.obs.error} Os nomes podem ser digitados mesmo assim.` : 'Ative a integração com o OBS em Configurações para listar cenas e fontes.', 'warning');
  return [
    field('Ação', select(obsActions, step.action, action => edit({ action }, true))),
    obsNeedsScene.has(step.action) ? field('Cena', textInput(step.scene, step.action === 'visibility' ? 'Vazio: cena atual' : 'Nome da cena', scene => edit({ scene }), scenesId), scenes) : null,
    obsNeedsSource.has(step.action) ? field('Fonte', textInput(step.source, step.action === 'visibility' ? 'Câmera, overlay…' : 'Microfone, Áudio do desktop…', source => edit({ source }), sourcesId), sources) : null,
    step.action === 'volume' ? field('Ajuste', numberInput(step.amount, { min: -100, max: 100, step: 0.5, suffix: 'dB', integer: false }, amount => edit({ amount }))) : null,
    step.action === 'screenshot' ? field('Pasta', simplePath(step.path ?? '', 'C:\\Screenshots', edit, { folder: 'folder' })) : null,
    step.action === 'screenshot' ? note('O arquivo será salvo automaticamente em PNG, com o nome da fonte e a data/hora.') : null,
    status
  ].filter(Boolean) as HTMLElement[];
}

// Atualiza a lista de cenas e fontes depois de configurar o OBS.
export function forgetLists() { cache.clear(); }
