// Diálogo de configurações: tema, legendas, OSD, pausa das teclas virtuais e a integração com o OBS.
// A senha vai para o Gerenciador de Credenciais pelo app e nunca volta para a interface: ela só sabe
// se há algo guardado.
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { $ } from '../lib/dom.ts';
import { errorText } from '../lib/text.ts';
import { setKeysPaused } from './chrome.ts';
import { confirmDialog, toast } from './feedback.ts';
import { forgetLists } from './step-forms.ts';
import { state, tauri } from './state.ts';

interface Settings { osd: boolean; sound_volume: number; always_admin: boolean; obs: { enabled: boolean; host: string; port: number }; mobile: { enabled: boolean; port: number } }
interface SettingsView { settings: Settings; obs_password: boolean; home_assistant_token: boolean }
interface MobileStatus { enabled: boolean; running: boolean; port: number; connected: boolean; urls: string[]; qrSvg: string | null; error: string }

let current: Settings | null = null;
let selectedTab = 'general';
let mobileStatusTimer: ReturnType<typeof setInterval> | null = null;
let lastMobileQr = '';

function selectSettingsTab(tab: string) {
  const target = document.getElementById(`settings-panel-${tab}`);
  const button = document.querySelector<HTMLButtonElement>(`.settings-tab[data-settings-tab="${tab}"]`);
  if (!target || button?.hidden) tab = 'general';
  selectedTab = tab;
  document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach(button => {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll<HTMLElement>('.settings-panel').forEach(panel => {
    panel.hidden = panel.id !== `settings-panel-${tab}`;
  });
}

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
  for (const id of ['#settings-app', '#settings-obs', '#settings-update']) $(id).hidden = !tauri;
  for (const id of ['#settings-tab-integrations', '#settings-tab-logs', '#settings-tab-about', '#settings-sound']) $(id).hidden = !tauri;
  selectSettingsTab(selectedTab);
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
    $<HTMLInputElement>('#always-admin').checked = Boolean(view.settings.always_admin);
    $<HTMLInputElement>('#osd').checked = view.settings.osd;
    const soundVolume = Math.min(100, Math.max(0, view.settings.sound_volume ?? 100));
    $<HTMLInputElement>('#sound-volume').value = String(soundVolume);
    $('#sound-volume-value').textContent = `${soundVolume}%`;
    $<HTMLInputElement>('#keys-paused').checked = paused;
    $<HTMLInputElement>('#obs-enabled').checked = view.settings.obs.enabled;
    $<HTMLInputElement>('#obs-host').value = view.settings.obs.host;
    $<HTMLInputElement>('#obs-port').value = String(view.settings.obs.port);
    $<HTMLInputElement>('#obs-password').value = '';
    $<HTMLInputElement>('#obs-password').placeholder = view.obs_password ? 'Senha guardada (digite para trocar)' : 'Senha do obs-websocket';
    renderObsState();
  }
  $<HTMLDialogElement>('#settings-modal').showModal();
}

function renderMobileStatus(status: MobileStatus | null) {
  const state = $('#mobile-state'), pairing = $('#mobile-pairing');
  const live = $('#mobile-live-state');
  if (!status) { state.textContent = 'Indisponível'; live.textContent = 'Servidor indisponível'; live.dataset.tone = 'warning'; pairing.hidden = true; return; }
  state.textContent = status.running ? status.connected ? 'Celular conectado' : 'Aguardando o celular' : status.error || 'Desligado';
  live.textContent = status.running ? status.connected ? 'Celular conectado' : 'Servidor ativo' : status.error || 'Servidor desligado';
  live.dataset.tone = status.connected ? 'ok' : status.error ? 'warning' : '';
  state.dataset.tone = status.running && !status.error ? 'ok' : status.error ? 'warning' : '';
  pairing.hidden = !status.running;
  $('#mobile-disconnect').hidden = !status.connected;
  $('#mobile-url').textContent = status.urls[0] || `http://<este computador>:${status.port}/`;
  // Outros adaptadores (VPN, máquinas virtuais): úteis quando o primeiro endereço não abre no celular.
  const others = status.urls.slice(1);
  $('#mobile-other-urls').hidden = !others.length;
  $('#mobile-other-urls').textContent = others.length ? `Se não abrir, tente: ${others.join(' · ')}` : '';
  const qr = status.qrSvg || '';
  if (lastMobileQr !== qr) { $('#mobile-qr').innerHTML = qr; lastMobileQr = qr; }
}

export async function refreshMobileStatus() {
  if (!tauri) return;
  renderMobileStatus(await invoke<MobileStatus>('mobile_status').catch(() => null));
}

export function watchMobileStatus(active: boolean) {
  if (mobileStatusTimer !== null) { clearInterval(mobileStatusTimer); mobileStatusTimer = null; }
  if (active && tauri) { void refreshMobileStatus(); mobileStatusTimer = setInterval(() => void refreshMobileStatus(), 3000); }
}

