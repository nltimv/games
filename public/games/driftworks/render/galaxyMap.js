// Draws the galaxy map: the systems the company has charted as glowing
// nodes in their faction's colour over soft faction washes, the lanes
// between them, a badge for your ships in each system, ships crossing
// lanes in a jump, marks for contracts and, with Market charts, the prices
// of one good. Corner brackets frame the system whose map the System view
// shows, and a selected ship's jumps still ahead light up as its route. Systems nobody has charted stay hidden; charted but unsurveyed
// ones are dim, with a "?". On a phone zoomed far out, the text labels
// give way (see PHONE_LABEL_ROOM).
// Returns the clickable things, like drawSystem.

import { allSystems, currentGalaxy, findFaction, findSystem, lanesFrom } from '../content/galaxy.js';
import { createRng, hashString } from '../core/rng.js';
import { HOME_SYSTEM } from '../content/homeSystem.js';
import { HULLS } from '../content/ships.js';
import { systemMarket } from '../systems/advisor.js';
import { contractMarks } from '../systems/contracts.js';
import { chartedSystems } from '../systems/explore.js';
import { canJump, jumpTime, shipPosition } from '../systems/travel.js';
import { shieldingNeeded } from '../systems/shielding.js';
import { shipRoute } from '../systems/orders.js';
import { scaleOf, toScreen, toWorld } from './camera.js';
import { drawAsset } from './assets.js';
import { drawLabel } from './labels.js';
import { drawContractMarks } from './marks.js';
import { createLabelSpace, drawCount, flock, flockName } from './flocks.js';
import { drawRing, iconScale } from './systemMap.js';

const WASH_RADIUS = 120;
// The washes are soft, so they are drawn once into a small layer (this many
// pixels per galaxy unit, at most WASH_MAX_PX a side) and then stretched.
const WASH_RES = 0.35;
const WASH_MAX_PX = 1024;
// How much bigger than the screen, each side, the panned copy of the washes is (see drawBackdrop).
const WASH_PAN_ROOM = 0.3;
// Things further than this off screen (px) are not drawn at all.
const CULL_MARGIN = 120;
// On a phone zoomed out (below PHONE_LABEL_ZOOM, where the galaxy opens at
// 4) so far that neighbouring systems (about 100 units apart) sit closer
// than PHONE_LABEL_ROOM pixels, the map drops its text labels; only the
// selected and open systems keep their names. Zoomed in, labels always show,
// however big the charted galaxy has grown.
const PHONE_LABEL_ZOOM = 2.5;
const PHONE_LABEL_ROOM = 72;
const SYSTEM_SPACING = 100;
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

// The galaxy's own sky, so it never looks like a system map: near black
// with a violet tint, the pale band of the galaxy's disc running corner to
// corner, darker dust along its middle, and fine star dust packed into it.
const BAND_GLOWS = ['rgba(120, 150, 255, 0.11)', 'rgba(165, 120, 255, 0.09)', 'rgba(110, 230, 220, 0.07)', 'rgba(255, 214, 236, 0.06)'];
const STAR_TINTS = ['#ffffff', '#ffffff', '#dfe8ff', '#ffe9d6', '#d8fff8'];

export function renderGalaxyBackground(width, height, dpr) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.scale(dpr, dpr);
  const rng = createRng(hashString('galaxy-sky'));
  const big = Math.max(width, height);

  const base = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, big * 0.75);
  base.addColorStop(0, '#0d0a26');
  base.addColorStop(1, '#030210');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // The band runs from lower left to upper right, a little wavy.
  const along = (t) => ({ x: -0.1 * width + t * 1.2 * width, y: height * (0.86 - 0.72 * t + 0.05 * Math.sin(t * 7)) });
  const spread = () => (rng() + rng() + rng() - 1.5) * 0.16 * big;
  const soft = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let i = 0; i < 46; i += 1) {
    const p = along(rng());
    soft(p.x + spread() * 0.6, p.y + spread() * 0.6, big * (0.07 + rng() * 0.13), BAND_GLOWS[i % BAND_GLOWS.length]);
  }
  for (let i = 0; i < 18; i += 1) {
    const p = along(rng());
    soft(p.x + spread() * 0.25, p.y + spread() * 0.25, big * (0.03 + rng() * 0.05), 'rgba(3, 2, 14, 0.4)');
  }

  const dust = (count, near) => {
    for (let i = 0; i < count; i += 1) {
      const p = near ? along(rng()) : { x: rng() * width, y: rng() * height };
      const x = near ? p.x + spread() * 0.7 : p.x;
      const y = near ? p.y + spread() * 0.7 : p.y;
      ctx.globalAlpha = 0.15 + rng() * 0.55;
      ctx.fillStyle = STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)];
      ctx.beginPath();
      ctx.arc(x, y, 0.3 + rng() * (near ? 0.6 : 0.9), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const area = (width * height) / 5200;
  dust(Math.round(area * 0.7), false);
  dust(Math.round(area * 2.4), true);
  ctx.globalAlpha = 1;
  return canvas;
}

