// Draws a star system on a 2D canvas: the star, orbits, the asteroid belt,
// planets, fields, stations, gates and ships. Each system has its own star
// and sky (see scenery.js), and stations wear their faction's colour. Returns the clickable things
// with their screen positions, so hit testing always matches the drawing.
//
// Everything with a look is an asset (see assets.js) and every label is a
// cached sprite (see labels.js), so a frame is mostly image copies: no
// gradients, no blur.

import { HOME_SYSTEM } from '../content/homeSystem.js';
import { findFaction, findPlace, findStation, findSystem, laneBetween, systemOf } from '../content/galaxy.js';
import { HOME_SKY, sceneryOf, stationTint } from '../content/scenery.js';
import { GOODS } from '../content/goods.js';
import { HULLS } from '../content/ships.js';
import { createRng, hashString } from '../core/rng.js';
import { SECOND, timeLeft } from '../core/time.js';
import { isSurveyed } from '../systems/explore.js';
import { canJump, jumpTime, shipPosition } from '../systems/travel.js';
import { orderPhase, projectShip } from '../systems/orders.js';
import { scaleOf, toScreen } from './camera.js';
import { drawAsset } from './assets.js';
import { drawLabel } from './labels.js';
import { createLabelSpace, drawCount, flock, flockName } from './flocks.js';

// Sizes of map art in CSS pixels at an icon scale of 1.
const SIZE = { field: 58, station: 44, gate: 30, ship: 32, parkedShip: 28 };
// Gap between a place's art and the ships waiting around it.
const PARK_GAP = 17;

// Seeded belt rocks, built once per system so a belt looks the same on
// every visit. Grouped by brightness so each group is one fill.
const belts = new Map();
function beltFor(system) {
  if (belts.has(system.id)) return belts.get(system.id);
  const rng = createRng(hashString(`${system.id}:decor`));
  const groups = [0.22, 0.32, 0.42, 0.52].map((alpha) => ({ alpha, rocks: [] }));
  for (let i = 0; i < 180; i += 1) {
    const angle = rng() * Math.PI * 2;
    const r = system.belt.radius + (rng() - 0.5) * system.belt.width * 1.2;
    const size = 0.6 + rng() * 1.3;
    const group = groups[Math.floor(rng() * groups.length)];
    group.rocks.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, size });
  }
  belts.set(system.id, groups);
  return groups;
}

/** Pre-renders a sky (see scenery.js: gradient wash, nebulae and stars) for a canvas size. */
export function renderBackground(width, height, dpr, sky = HOME_SKY) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.scale(dpr, dpr);

  const base = ctx.createLinearGradient(0, 0, width * 0.6, height);
  base.addColorStop(0, sky.base[0]);
  base.addColorStop(1, sky.base[1]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  };
  for (const g of sky.glows) glow(width * g.x, height * g.y, Math.max(width, height) * g.r, g.color);

  const rng = createRng(sky.seed);
  const count = Math.round(((width * height) / 5200) * sky.stars);
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
 * Screen positions for ships that sit at a place (docked, waiting, mining,
 * refitting): spread evenly on a ring just outside its art, turning slowly,
 * so each one is easy to click and none hides behind the place.
 */
function parkingSpots(cam, state, now, u, parked) {
  const byPlace = new Map();
  for (const { ship, place } of parked) {
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(ship.id);
  }
  const spots = new Map();
  const turn = (now / (4 * 60 * SECOND)) * Math.PI * 2;
  for (const [placeId, ids] of byPlace) {
    const place = findPlace(placeId);
    if (!place) continue;
    const c = toScreen(cam, place.x, place.y);
    const art = findStation(placeId) ? ((SIZE.station * 36) / 64 / 2) * u : SIZE.field * 0.36 * u;
    // Wide enough that the ships do not touch each other.
    const r = Math.max(art + PARK_GAP * u, (ids.length * SIZE.parkedShip * 1.15 * u) / (Math.PI * 2));
    const offset = (hashString(placeId) % 628) / 100;
    ids.forEach((id, i) => {
      const angle = turn + offset + (i / ids.length) * Math.PI * 2;
      spots.set(id, { x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r, heading: angle + Math.PI / 2 });
    });
  }
  return spots;
}

