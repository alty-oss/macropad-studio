// Ícones de traço (24 × 24) e logotipos de marca preenchidos. Os desenhos ficam em icons.json, que
// também é servido à página do celular (src-tauri/src/mobile.rs), para os dois lados usarem os mesmos.
import data from './icons.json';

const { line, brand } = data;
export type IconName = keyof typeof line | keyof typeof brand;

// Ícones que o usuário pode escolher para a legenda de uma tecla ou de um botão do celular.
export const customIcons: IconName[] = [
  'star', 'heart', 'flag', 'bell', 'camera', 'video', 'mic', 'music', 'code', 'chat', 'gamepad', 'home', 'globe', 'folder', 'app', 'keyboard', 'bolt',
  'sun', 'lightbulb', 'power', 'user', 'terminal', 'monitor', 'record', 'broadcast', 'replay', 'mixer', 'wand',
  'obs', 'twitch', 'youtube', 'discord', 'spotify'
];
export const isBrand = (name: string) => Object.hasOwn(brand, name);
export const isIconName = (name: string): name is IconName => Object.hasOwn(line, name) || isBrand(name);
export function icon(name: IconName, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (isBrand(name)) {
    svg.setAttribute('class', `${className} icon-brand`);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', brand[name as keyof typeof brand]);
    svg.append(path);
  } else {
    svg.setAttribute('class', className);
    svg.innerHTML = line[name as keyof typeof line] || '';
  }
  return svg;
}
