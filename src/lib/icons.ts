// Ícones de traço, 24 × 24.
const icons = {
  logo: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 9h.01M12 9h.01M15 9h.01M9 13h.01M12 13h.01M15 13h.01M9 17h.01M12 17h.01M15 17h.01"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  warning: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 16.8h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  bolt: '<path d="M13 3 5 13.5h6.5L10.5 21 19 10.5h-6.5z"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
  app: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17M7 6.8h.01M9.5 6.8h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
  volumeUp: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12"/>',
  volumeDown: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>',
  mute: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="m21 9.5-5 5M16 9.5l5 5"/>',
  playPause: '<path d="m4 6 8 6-8 6z"/><path d="M16 6v12M20 6v12"/>',
  next: '<path d="m5 6 9 6-9 6z"/><path d="M18 6v12"/>',
  prev: '<path d="m19 6-9 6 9 6z"/><path d="M6 6v12"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.3 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.3-3.4-8.5s1-6.1 3.4-8.5z"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  multi: '<rect x="3.5" y="4" width="17" height="4.5" rx="1.2"/><rect x="3.5" y="10" width="17" height="4.5" rx="1.2"/><rect x="3.5" y="16" width="11" height="4" rx="1.2"/>',
  empty: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  play: '<path d="m7 5 12 7-12 7z"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>',
  arrowUp: '<path d="m6 14 6-6 6 6"/>',
  arrowDown: '<path d="m6 10 6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  rotateLeft: '<path d="M4 5v5h5"/><path d="M4.6 14.5A7.5 7.5 0 1 0 6 7.4L4 10"/>',
  rotateRight: '<path d="M20 5v5h-5"/><path d="M19.4 14.5A7.5 7.5 0 1 1 18 7.4l2 2.6"/>',
  press: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'
};
export type IconName = keyof typeof icons;
export function icon(name: IconName, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = icons[name] || '';
  return svg;
}
