// Diálogo de configurações: tema, legendas, OSD, pausa das teclas virtuais e integrações (OBS e
// Home Assistant). Senhas e tokens vão para o Gerenciador de Credenciais pelo app e nunca voltam
// para a interface: ela só sabe se há algo guardado.
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { $ } from '../lib/dom.ts';
import { errorText } from '../lib/text.ts';
import { setKeysPaused } from './chrome.ts';
import { confirmDialog, toast } from './feedback.ts';
import { forgetLists } from './step-forms.ts';
import { state, tauri } from './state.ts';

interface Settings { osd: boolean; obs: { enabled: boolean; host: string; port: number }; homeassistant: { url: string } }
interface SettingsView { settings: Settings; obs_password: boolean; home_assistant_token: boolean }

let current: Settings | null = null;

// Atualizações: o app procura uma vez ao abrir; o botão em "Sobre" procura de novo ou instala.
let available: { version: string; notes: string } | null = null;

function renderUpdate() {
  $('#check-update').textContent = available ? `Instalar a versão ${available.version}` : 'Procurar atualizações';
  $('#check-update').classList.toggle('btn-primary', Boolean(available));
}

export async function checkForUpdate(quiet: boolean) {
  if (!tauri) return;
  try {
    available = await invoke<{ version: string; notes: string } | null>('update_check');
    renderUpdate();
    if (available) toast(`A versão ${available.version} do Macropad Studio está disponível. Instale em Configurações › Sobre.`);
    else if (!quiet) toast('O Macropad Studio já está na versão mais nova.', 'success');
  } catch (error) {
    if (!quiet) toast(errorText(error), 'error');
  }
}

async function installUpdate() {
  if (!available) { await checkForUpdate(false); return; }
  const notes = available.notes.trim();
  if (!await confirmDialog(`Instalar a versão ${available.version}?`, `${notes ? `${notes.slice(0, 300)}${notes.length > 300 ? '…' : ''} ` : ''}O app fecha durante a instalação e abre de novo sozinho. Alterações não gravadas no macropad se perdem.`, 'Instalar')) return;
  $<HTMLButtonElement>('#check-update').disabled = true;
  $('#check-update').textContent = 'Baixando…';
  try { await invoke('update_install'); }
  catch (error) { toast(errorText(error), 'error'); }
  finally { $<HTMLButtonElement>('#check-update').disabled = false; renderUpdate(); }
}

export async function openSettings() {
  for (const id of ['#settings-app', '#settings-obs', '#settings-homeassistant', '#settings-update']) $(id).hidden = !tauri;
  if (tauri) $('#app-version').textContent = `Versão ${await invoke<string>('app_version').catch(() => '?')}`;
  $('#open-logs').hidden = !tauri;
  $<HTMLSelectElement>('#theme').value = savedTheme();
  if (tauri) {
    const [autostart, view, paused] = await Promise.all([
      invoke<boolean>('autostart_get').catch(() => false),
      invoke<SettingsView>('settings_get'),
      invoke<boolean>('keys_paused_get').catch(() => false)
    ]);
    current = view.settings;
    $<HTMLInputElement>('#autostart').checked = autostart;
    $<HTMLInputElement>('#osd').checked = view.settings.osd;
    $<HTMLInputElement>('#keys-paused').checked = paused;
    $<HTMLInputElement>('#obs-enabled').checked = view.settings.obs.enabled;
    $<HTMLInputElement>('#obs-host').value = view.settings.obs.host;
    $<HTMLInputElement>('#obs-port').value = String(view.settings.obs.port);
    $<HTMLInputElement>('#obs-password').value = '';
    $<HTMLInputElement>('#obs-password').placeholder = view.obs_password ? 'Senha guardada (digite para trocar)' : 'Senha do obs-websocket';
    $<HTMLInputElement>('#ha-url').value = view.settings.homeassistant.url;
    $<HTMLInputElement>('#ha-token').value = '';
    $<HTMLInputElement>('#ha-token').placeholder = view.home_assistant_token ? 'Token guardado (digite para trocar)' : 'Token de acesso de longa duração';
    renderObsState();
  }
  $<HTMLDialogElement>('#settings-modal').showModal();
}

