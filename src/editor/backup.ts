// Importar e exportar a configuração. No app, usa as janelas de salvar e abrir do Windows; no
// navegador, download e seletor de arquivo. A importação vira alterações não gravadas, para revisar
// antes de gravar no macropad.
import { invoke } from '@tauri-apps/api/core';
import { parseBackup, serializeBackup } from '../device/backup-file.ts';
import type { MobilePage } from '../device/protocol.ts';
import type { Binding } from '../device/protocol.ts';
import { h } from '../lib/dom.ts';
import { errorText, plural } from '../lib/text.ts';
import { remember, renderAll, stageDraft } from './editing.ts';
import { confirmDialog, log, toast } from './feedback.ts';
import { saveLabels } from './labels.ts';
import { loadAllLayers } from './session.ts';
import { allSlots, bindingAt, state, tauri } from './state.ts';

// Camadas lidas entram completas; das que não foram lidas (sem dispositivo), só os rascunhos.
function collectLayers() {
  let skipped = 0;
  const layers = new Map<number, Map<number, Binding>>();
  state.layers.forEach((layer, index) => {
    const number = index + 1;
    const controls = new Map<number, Binding>();
    for (const slot of layer.loaded ? allSlots() : [...layer.drafts.keys()]) {
      const binding = bindingAt(slot, number);
      if (binding.kind === 'raw') skipped++;
      else controls.set(slot, binding);
    }
    if (controls.size) layers.set(number, controls);
  });
  return { layers, skipped };
}

function saveInBrowser(contents: string, fileName: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = h('a', { href: url, download: fileName });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openInBrowser(): Promise<string | null> {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => resolve(input.files?.[0] ? await input.files[0].text() : null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

// Salva um arquivo gerado aqui: janela "Salvar como" no app, download no navegador. false se cancelar.
export async function saveFile(contents: string, fileName: string, filter?: string, extension?: string, type?: string): Promise<boolean> {
  if (tauri) return invoke<boolean>('file_save', { contents, fileName, filter, extension });
  saveInBrowser(contents, fileName, type);
  return true;
}

export async function exportConfig() {
  try {
    await loadAllLayers();
    const { layers, skipped } = collectLayers();
    const empty: MobilePage = { buttons: [], folders: [] };
    const mobile = tauri ? { ...empty, ...await invoke<MobilePage>('mobile_page_get').catch(() => empty) } : empty;
    if (!layers.size && !mobile.buttons.length) { toast('Não há ações para exportar. Conecte o macropad ou configure algum controle.', 'error'); return; }
    const contents = serializeBackup(state.layout, layers, state.labels, mobile);
    const fileName = `macropad-studio-${new Date().toISOString().slice(0, 10)}.json`;
    if (!await saveFile(contents, fileName)) return;
    const count = [...layers.values()].reduce((total, controls) => total + controls.size, 0);
    log(`Configuração exportada: ${plural(count, 'controle', 'controles')} em ${plural(layers.size, 'camada', 'camadas')}.`);
    toast(skipped
      ? `Configuração exportada. ${plural(skipped, 'ação existente ficou', 'ações existentes ficaram')} de fora, porque o editor não consegue regravá-las.`
      : 'Configuração exportada.', 'success');
  } catch (error) { toast(errorText(error), 'error'); }
}

export async function importConfig() {
  try {
    const text = tauri ? await invoke<string | null>('backup_open') : await openInBrowser();
    if (text === null) return;
    const { layers, labels, mobile, skipped } = parseBackup(text, state.layout);
    const count = [...layers.values()].reduce((total, controls) => total + controls.size, 0);
    if (!count && !mobile.buttons.length) { toast('O arquivo não tem ações que este macropad ou celular possa usar.', 'error'); return; }
    const ok = await confirmDialog(`Importar ${plural(count, 'controle', 'controles')}?`,
      `As ações do arquivo substituem as atuais desses controles como alterações não gravadas. Revise e clique em Gravar no dispositivo para aplicá-las.${labels.length ? ' As legendas personalizadas do arquivo valem na hora.' : ''}`, 'Importar');
    if (!ok) return;
    remember();
    for (const [layer, controls] of layers) for (const [slot, binding] of controls) stageDraft(layer, slot, binding);
    if (labels.length) {
      const replaced = new Set(labels.map(label => `${label.layer}:${label.slot}`));
      await saveLabels([...state.labels.filter(label => !replaced.has(`${label.layer}:${label.slot}`)), ...labels]);
    }
    if (tauri && mobile.buttons.length) { await invoke('mobile_page_save', { page: mobile }); document.dispatchEvent(new Event('mobile-page-changed')); }
    renderAll();
    log(`Configuração importada: ${plural(count, 'controle', 'controles')}${skipped ? `, ${skipped} ignorados` : ''}.`);
    toast(skipped ? `Importado. ${plural(skipped, 'item inválido foi ignorado', 'itens inválidos foram ignorados')}.` : 'Importado. Revise e grave no dispositivo.', 'success');
  } catch (error) { toast(errorText(error), 'error'); }
}
