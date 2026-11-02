// "Cola" da configuração: uma imagem SVG com as três camadas, como o aparelho aparece na tela
// (teclas em 4 × 3 e os knobs à direita), para imprimir ou deixar ao lado do monitor.
import { labelFor, type Binding } from '../device/protocol.ts';
import { errorText } from '../lib/text.ts';
import { saveFile } from './backup.ts';
import { toast } from './feedback.ts';
import { loadAllLayers } from './session.ts';
import { bindingAt, controlInfo, labelAt, state } from './state.ts';

const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1)}…` : text;
const describe = (binding: Binding) => binding.kind === 'empty' ? '' : labelFor(binding);

const KEY = { width: 168, height: 92, gap: 12 };
const COLUMNS = 4;

function layerSvg(layer: number, top: number): string {
  const parts: string[] = [`<text x="24" y="${top + 24}" class="layer">Camada ${layer}</text>`];
  for (let slot = 1; slot <= state.layout.keys; slot++) {
    const number = Number(controlInfo(slot).name.slice(-2)) - 1;
    const x = 24 + (number % COLUMNS) * (KEY.width + KEY.gap), y = top + 40 + Math.floor(number / COLUMNS) * (KEY.height + KEY.gap);
    const binding = bindingAt(slot, layer), label = labelAt(slot, layer);
    const title = label?.text.trim() || describe(binding);
    parts.push(`<rect x="${x}" y="${y}" width="${KEY.width}" height="${KEY.height}" rx="10" class="key"/>`);
    if (label?.color && binding.kind !== 'empty') parts.push(`<rect x="${x}" y="${y}" width="6" height="${KEY.height}" rx="3" fill="${label.color}"/>`);
    parts.push(`<text x="${x + 14}" y="${y + 22}" class="name">${escape(controlInfo(slot).name)}</text>`);
    parts.push(`<text x="${x + 14}" y="${y + 50}" class="title">${escape(clip(title || '—', 20))}</text>`);
    if (label?.text.trim() && binding.kind !== 'empty') parts.push(`<text x="${x + 14}" y="${y + 72}" class="detail">${escape(clip(describe(binding), 28))}</text>`);
  }
  const knobX = 24 + COLUMNS * (KEY.width + KEY.gap) + 12;
  for (let knob = 0; knob < state.layout.knobs; knob++) {
    const y = top + 40 + knob * 86;
    parts.push(`<circle cx="${knobX + 30}" cy="${y + 34}" r="26" class="key"/><text x="${knobX + 30}" y="${y + 39}" class="knob">${knob + 1}</text>`);
    ['↶', '●', '↷'].forEach((glyph, part) => {
      const slot = 16 + knob * 3 + part;
      const binding = bindingAt(slot, layer);
      const text = labelAt(slot, layer)?.text.trim() || describe(binding) || '—';
      parts.push(`<text x="${knobX + 70}" y="${y + 16 + part * 22}" class="detail"><tspan class="glyph">${glyph}</tspan> ${escape(clip(text, 30))}</text>`);
    });
  }
  return parts.join('\n');
}

export async function exportCheatSheet() {
  try {
    await loadAllLayers();
    const rows = Math.ceil(state.layout.keys / COLUMNS);
    const layerHeight = Math.max(40 + rows * (KEY.height + KEY.gap), 40 + state.layout.knobs * 86) + 28;
    const width = 24 + COLUMNS * (KEY.width + KEY.gap) + 300;
    const height = 3 * layerHeight + 16;
    const body = [1, 2, 3].map(layer => layerSvg(layer, 8 + (layer - 1) * layerHeight)).join('\n');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, sans-serif">
<style>
  .layer { font-size: 18px; font-weight: 700; fill: #1b1c1f; }
  .key { fill: #f4f5f7; stroke: #c9ccd2; stroke-width: 1.5; }
  .name { font-size: 11px; fill: #7a7e88; }
  .title { font-size: 16px; font-weight: 600; fill: #1b1c1f; }
  .detail { font-size: 12px; fill: #4c505a; }
  .knob { font-size: 16px; font-weight: 700; fill: #1b1c1f; text-anchor: middle; }
  .glyph { fill: #3286ff; font-weight: 700; }
</style>
<rect width="100%" height="100%" fill="#ffffff"/>
${body}
</svg>
`;
    if (await saveFile(svg, 'macropad-studio-cola.svg', 'Imagem SVG', 'svg', 'image/svg+xml')) toast('Cola salva. Abra no navegador para imprimir.', 'success');
  } catch (error) { toast(errorText(error), 'error'); }
}