/** What a gate's second label line says: locked, unsurveyed, a hazard or the jump time. */
function gateNote(state, system, gate) {
  const far = findSystem(gate.to);
  if (!canJump(state)) return 'locked';
  if (far?.hazard) return far.hazard;
  if (!isSurveyed(state, gate.to)) return 'unsurveyed';
  const lane = laneBetween(system.id, gate.to);
  return lane ? `${Math.round(jumpTime(state, lane) / 60000)} min jump` : '';
}

/**
 * Draws the system `view.systemId` (Aurel by default). `view` has
 * { selection, hover, target } as { kind, id } or null, and the canvas
 * `dpr`. Returns hit targets: [{ kind, id, x, y, r }] in screen pixels.
 */
export function drawSystem(ctx, cam, state, now, view) {
  const system = findSystem(view.systemId) ?? HOME_SYSTEM;
  const dpr = view.dpr ?? 1;
  const s = scaleOf(cam);
  const u = iconScale(cam);
  // Zoomed far out (phones), labels get shorter so they do not collide.
  const compact = s < 0.5;
  const targets = [];
  const sun = toScreen(cam, 0, 0);
  const look = sceneryOf(system);

  drawAsset(ctx, `sun-glow-${look.starClass}`, sun.x, sun.y, 400 * s * look.star.glowSize, dpr);

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
  for (const group of beltFor(system)) {
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
  const sunR = Math.max(7, system.star.radius * look.star.size * s);
  if (!drawAsset(ctx, `sun-${look.starClass}`, sun.x, sun.y, (sunR * 64) / 26, dpr)) dot(ctx, sun.x, sun.y, sunR, look.star.body[2]);

  // Planets: the disc is 29/32 of the art.
  for (const planet of system.planets) {
    const p = toScreen(cam, planet.x, planet.y);
    const r = Math.max(4, planet.radius * s);
    if (!drawAsset(ctx, `planet-${planet.kind}`, p.x, p.y, (r * 64) / 29, dpr, { tint: look.planetTints[planet.id] ?? null })) dot(ctx, p.x, p.y, r, '#c99a86');
    if (!compact) drawLabel(ctx, planet.name, p.x, p.y + r + 11, dpr, { weight: 600, color: 'rgba(220, 236, 255, 0.7)' });
  }

  // Gates: locked until the warp drive, then the way to the next system.
  const open = canJump(state);
  for (const gate of system.gates) {
    const p = toScreen(cam, gate.x, gate.y);
    const w = SIZE.gate * u;
    const half = (w * 64) / 48 / 2;
    if (!drawAsset(ctx, 'gate', p.x, p.y, w, dpr, { alpha: open ? 1 : 0.7 })) dot(ctx, p.x, p.y, 6 * u, 'rgba(180, 215, 255, 0.4)');
    drawLabel(ctx, compact ? gate.short : gate.name, p.x, p.y + half + 6, dpr, { size: 11, color: open ? 'rgba(220, 238, 255, 0.9)' : 'rgba(200, 225, 255, 0.72)' });
    if (!compact) drawLabel(ctx, gateNote(state, system, gate), p.x, p.y + half + 20, dpr, { size: 10, weight: 600, color: 'rgba(200, 225, 255, 0.5)' });
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
    if (!drawAsset(ctx, `station-${station.type}`, p.x, p.y, w, dpr, { tint: stationTint(station) })) dot(ctx, p.x, p.y, hex, findFaction(station.faction)?.color ?? '#7fe9de');
    drawLabel(ctx, compact ? station.short : station.name, p.x, p.y + hex + 13, dpr, { size: compact ? 11 : 12, weight: 800, color: '#ffffff' });
    const docked = shipsAt(state, station.id);
    if (docked.length && !compact) {
      const text = docked.length === 1 ? `${docked[0].name} docked` : `${docked.length} ships docked`;
      drawLabel(ctx, text, p.x, p.y + hex + 28, dpr, { size: 11, weight: 600, color: 'rgba(220, 236, 255, 0.72)' });
    }
    targets.push({ kind: 'station', id: station.id, x: p.x, y: p.y, r: Math.max(18, hex * 1.7) });
  }

  // The routes the ships picked in the order menu would fly.
  const routes = routePreviews(cam, state, view, system.id);
  if (routes.length) {
    ctx.strokeStyle = 'rgba(255, 211, 110, 0.6)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (const route of routes) {
      ctx.moveTo(route.from.x, route.from.y);
      ctx.lineTo(route.to.x, route.to.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Ships in this system. Ships at a place sit on a ring around it (see
  // parkingSpots); ships in a jump show on the galaxy map instead. Ships
  // flying close together are drawn as one flock (see flocks.js).
  const label = createLabelSpace(ctx, dpr);
  const positions = state.ships.map((ship, index) => ({ ship, index, pos: shipPosition(ship, now, index) })).filter(({ pos }) => pos.system === system.id);
  const spots = parkingSpots(cam, state, now, u, positions.filter((p) => p.pos.place).map((p) => ({ ship: p.ship, place: p.pos.place })));
  const flying = [];
  // The time left of what a ship does now: the flight, or the job.
  const leftOf = (ship) => orderPhase(ship.order, now).end - now;
  // Labels go on the side facing away from the star, where there is more room.
  const shipLabel = (text, p) => {
    const outward = p.x >= sun.x;
    label(text, p.x + (outward ? 10 : -10), p.y - 12, { size: 11, align: outward ? 'left' : 'right', color: 'rgba(230, 242, 255, 0.85)' });
  };
  const drawShip = ({ ship, index, pos }, p, spot) => {
    const ahead = shipPosition(ship, now + 2 * SECOND, index);
    const heading = spot ? spot.heading : Math.atan2(ahead.y - pos.y, ahead.x - pos.x);
    const w = (pos.moving ? SIZE.ship : SIZE.parkedShip) * u;
    const rotate = Number.isFinite(heading) ? heading : 0;
    if (!drawAsset(ctx, `ship-${HULLS[ship.hull].role}`, p.x, p.y, w, dpr, { rotate })) dot(ctx, p.x, p.y, 3, '#d9fff8');
    return w;
  };

  for (const entry of positions) {
    const { ship, pos } = entry;
    const spot = spots.get(ship.id);
    const p = spot ?? toScreen(cam, pos.x, pos.y);
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
    if (!spot) {
      flying.push({ ...entry, p });
      continue;
    }
    const w = drawShip(entry, p, spot);
    if (ship.order) shipLabel(`${ship.name}${ship.order.type === 'mine' && !pos.moving ? ' mining' : ''} · ${timeLeft(leftOf(ship))}`, p);
    targets.push({ kind: 'ship', id: ship.id, x: p.x, y: p.y, r: Math.max(12, w * 0.6) });
  }

  for (const group of flock(flying, SIZE.ship * 0.8 * u)) {
    const [lead] = group.members;
    if (group.members.length === 1) {
      const w = drawShip(lead, lead.p, null);
      if (lead.ship.order) shipLabel(`${lead.ship.name} · ${timeLeft(leftOf(lead.ship))}`, lead.p);
      targets.push({ kind: 'ship', id: lead.ship.id, x: lead.p.x, y: lead.p.y, r: Math.max(12, w * 0.6) });
      continue;
    }
    const p = { x: group.x, y: group.y };
    const w = drawShip(lead, p, null);
    drawCount(ctx, p.x + w * 0.42, p.y - w * 0.36, group.members.length, dpr, u);
    const times = group.members.filter((m) => m.ship.order).map((m) => leftOf(m.ship));
    const soon = Math.min(...times);
    const late = Math.max(...times);
    const when = !times.length ? '' : timeLeft(soon) === timeLeft(late) ? ` · ${timeLeft(soon)}` : ` · ${timeLeft(soon)} to ${timeLeft(late)}`;
    shipLabel(`${flockName(group.members)}${when}`, { x: p.x + w * 0.25, y: p.y });
    const ids = group.members.map((m) => m.ship.id);
    targets.push({ kind: 'flock', id: lead.ship.id, ids, x: p.x, y: p.y, r: Math.max(14, w * 0.7) });
    // Each ship keeps a target on the flock (too small to click), so box
    // selection and the selection rings still work per ship.
    for (const id of ids) targets.push({ kind: 'ship', id, x: p.x, y: p.y, r: 0, ring: Math.max(12, w * 0.6) });
  }

  // Hover, menu target, selection and tutorial rings. A group selection
  // (box select) rings every ship in it; ships inside a box being dragged
  // get the hover ring.
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

function routePreviews(cam, state, view, systemId) {
  const target = view.target;
  if (!target || target.kind === 'ship' || systemOf(target.id) !== systemId) return [];
  const to = findPlace(target.id);
  const ids = target.shipIds ?? (target.shipId ? [target.shipId] : []);
  const starts = new Set();
  for (const id of ids) {
    const ship = state.ships.find((s) => s.id === id);
    // A busy ship's new order starts where its last one ends.
    const at = ship ? projectShip(state, ship).at : null;
    // Ships coming from another system enter through a gate; no line for them.
    const from = at && systemOf(at) === systemId ? findPlace(at) : null;
    if (from && to && from !== to) starts.add(from);
  }
  return [...starts].map((from) => ({ from: toScreen(cam, from.x, from.y), to: toScreen(cam, to.x, to.y) }));
}

const RINGS = {
  hover: { color: 'rgba(255, 255, 255, 0.35)', gap: 2, width: 1.5 },
  target: { color: 'rgba(255, 211, 110, 0.9)', gap: 4, width: 2 },
  selected: { color: '#8ff5e4', gap: 4, width: 2 },
  guide: { color: 'rgba(255, 211, 110, 0.95)', gap: 9, width: 2.5, dash: [6, 5] },
};

export function drawRing(ctx, targets, ref, style) {
  if (!ref) return;
  const target = targets.find((t) => t.kind === ref.kind && t.id === ref.id);
  if (!target) return;
  const ring = RINGS[style];
  // Targets can draw their ring at another size than they click (ships in a galaxy badge).
  const r = target.ring ?? target.r;
  ctx.strokeStyle = ring.color;
  ctx.lineWidth = ring.width;
  if (ring.dash) ctx.setLineDash(ring.dash);
  ctx.beginPath();
  ctx.arc(target.x, target.y, r + ring.gap, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (style !== 'hover') {
    // A soft second ring instead of a blurred glow.
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(target.x, target.y, r + ring.gap + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/**
 * The target under (x, y). Where hit areas overlap (a ship docked next to
 * its station), the one whose middle is closest, measured against its
 * size, wins; ships win a tie.
 */
export function hitTest(targets, x, y) {
  const order = { ship: 0, flock: 0, 'ships-at': 0, station: 1, system: 1, field: 2, gate: 3 };
  let best = null;
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (!t.r || d > t.r) continue;
    const score = d / t.r;
    const rank = order[t.kind] ?? 9;
    if (!best || score < best.score - 0.05 || (Math.abs(score - best.score) <= 0.05 && rank < best.rank)) best = { ...t, score, rank };
  }
  if (!best) return null;
  return best.ids ? { kind: best.kind, id: best.id, ids: best.ids } : { kind: best.kind, id: best.id };
}

/** The ships whose middles lie inside the screen rectangle from a to b. */
export function shipsInBox(targets, a, b) {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return targets.filter((t) => t.kind === 'ship' && t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1).map((t) => t.id);
}
