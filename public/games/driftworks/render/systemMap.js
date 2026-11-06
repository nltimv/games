// Draws a star system on a 2D canvas: the star, orbits, the asteroid belt,
// planets, fields, stations, gates and ships. Returns the clickable things
// with their screen positions, so hit testing always matches the drawing.

import { HOME_SYSTEM } from '../content/homeSystem.js';
import { GOODS } from '../content/goods.js';
import { HULLS } from '../content/ships.js';
import { createRng, hashString } from '../core/rng.js';
import { SECOND } from '../core/time.js';
import { formatDuration } from '../../../shared/js/format.js';
import { shipPosition } from '../systems/travel.js';
import { scaleOf, toScreen } from './camera.js';

export const FONT = "'Nunito Sans', 'Segoe UI', system-ui, sans-serif";

const STATION_COLORS = ['#e9fffb', '#7fe9de', '#1b9aa8'];
const PLANET_COLORS = {
  rocky: ['#fff4ea', '#f0a987', '#7a3b33'],
  ice: ['#ffffff', '#bdf4ff', '#2f86b8'],
};
const SHIP_COLORS = {
  miner: { body: '#d9fff8', glow: 'rgba(111, 240, 216, 0.55)' },
  hauler: { body: '#fff0c8', glow: 'rgba(255, 211, 110, 0.55)' },
};

// Seeded decoration, built once so the belt and fields look the same on
// every visit.
const DECOR = (() => {
  const rng = createRng(hashString(`${HOME_SYSTEM.id}:decor`));
  const belt = [];
  for (let i = 0; i < 180; i += 1) {
    const angle = rng() * Math.PI * 2;
    const r = HOME_SYSTEM.belt.radius + (rng() - 0.5) * HOME_SYSTEM.belt.width * 1.2;
    belt.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, size: 0.6 + rng() * 1.3, alpha: 0.2 + rng() * 0.35 });
  }
  const fields = {};
  for (const field of HOME_SYSTEM.fields) {
    const frng = createRng(hashString(`${field.id}:rocks`));
    const rocks = [{ dx: 0, dy: 0, size: 8 }];
    for (let i = 0; i < 8; i += 1) {
      const angle = frng() * Math.PI * 2;
      const dist = 9 + frng() * 16;
      rocks.push({ dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, size: 2.2 + frng() * 4 });
    }
    fields[field.id] = rocks;
  }
  return { belt, fields };
})();

/** Pre-renders the sky (gradient wash and stars) for a canvas size. */
export function renderBackground(width, height, dpr) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d');
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
  for (let i = 0; i < count; i += 1) {
    ctx.globalAlpha = 0.2 + rng() * 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(rng() * width, rng() * height, 0.4 + rng() * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function radial(ctx, x, y, r, [light, mid, dark]) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, light);
  g.addColorStop(0.45, mid);
  g.addColorStop(1, dark);
  return g;
}

