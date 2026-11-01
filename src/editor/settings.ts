// Diálogo de configurações e a preferência de legendas nas teclas.
import { invoke } from '@tauri-apps/api/core';
import { $ } from '../lib/dom.ts';
import { tauri } from './state.ts';

export async function openSettings() {
  $('#settings-app').hidden = !tauri;
  if (tauri) $<HTMLInputElement>('#autostart').checked = await invoke<boolean>('autostart_get').catch(() => false);
  $<HTMLDialogElement>('#settings-modal').showModal();
}

// Preferência só desta máquina: o localStorage pode falhar, e a tela funciona sem ele.
export function setLegends(visible: boolean) {
  document.body.classList.toggle('no-legends', !visible);
  try { localStorage.setItem('legends', visible ? '1' : '0'); } catch {}
}
export function savedLegends() {
  try { return localStorage.getItem('legends') !== '0'; } catch { return true; }
}
