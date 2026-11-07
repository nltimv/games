// The "!" that marks contracts on the maps: gold where an offer waits,
// aqua where a contract is running. Each look is drawn once per size and
// then copied.

const LOOKS = {
  offer: { light: '#fff6d8', mid: '#ffd36e', dark: '#e0a52c', ink: '#3a2a00' },
  running: { light: '#e6fff9', mid: '#6ff0d8', dark: '#22b8a0', ink: '#03303d' },
};
const discs = new Map();

function disc(kind, r, dpr) {
  const key = `${kind}|${r}|${dpr}`;
  let canvas = discs.get(key);
  if (!canvas) {
    const look = LOOKS[kind];
    const size = Math.ceil((r * 2 + 6) * dpr);
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const c = size / dpr / 2;
    ctx.shadowColor = 'rgba(2, 8, 24, 0.55)';
    ctx.shadowBlur = 3 * dpr;
    const g = ctx.createRadialGradient(c - r * 0.3, c - r * 0.4, r * 0.1, c, c, r);
    g.addColorStop(0, look.light);
    g.addColorStop(0.45, look.mid);
    g.addColorStop(1, look.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // The "!" itself, drawn rather than typed so it needs no font.
    ctx.strokeStyle = look.ink;
    ctx.fillStyle = look.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.34;
    ctx.beginPath();
    ctx.moveTo(c, c - r * 0.52);
    ctx.lineTo(c, c + r * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c + r * 0.5, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    discs.set(key, canvas);
  }
  return canvas;
}

/**
 * Draws contract marks at (x, y), side by side when a place has both: an
 * offer first, then a running contract. `marks` is { offer, active }.
 */
export function drawContractMarks(ctx, x, y, marks, dpr, u = 1) {
  if (!marks) return;
  const r = Math.round(7 * Math.min(1.25, Math.max(0.9, u)));
  const kinds = [marks.offer ? 'offer' : null, marks.active ? 'running' : null].filter(Boolean);
  kinds.forEach((kind, i) => {
    const cx = x + i * (r * 2 + 2);
    const canvas = disc(kind, r, dpr);
    const size = canvas.width / dpr;
    ctx.drawImage(canvas, cx - size / 2, y - size / 2, size, size);
  });
}
