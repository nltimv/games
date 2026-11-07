// Ships that fly close together are drawn as one flock: the lead ship's
// icon with a count and a single label, clicked as one. Labels that would
// still pile up move up or down to a free spot, or are left out.

import { drawLabel, labelWidth } from './labels.js';

/**
 * Groups `items` ({ p: { x, y }, ... } in screen pixels) whose positions lie
 * within `radius` of a group's middle. Returns [{ x, y, members }], in the
 * order the groups were started.
 */
export function flock(items, radius) {
  const groups = [];
  for (const item of items) {
    const group = groups.find((g) => Math.hypot(g.x - item.p.x, g.y - item.p.y) <= radius);
    if (!group) {
      groups.push({ x: item.p.x, y: item.p.y, members: [item] });
      continue;
    }
    group.members.push(item);
    const n = group.members.length;
    group.x += (item.p.x - group.x) / n;
    group.y += (item.p.y - group.y) / n;
  }
  return groups;
}

/** A flock's label: both names for two ships, else how many. */
export function flockName(members) {
  return members.length === 2 ? `${members[0].ship.name}, ${members[1].ship.name}` : `${members.length} ships`;
}

/** The count on a flock's icon: a small dark disc with the number. */
export function drawCount(ctx, x, y, n, dpr, u = 1) {
  const r = (n > 9 ? 8 : 7) * u;
  ctx.fillStyle = 'rgba(6, 18, 40, 0.88)';
  ctx.strokeStyle = 'rgba(143, 245, 228, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawLabel(ctx, String(n), x, y + 0.5, dpr, { size: Math.round(10 * Math.min(1.2, u)), weight: 800, color: '#ffffff' });
}

const LINE = 14;
const SHIFTS = [0, -LINE, LINE, -2 * LINE, 2 * LINE];

/**
 * Space for labels on one frame. `draw` places a label like drawLabel, but
 * moves it up or down when it would overlap one drawn before, and leaves
 * it out when there is no room nearby. Returns whether it was drawn.
 */
export function createLabelSpace(ctx, dpr) {
  const boxes = [];
  return function draw(text, x, y, options = {}) {
    const size = options.size ?? 12;
    const width = labelWidth(text, options);
    const align = options.align ?? 'center';
    const left = align === 'left' ? x : align === 'right' ? x - width : x - width / 2;
    for (const dy of SHIFTS) {
      const box = { left, right: left + width, top: y + dy - size * 0.7, bottom: y + dy + size * 0.7 };
      if (boxes.some((b) => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top)) continue;
      boxes.push(box);
      drawLabel(ctx, text, x, y + dy, dpr, options);
      return true;
    }
    return false;
  };
}
