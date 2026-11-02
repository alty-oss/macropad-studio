// Kits prontos: configurações completas de uma camada para usos comuns. Aplicar um kit cria
// alterações não gravadas na camada aberta, como a importação; nada vai para o macropad antes de
// gravar, e Ctrl+Z desfaz.
import type { Binding, Profile, Step } from '../device/protocol.ts';
import { newStep, type StepOf } from '../device/steps.ts';
import { plural } from '../lib/text.ts';
import { remember, renderAll, stageDraft } from './editing.ts';
import { confirmDialog, toast } from './feedback.ts';
import { showMenu, type MenuEntry } from './menu.ts';
import { controlInfo, state, tauri } from './state.ts';

// Teclas pela numeração da tela (Tecla 01–12) e knobs pelas três funções.
type Place = number | `knob${1 | 2 | 3}`;
interface Kit { name: string; description: string; app: boolean; note?: string; controls: [Place, Binding][] }

const CTRL = 1, SHIFT = 2, ALT = 4;
const key = (mods: number, code: number): Binding => ({ kind: 'key', mods, code });
const media = (code: number): Binding => ({ kind: 'media', media: code });
const app = (step: Step): Binding => ({ kind: 'app', multi: false, steps: [step] });
const multi = (steps: Step[], profiles: Profile[] = []): Binding => ({ kind: 'app', multi: true, steps, mode: 'normal', alt: [], profiles });
const hotkey = (mods: number, code: number): Step => ({ type: 'hotkey', mods, code });
const obs = (action: StepOf<'obs'>['action'], extra: Partial<StepOf<'obs'>> = {}): Step => ({ ...newStep('obs') as StepOf<'obs'>, action, ...extra });
const audio = (target: StepOf<'audio'>['target'], action: StepOf<'audio'>['action'], extra: Partial<StepOf<'audio'>> = {}): Step => ({ ...newStep('audio') as StepOf<'audio'>, target, action, ...extra });
// Knob: girar à esquerda, pressionar e girar à direita.
const knob = (number: 1 | 2 | 3, left: Binding, press: Binding, right: Binding): [Place, Binding][] => [[`knob${number}`, left], [`knob${number}`, press], [`knob${number}`, right]];

// Usos HID das letras e teclas usadas nos kits.
const K = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter, i) => [letter, 4 + i])) as Record<string, number>;
const F = (n: number) => 0x3a + n - 1;
const MEDIA = { volumeUp: 0xe9, volumeDown: 0xea, mute: 0xe2, playPause: 0xcd, next: 0xb5, prev: 0xb6 };

