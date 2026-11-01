// Importar e exportar a configuração. No app, usa as janelas de salvar e abrir do Windows; no
// navegador, download e seletor de arquivo. A importação vira alterações não gravadas, para revisar
// antes de gravar no macropad.
import { invoke } from '@tauri-apps/api/core';
import { parseBackup, serializeBackup } from '../device/backup-file.ts';
import type { Binding } from '../device/protocol.ts';
import { h } from '../lib/dom.ts';
import { errorText, plural } from '../lib/text.ts';
import { renderBoard } from './board.ts';
import { renderChrome, renderLayers } from './chrome.ts';
import { stageDraft } from './editing.ts';
import { confirmDialog, log, toast } from './feedback.ts';
import { renderInspector } from './inspector.ts';
import { loadAllLayers } from './session.ts';
import { bindingAt, state, tauri } from './state.ts';

// Camadas lidas entram completas; das que não foram lidas (sem dispositivo), só os rascunhos.
function collectLayers() {
  const allSlots = [
    ...Array.from({ length: state.layout.keys }, (_, i) => i + 1),
    ...Array.from({ length: state.layout.knobs * 3 }, (_, i) => 16 + i)
  ];
  let skipped = 0;
  const layers = new Map<number, Map<number, Binding>>();
  state.layers.forEach((layer, index) => {
    const number = index + 1;
    const controls = new Map<number, Binding>();
    for (const slot of layer.loaded ? allSlots : [...layer.drafts.keys()]) {
      const binding = bindingAt(slot, number);
      if (binding.kind === 'raw') skipped++;
      else controls.set(slot, binding);
    }
    if (controls.size) layers.set(number, controls);
  });
  return { layers, skipped };
}

function saveInBrowser(contents: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
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

export async function exportConfig() {
  try {
    await loadAllLayers();
    const { layers, skipped } = collectLayers();
    if (!layers.size) { toast('Não há ações para exportar. Conecte o macropad ou configure algum controle.', 'error'); return; }
    const contents = serializeBackup(state.layout, layers);
    const fileName = `macropad-studio-${new Date().toISOString().slice(0, 10)}.json`;
    if (tauri) { if (!await invoke<boolean>('backup_save', { contents, fileName })) return; }
    else saveInBrowser(contents, fileName);
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
    const { layers, skipped } = parseBackup(text, state.layout);
    const count = [...layers.values()].reduce((total, controls) => total + controls.size, 0);
    if (!count) { toast('O arquivo não tem ações que este macropad possa usar.', 'error'); return; }
    const ok = await confirmDialog(`Importar ${plural(count, 'controle', 'controles')}?`,
      'As ações do arquivo substituem as atuais desses controles como alterações não gravadas. Revise e clique em Gravar no dispositivo para aplicá-las.', 'Importar');
    if (!ok) return;
    for (const [layer, controls] of layers) for (const [slot, binding] of controls) stageDraft(layer, slot, binding);
    renderBoard(); renderLayers(); renderChrome(); renderInspector();
    log(`Configuração importada: ${plural(count, 'controle', 'controles')}${skipped ? `, ${skipped} ignorados` : ''}.`);
    toast(skipped ? `Importado. ${plural(skipped, 'item inválido foi ignorado', 'itens inválidos foram ignorados')}.` : 'Importado. Revise e grave no dispositivo.', 'success');
  } catch (error) { toast(errorText(error), 'error'); }
}
