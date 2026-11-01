// Troca de relatórios HID. No app para Windows, o Rust abre o dispositivo (hidapi);
// no navegador, usamos WebHID para pré-visualizar a interface.
import { DEVICE } from './protocol.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function nativeTransport(tauri) {
  const { invoke } = tauri.core;
  return {
    native: true,
    supported: true,
    connect: () => invoke('device_connect'),
    send: payload => invoke('device_send', { payload: Array.from(payload) }),
    ask: (payload, expected, timeout) => invoke('device_ask', { payload: Array.from(payload), expected, timeoutMs: timeout }),
    onChange(callback) { tauri.event.listen('device-changed', event => callback(event.payload)); }
  };
}

function webHidTransport() {
  let device = null;
  let collector = null;
  const onInput = event => collector?.push(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
  const isConfigurationInterface = candidate => candidate.vendorId === DEVICE.vendorId && candidate.productId === DEVICE.productId &&
    candidate.collections.some(collection => collection.usagePage === DEVICE.usagePage && collection.usage === DEVICE.usage &&
      collection.outputReports.some(report => report.reportId === DEVICE.reportId));
  async function send(payload) {
    const bytes = new Uint8Array(DEVICE.reportLength);
    bytes.set(payload);
    await device.sendReport(DEVICE.reportId, bytes);
    await sleep(8);
  }
  return {
    native: false,
    supported: 'hid' in navigator,
    async connect() {
      const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: DEVICE.vendorId, productId: DEVICE.productId, usagePage: DEVICE.usagePage, usage: DEVICE.usage }] });
      const found = devices.find(isConfigurationInterface);
      if (!found) throw new Error('Nenhuma interface de configuração selecionada.');
      device?.removeEventListener('inputreport', onInput);
      device = found;
      if (!device.opened) await device.open();
      device.addEventListener('inputreport', onInput);
    },
    send,
    async ask(payload, expected, timeout) {
      const answers = [];
      collector = answers;
      try {
        await send(payload);
        const started = Date.now();
        while (answers.length < expected && Date.now() - started < timeout) await sleep(15);
        return answers;
      } finally { collector = null; }
    },
    onChange(callback) {
      navigator.hid?.addEventListener('disconnect', event => {
        if (event.device !== device) return;
        device = null;
        callback(false);
      });
    }
  };
}

export const transport = window.__TAURI__ ? nativeTransport(window.__TAURI__) : webHidTransport();
