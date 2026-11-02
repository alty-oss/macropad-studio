// Editor da página exclusiva do celular, com pastas. Nunca chama o transporte HID.
import { invoke } from '@tauri-apps/api/core';
import { appBindingError, appParts, equivalentSteps, isRotaryOnlyStep, MOBILE_MAX_FOLDER, newStep, stepNames, type AppMode, type Binding, type BindingOf, type MobileButton, type MobilePage, type Step, type StepType } from '../device/protocol.ts';
import { $, h, inputValue, type Child } from '../lib/dom.ts';
import { customIcons, icon, isIconName, type IconName } from '../lib/icons.ts';
import { errorText } from '../lib/text.ts';
import { DRAG_ACTION, DRAG_SLOT } from './board.ts';
import { toast } from './feedback.ts';
import { stepIcon } from './legend.ts';
import { actionById, renderLibrary } from './library.ts';
import { appSuggestions, field, note, stepFields, type EditStep } from './step-forms.ts';
import { state, tauri } from './state.ts';

export const MOBILE_COLORS = ['#2f6bff', '#1b3fd6', '#8e5cff', '#ff4fa3', '#ff5a4f', '#ff9a2e', '#f5c400', '#2fd27f', '#1de9b6', '#18c3ff', '#5b6170'];
const ORIENTATION_KEY = 'mobile-preview-portrait';
const MOBILE_DRAG = 'mobile:';

let data: MobilePage = { buttons: [], folders: [] };
// Pastas abertas a partir da página principal; a última é a página exibida.
let path: number[] = [];
let selected = 1;
let dirty = false;
let loaded = false;
let portrait = (() => { try { return localStorage.getItem(ORIENTATION_KEY) === '1'; } catch { return false; } })();

const pageId = () => path.at(-1) ?? 0;
const folderById = (id: number) => data.folders.find(folder => folder.id === id);
const folderName = (id: number) => folderById(id)?.name.trim() || 'Pasta';
const pageButtons = (id = pageId()) => id ? folderById(id)?.buttons ?? [] : data.buttons;
const isBack = (slot: number) => pageId() !== 0 && slot === 1;
const empty = (slot: number): MobileButton => ({ slot, folder: 0, text: '', icon: '', color: '', image: '', fit: '', multi: false, steps: [], mode: 'normal', alt: [], profiles: [] });
const buttonAt = (slot: number) => pageButtons().find(button => button.slot === slot) ?? empty(slot);
const used = (button: MobileButton) => Boolean(button.folder || button.steps.length || button.multi);

function setPageButtons(list: MobileButton[]) {
  const id = pageId();
  if (!id) data.buttons = list;
  else { const folder = folderById(id); if (folder) folder.buttons = list; }
}

// Pastas que nenhum botão alcança a partir da página principal são apagadas.
function prune() {
  const reachable = new Set<number>();
  const visit = (list: MobileButton[]) => list.forEach(button => {
    if (!button.folder || reachable.has(button.folder)) return;
    reachable.add(button.folder);
    visit(folderById(button.folder)?.buttons ?? []);
  });
  visit(data.buttons);
  data.folders = data.folders.filter(folder => reachable.has(folder.id));
  path = path.filter(id => reachable.has(id));
}

function markDirty() { dirty = true; $('#mobile-editor-save').toggleAttribute('disabled', false); }
function setButton(button: MobileButton, rerender = true) {
  setPageButtons([...pageButtons().filter(item => item.slot !== button.slot), button].filter(used).sort((a, b) => a.slot - b.slot));
  prune();
  markDirty();
  if (rerender) render(); else { renderGrid(); renderHead(); }
}
const update = (change: (button: MobileButton) => void, rerender = true) => { const next = structuredClone(buttonAt(selected)); change(next); setButton(next, rerender); };

function select(slot: number) { selected = slot; state.mobileSelected = slot; }
function openFolder(id: number) { if (!folderById(id)) return; path = [...path, id]; select(2); render(); }
function goTo(depth: number) { path = path.slice(0, depth); select(1); render(); }

function bindingFor(button: MobileButton): BindingOf<'app'> { return { kind: 'app', multi: button.multi, steps: button.steps, mode: button.mode, alt: button.alt, profiles: button.profiles }; }
function autoIcon(button: MobileButton): IconName | null {
  if (button.icon && isIconName(button.icon)) return button.icon;
  if (button.folder) return 'folder';
  if (button.multi && button.steps.length !== 1) return 'multi';
  return button.steps[0] ? stepIcon(button.steps[0]) : null;
}
function title(button: MobileButton) {
  if (button.folder) return folderName(button.folder);
  if (button.multi) return 'Multi-ação';
  return button.steps[0] ? stepNames[button.steps[0].type] : 'Sem ação';
}

