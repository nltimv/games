// Draws the galaxy map: the systems the company has charted as glowing
// nodes in their faction's colour over soft faction washes, the lanes
// between them, and ships crossing lanes in a jump. Systems nobody has
// charted stay hidden; charted but unsurveyed ones are dim, with a "?".
// Returns the clickable things, like drawSystem.

import { allSystems, findFaction, findSystem, lanesFrom } from '../content/galaxy.js';
import { HULLS } from '../content/ships.js';
import { chartedSystems, isSurveyed } from '../systems/explore.js';
import { canJump, jumpTime, shipPosition } from '../systems/travel.js';
import { scaleOf, toScreen } from './camera.js';
import { drawAsset } from './assets.js';
import { drawLabel } from './labels.js';
import { drawRing, iconScale } from './systemMap.js';

const WASH_RADIUS = 120;
const blobs = new Map();

/** A soft round glow in `color`, pre-rendered once per size bucket. */
function blob(color, px) {
  const size = Math.max(8, 2 ** Math.ceil(Math.log2(px)));
  const key = `${color}@${size}`;
  let canvas = blobs.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    blobs.set(key, canvas);
  }
  return canvas;
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** How far out the charted part of the galaxy reaches from Aurel, for framing. */
export function galaxyExtent(state) {
  let far = 180;
  for (const id of chartedSystems(state)) {
    const system = findSystem(id);
    if (system) far = Math.max(far, Math.hypot(system.gx, system.gy));
  }
  return far + 90;
}

/** Where a ship is on the galaxy map: in a system, or along a lane. */
export function galaxyPosition(ship, now, index = 0) {
  const pos = shipPosition(ship, now, index);
  if (pos.jump) {
    const a = findSystem(pos.jump.from);
    const b = findSystem(pos.jump.to);
    const t = pos.jump.t * pos.jump.t * (3 - 2 * pos.jump.t);
    return { x: a.gx + (b.gx - a.gx) * t, y: a.gy + (b.gy - a.gy) * t, jumping: true, heading: Math.atan2(b.gy - a.gy, b.gx - a.gx) };
  }
  const system = findSystem(pos.system);
  return system ? { x: system.gx, y: system.gy, jumping: false, system: system.id } : null;
}

const roleArt = (ship) => `ship-${HULLS[ship.hull].role}`;

/**
 * Draws the galaxy. `view` is as for drawSystem. Returns hit targets for
 * systems and for ships in a jump.
 */
