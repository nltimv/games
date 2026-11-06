// Draws a star system on a 2D canvas: the star, orbits, the asteroid belt,
// planets, fields, stations, gates and ships. Returns the clickable things
// with their screen positions, so hit testing always matches the drawing.
//
// Everything with a look is an asset (see assets.js) and every label is a
// cached sprite (see labels.js), so a frame is mostly image copies: no
// gradients, no blur.

import { HOME_SYSTEM, findPlace, findStation } from '../content/homeSystem.js';
import { GOODS } from '../content/goods.js';
import { HULLS } from '../content/ships.js';
import { createRng, hashString } from '../core/rng.js';
import { SECOND } from '../core/time.js';
import { formatDuration } from '../../../shared/js/format.js';
import { shipPosition } from '../systems/travel.js';
import { projectShip } from '../systems/orders.js';
import { scaleOf, toScreen } from './camera.js';
import { drawAsset } from './assets.js';
import { drawLabel } from './labels.js';

// Sizes of map art in CSS pixels at an icon scale of 1.
const SIZE = { field: 58, station: 44, gate: 30, ship: 22, parkedShip: 17 };

// Seeded belt rocks, built once so the belt looks the same on every visit.
// Grouped by brightness so each group is one fill.
const BELT = (() => {
  const rng = createRng(hashString(`${HOME_SYSTEM.id}:decor`));
  const groups = [0.22, 0.32, 0.42, 0.52].map((alpha) => ({ alpha, rocks: [] }));
  for (let i = 0; i < 180; i += 1) {
    const angle = rng() * Math.PI * 2;
    const r = HOME_SYSTEM.belt.radius + (rng() - 0.5) * HOME_SYSTEM.belt.width * 1.2;
    const size = 0.6 + rng() * 1.3;
    const group = groups[Math.floor(rng() * groups.length)];
    group.rocks.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, size });
  }
  return groups;
})();