function label(ctx, text, x, y, { size = 12, weight = 700, color = 'rgba(230, 242, 255, 0.92)', align = 'center' } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(2, 8, 24, 0.85)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** A small glyph inside the station hex, one per station type. */
function stationGlyph(ctx, type, x, y, r) {
  ctx.fillStyle = 'rgba(3, 48, 61, 0.75)';
  ctx.strokeStyle = 'rgba(3, 48, 61, 0.75)';
  ctx.lineWidth = 1.4;
  const g = r * 0.38;
  ctx.beginPath();
  if (type === 'refinery') ctx.arc(x, y, g, 0, Math.PI * 2);
  else if (type === 'foundry') ctx.rect(x - g, y - g, g * 2, g * 2);
  else if (type === 'tradingPost') {
    ctx.moveTo(x, y - g * 1.2);
    ctx.lineTo(x + g * 1.2, y);
    ctx.lineTo(x, y + g * 1.2);
    ctx.lineTo(x - g * 1.2, y);
    ctx.closePath();
  } else {
    ctx.moveTo(x - g, y + g * 0.6);
    ctx.lineTo(x, y - g * 0.8);
    ctx.lineTo(x + g, y + g * 0.6);
    ctx.stroke();
    return;
  }
  ctx.fill();
}

function shipsAt(state, placeId) {
  return state.ships.filter((s) => !s.order && s.at === placeId);
}

function sizeFactor(cam) {
  return Math.min(1.5, Math.max(0.85, Math.sqrt(cam.zoom)));
}

/**
 * Draws the system. `view` has { selection, hover } as { kind, id } or null.
 * Returns hit targets: [{ kind, id, x, y, r }] in screen pixels.
 */
export function drawSystem(ctx, cam, state, now, view) {
  const system = HOME_SYSTEM;
  const s = scaleOf(cam);
  const k = sizeFactor(cam);
  // Zoomed far out (phones), labels get shorter so they do not collide.
  const compact = s < 0.5;
  const targets = [];
  const sun = toScreen(cam, 0, 0);

  // Star glow
  const glowR = 200 * s;
  const glow = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, glowR);
  glow.addColorStop(0, 'rgba(255, 227, 163, 0.5)');
  glow.addColorStop(0.35, 'rgba(255, 180, 94, 0.16)');
  glow.addColorStop(1, 'rgba(255, 154, 61, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, glowR, 0, Math.PI * 2);
  ctx.fill();

  // Orbits
  ctx.lineWidth = 1;
  system.orbits.forEach((radius, i) => {
    ctx.strokeStyle = i === system.orbits.length - 1 ? 'rgba(190, 220, 255, 0.13)' : 'rgba(190, 220, 255, 0.17)';
    ctx.setLineDash(i === system.orbits.length - 1 ? [3, 7] : []);
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, radius * s, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // Belt
  ctx.strokeStyle = 'rgba(160, 190, 230, 0.06)';
  ctx.lineWidth = system.belt.width * s;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, system.belt.radius * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#9fb6d6';
  for (const rock of DECOR.belt) {
    const p = toScreen(cam, rock.x, rock.y);
    ctx.globalAlpha = rock.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rock.size * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Star
  const sunR = Math.max(9, system.star.radius * s);
  const body = ctx.createRadialGradient(sun.x - sunR * 0.3, sun.y - sunR * 0.35, sunR * 0.1, sun.x, sun.y, sunR);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.35, '#fff1c2');
  body.addColorStop(0.8, '#ffbd5c');
  body.addColorStop(1, '#ff9b3a');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sunR, 0, Math.PI * 2);
  ctx.fill();

  // Planets
  for (const planet of system.planets) {
    const p = toScreen(cam, planet.x, planet.y);
    const r = Math.max(4, planet.radius * s);
    ctx.fillStyle = radial(ctx, p.x, p.y, r, PLANET_COLORS[planet.kind] ?? PLANET_COLORS.rocky);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (!compact) label(ctx, planet.name, p.x, p.y + r + 11, { weight: 600, color: 'rgba(220, 236, 255, 0.7)' });
  }

  // Gates (locked in act 1)
  for (const gate of system.gates) {
    const p = toScreen(cam, gate.x, gate.y);
    ctx.strokeStyle = 'rgba(180, 215, 255, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 9 * k, 13 * k, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(180, 215, 255, 0.08)';
    ctx.fill();
    label(ctx, compact ? gate.short : gate.name, p.x, p.y + 13 * k + 11, { size: 11, color: 'rgba(200, 225, 255, 0.72)' });
    if (!compact) label(ctx, 'locked', p.x, p.y + 13 * k + 25, { size: 10, weight: 600, color: 'rgba(200, 225, 255, 0.45)' });
    targets.push({ kind: 'gate', id: gate.id, x: p.x, y: p.y, r: 18 * k });
  }

  // Asteroid fields
  for (const field of system.fields) {
    const p = toScreen(cam, field.x, field.y);
    const look = GOODS[field.good].look;
    for (const rock of DECOR.fields[field.id]) {
      const rx = p.x + rock.dx * s * 1.1;
      const ry = p.y + rock.dy * s * 1.1;
      const rr = rock.size * k;
      ctx.fillStyle = radial(ctx, rx, ry, rr, ['#ffffff', look.light, look.dark]);
      ctx.beginPath();
      ctx.arc(rx, ry, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    const spread = Math.max(16 * k, 27 * s);
    label(ctx, compact ? field.name : `${field.name} · ${GOODS[field.good].name.toLowerCase()}`, p.x, p.y + spread + 12, { size: compact ? 11 : 12 });
    targets.push({ kind: 'field', id: field.id, x: p.x, y: p.y, r: Math.max(22, spread + 4) });
  }

  // Stations
  for (const station of system.stations) {
    const p = toScreen(cam, station.x, station.y);
    const r = 11 * k;
    const fill = ctx.createLinearGradient(p.x, p.y - r, p.x, p.y + r);
    fill.addColorStop(0, STATION_COLORS[0]);
    fill.addColorStop(0.5, STATION_COLORS[1]);
    fill.addColorStop(1, STATION_COLORS[2]);
    ctx.shadowColor = 'rgba(46, 197, 192, 0.55)';
    ctx.shadowBlur = 12;
    hexPath(ctx, p.x, p.y, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
    stationGlyph(ctx, station.type, p.x, p.y, r);

    label(ctx, compact ? station.short : station.name, p.x, p.y + r + 13, { size: compact ? 11 : 12, weight: 800, color: '#ffffff' });
    const docked = shipsAt(state, station.id);
    if (docked.length && !compact) {
      const text = docked.length === 1 ? `${docked[0].name} docked` : `${docked.length} ships docked`;
      label(ctx, text, p.x, p.y + r + 28, { size: 11, weight: 600, color: 'rgba(220, 236, 255, 0.72)' });
    }
    targets.push({ kind: 'station', id: station.id, x: p.x, y: p.y, r: 20 * k });
  }

  // Ships
  state.ships.forEach((ship, index) => {
    const pos = shipPosition(ship, now, index);
    const ahead = shipPosition(ship, now + 2 * SECOND, index);
    const p = toScreen(cam, pos.x, pos.y);
    const role = HULLS[ship.hull].role;
    const colors = SHIP_COLORS[role] ?? SHIP_COLORS.miner;

    if (pos.moving && pos.to) {
      const dest = toScreen(cam, ...placeXY(pos.to));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(dest.x, dest.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const heading = Math.atan2(ahead.y - pos.y, ahead.x - pos.x);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Number.isFinite(heading) ? heading : 0);
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 10;
    ctx.fillStyle = colors.body;
    const size = (ship.order ? 5 : 3.6) * k;
    ctx.beginPath();
    ctx.moveTo(size * 1.3, 0);
    ctx.lineTo(-size, size * 0.85);
    ctx.lineTo(-size * 0.5, 0);
    ctx.lineTo(-size, -size * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;

    if (ship.order) {
      const left = formatDuration(ship.order.endsAt - now);
      const verb = ship.order.type === 'mine' && !pos.moving ? ' mining' : '';
      // Put the label on the side facing away from the star, where there
      // is more room.
      const outward = p.x >= sun.x;
      label(ctx, `${ship.name}${verb} · ${left}`, p.x + (outward ? 10 : -10), p.y - 12, {
        size: 11,
        align: outward ? 'left' : 'right',
        color: 'rgba(230, 242, 255, 0.85)',
      });
    }
    targets.push({ kind: 'ship', id: ship.id, x: p.x, y: p.y, r: ship.order ? 12 : 7, parked: !ship.order });
  });

  // Hover and selection rings
  drawRing(ctx, targets, view.hover, now, false);
  drawRing(ctx, targets, view.selection, now, true);
  return targets;
}

function placeXY(id) {
  const place =
    HOME_SYSTEM.stations.find((s) => s.id === id) ??
    HOME_SYSTEM.fields.find((f) => f.id === id) ??
    HOME_SYSTEM.gates.find((g) => g.id === id);
  return place ? [place.x, place.y] : [0, 0];
}

function drawRing(ctx, targets, ref, now, selected) {
  if (!ref) return;
  const target = targets.find((t) => t.kind === ref.kind && t.id === ref.id);
  if (!target) return;
  ctx.save();
  ctx.lineWidth = 1.5;
  if (selected) {
    ctx.strokeStyle = '#8ff5e4';
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -(now / 120) % 8;
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  }
  ctx.beginPath();
  ctx.arc(target.x, target.y, target.r + (selected ? 4 : 2), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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