// Ação da biblioteca como ação do app: o atalho de teclado e as teclas de mídia, que no macropad são
// gravados no aparelho, viram as etapas equivalentes.
function mobileParts(binding: Binding): Omit<MobileButton, 'slot' | 'folder' | 'text' | 'icon' | 'color' | 'image' | 'fit'> | null {
  if (binding.kind === 'app') return appParts(binding);
  const steps = binding.kind === 'key' ? [newStep('hotkey')] : equivalentSteps(binding);
  return steps ? { multi: false, steps, mode: 'normal', alt: [], profiles: [] } : null;
}

export function assignMobileAction(slot: number, id: string) {
  const item = actionById.get(id);
  if (!item) return;
  if (isBack(slot)) { toast('O primeiro botão de uma pasta é sempre o Voltar.'); return; }
  select(slot);
  const previous = buttonAt(slot);
  if (id === 'empty') { setButton(empty(slot)); return; }
  if (id === 'folder') {
    const free = Array.from({ length: MOBILE_MAX_FOLDER }, (_, index) => index + 1).find(folder => !folderById(folder));
    if (!free) { toast('Limite de pastas atingido.', 'error'); return; }
    data.folders.push({ id: free, name: 'Nova pasta', buttons: [] });
    setButton({ ...empty(slot), folder: free, text: 'Nova pasta', icon: previous.icon, color: previous.color, image: previous.image, fit: previous.fit });
    return;
  }
  const parts = mobileParts(item.make());
  if (!parts) return;
  setButton({ slot, folder: 0, text: previous.folder ? '' : previous.text, icon: previous.icon, color: previous.color, image: previous.image, fit: previous.fit, ...parts });
}

// Move um botão para outro slot da mesma página, trocando de lugar com o que estiver lá.
function moveButton(from: number, to: number) {
  if (from === to || isBack(from) || isBack(to)) return;
  const a = buttonAt(from), b = buttonAt(to);
  setPageButtons([...pageButtons().filter(item => item.slot !== from && item.slot !== to), { ...a, slot: to }, { ...b, slot: from }].filter(used).sort((x, y) => x.slot - y.slot));
  markDirty();
  select(to);
  render();
}

// Tecla com o mesmo acabamento da página do celular.
export function mobileKey(button: MobileButton, options: { back?: boolean; className?: string } = {}) {
  const cover = !options.back && Boolean(button.image) && button.fit === 'cover';
  const picture = !options.back && Boolean(button.image) && !cover;
  const glyph = options.back ? 'back' : picture || cover ? null : autoIcon(button);
  const label = options.back ? 'Voltar' : button.text.trim();
  const key = h('span', { class: `mkey${cover ? ' cover' : ''}${picture ? ' picture' : ''}${used(button) || options.back ? ' assigned' : ''}${button.color ? ' colored' : ''}${button.folder ? ' folder' : ''}${options.back ? ' back' : ''}${label && glyph ? ' labelled' : ''} ${options.className ?? ''}` },
    h('span', { class: 'mkey-face', style: cover ? `background-image: url("${button.image}")` : null },
      glyph ? icon(glyph, 'icon mkey-glyph') : null,
      picture ? h('img', { class: 'mkey-image', src: button.image, alt: '', draggable: 'false' }) : null,
      label ? h('span', { class: 'mkey-label' }, label) : null,
      button.folder && glyph !== 'folder' ? icon('folder', 'icon mkey-folder') : null));
  if (button.color) key.style.setProperty('--c', button.color);
  if (label && picture) key.classList.add('labelled');
  return key;
}