export async function openMobileConnection() {
  if (!tauri) return;
  try {
    const view = await invoke<SettingsView>('settings_get');
    current = view.settings;
    $<HTMLInputElement>('#mobile-enabled').checked = Boolean(current.mobile?.enabled);
    $<HTMLInputElement>('#mobile-port').value = String(current.mobile?.port || 38800);
    await refreshMobileStatus();
    const dialog = $<HTMLDialogElement>('#mobile-connection-modal');
    if (!dialog.open) dialog.showModal();
  } catch (error) { toast(errorText(error), 'error'); }
}

export function renderObsState() {
  const element = $('#obs-state');
  if (!element) return;
  element.textContent = state.obs.connected
    ? ['Conectado', state.obs.scene && `cena ${state.obs.scene}`, state.obs.recording && '● gravando', state.obs.streaming && '● ao vivo'].filter(Boolean).join(' · ')
    : current?.obs.enabled ? state.obs.error || 'Conectando…' : 'Desligado';
  element.dataset.tone = state.obs.connected ? 'ok' : current?.obs.enabled && state.obs.error ? 'warning' : '';
}

async function saveSettings(next: Settings, secrets: { obsPassword?: string } = {}) {
  try {
    await invoke('settings_save', { settings: next, obsPassword: secrets.obsPassword ?? null });
    current = next;
    forgetLists();
    return true;
  } catch (error) {
    toast(errorText(error), 'error');
    return false;
  }
}

export function bindSettings() {
  document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach(button => {
    button.addEventListener('click', () => selectSettingsTab(button.dataset.settingsTab ?? 'general'));
  });
  $('#theme').addEventListener('change', event => setTheme((event.target as HTMLSelectElement).value as Theme));
  $('#osd').addEventListener('change', async event => {
    const checkbox = event.target as HTMLInputElement;
    if (!current || !await saveSettings({ ...current, osd: checkbox.checked })) checkbox.checked = !checkbox.checked;
  });
  $('#always-admin').addEventListener('change', async event => {
    const checkbox = event.target as HTMLInputElement;
    if (!current || !await saveSettings({ ...current, always_admin: checkbox.checked })) checkbox.checked = !checkbox.checked;
  });
  $('#mobile-enabled').addEventListener('change', async event => {
    const checkbox = event.target as HTMLInputElement;
    if (!current) return;
    const next = { ...current, mobile: { ...current.mobile, enabled: checkbox.checked } };
    if (!await saveSettings(next)) checkbox.checked = !checkbox.checked;
    await refreshMobileStatus();
  });
  $('#mobile-port').addEventListener('change', async event => {
    const input = event.target as HTMLInputElement;
    if (!current) return;
    const previous = current.mobile?.port || 38800;
    const port = Math.min(65535, Math.max(1024, Number(input.value) || 38800));
    input.value = String(port);
    if (!await saveSettings({ ...current, mobile: { ...current.mobile, port } })) input.value = String(previous);
    await refreshMobileStatus();
  });
  $('#mobile-disconnect').addEventListener('click', async () => {
    try { await invoke('mobile_disconnect'); await refreshMobileStatus(); toast('Celular desconectado.', 'success'); }
    catch (error) { toast(errorText(error), 'error'); }
  });
  $('#mobile-copy-url').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#mobile-url').textContent ?? ''); toast('Endereço copiado.', 'success'); }
    catch { toast('Não foi possível copiar o endereço.', 'error'); }
  });
  $('#mobile-connect').addEventListener('click', openMobileConnection);
  $('#close-mobile-connection').addEventListener('click', () => $<HTMLDialogElement>('#mobile-connection-modal').close());
  $('#keys-paused').addEventListener('change', event => setKeysPaused((event.target as HTMLInputElement).checked));
  $('#sound-volume').addEventListener('input', event => {
    const value = Number((event.target as HTMLInputElement).value);
    $('#sound-volume-value').textContent = `${value}%`;
  });
  $('#sound-volume').addEventListener('change', async event => {
    const input = event.target as HTMLInputElement;
    if (!current) return;
    const previous = current.sound_volume ?? 100;
    const soundVolume = Math.min(100, Math.max(0, Number(input.value)));
    if (!await saveSettings({ ...current, sound_volume: soundVolume })) {
      input.value = String(previous);
      $('#sound-volume-value').textContent = `${previous}%`;
    }
  });
  $('#save-integrations').addEventListener('click', async () => {
    if (!current) return;
    const port = Number($<HTMLInputElement>('#obs-port').value) || 4455;
    const password = $<HTMLInputElement>('#obs-password').value;
    const next: Settings = {
      ...current,
      obs: { enabled: $<HTMLInputElement>('#obs-enabled').checked, host: $<HTMLInputElement>('#obs-host').value.trim() || '127.0.0.1', port: Math.min(65535, Math.max(1, port)) }
    };
    if (await saveSettings(next, { obsPassword: password || undefined })) {
      $<HTMLInputElement>('#obs-password').value = '';
      toast('Integração salva.', 'success');
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
