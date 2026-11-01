// Como cada ação aparece: título e ícone no painel, legenda impressa na keycap.
import { comboLabel, mediaNames } from '../device/keys.ts';
import { stepNames, type Binding, type Step, type StepType } from '../device/protocol.ts';
import { h } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { plural } from '../lib/text.ts';

export const PROGRAM_PATH = /\.(exe|bat|cmd|com|lnk)$/i;
export const mediaIcons = new Map<number, IconName>([[0xe9, 'volumeUp'], [0xea, 'volumeDown'], [0xe2, 'mute'], [0xcd, 'playPause'], [0xb5, 'next'], [0xb6, 'prev']]);
const mediaShort = new Map<number, string>([[0xe9, 'Vol +'], [0xea, 'Vol −'], [0xe2, 'Mudo'], [0xcd, 'Play'], [0xb5, 'Próx.'], [0xb6, 'Ant.']]);
const stepIcons: Record<StepType, IconName> = { open: 'folder', website: 'globe', text: 'text', hotkey: 'keyboard', delay: 'clock' };
// Em "Abrir", o ícone segue o caminho: programa, arquivo com extensão ou pasta.
export const stepIcon = (step: Step): IconName => step.type !== 'open' ? stepIcons[step.type]
  : PROGRAM_PATH.test(step.path.trim()) ? 'app' : /\.[a-z0-9]{1,5}$/i.test(step.path.trim()) ? 'file' : 'folder';

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

// Nome curto para caber numa tecla: pasta ou arquivo sem extensão de executável, domínio sem "www." nem sufixo.
function shortName(step: Step): string {
  if (step.type === 'open') {
    const name = step.path.split(/[\\/]/).filter(Boolean).pop() || '';
    return name.replace(/\.(exe|lnk|bat|cmd|url)$/i, '') || 'Abrir';
  }
  if (step.type === 'website') {
    try { return new URL(step.url).hostname.replace(/^www\./, '').split('.')[0] || 'Site'; }
    catch { return 'Site'; }
  }
  if (step.type === 'hotkey') return comboLabel(step.mods, step.code).join('+') || 'Atalho';
  return stepNames[step.type];
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
export function keycapLegend(binding: Binding) {
  const legend = legendFor(binding);
  return h('span', { class: 'keycap-legend' },
    legend.icon ? icon(legend.icon) : null,
    legend.mods ? h('small', {}, legend.mods) : null,
    legend.text ? h('span', { class: legendClass(legend.text) }, legend.text) : null);
}