export function renderObsState() {
  const element = $('#obs-state');
  if (!element) return;
  element.textContent = state.obs.connected
    ? ['Conectado', state.obs.scene && `cena ${state.obs.scene}`, state.obs.recording && '● gravando', state.obs.streaming && '● ao vivo'].filter(Boolean).join(' · ')
    : current?.obs.enabled ? state.obs.error || 'Conectando…' : 'Desligado';
  element.dataset.tone = state.obs.connected ? 'ok' : current?.obs.enabled && state.obs.error ? 'warning' : '';
}

async function saveSettings(next: Settings, secrets: { obsPassword?: string; homeAssistantToken?: string } = {}) {
  try {
    await invoke('settings_save', { settings: next, obsPassword: secrets.obsPassword ?? null, homeAssistantToken: secrets.homeAssistantToken ?? null });
    current = next;
    forgetLists();
    return true;
  } catch (error) {
    toast(errorText(error), 'error');
    return false;
  }
}

export function bindSettings() {
  $('#theme').addEventListener('change', event => setTheme((event.target as HTMLSelectElement).value as Theme));
  $('#osd').addEventListener('change', async event => {
    const checkbox = event.target as HTMLInputElement;
    if (!current || !await saveSettings({ ...current, osd: checkbox.checked })) checkbox.checked = !checkbox.checked;
  });
  $('#keys-paused').addEventListener('change', event => setKeysPaused((event.target as HTMLInputElement).checked));
  $('#save-integrations').addEventListener('click', async () => {
    if (!current) return;
    const port = Number($<HTMLInputElement>('#obs-port').value) || 4455;
    const password = $<HTMLInputElement>('#obs-password').value;
    const token = $<HTMLInputElement>('#ha-token').value;
    const next: Settings = {
      ...current,
      obs: { enabled: $<HTMLInputElement>('#obs-enabled').checked, host: $<HTMLInputElement>('#obs-host').value.trim() || '127.0.0.1', port: Math.min(65535, Math.max(1, port)) },
      homeassistant: { url: $<HTMLInputElement>('#ha-url').value.trim() }
    };
    if (await saveSettings(next, { obsPassword: password || undefined, homeAssistantToken: token || undefined })) {
      $<HTMLInputElement>('#obs-password').value = '';
      $<HTMLInputElement>('#ha-token').value = '';
      toast('Integrações salvas.', 'success');
      renderObsState();
    }
  });
  $('#open-logs').addEventListener('click', () => invoke('logs_open').catch(error => toast(errorText(error), 'error')));
  $('#check-update').addEventListener('click', () => available ? installUpdate() : checkForUpdate(false));
}

// Tema: "system" acompanha o Windows. A preferência é só desta máquina; sem localStorage, vale o padrão.
type Theme = 'system' | 'dark' | 'light';
export function savedTheme(): Theme {
  try { return (localStorage.getItem('theme') as Theme | null) ?? 'system'; } catch { return 'system'; }
}
const systemLight = matchMedia('(prefers-color-scheme: light)');
let preference: Theme = 'system';
function applyTheme() {
  const effective = preference === 'system' ? (systemLight.matches ? 'light' : 'dark') : preference;
  document.documentElement.dataset.theme = effective;
  if (tauri) getCurrentWindow().setTheme(preference === 'system' ? null : effective).catch(() => {});
}
systemLight.addEventListener('change', () => { if (preference === 'system') applyTheme(); });
export function setTheme(theme: Theme) {
  preference = theme;
  try { localStorage.setItem('theme', theme); } catch {}
  applyTheme();
}

// Preferência só desta máquina: o localStorage pode falhar, e a tela funciona sem ele.
export function setLegends(visible: boolean) {
  document.body.classList.toggle('no-legends', !visible);
  try { localStorage.setItem('legends', visible ? '1' : '0'); } catch {}
}
export function savedLegends() {
  try { return localStorage.getItem('legends') !== '0'; } catch { return true; }
}
