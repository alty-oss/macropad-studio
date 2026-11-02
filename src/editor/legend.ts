// Como cada ação aparece: título e ícone no painel, legenda impressa na keycap.
import type { Label } from '../device/backup-file.ts';
import { comboLabel, mediaNames } from '../device/keys.ts';
import { stepNames, type Binding, type Step } from '../device/protocol.ts';
import { h } from '../lib/dom.ts';
import { icon, isIconName, type IconName } from '../lib/icons.ts';
import { plural } from '../lib/text.ts';

export const PROGRAM_PATH = /\.(exe|bat|cmd|com|lnk)$/i;
export const mediaIcons = new Map<number, IconName>([[0xe9, 'volumeUp'], [0xea, 'volumeDown'], [0xe2, 'mute'], [0xcd, 'playPause'], [0xb5, 'next'], [0xb6, 'prev']]);
const mediaShort = new Map<number, string>([[0xe9, 'Vol +'], [0xea, 'Vol −'], [0xe2, 'Mudo'], [0xcd, 'Play'], [0xb5, 'Próx.'], [0xb6, 'Ant.']]);
// Teclas de mídia das etapas do app, com os mesmos ícones e nomes curtos das gravadas no aparelho.
const mediaKeyIcons: Record<string, IconName> = { playPause: 'playPause', next: 'next', prev: 'prev', stop: 'stop', volumeUp: 'volumeUp', volumeDown: 'volumeDown', mute: 'mute' };
const mediaKeyShort: Record<string, string> = { playPause: 'Play', next: 'Próx.', prev: 'Ant.', stop: 'Parar', volumeUp: 'Vol +', volumeDown: 'Vol −', mute: 'Mudo' };

const obsIcons: Record<string, IconName> = { mute: 'mic', visibility: 'eye', volume: 'volumeUp', record: 'record', recordStart: 'record', recordStop: 'record', recordPause: 'record', stream: 'broadcast', streamStart: 'broadcast', streamStop: 'broadcast', replay: 'replay', screenshot: 'image', scene: 'monitor' };

// O ícone segue o conteúdo: em "Abrir", programa, arquivo ou pasta; em mídia e áudio, a ação.
export function stepIcon(step: Step): IconName {
  switch (step.type) {
    case 'open': return PROGRAM_PATH.test(step.path.trim()) ? 'app' : /\.[a-z0-9]{1,5}$/i.test(step.path.trim()) ? 'file' : 'folder';
    case 'website': return 'globe';
    case 'text': return 'text';
    case 'hotkey': return 'keyboard';
    case 'delay': return 'clock';
    case 'media': return mediaKeyIcons[step.key] ?? 'playPause';
    case 'command': return 'terminal';
    case 'http': return 'link';
    case 'audio':
      if (step.action === 'up') return 'volumeUp';
      if (step.action === 'down') return 'volumeDown';
      return step.target === 'mic' ? 'mic' : 'mute';
    case 'window': return 'window';
    case 'system': return step.action === 'theme' ? 'sun' : 'power';
    case 'mouse': return 'mouse';
    case 'sound': return 'music';
    case 'counter': return 'hash';
    case 'brightness': return 'sun';
    case 'obs': return obsIcons[step.action] ?? 'obs';
    case 'voicemeeter': return 'mixer';
    case 'player': return step.action === 'next' ? 'next' : step.action === 'prev' ? 'prev' : step.action === 'stop' ? 'stop' : 'playPause';
  }
}

// where: 'device' para ações gravadas no macropad, 'app' para as executadas por teclas virtuais.
export function bindingMeta(binding: Binding): { title: string; icon: IconName; where: 'device' | 'app' | null } {
  switch (binding.kind) {
    case 'key': return { title: 'Atalho de teclado', icon: 'keyboard', where: 'device' };
    case 'media': return { title: mediaNames.get(binding.media) || 'Mídia', icon: mediaIcons.get(binding.media) ?? 'volumeUp', where: 'device' };
    case 'app': {
      const [step] = binding.steps;
      return binding.multi ? { title: 'Multi-ação', icon: 'multi', where: 'app' }
        : { title: step ? stepNames[step.type] : 'Ação do app', icon: step ? stepIcon(step) : 'multi', where: 'app' };
    }
    case 'raw': return { title: 'Ação existente', icon: 'warning', where: 'device' };
    case 'empty': return { title: 'Sem ação', icon: 'empty', where: null };
  }
}