// The route of a selected ship: its jumps still ahead as bright lanes
// (dashed for queued orders), each with an arrow, and a ring on the system
// where its last jump lands. A jump under way starts from the ship.
const ROUTE_COLOR = 'rgba(150, 255, 232, 0.95)';
const MAX_ROUTES = 12;

// Plotting queued orders takes a moment, so a ship's route is worked out
// again only when its orders change (or a jump on it ends).
const routes = new WeakMap();

function routeOf(state, ship, now) {
  const key = `${ship.order?.startedAt}|${ship.order?.endsAt}|${ship.order?.jumpsPaid}|${JSON.stringify(ship.queue)}|${state.surveyed?.length}`;
  const cached = routes.get(ship);
  if (cached?.key === key) return cached.hops.filter((hop) => hop.queued || hop.end > now);
  const hops = shipRoute(state, ship, now);
  routes.set(ship, { key, hops });
  return hops;
}

function drawRoutes(ctx, cam, state, now, selection) {
  const ids = selection?.kind === 'ship' ? [selection.id] : selection?.kind === 'ships' ? selection.ids : [];
  for (const id of ids.slice(0, MAX_ROUTES)) {
    const index = state.ships.findIndex((ship) => ship.id === id);
    const ship = state.ships[index];
    if (!ship) continue;
    const hops = routeOf(state, ship, now);
    if (!hops.length) continue;
    for (const hop of hops) {
      const a = findSystem(hop.from);
      const b = findSystem(hop.to);
      const flying = !hop.queued && hop.start <= now;
      const from = flying ? galaxyPosition(ship, now, index) : null;
      const p = toScreen(cam, from?.x ?? a.gx, from?.y ?? a.gy);
      const q = toScreen(cam, b.gx, b.gy);
      routeLine(ctx, p, q, hop.queued);
    }
    const end = findSystem(hops.at(-1).to);
    const e = toScreen(cam, end.gx, end.gy);
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash(hops.at(-1).queued ? [5, 4] : []);
    ctx.beginPath();
    ctx.arc(e.x, e.y, 15 * iconScale(cam), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function routeLine(ctx, p, q, queued) {
  const length = Math.hypot(q.x - p.x, q.y - p.y);
  if (length < 1) return;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(150, 255, 232, 0.22)';
  ctx.lineWidth = 7;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.stroke();
  ctx.strokeStyle = ROUTE_COLOR;
  ctx.lineWidth = 2.4;
  ctx.setLineDash(queued ? [6, 5] : []);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  if (length < 40) return;
  // An arrow halfway, pointing the way the ship goes.
  const ux = (q.x - p.x) / length;
  const uy = (q.y - p.y) / length;
  const mx = (p.x + q.x) / 2 + ux * 4;
  const my = (p.y + q.y) / 2 + uy * 4;
  ctx.fillStyle = ROUTE_COLOR;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(mx - ux * 9 - uy * 5, my - uy * 9 + ux * 5);
  ctx.lineTo(mx - ux * 9 + uy * 5, my - uy * 9 - ux * 5);
  ctx.closePath();
  ctx.fill();
}

/** Corner brackets around the system whose map the System tab shows. */
function drawViewfinder(ctx, p, half) {
  const arm = half * 0.42;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const path = () => {
    ctx.beginPath();
    for (const [dx, dy] of corners) {
      const x = p.x + dx * half;
      const y = p.y + dy * half;
      ctx.moveTo(x - dx * arm, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - dy * arm);
    }
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(160, 250, 235, 0.28)';
  ctx.lineWidth = 5;
  path();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200, 255, 245, 0.95)';
  ctx.lineWidth = 2;
  path();
  ctx.stroke();
  ctx.lineCap = 'butt';
}

let chart = null;

/**
 * What the map shows of the galaxy: the charted systems, the surveyed ones,
 * and the lanes worth drawing (solid between surveyed systems, dashed into
 * the unknown). Worked out again only when a survey (or a new galaxy)
 * changes it.
 */
function chartOf(state) {
  const key = `${currentGalaxy().seed}|${(state.surveyed ?? []).join(',')}`;
  if (chart?.key === key) return chart;
  const charted = chartedSystems(state);
  const surveyed = new Set([HOME_SYSTEM.id, ...(state.surveyed ?? [])]);
  const systems = allSystems().filter((system) => charted.has(system.id));
  const lanes = [];
  const seen = new Set();
  for (const system of systems) {
    for (const { to, lane } of lanesFrom(system.id)) {
      const pair = [system.id, to].sort().join('|');
      if (seen.has(pair) || !charted.has(to)) continue;
      seen.add(pair);
      if (!surveyed.has(system.id) && !surveyed.has(to)) continue;
      lanes.push({ a: system, b: findSystem(to), lane, known: surveyed.has(system.id) && surveyed.has(to) });
    }
  }
  chart = { key, systems, surveyed, lanes, washes: null, extent: null };
  return chart;
}

/**
 * Every charted system's faction wash, in one layer in galaxy units, made
 * again only when the charted or surveyed systems change.
 */
function washLayer(chart) {
  if (chart.washes) return chart.washes;
  const { systems, surveyed } = chart;
  const xs = systems.map((system) => system.gx);
  const ys = systems.map((system) => system.gy);
  const x0 = Math.min(...xs) - WASH_RADIUS;
  const y0 = Math.min(...ys) - WASH_RADIUS;
  const w = Math.max(...xs) + WASH_RADIUS - x0;
  const h = Math.max(...ys) + WASH_RADIUS - y0;
  const scale = Math.min(WASH_RES, WASH_MAX_PX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const layer = canvas.getContext('2d');
  const r = WASH_RADIUS * scale;
  for (const system of systems) {
    const color = withAlpha(findFaction(system.faction).color, surveyed.has(system.id) ? 0.2 : 0.09);
    layer.drawImage(blob(color, r * 2), (system.gx - x0) * scale - r, (system.gy - y0) * scale - r, r * 2, r * 2);
  }
  chart.washes = { canvas, x0, y0, scale };
  return chart.washes;
}

/** Draws the wash layer stretched to the camera, clipped to a screen rectangle. */
function stretchWashes(ctx, cam, layer, x0, y0, x1, y1) {
  const s = scaleOf(cam);
  const p = toScreen(cam, layer.x0, layer.y0);
  const dw = (layer.canvas.width / layer.scale) * s;
  const dh = (layer.canvas.height / layer.scale) * s;
  const left = Math.max(x0, p.x);
  const top = Math.max(y0, p.y);
  const right = Math.min(x1, p.x + dw);
  const bottom = Math.min(y1, p.y + dh);
  if (right <= left || bottom <= top) return;
  const kx = layer.canvas.width / dw;
  const ky = layer.canvas.height / dh;
  ctx.drawImage(layer.canvas, (left - p.x) * kx, (top - p.y) * ky, (right - left) * kx, (bottom - top) * ky, left, top, right - left, bottom - top);
}

/** A system node's radius on screen. */
const nodeRadius = (system, u) => (system.id === 'aurel' ? 8 : 6) * u;

/** Draws the glow behind each surveyed system that reaches a screen rectangle. */
function drawGlows(ctx, cam, chart, u, dpr, x0, y0, x1, y1) {
  for (const system of chart.systems) {
    if (!chart.surveyed.has(system.id)) continue;
    const p = toScreen(cam, system.gx, system.gy);
    const glow = nodeRadius(system, u) * 4;
    if (p.x + glow < x0 || p.x - glow > x1 || p.y + glow < y0 || p.y - glow > y1) continue;
    ctx.drawImage(blob(withAlpha(findFaction(system.faction).color, 0.75), glow * 2 * dpr), p.x - glow, p.y - glow, glow * 2, glow * 2);
  }
}

let backdrop = null;
let lastScale = 0;

/**
 * Draws the washes and the glows behind surveyed systems. Stretching the
 * washes over a whole phone screen every frame is slow where canvases are
 * drawn on the CPU, so while the zoom holds still both are drawn once into
 * a copy the size of the screen (and WASH_PAN_ROOM more each side), which
 * a pan then draws pixel for pixel. While the zoom changes they are drawn
 * directly.
 */
function drawBackdrop(ctx, cam, chart, u, width, height, dpr) {
  const s = scaleOf(cam);
  const steady = s === lastScale;
  lastScale = s;
  const layer = washLayer(chart);
  if (!steady) {
    stretchWashes(ctx, cam, layer, 0, 0, width, height);
    drawGlows(ctx, cam, chart, u, dpr, 0, 0, width, height);
    return;
  }
  let copy = backdrop;
  let q = copy && toScreen(cam, copy.x, copy.y);
  const fits = copy?.chart === chart && copy.s === s && copy.u === u && copy.dpr === dpr && q.x <= 0 && q.y <= 0 && q.x + copy.width >= width && q.y + copy.height >= height;
  if (!fits) {
    const rw = Math.ceil(width * WASH_PAN_ROOM);
    const rh = Math.ceil(height * WASH_PAN_ROOM);
    const canvas = backdrop?.canvas ?? document.createElement('canvas');
    const w = Math.ceil((width + rw * 2) * dpr);
    const h = Math.ceil((height + rh * 2) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const c = canvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    c.setTransform(dpr, 0, 0, dpr, rw * dpr, rh * dpr);
    stretchWashes(c, cam, layer, -rw, -rh, width + rw, height + rh);
    drawGlows(c, cam, chart, u, dpr, -rw, -rh, width + rw, height + rh);
    const corner = toWorld(cam, -rw, -rh);
    copy = backdrop = { chart, s, u, dpr, canvas, x: corner.x, y: corner.y, width: width + rw * 2, height: height + rh * 2 };
    q = { x: -rw, y: -rh };
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(copy.canvas, Math.round(q.x * dpr), Math.round(q.y * dpr));
  ctx.restore();
}

/** How far out the charted part of the galaxy reaches from Aurel, for framing. */
export function galaxyExtent(state) {
  const chart = chartOf(state);
  if (chart.extent == null) {
    let far = 180;
    for (const system of chart.systems) far = Math.max(far, Math.hypot(system.gx, system.gy));
    chart.extent = far + 90;
  }
  return chart.extent;
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
function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A price per tonne for a map label: one decimal under 100 cr. */
const price = (value) => (value < 100 ? value.toFixed(1) : String(Math.round(value)));
const ROLES = ['miner', 'hauler', 'scout'];

/**
 * Draws the galaxy. `view` is as for drawSystem. Returns hit targets for
 * systems, ship badges (`ships-at`, id "system|role") and ships.
 */
export function drawGalaxy(ctx, cam, state, now, view) {
  const dpr = view.dpr ?? 1;
  const s = scaleOf(cam);
  const u = iconScale(cam);
  const targets = [];
  const chart = chartOf(state);
  const { systems, surveyed } = chart;
  const open = canJump(state);
  // Only what is on screen (or near it) is drawn.
  const width = ctx.canvas.width / dpr;
  const height = ctx.canvas.height / dpr;
  const m = CULL_MARGIN;
  const onScreen = (p) => p.x > -m && p.x < width + m && p.y > -m && p.y < height + m;
  const crosses = (a, b) => Math.max(a.x, b.x) > -m && Math.min(a.x, b.x) < width + m && Math.max(a.y, b.y) > -m && Math.min(a.y, b.y) < height + m;
  const crowded = Boolean(view.compact) && cam.zoom < PHONE_LABEL_ZOOM && s * SYSTEM_SPACING < PHONE_LABEL_ROOM;
  const named = new Set([view.current, view.selection?.kind === 'system' ? view.selection.id : null, view.guide?.kind === 'system' ? view.guide.id : null]);

  // Faction washes behind everything, so regions read as soft colour, and
  // a glow behind each surveyed system.
  drawBackdrop(ctx, cam, chart, u, width, height, dpr);

  // Lanes: solid between surveyed systems, dashed into the unknown, each
  // kind as one path.
  const times = open && s > 0.5 && !crowded;
  for (const known of [true, false]) {
    ctx.beginPath();
    for (const lane of chart.lanes) {
      if (lane.known !== known) continue;
      const a = toScreen(cam, lane.a.gx, lane.a.gy);
      const b = toScreen(cam, lane.b.gx, lane.b.gy);
      if (!crosses(a, b)) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = known ? 'rgba(170, 215, 255, 0.42)' : 'rgba(170, 215, 255, 0.22)';
    ctx.setLineDash(known ? [] : [4, 5]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (times) {
    for (const lane of chart.lanes) {
      const a = toScreen(cam, lane.a.gx, lane.a.gy);
      const b = toScreen(cam, lane.b.gx, lane.b.gy);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (onScreen(mid)) drawLabel(ctx, `${Math.round(jumpTime(state, lane.lane) / 60000)} min`, mid.x, mid.y, dpr, { size: 10, weight: 600, color: 'rgba(200, 225, 255, 0.55)' });
    }
  }

  drawRoutes(ctx, cam, state, now, view.selection);

  // Ships: a count beside each system, and ships in a jump on their lane.
  const counts = new Map();
  const jumping = [];
  state.ships.forEach((ship, index) => {
    const pos = galaxyPosition(ship, now, index);
    if (!pos) return;
    if (pos.jumping) jumping.push({ ship, pos });
    else {
      // Grouped by role, in a fixed order, so each kind of ship shows.
      const here = counts.get(pos.system) ?? new Map(ROLES.map((role) => [role, []]));
      here.get(HULLS[ship.hull].role).push(ship.id);
      counts.set(pos.system, here);
    }
  });
  const badges = [];

  // With Market charts and a good picked: a blue dot left of each system
  // that sells it (bigger where it is cheaper) and a green one right of
  // each that buys it (bigger where it pays more). Prices show for the best
  // three of each, and for every system once zoomed in.
  const markets = new Map();
  if (view.market) {
    for (const system of systems) if (surveyed.has(system.id)) markets.set(system.id, systemMarket(state, system.id, view.market, now));
  }
  const asks = [...markets.values()].map((m) => m.sells).filter((v) => v != null).sort((a, b) => a - b);
  const bids = [...markets.values()].map((m) => m.buys).filter((v) => v != null).sort((a, b) => b - a);
  const share = (value, list) => (list.length < 2 || list[0] === list.at(-1) ? 1 : (value - list.at(-1)) / (list[0] - list.at(-1)));
  const everyPrice = s >= 0.9;

  // Systems, with a "!" above the left shoulder for contracts at their stations.
  const marks = contractMarks(state, now).systems;
  for (const system of systems) {
    const p = toScreen(cam, system.gx, system.gy);
    if (!onScreen(p)) continue;
    const faction = findFaction(system.faction);
    const isKnown = surveyed.has(system.id);
    const r = nodeRadius(system, u);
    // The open system's brackets push its labels down a little.
    const framed = system.id === view.current ? Math.max(15, r * 2.5) : 0;
    if (framed) drawViewfinder(ctx, p, framed);
    const below = framed ? framed + 11 : r + 11;
    if (isKnown) {
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
      const blocked = Boolean(shieldingNeeded(state, system));
      ctx.strokeStyle = blocked ? 'rgba(255, 170, 120, 0.7)' : 'rgba(190, 215, 255, 0.5)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      drawLabel(ctx, '?', p.x, p.y + 0.5, dpr, { size: 11, weight: 800, color: 'rgba(220, 236, 255, 0.8)' });
    }
    const labelled = !crowded || named.has(system.id);
    if (labelled) drawLabel(ctx, system.name, p.x, p.y + below, dpr, { size: 12, weight: 800, color: isKnown ? '#ffffff' : 'rgba(220, 236, 255, 0.7)' });
    const hazardBlocks = Boolean(system.hazard) && Boolean(shieldingNeeded(state, system));
    const sub = system.hazard ? system.hazard : !isKnown ? 'unsurveyed' : system.id === 'aurel' ? 'home' : null;
    if (sub && labelled) drawLabel(ctx, sub, p.x, p.y + below + 14, dpr, { size: 10, weight: 600, color: hazardBlocks ? 'rgba(255, 190, 150, 0.8)' : 'rgba(200, 225, 255, 0.55)' });
    const market = markets.get(system.id);
    if (market) {
      const y = p.y + below + (sub ? 28 : 14);
      const sells = market.sells != null && (everyPrice || market.sells <= asks[Math.min(2, asks.length - 1)]);
      const buys = market.buys != null && (everyPrice || market.buys >= bids[Math.min(2, bids.length - 1)]);
      if (market.sells != null) {
        const q = 1 - share(market.sells, asks);
        dot(ctx, p.x - r - 7 * u, p.y, (2 + 3.5 * q) * u, `rgba(143, 211, 255, ${0.5 + 0.5 * q})`);
      }
      if (market.buys != null) {
        const q = share(market.buys, bids);
        dot(ctx, p.x + r + 7 * u, p.y, (2 + 3.5 * q) * u, `rgba(159, 245, 160, ${0.5 + 0.5 * q})`);
      }
      if (sells && !crowded) {
        const best = market.sells === asks[0];
        drawLabel(ctx, `${best ? '★ ' : ''}sells ${price(market.sells)}`, buys ? p.x - 4 : p.x, y, dpr, { size: 11, weight: best ? 800 : 700, color: best ? '#bfe6ff' : 'rgba(143, 211, 255, 0.85)', align: buys ? 'right' : 'center' });
      }
      if (buys && !crowded) {
        const best = market.buys === bids[0];
        drawLabel(ctx, `${best ? '★ ' : ''}buys ${price(market.buys)}`, sells ? p.x + 4 : p.x, y, dpr, { size: 11, weight: best ? 800 : 700, color: best ? '#c8ffc0' : 'rgba(159, 245, 160, 0.85)', align: sells ? 'left' : 'center' });
      }
    }
    const mark = marks.get(system.id);
    if (mark) drawContractMarks(ctx, p.x - (framed ? framed + 6 : r + 8 * u) - (mark.offer && mark.active ? 16 : 0), p.y - r - 4, mark, dpr, u);
    targets.push({ kind: 'system', id: system.id, x: p.x, y: p.y, r: Math.max(16, r * 2.2) });
    // Your ships there: a badge per kind of ship, with how many, which
    // selects them all. Each ship also gets a target on its badge (too
    // small to click) so box selection and selection rings work as on a
    // system map.
    const here = counts.get(system.id);
    if (here) {
      let bx = p.x + (framed ? framed + 14 : r + 12);
      const by = p.y - r - 4;
      for (const [role, ids] of here) {
        if (!ids.length) continue;
        const count = String(ids.length);
        drawAsset(ctx, `ship-${role}`, bx, by, Math.max(15, 18 * u), dpr);
        drawLabel(ctx, count, bx + 10 * u, by, dpr, { size: 11, weight: 800, align: 'left' });
        const width = 10 * u + count.length * 7;
        badges.push({ kind: 'ships-at', id: `${system.id}|${role}`, ids, x: bx + width / 2 - 4, y: by, r: Math.max(10, 9 * u + count.length * 2) });
        for (const id of ids) badges.push({ kind: 'ship', id, x: bx, y: by, r: 0, ring: 9 * u });
        bx += width + 14 * u;
      }
    }
  }
  // Badges go after the systems, so they win where they overlap a node.
  targets.push(...badges);

  // Ships in a jump, on their lane. Ships close together fly as one flock.
  const placeLabel = createLabelSpace(ctx, dpr);
  const label = (...args) => !crowded && placeLabel(...args);
  const w = 26 * u;
  const onLanes = jumping.map((entry) => ({ ...entry, p: toScreen(cam, entry.pos.x, entry.pos.y) })).filter((entry) => onScreen(entry.p));
  for (const group of flock(onLanes, w * 0.8)) {
    const [lead] = group.members;
    const p = group.members.length === 1 ? lead.p : { x: group.x, y: group.y };
    drawAsset(ctx, roleArt(lead.ship), p.x, p.y, w, dpr, { rotate: lead.pos.heading });
    if (group.members.length === 1) {
      label(lead.ship.name, p.x + 10, p.y - 12, { size: 11, align: 'left', color: 'rgba(230, 242, 255, 0.85)' });
      targets.push({ kind: 'ship', id: lead.ship.id, x: p.x, y: p.y, r: Math.max(12, w * 0.6) });
      continue;
    }
    drawCount(ctx, p.x + w * 0.42, p.y - w * 0.36, group.members.length, dpr, u);
    label(flockName(group.members), p.x + w * 0.42 + 10, p.y - 12, { size: 11, align: 'left', color: 'rgba(230, 242, 255, 0.85)' });
    const ids = group.members.map((m) => m.ship.id);
    targets.push({ kind: 'flock', id: lead.ship.id, ids, x: p.x, y: p.y, r: Math.max(14, w * 0.7) });
    for (const id of ids) targets.push({ kind: 'ship', id, x: p.x, y: p.y, r: 0, ring: Math.max(12, w * 0.6) });
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