const kits: Kit[] = [
  {
    name: 'Streaming (OBS)', app: true, description: 'Gravar, transmitir, replay, cenas e volumes do OBS nos knobs.',
    note: 'Troque os nomes das cenas e fontes pelos do seu OBS (Configurações › OBS Studio lista os nomes).',
    controls: [
      [1, app(obs('record'))], [2, app(obs('stream'))], [3, app(obs('replay'))], [4, app(obs('mute', { source: 'Mic/Aux' }))],
      [5, app(obs('scene', { scene: 'Cena 1' }))], [6, app(obs('scene', { scene: 'Cena 2' }))], [7, app(obs('scene', { scene: 'Cena 3' }))], [8, app(obs('scene', { scene: 'Cena 4' }))],
      [9, app(obs('visibility', { source: 'Câmera' }))], [10, app(obs('virtualcam'))], [11, app(obs('chapter'))], [12, app(obs('recordPause'))],
      ...knob(1, app(obs('volume', { source: 'Mic/Aux', amount: -2 })), app(obs('mute', { source: 'Mic/Aux' })), app(obs('volume', { source: 'Mic/Aux', amount: 2 }))),
      ...knob(2, app(obs('volume', { source: 'Áudio do desktop', amount: -2 })), app(obs('mute', { source: 'Áudio do desktop' })), app(obs('volume', { source: 'Áudio do desktop', amount: 2 }))),
      ...knob(3, media(MEDIA.volumeDown), media(MEDIA.mute), media(MEDIA.volumeUp))
    ]
  },
  {
    name: 'Reuniões (Meet, Teams, Zoom)', app: true, description: 'Microfone, câmera e mão levantada, com o atalho certo para cada programa.',
    note: 'O mudo do microfone vale para qualquer app. Câmera e mão usam perfis: Teams e Zoom pelo programa; o padrão é o Google Meet no navegador.',
    controls: [
      [1, app(audio('mic', 'toggle'))],
      [2, multi([hotkey(CTRL, K.E)], [{ app: 'ms-teams.exe', steps: [hotkey(CTRL | SHIFT, K.O)] }, { app: 'zoom.exe', steps: [hotkey(ALT, K.V)] }])],
      [3, multi([hotkey(CTRL | ALT, K.H)], [{ app: 'ms-teams.exe', steps: [hotkey(CTRL | SHIFT, K.K)] }, { app: 'zoom.exe', steps: [hotkey(ALT, K.Y)] }])],
      [4, multi([hotkey(CTRL, K.D)], [{ app: 'ms-teams.exe', steps: [hotkey(CTRL | SHIFT, K.M)] }, { app: 'zoom.exe', steps: [hotkey(ALT, K.A)] }])],
      ...knob(1, media(MEDIA.volumeDown), media(MEDIA.mute), media(MEDIA.volumeUp))
    ]
  },
  {
    name: 'VS Code', app: false, description: 'Paleta de comandos, terminal, busca, formatação e abas no knob.',
    controls: [
      [1, key(CTRL | SHIFT, K.P)], [2, key(CTRL, 0x35)], [3, key(CTRL | SHIFT, K.F)], [4, key(SHIFT | ALT, K.F)],
      [5, key(CTRL, 0x38)], [6, key(CTRL, K.P)], [7, key(0, F(5))], [8, key(0, F(2))],
      [9, key(CTRL, K.B)], [10, key(CTRL | SHIFT, K.E)], [11, key(CTRL | SHIFT, K.G)], [12, key(CTRL, K.S)],
      ...knob(1, key(CTRL, 0x4b), key(CTRL, K.W), key(CTRL, 0x4e)),
      ...knob(2, key(CTRL, 0x2d), key(CTRL, 0x27), key(CTRL, 0x2e))
    ]
  },
  {
    name: 'Photoshop', app: false, description: 'Ferramentas, desfazer e tamanho do pincel e zoom nos knobs.',
    controls: [
      [1, key(CTRL, K.Z)], [2, key(CTRL | SHIFT, K.Z)], [3, key(0, K.B)], [4, key(0, K.E)],
      [5, key(0, K.V)], [6, key(0, K.L)], [7, key(0, K.I)], [8, key(0, K.M)],
      [9, key(0, K.T)], [10, key(0, K.X)], [11, key(CTRL, K.J)], [12, key(CTRL, K.S)],
      ...knob(1, key(0, 0x2f), key(0, K.D), key(0, 0x30)),
      ...knob(2, key(CTRL, 0x2d), key(CTRL, 0x27), key(CTRL, 0x2e))
    ]
  },
  {
    name: 'Mídia', app: true, description: 'Teclas de mídia, volume do sistema e do Spotify nos knobs, microfone e sons.',
    controls: [
      [1, media(MEDIA.prev)], [2, media(MEDIA.playPause)], [3, media(MEDIA.next)], [4, app(audio('mic', 'toggle'))],
      [5, app({ type: 'open', path: 'spotify:', args: '', focus: false })],
      ...knob(1, media(MEDIA.volumeDown), media(MEDIA.mute), media(MEDIA.volumeUp)),
      ...knob(2, app(audio('app', 'down', { app: 'spotify.exe' })), app(audio('app', 'mute', { app: 'spotify.exe' })), app(audio('app', 'up', { app: 'spotify.exe' })))
    ]
  },
  {
    name: 'Discord', app: false, description: 'Mudo, ensurdecer e push-to-talk pelos atalhos do Discord.',
    note: 'No Discord, abra Configurações › Atalhos de teclado e crie os atalhos: Ctrl+Shift+M para alternar o mudo, Ctrl+Shift+D para ensurdecer e Ctrl+Shift+T para pressionar para falar.',
    controls: [[1, key(CTRL | SHIFT, K.M)], [2, key(CTRL | SHIFT, K.D)], [3, key(CTRL | SHIFT, K.T)]]
  }
];

// Slot do firmware da tecla com a numeração da tela, ou dos knobs pela ordem das funções.
function slotsFor(controls: [Place, Binding][]): [number, Binding][] {
  const keySlot = (number: number) => {
    const name = `Tecla ${String(number).padStart(2, '0')}`;
    for (let slot = 1; slot <= state.layout.keys; slot++) if (controlInfo(slot).name === name) return slot;
    return null;
  };
  const knobParts = new Map<string, number>();
  return controls.flatMap(([place, binding]): [number, Binding][] => {
    if (typeof place === 'number') { const slot = keySlot(place); return slot ? [[slot, binding]] : []; }
    const index = Number(place.slice(4)) - 1;
    if (index >= state.layout.knobs) return [];
    const part = knobParts.get(place) ?? 0;
    knobParts.set(place, part + 1);
    return [[16 + index * 3 + part, binding]];
  });
}

async function applyKit(kit: Kit) {
  const controls = slotsFor(kit.controls);
  const text = `${plural(controls.length, 'controle da camada', 'controles da camada')} ${state.layer} recebem as ações do kit como alterações não gravadas. Revise e grave no dispositivo.${kit.note ? ` ${kit.note}` : ''}`;
  if (!await confirmDialog(`Aplicar o kit ${kit.name}?`, text, 'Aplicar')) return;
  remember();
  for (const [slot, binding] of controls) stageDraft(state.layer, slot, structuredClone(binding));
  renderAll();
  toast(`Kit ${kit.name} aplicado na camada ${state.layer}.`, 'success');
}

export function kitMenuEntries(): MenuEntry[] {
  return kits.map(kit => ({
    label: `Kit: ${kit.name}`, icon: 'sparkle' as const, disabled: kit.app && !tauri,
    action: () => applyKit(kit)
  }));
}
export function openKitMenu(x: number, y: number) { showMenu(x, y, kitMenuEntries()); }