const withoutExtension = (name: string) => name.replace(/\.(exe|lnk|bat|cmd|url|mp3|wav|ogg|txt)$/i, '');
const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || '';
const domain = (url: string, fallback: string) => {
  try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0] || fallback; }
  catch { return fallback; }
};
const obsShort: Record<string, string> = {
  record: 'REC', recordStart: 'REC', recordStop: 'Parar', recordPause: 'Pausa', stream: 'Live', streamStart: 'Live', streamStop: 'Fim',
  virtualcam: 'Cam', replay: 'Replay', transition: 'Corte', chapter: 'Marca'
};
const windowShort: Record<string, string> = { minimize: 'Min', maximize: 'Max', close: 'Fechar', topmost: 'Topo', nextMonitor: 'Monitor' };
const systemShort: Record<string, string> = { lock: 'Bloq.', sleep: 'Suspender', shutdown: 'Desligar', restart: 'Reiniciar', theme: 'Tema' };
const mouseShort: Record<string, string> = { left: 'Clique', right: 'Clique D', middle: 'Meio', scrollUp: 'Rolar ↑', scrollDown: 'Rolar ↓', scrollLeft: 'Rolar ←', scrollRight: 'Rolar →' };

// Nome curto para caber numa tecla.
function shortName(step: Step): string {
  switch (step.type) {
    case 'open': return withoutExtension(lastPart(step.path)) || 'Abrir';
    case 'website': return domain(step.url, 'Site');
    case 'hotkey': return comboLabel(step.mods, step.code).join('+') || 'Atalho';
    case 'media': return mediaKeyShort[step.key] ?? 'Mídia';
    case 'command': return 'Cmd';
    case 'http': return domain(step.url, 'HTTP');
    case 'audio': {
      const name = step.target === 'mic' ? 'Mic' : step.target === 'output' ? 'Som' : withoutExtension(step.app) || 'App';
      return step.action === 'up' ? `${name} +` : step.action === 'down' ? `${name} −` : name;
    }
    case 'window': return windowShort[step.action];
    case 'system': return systemShort[step.action];
    case 'mouse': return mouseShort[step.action];
    case 'sound': return withoutExtension(lastPart(step.path)) || 'Som';
    case 'counter': return step.change === 0 ? 'Zerar' : `${step.change > 0 ? '+' : ''}${step.change}`;
    case 'brightness': return `${step.change > 0 ? '+' : ''}${step.change}%`;
    case 'obs': return step.action === 'scene' ? step.scene || 'Cena' : obsShort[step.action] ?? (step.source || 'OBS');
    case 'voicemeeter': return 'VM';
    case 'player': return withoutExtension(step.app) || 'Player';
    default: return stepNames[step.type];
  }
}
// Legenda como numa tecla impressa: ícone ou modificadores em cima, texto principal embaixo.
function legendFor(binding: Binding): { icon?: IconName; text: string; mods?: string } {
  switch (binding.kind) {
    case 'key': {
      const parts = comboLabel(binding.mods, binding.code);
      return { text: parts.pop() || '', mods: parts.join(' ') };
    }
    case 'media': return { icon: mediaIcons.get(binding.media), text: mediaShort.get(binding.media) ?? '' };
    case 'app': {
      if (binding.multi) return { icon: 'multi', text: plural(binding.steps.length, 'etapa', 'etapas') };
      const [step] = binding.steps;
      return step ? { icon: stepIcon(step), text: shortName(step) } : { icon: 'warning', text: 'Macro' };
    }
    case 'raw': return { icon: 'warning', text: 'Existente' };
    case 'empty': return { text: '' };
  }
}
// A fonte diminui com a palavra mais longa. Textos com espaço quebram em até duas linhas, só entre
// palavras; uma palavra que ainda não couber termina em reticências.
function legendClass(text: string) {
  const longest = Math.max(...text.split(/\s+/).map(word => [...word].length));
  const size = longest <= 3 ? 'lg' : longest <= 6 ? 'md' : longest <= 8 ? 'sm' : 'xs';
  return `legend-${size}${/\s/.test(text.trim()) ? ' legend-wrap' : ''}`;
}
// A legenda personalizada (texto e ícone) substitui a gerada; a cor fica a cargo da keycap.
export function keycapLegend(binding: Binding, label?: Label) {
  const legend = legendFor(binding);
  const custom = label && binding.kind !== 'empty' ? label : undefined;
  const glyph = custom?.icon && isIconName(custom.icon) ? custom.icon : legend.icon;
  const text = custom?.text.trim() || legend.text;
  return h('span', { class: 'keycap-legend' },
    glyph ? icon(glyph) : null,
    !custom?.text.trim() && legend.mods ? h('small', {}, legend.mods) : null,
    text ? h('span', { class: legendClass(text) }, text) : null);
}