/** Pre-renders the sky (gradient wash and stars) for a canvas size. */
export function renderBackground(width, height, dpr) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.scale(dpr, dpr);

  const base = ctx.createLinearGradient(0, 0, width * 0.6, height);
  base.addColorStop(0, '#081634');
  base.addColorStop(1, '#040a1d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  };
  glow(width * 0.28, height * 0.3, Math.max(width, height) * 0.55, 'rgba(21, 64, 122, 0.85)');
  glow(width * 0.72, height * 0.95, Math.max(width, height) * 0.45, 'rgba(15, 85, 96, 0.8)');

  const rng = createRng(hashString('sky'));
  const count = Math.round((width * height) / 5200);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < count; i += 1) {
    ctx.globalAlpha = 0.2 + rng() * 0.6;
    ctx.beginPath();
    ctx.arc(rng() * width, rng() * height, 0.4 + rng() * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * How big icons are drawn. Grows gently with zoom, and a little with the
 * screen (so phones fit the whole system), but the art is always scaled as
 * a whole, so it looks the same everywhere.
 */
export function iconScale(cam) {
  const zoom = Math.min(1.5, Math.max(0.85, Math.sqrt(cam.zoom)));
  const screen = Math.min(1.1, Math.max(0.78, 0.62 + 0.5 * cam.base));
  return zoom * screen;
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function shipsAt(state, placeId) {
  return state.ships.filter((s) => !s.order && s.at === placeId);
}

/**
 * Draws the system. `view` has { selection, hover, target } as { kind, id }
 * or null, and the canvas `dpr`. Returns hit targets: [{ kind, id, x, y, r }]
 * in screen pixels.
 */
export function drawSystem(ctx, cam, state, now, view) {
  const system = HOME_SYSTEM;
  const dpr = view.dpr ?? 1;
  const s = scaleOf(cam);
  const u = iconScale(cam);
  // Zoomed far out (phones), labels get shorter so they do not collide.
  const compact = s < 0.5;
  const targets = [];
  const sun = toScreen(cam, 0, 0);

  drawAsset(ctx, 'sun-glow', sun.x, sun.y, 400 * s, dpr);

  // Orbits
  ctx.lineWidth = 1;
  system.orbits.forEach((radius, i) => {
    const outer = i === system.orbits.length - 1;
    ctx.strokeStyle = outer ? 'rgba(190, 220, 255, 0.13)' : 'rgba(190, 220, 255, 0.17)';
    ctx.setLineDash(outer ? [3, 7] : []);
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, radius * s, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // Belt: a faint band and a few hundred rocks, one fill per brightness.
  ctx.strokeStyle = 'rgba(160, 190, 230, 0.06)';
  ctx.lineWidth = system.belt.width * s;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, system.belt.radius * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#9fb6d6';
  const rockScale = Math.min(1.5, Math.max(0.85, Math.sqrt(cam.zoom)));
  for (const group of BELT) {
    ctx.globalAlpha = group.alpha;
    ctx.beginPath();
    for (const rock of group.rocks) {
      const x = sun.x + rock.x * s;
      const y = sun.y + rock.y * s;
      const r = rock.size * rockScale;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Star: the art's disc is 26/32 of its width.
  const sunR = Math.max(9, system.star.radius * s);
  if (!drawAsset(ctx, 'sun', sun.x, sun.y, (sunR * 64) / 26, dpr)) dot(ctx, sun.x, sun.y, sunR, '#ffd58a');

  // Planets: the disc is 29/32 of the art.
  for (const planet of system.planets) {
    const p = toScreen(cam, planet.x, planet.y);
    const r = Math.max(4, planet.radius * s);
    if (!drawAsset(ctx, `planet-${planet.kind}`, p.x, p.y, (r * 64) / 29, dpr)) dot(ctx, p.x, p.y, r, '#c99a86');
    if (!compact) drawLabel(ctx, planet.name, p.x, p.y + r + 11, dpr, { weight: 600, color: 'rgba(220, 236, 255, 0.7)' });
  }

  // Gates (locked in act 1)
  for (const gate of system.gates) {
    const p = toScreen(cam, gate.x, gate.y);
    const w = SIZE.gate * u;
    const half = (w * 64) / 48 / 2;
    if (!drawAsset(ctx, 'gate', p.x, p.y, w, dpr)) dot(ctx, p.x, p.y, 6 * u, 'rgba(180, 215, 255, 0.4)');
    drawLabel(ctx, compact ? gate.short : gate.name, p.x, p.y + half + 6, dpr, { size: 11, color: 'rgba(200, 225, 255, 0.72)' });
    if (!compact) drawLabel(ctx, 'locked', p.x, p.y + half + 20, dpr, { size: 10, weight: 600, color: 'rgba(200, 225, 255, 0.45)' });
    targets.push({ kind: 'gate', id: gate.id, x: p.x, y: p.y, r: Math.max(16, half) });
  }

  // Asteroid fields
  for (const field of system.fields) {
    const p = toScreen(cam, field.x, field.y);
    const w = SIZE.field * u;
    if (!drawAsset(ctx, `field-${field.good}`, p.x, p.y, w, dpr)) dot(ctx, p.x, p.y, w * 0.2, GOODS[field.good].look.mid);
    const name = compact ? field.name : `${field.name} · ${GOODS[field.good].name.toLowerCase()}`;
    drawLabel(ctx, name, p.x, p.y + w * 0.42 + 9, dpr, { size: compact ? 11 : 12 });
    const waiting = shipsAt(state, field.id);
    if (waiting.length && !compact) {
      const text = waiting.length === 1 ? `${waiting[0].name} waiting` : `${waiting.length} ships waiting`;
      drawLabel(ctx, text, p.x, p.y + w * 0.42 + 24, dpr, { size: 11, weight: 600, color: 'rgba(220, 236, 255, 0.72)' });
    }
    targets.push({ kind: 'field', id: field.id, x: p.x, y: p.y, r: Math.max(22, w * 0.45) });
  }

  // Stations: the hex is 36/64 of the art's width.
  for (const station of system.stations) {
    const p = toScreen(cam, station.x, station.y);
    const w = SIZE.station * u;
    const hex = (w * 36) / 64 / 2;
    if (!drawAsset(ctx, `station-${station.type}`, p.x, p.y, w, dpr)) dot(ctx, p.x, p.y, hex, '#7fe9de');
    drawLabel(ctx, compact ? station.short : station.name, p.x, p.y + hex + 13, dpr, { size: compact ? 11 : 12, weight: 800, color: '#ffffff' });
    const docked = shipsAt(state, station.id);
    if (docked.length && !compact) {
      const text = docked.length === 1 ? `${docked[0].name} docked` : `${docked.length} ships docked`;
      drawLabel(ctx, text, p.x, p.y + hex + 28, dpr, { size: 11, weight: 600, color: 'rgba(220, 236, 255, 0.72)' });
    }
    targets.push({ kind: 'station', id: station.id, x: p.x, y: p.y, r: Math.max(18, hex * 1.7) });
  }

  // The route the ship picked in the order menu would fly.
  const preview = routePreview(cam, state, view);
  if (preview) {
    ctx.strokeStyle = 'rgba(255, 211, 110, 0.6)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(preview.from.x, preview.from.y);
    ctx.lineTo(preview.to.x, preview.to.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Ships. Ships waiting at a place circle just outside its art, so they
  // never hide behind it.
  const clearance = { station: ((SIZE.station * 36) / 64 / 2) * u + 7, field: SIZE.field * 0.4 * u };
  state.ships.forEach((ship, index) => {
    const pos = shipPosition(ship, now, index);
    const p = toScreen(cam, pos.x, pos.y);
    if (pos.place) pushOut(cam, p, pos.place, clearance);
    const role = HULLS[ship.hull].role;

    if (pos.moving && pos.to) {
      const place = findPlace(pos.to);
      const dest = toScreen(cam, place?.x ?? 0, place?.y ?? 0);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(dest.x, dest.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const ahead = shipPosition(ship, now + 2 * SECOND, index);
    const heading = Math.atan2(ahead.y - pos.y, ahead.x - pos.x);
    const w = (ship.order ? SIZE.ship : SIZE.parkedShip) * u;
    const rotate = Number.isFinite(heading) ? heading : 0;
    if (!drawAsset(ctx, `ship-${role}`, p.x, p.y, w, dpr, { rotate })) dot(ctx, p.x, p.y, 3, '#d9fff8');

    if (ship.order) {
      const left = formatDuration(ship.order.endsAt - now);
      const verb = ship.order.type === 'mine' && !pos.moving ? ' mining' : '';
      // Put the label on the side facing away from the star, where there
      // is more room.
      const outward = p.x >= sun.x;
      drawLabel(ctx, `${ship.name}${verb} · ${left}`, p.x + (outward ? 10 : -10), p.y - 12, dpr, {
        size: 11,
        align: outward ? 'left' : 'right',
        color: 'rgba(230, 242, 255, 0.85)',
      });
    }
    targets.push({ kind: 'ship', id: ship.id, x: p.x, y: p.y, r: ship.order ? 12 : 7, parked: !ship.order });
  });

  // Hover, menu target, selection and tutorial rings
  drawRing(ctx, targets, view.hover, 'hover');
  drawRing(ctx, targets, view.target, 'target');
  drawRing(ctx, targets, view.selection, 'selected');
  drawRing(ctx, targets, view.guide, 'guide');
  return targets;
}

function pushOut(cam, p, placeId, clearance) {
  const place = findPlace(placeId);
  if (!place) return;
  const min = findStation(placeId) ? clearance.station : clearance.field;
  const c = toScreen(cam, place.x, place.y);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const d = Math.hypot(dx, dy);
  if (d >= min || d === 0) return;
  p.x = c.x + (dx / d) * min;
  p.y = c.y + (dy / d) * min;
}

function routePreview(cam, state, view) {
  const target = view.target;
  if (!target?.shipId || target.kind === 'ship') return null;
  const ship = state.ships.find((s) => s.id === target.shipId);
  // A busy ship's new order starts where its last one ends.
  const from = ship ? findPlace(projectShip(state, ship).at) : null;
  const to = findPlace(target.id);
  if (!from || !to || from === to) return null;
  return { from: toScreen(cam, from.x, from.y), to: toScreen(cam, to.x, to.y) };
}

const RINGS = {
  hover: { color: 'rgba(255, 255, 255, 0.35)', gap: 2, width: 1.5 },
  target: { color: 'rgba(255, 211, 110, 0.9)', gap: 4, width: 2 },
  selected: { color: '#8ff5e4', gap: 4, width: 2 },
  guide: { color: 'rgba(255, 211, 110, 0.95)', gap: 9, width: 2.5, dash: [6, 5] },
};

function drawRing(ctx, targets, ref, style) {
  if (!ref) return;
  const target = targets.find((t) => t.kind === ref.kind && t.id === ref.id);
  if (!target) return;
  const ring = RINGS[style];
  ctx.strokeStyle = ring.color;
  ctx.lineWidth = ring.width;
  if (ring.dash) ctx.setLineDash(ring.dash);
  ctx.beginPath();
  ctx.arc(target.x, target.y, target.r + ring.gap, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (style !== 'hover') {
    // A soft second ring instead of a blurred glow.
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r + ring.gap + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** The nearest target within its radius of (x, y), moving ships first. */
export function hitTest(targets, x, y) {
  const order = { ship: 0, station: 1, field: 2, gate: 3 };
  let best = null;
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d > t.r) continue;
    // Docked ships circle their station; the station wins a click near both.
    const rank = t.parked ? 4 : (order[t.kind] ?? 9);
    if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { ...t, d, rank };
  }
  return best ? { kind: best.kind, id: best.id } : null;
}