export function drawGalaxy(ctx, cam, state, now, view) {
  const dpr = view.dpr ?? 1;
  const s = scaleOf(cam);
  const u = iconScale(cam);
  const targets = [];
  const charted = chartedSystems(state);
  const systems = allSystems().filter((system) => charted.has(system.id));
  const open = canJump(state);

  // Faction washes behind everything, so regions read as soft colour.
  for (const system of systems) {
    const faction = findFaction(system.faction);
    const p = toScreen(cam, system.gx, system.gy);
    const r = WASH_RADIUS * s;
    const alpha = isSurveyed(state, system.id) ? 0.2 : 0.09;
    ctx.drawImage(blob(withAlpha(faction.color, alpha), r * 2 * dpr), p.x - r, p.y - r, r * 2, r * 2);
  }

  // Lanes: solid between surveyed systems, dashed into the unknown.
  const drawn = new Set();
  ctx.lineWidth = 1.3;
  for (const system of systems) {
    for (const { to, lane } of lanesFrom(system.id)) {
      const key = [system.id, to].sort().join('|');
      if (drawn.has(key) || !charted.has(to)) continue;
      drawn.add(key);
      const known = isSurveyed(state, system.id) && isSurveyed(state, to);
      if (!known && !isSurveyed(state, system.id) && !isSurveyed(state, to)) continue;
      const other = findSystem(to);
      const a = toScreen(cam, system.gx, system.gy);
      const b = toScreen(cam, other.gx, other.gy);
      ctx.strokeStyle = known ? 'rgba(170, 215, 255, 0.42)' : 'rgba(170, 215, 255, 0.22)';
      ctx.setLineDash(known ? [] : [4, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (open && s > 0.5) {
        drawLabel(ctx, `${Math.round(jumpTime(state, lane) / 60000)} min`, (a.x + b.x) / 2, (a.y + b.y) / 2, dpr, { size: 10, weight: 600, color: 'rgba(200, 225, 255, 0.55)' });
      }
    }
  }
  ctx.setLineDash([]);

  // Ships: a count beside each system, and ships in a jump on their lane.
  const counts = new Map();
  const jumping = [];
  state.ships.forEach((ship, index) => {
    const pos = galaxyPosition(ship, now, index);
    if (!pos) return;
    if (pos.jumping) jumping.push({ ship, pos });
    else counts.set(pos.system, (counts.get(pos.system) ?? 0) + 1);
  });

  // Systems
  for (const system of systems) {
    const faction = findFaction(system.faction);
    const surveyed = isSurveyed(state, system.id);
    const p = toScreen(cam, system.gx, system.gy);
    const r = (system.id === 'aurel' ? 8 : 6) * u;
    if (surveyed) {
      const glow = r * 4;
      ctx.drawImage(blob(withAlpha(faction.color, 0.75), glow * 2 * dpr), p.x - glow, p.y - glow, glow * 2, glow * 2);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = faction.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(150, 180, 220, 0.18)';
      ctx.strokeStyle = system.hazard ? 'rgba(255, 170, 120, 0.7)' : 'rgba(190, 215, 255, 0.5)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      drawLabel(ctx, '?', p.x, p.y + 0.5, dpr, { size: 11, weight: 800, color: 'rgba(220, 236, 255, 0.8)' });
    }
    drawLabel(ctx, system.name, p.x, p.y + r + 11, dpr, { size: 12, weight: 800, color: surveyed ? '#ffffff' : 'rgba(220, 236, 255, 0.7)' });
    const sub = system.hazard ? system.hazard : !surveyed ? 'unsurveyed' : system.id === 'aurel' ? 'home' : null;
    if (sub) drawLabel(ctx, sub, p.x, p.y + r + 25, dpr, { size: 10, weight: 600, color: system.hazard ? 'rgba(255, 190, 150, 0.8)' : 'rgba(200, 225, 255, 0.55)' });
    const n = counts.get(system.id);
    if (n) {
      drawAsset(ctx, 'ship-miner', p.x + r + 12, p.y - r - 4, 18 * u, dpr);
      drawLabel(ctx, String(n), p.x + r + 24, p.y - r - 4, dpr, { size: 11, weight: 800, align: 'left' });
    }
    targets.push({ kind: 'system', id: system.id, x: p.x, y: p.y, r: Math.max(16, r * 2.2) });
  }

  for (const { ship, pos } of jumping) {
    const p = toScreen(cam, pos.x, pos.y);
    const w = 26 * u;
    drawAsset(ctx, roleArt(ship), p.x, p.y, w, dpr, { rotate: pos.heading });
    drawLabel(ctx, ship.name, p.x + 10, p.y - 12, dpr, { size: 11, align: 'left', color: 'rgba(230, 242, 255, 0.85)' });
    targets.push({ kind: 'ship', id: ship.id, x: p.x, y: p.y, r: Math.max(12, w * 0.6) });
  }

  drawRing(ctx, targets, view.hover, 'hover');
  for (const id of view.boxed ?? []) drawRing(ctx, targets, { kind: 'ship', id }, 'hover');
  drawRing(ctx, targets, view.target, 'target');
  if (view.selection?.kind === 'ships') {
    for (const id of view.selection.ids) drawRing(ctx, targets, { kind: 'ship', id }, 'selected');
  } else {
    drawRing(ctx, targets, view.selection, 'selected');
  }
  drawRing(ctx, targets, view.guide, 'guide');
  return targets;
}
