// Map labels, pre-rendered with their dark halo into small canvases. Blurred
// text is slow to draw, so each label is drawn once and then copied; the
// cache forgets the least recently used labels (ship countdowns change every
// second).

export const FONT = "'Nunito Sans', 'Segoe UI', system-ui, sans-serif";

const MAX_LABELS = 240;
const PAD = 5;
const cache = new Map();
let scratch = null;

function measure(font, text) {
  scratch ??= document.createElement('canvas').getContext('2d');
  scratch.font = font;
  return scratch.measureText(text).width;
}

function render(text, font, size, color, dpr) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((measure(font, text) + PAD * 2) * dpr);
  canvas.height = Math.ceil((size * 1.4 + PAD * 2) * dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // shadowBlur ignores the transform, so scale it by hand.
  ctx.shadowColor = 'rgba(2, 8, 24, 0.85)';
  ctx.shadowBlur = 4 * dpr;
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2);
  return { canvas, width, height };
}

/**
 * Draws `text` at (x, y): centred vertically, and aligned left, centre or
 * right of x.
 */
export function drawLabel(ctx, text, x, y, dpr, { size = 12, weight = 700, color = 'rgba(230, 242, 255, 0.92)', align = 'center' } = {}) {
  const font = `${weight} ${size}px ${FONT}`;
  const key = `${font}|${color}|${dpr}|${text}`;
  let label = cache.get(key);
  if (label) {
    cache.delete(key);
  } else {
    label = render(text, font, size, color, dpr);
    if (cache.size >= MAX_LABELS) cache.delete(cache.keys().next().value);
  }
  cache.set(key, label);
  const left = align === 'left' ? x - PAD : align === 'right' ? x - label.width + PAD : x - label.width / 2;
  // Whole device pixels keep the text sharp.
  const snap = (v) => Math.round(v * dpr) / dpr;
  ctx.drawImage(label.canvas, snap(left), snap(y - label.height / 2), label.width, label.height);
}

/** Forgets every label, so they are redrawn (once the web font loads). */
export function clearLabels() {
  cache.clear();
}