// Imagem escolhida pelo usuário, reduzida para no máximo 320 px (sem cortar) e guardada em WebP,
// que mantém a transparência. O corte para "cobrir a tecla" fica com o CSS, então trocar o ajuste
// não exige escolher a imagem de novo.
const IMAGE_SIZE = 320;
async function readImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('Escolha uma imagem PNG, JPEG, WebP ou GIF.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Não foi possível abrir esta imagem.'); });
  const scale = Math.min(1, IMAGE_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = h('canvas', { width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível processar a imagem.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = canvas.toDataURL('image/webp', 0.88);
  return data.startsWith('data:image/webp') ? data : canvas.toDataURL('image/png');
}

async function setImage(slot: number, file: File) {
  const button = buttonAt(slot);
  if (!used(button)) { toast('Atribua uma ação ao botão antes de colocar uma imagem.'); return; }
  try {
    const image = await readImage(file);
    select(slot);
    update(next => { next.image = image; if (!next.fit) next.fit = 'cover'; });
  } catch (error) { toast(errorText(error), 'error'); }
}

const imageFile = (transfer: DataTransfer | null) => [...transfer?.files ?? []].find(file => file.type.startsWith('image/'));

function renderGrid() {
  const grid = $('#mobile-editor-grid');
  grid.classList.toggle('portrait', portrait);
  grid.replaceChildren(...Array.from({ length: 15 }, (_, index) => {
    const slot = index + 1, button = buttonAt(slot), back = isBack(slot);
    const element = h('button', {
      type: 'button', class: `mobile-slot${selected === slot && !back ? ' selected' : ''}`, draggable: back || !used(button) ? null : 'true', 'aria-pressed': String(selected === slot),
      'aria-label': back ? 'Voltar para a página anterior' : `Botão ${slot}: ${used(button) ? button.text || title(button) : 'vazio'}`,
      title: button.folder ? 'Clique duas vezes para abrir a pasta' : null
    }, mobileKey(button, { back }));
    element.addEventListener('click', () => { if (back) { goTo(path.length - 1); return; } select(slot); render(); });
    element.addEventListener('dblclick', () => { if (button.folder) openFolder(button.folder); });
    element.addEventListener('dragstart', event => {
      event.dataTransfer?.setData(DRAG_SLOT, `${MOBILE_DRAG}${slot}`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    element.addEventListener('dragover', event => {
      const types = event.dataTransfer?.types ?? [];
      if (back || (!types.includes(DRAG_ACTION) && !types.includes(DRAG_SLOT) && !types.includes('Files'))) return;
      event.preventDefault();
      element.classList.add('drop-target');
    });
    element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
    element.addEventListener('drop', event => {
      event.preventDefault();
      element.classList.remove('drop-target');
      // Uma imagem arrastada do computador vira a imagem do botão, como no Stream Deck.
      const file = imageFile(event.dataTransfer);
      if (file) { void setImage(slot, file); return; }
      const moved = event.dataTransfer?.getData(DRAG_SLOT) ?? '';
      if (moved.startsWith(MOBILE_DRAG)) { moveButton(Number(moved.slice(MOBILE_DRAG.length)), slot); return; }
      const id = event.dataTransfer?.getData(DRAG_ACTION);
      if (id) assignMobileAction(slot, id);
    });
    return element;
  }));
}

function renderBreadcrumb() {
  const crumbs: Node[] = [h('button', { type: 'button', class: `crumb${path.length ? '' : ' current'}`, onclick: () => goTo(0) }, icon('phone'), 'Celular')];
  path.forEach((id, index) => crumbs.push(icon('chevron', 'icon crumb-sep'), h('button', { type: 'button', class: `crumb${index === path.length - 1 ? ' current' : ''}`, onclick: () => goTo(index + 1) }, icon('folder'), folderName(id))));
  $('#mobile-breadcrumb').replaceChildren(...crumbs);
  const count = pageButtons().filter(used).length;
  $('#mobile-page-info').textContent = `${path.length ? 'Pasta' : 'Página principal'} · ${count} de ${path.length ? 14 : 15} botões configurados · ${data.folders.length} ${data.folders.length === 1 ? 'pasta' : 'pastas'}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>('#mobile-orientation button')) button.setAttribute('aria-checked', String((button.dataset.orientation === 'portrait') === portrait));
}

function render() {
  if (isBack(selected)) select(2);
  renderBreadcrumb();
  renderGrid();
  renderHead();
  renderInspector();
  $('#mobile-editor-save').toggleAttribute('disabled', !dirty);
  if (state.editorMode === 'mobile') renderLibrary();
}

function renderHead() {
  const head = $('#mobile-inspector-head'), button = buttonAt(selected);
  const where = path.length ? `Botão ${selected} · ${folderName(pageId())}` : `Botão ${selected} · Página principal`;
  if (!used(button)) { head.replaceChildren(h('div', { class: 'mi-head' }, h('div', { class: 'mi-title' }, h('h2', {}, 'Propriedades'), h('p', {}, where)))); return; }
  const error = button.folder ? null : appBindingError(bindingFor(button));
  head.replaceChildren(h('div', { class: 'mi-head' },
    mobileKey(button, { className: 'mkey-mini' }),
    h('div', { class: 'mi-title' },
      h('div', { class: 'mi-title-row' }, h('h2', {}, title(button)), button.folder ? h('span', { class: 'chip' }, icon('folder'), 'Pasta') : h('span', { class: 'chip chip-app' }, icon('phone'), 'Somente no celular'), error ? h('span', { class: 'chip chip-pending' }, 'Incompleta') : null),
      h('p', {}, where)),
    h('div', { class: 'inspector-tools' },
      button.folder ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => openFolder(button.folder) }, icon('folder'), 'Abrir pasta') : null,
      !button.folder && tauri && button.steps.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => void testButton(button) }, icon('play'), 'Testar') : null,
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => setButton(empty(selected)) }, icon('trash'), 'Remover'))));
}

async function testButton(button: MobileButton) {
  const error = appBindingError(bindingFor(button));
  if (error) { toast(error, 'error'); return; }
  const typed = button.steps.some(step => step.type === 'text' || step.type === 'hotkey' || step.type === 'mouse' || step.type === 'window');
  if (typed) toast('Mude para a janela de destino: a ação começa em 3 segundos.');
  try { await invoke('macro_test', { steps: typed ? [{ type: 'delay', ms: 3000 }, ...button.steps] : button.steps }); }
  catch (failure) { toast(errorText(failure), 'error'); }
}

const STEP_TYPES: StepType[] = ['open', 'website', 'text', 'hotkey', 'delay', 'media', 'command', 'audio', 'window', 'system', 'mouse', 'brightness', 'sound', 'obs', 'voicemeeter', 'player', 'http', 'counter'];

// Lista compacta de etapas: cabeçalho de uma linha com as ferramentas e os campos logo abaixo.
function stepList(list: Step[], changed: (list: Step[], rerender?: boolean) => void): Child[] {
  const last = list.length - 1;
  const tool = (name: IconName, label: string, disabled: boolean, action: () => void) =>
    h('button', { type: 'button', class: 'btn btn-icon btn-tiny', 'aria-label': label, title: label, disabled, onclick: action }, icon(name));
  const items = list.map((step, index) => h('li', { class: 'mi-step' },
    h('div', { class: 'mi-step-head' }, h('span', { class: 'step-index' }, String(index + 1)), icon(stepIcon(step)), h('strong', {}, stepNames[step.type]),
      h('span', { class: 'step-tools' },
        tool('arrowUp', 'Mover para cima', index === 0, () => { list.splice(index - 1, 0, ...list.splice(index, 1)); changed(list); }),
        tool('arrowDown', 'Mover para baixo', index === last, () => { list.splice(index + 1, 0, ...list.splice(index, 1)); changed(list); }),
        tool('copy', 'Duplicar etapa', false, () => { list.splice(index + 1, 0, structuredClone(list[index])); changed(list); }),
        tool('trash', 'Remover etapa', false, () => { list.splice(index, 1); changed(list); }))),
    h('div', { class: 'form' }, stepFields(step, (patch, rerender = false) => { Object.assign(step, patch); changed(list, rerender); }))));
  const add = h('select', {
    class: 'input add-step', 'aria-label': 'Adicionar etapa',
    onchange: event => { const value = inputValue(event); if (!value) return; list.push(newStep(value as StepType)); changed(list); }
  }, h('option', { value: '' }, '+ Adicionar etapa'), STEP_TYPES.map(type => h('option', { value: type }, stepNames[type])));
  return [items.length ? h('ol', { class: 'mi-steps' }, items) : null, add];
}

const group = (heading: string, ...content: Child[]) => h('section', { class: 'mi-group' }, h('h3', {}, heading), ...content);

function actionEditor(button: MobileButton): Child[] {
  if (button.folder) {
    const folder = folderById(button.folder);
    const inside = folder?.buttons.length ?? 0;
    return [group('Pasta', h('div', { class: 'form' },
      field('Nome', h('input', { class: 'input', maxlength: 48, value: folder?.name ?? '', spellcheck: 'false', oninput: event => {
        const name = inputValue(event);
        const target = folderById(button.folder);
        if (target) target.name = name;
        update(next => { if (!next.text || next.text === folder?.name) next.text = name; }, false);
        renderBreadcrumb();
      } }))),
      note(`${inside} ${inside === 1 ? 'botão' : 'botões'} dentro. Clique duas vezes na tecla ou em Abrir pasta para editar; o botão 1 da pasta volta para a página anterior.`))];
  }
  if (!button.multi) {
    const [step] = button.steps;
    const edit: EditStep = (patch, rerender) => update(next => { Object.assign(next.steps[0], patch); }, rerender);
    return [group(step ? stepNames[step.type] : 'Ação', h('div', { class: 'form' }, step ? stepFields(step, edit) : null),
      h('button', { type: 'button', class: 'btn-link mi-link', onclick: () => update(next => { next.multi = true; }) }, 'Converter em multi-ação (etapas, alternar, segurar, perfis)'))];
  }
  const mode = h('select', { class: 'input', onchange: event => update(next => { next.mode = inputValue(event) as AppMode; if (next.mode !== 'normal' && !next.alt.length && next.steps[0]) next.alt = [structuredClone(next.steps[0])]; }) },
    ([['normal', 'Executar a cada toque'], ['toggle', 'Alternar entre duas listas'], ['hold', 'Toque ou segurar']] as const).map(([value, label]) => h('option', { value, selected: button.mode === value }, label)));
  const profiles = button.profiles.map((profile, index) => {
    const [listId, suggestions] = appSuggestions();
    return h('div', { class: 'mi-profile' },
      h('div', { class: 'profile-head' }, icon('app'), h('input', { class: 'input', value: profile.app, placeholder: 'photoshop.exe', list: listId, oninput: event => update(next => { next.profiles[index].app = inputValue(event); }, false) }), suggestions,
        h('button', { type: 'button', class: 'btn btn-icon btn-tiny', 'aria-label': 'Remover perfil', onclick: () => update(next => { next.profiles.splice(index, 1); }) }, icon('trash'))),
      stepList(profile.steps, (list, rerender) => update(next => { next.profiles[index].steps = list; }, rerender)));
  });
  return [
    group('Etapas', stepList(button.steps, (list, rerender) => update(next => { next.steps = list; }, rerender))),
    group('Comportamento', h('div', { class: 'form' }, field('Modo', mode)),
      button.mode === 'normal' ? null : h('div', { class: 'subsection' }, h('h4', {}, button.mode === 'toggle' ? 'Segunda ação' : 'Ao segurar'), stepList(button.alt, (list, rerender) => update(next => { next.alt = list; }, rerender)))),
    h('details', { class: 'mi-group mi-collapsible', open: button.profiles.length > 0 },
      h('summary', {}, icon('chevron', 'icon chevron'), h('h3', {}, `Perfis por programa${button.profiles.length ? ` · ${button.profiles.length}` : ''}`)),
      ...profiles,
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => update(next => { next.profiles.push({ app: '', steps: [] }); }) }, icon('app'), 'Adicionar perfil'))
  ];
}

function appearance(button: MobileButton) {
  const pick = (name: IconName | '', label: string, content: Child) => h('button', { type: 'button', class: 'pick', title: label, 'aria-label': label, 'aria-pressed': String(button.icon === name), onclick: () => update(next => { next.icon = name; }) }, content);
  const custom = h('input', { type: 'color', class: 'swatch-custom', 'aria-label': 'Outra cor', title: 'Outra cor', value: button.color && !MOBILE_COLORS.includes(button.color) ? button.color : '#2f6bff', onchange: event => update(next => { next.color = inputValue(event); }) });
  return group('Aparência', h('div', { class: 'form' },
    field('Legenda', h('input', { class: 'input', maxlength: 48, value: button.text, placeholder: 'Sem legenda', spellcheck: 'false', oninput: event => update(next => { next.text = inputValue(event); }, false) })),
    field('Cor', h('div', { class: 'swatches' },
      h('button', { type: 'button', class: 'swatch swatch-none', 'aria-label': 'Sem cor', title: 'Sem cor', 'aria-pressed': String(!button.color), onclick: () => update(next => { next.color = ''; }) }),
      MOBILE_COLORS.map(color => { const swatch = h('button', { type: 'button', class: 'swatch', 'aria-label': color, title: color, 'aria-pressed': String(button.color === color), onclick: () => update(next => { next.color = color; }) }); swatch.style.background = color; return swatch; }),
      h('label', { class: `swatch swatch-picker${button.color && !MOBILE_COLORS.includes(button.color) ? ' active' : ''}` }, custom))),
    field('Imagem', imageControl(button)),
    button.image ? null : field('Ícone', h('div', { class: 'icon-picker mi-icons' }, pick('', 'Automático', 'Auto'), customIcons.map(name => pick(name, name, icon(name)))))));
}

// Imagem do botão: escolher (ou arrastar até a tecla), o ajuste e remover.
function imageControl(button: MobileButton) {
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true, onchange: event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void setImage(button.slot, file);
  } });
  const choose = h('button', { type: 'button', class: 'btn btn-small', onclick: () => input.click() }, icon('image'), button.image ? 'Trocar imagem' : 'Escolher imagem');
  if (!button.image) return h('div', { class: 'mi-image' }, choose, input, h('span', { class: 'field-hint' }, 'ou arraste uma imagem até a tecla'));
  const fit = (value: 'icon' | 'cover', label: string, hint: string) => h('button', { type: 'button', class: 'segment', role: 'radio', title: hint, 'aria-checked': String(button.fit === value || (value === 'icon' && button.fit !== 'cover')), onclick: () => update(next => { next.fit = value; }) }, label);
  return h('div', { class: 'mi-image' },
    h('img', { class: 'mi-image-thumb', src: button.image, alt: '' }),
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Ajuste da imagem' }, fit('icon', 'Logo', 'No lugar do ícone, sobre a cor da tecla'), fit('cover', 'Cobrir tecla', 'A imagem ocupa a tecla inteira')),
    choose, input,
    h('button', { type: 'button', class: 'btn-link', onclick: () => update(next => { next.image = ''; next.fit = ''; }) }, 'Remover'));
}

function renderInspector() {
  const body = $('#mobile-editor-inspector'), button = buttonAt(selected);
  if (!used(button)) {
    body.replaceChildren(h('div', { class: 'mi-empty' }, h('span', { class: 'empty-icon' }, icon('grid')), h('strong', {}, 'Arraste uma ação da direita e solte numa tecla acima.'),
      h('p', {}, 'Ou selecione uma tecla e clique numa ação. Use Navegação › Pasta para agrupar botões; arraste uma tecla sobre outra para trocá-las de lugar.')));
    return;
  }
  const error = button.folder ? null : appBindingError(bindingFor(button));
  body.replaceChildren(h('div', { class: 'mi-layout' },
    h('div', { class: 'mi-main' }, ...actionEditor(button),
      button.mode === 'normal' && button.steps.some(isRotaryOnlyStep) ? note('Ação incremental: no celular, segure o botão para repetir, como girar um knob.') : null,
      error ? note(error, 'warning') : null),
    h('div', { class: 'mi-side' }, appearance(button))));
}

export async function openMobileEditor() {
  if (loaded) { render(); return; }
  if (!tauri) { data = { buttons: [], folders: [] }; loaded = true; render(); return; }
  try {
    const response = await invoke<Partial<MobilePage>>('mobile_page_get');
    const normalize = (list: MobileButton[] = []) => list.map(button => ({ ...empty(button.slot), ...button }));
    data = { buttons: normalize(response.buttons), folders: (response.folders ?? []).map(folder => ({ ...folder, buttons: normalize(folder.buttons) })) };
    path = [];
    select(data.buttons[0]?.slot || 1);
    dirty = false; loaded = true; render();
  } catch (error) { toast(errorText(error), 'error'); }
}

function validate(): string | null {
  const pages = [{ name: 'Página principal', buttons: data.buttons }, ...data.folders.map(folder => ({ name: `Pasta ${folder.name || folder.id}`, buttons: folder.buttons }))];
  for (const page of pages) for (const button of page.buttons) {
    if (button.folder) continue;
    const error = appBindingError(bindingFor(button));
    if (error) return `${page.name}, botão ${button.slot}: ${error}`;
  }
  return null;
}

export function bindMobileEditor() {
  $('#mobile-editor-save').addEventListener('click', async () => {
    prune();
    const invalid = validate();
    if (invalid) { toast(invalid, 'error'); return; }
    try { await invoke('mobile_page_save', { page: data }); dirty = false; render(); toast('Página do celular salva.', 'success'); }
    catch (error) { toast(errorText(error), 'error'); }
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('#mobile-orientation button')) button.addEventListener('click', () => {
    portrait = button.dataset.orientation === 'portrait';
    try { localStorage.setItem(ORIENTATION_KEY, portrait ? '1' : '0'); } catch { /* sem armazenamento */ }
    renderBreadcrumb(); renderGrid();
  });
  document.addEventListener('mobile-assign-action', event => {
    if (state.editorMode !== 'mobile') return;
    assignMobileAction(selected, (event as CustomEvent<{ id: string }>).detail.id);
  });
  document.addEventListener('mobile-page-changed', () => { loaded = false; if (state.editorMode === 'mobile') void openMobileEditor(); });
}
