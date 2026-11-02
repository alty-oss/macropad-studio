// OSD: aviso rápido na tela quando uma ação do app roda (volume, cena do OBS, erro…). A janela
// fica sempre aberta e transparente; só o cartão aparece e some.
import { listen } from '@tauri-apps/api/event';

interface Osd { title: string; detail: string; tone: 'info' | 'error' }

const card = document.querySelector<HTMLElement>('#osd')!;
const title = document.querySelector<HTMLElement>('#osd-title')!;
const detail = document.querySelector<HTMLElement>('#osd-detail')!;
let timer: ReturnType<typeof setTimeout> | undefined;

listen<Osd>('osd', ({ payload }) => {
  title.textContent = payload.title || payload.detail;
  detail.textContent = payload.title ? payload.detail : '';
  card.classList.toggle('error', payload.tone === 'error');
  card.classList.add('visible');
  clearTimeout(timer);
  timer = setTimeout(() => card.classList.remove('visible'), payload.tone === 'error' ? 3500 : 1400);
});
