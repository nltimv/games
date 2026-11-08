// Travel: flights inside a system, jumps between systems, and where a ship
// is drawn.
//
// A course is a list of legs: flights inside a system ({ from, to } places
// in the same system) and jumps ({ from, to, jump: true }, from a gate to
// the gate on the far side of its lane). Orders to another system plot a
// course through the gates on their own (see plotCourse). A command ship
// pays each jump for the ships aboard its fleet as well.

import { DOCK_SECONDS, HULLS } from '../content/ships.js';
import { findPlace, findSystem, lanesFrom, systemOf } from '../content/galaxy.js';
import { MINUTE, SECOND } from '../core/time.js';
import { isSurveyed } from './explore.js';
import { speedOf } from './modules.js';
import { isResearched } from './research.js';
import { hazardNote, isShielded } from './shielding.js';
import { linksFrom } from './signals.js';

export function distance(aId, bId) {
  const a = findPlace(aId);
  const b = findPlace(bId);
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * A flight inside one system in ms: undocking and docking, plus the flight
 * at the ship's engines' speed, to the nearest 5 seconds.
 */
export function flightTime(ship, fromId, toId) {
  if (!fromId || fromId === toId) return 0;
  const ms = DOCK_SECONDS * SECOND + (distance(fromId, toId) / speedOf(ship)) * MINUTE;
  return Math.round(ms / (5 * SECOND)) * 5 * SECOND;
}

/** How long a lane's jump takes, after Jump drive research. */
export function jumpTime(state, lane) {
  const factor = isResearched(state, 'jump-2') ? 0.6 : isResearched(state, 'jump-1') ? 0.75 : 1;
  return Math.round((lane.minutes * factor * MINUTE) / (5 * SECOND)) * 5 * SECOND;
}

/** A lane's fee, after Lane charts research. */
export function jumpFee(state, lane) {
  return Math.round(lane.fee * (isResearched(state, 'lane-charts') ? 0.5 : 1));
}

export function canJump(state) {
  return isResearched(state, 'warp-drive');
}

/**
 * Whether a ship may fly into a system: it has been surveyed, and its
 * hazard (if any) is shielded. A scout may also enter the unsurveyed system
 * it is sent to survey.
 */
function mayEnter(state, systemId, { surveyTarget = null } = {}) {
  const system = findSystem(systemId);
  if (!isShielded(state, system)) return false;
  return isSurveyed(state, systemId) || systemId === surveyTarget;
}

/**
 * The quickest chain of systems from `fromSys` to `toSys`, by jump time
 * plus the flight across each system between its gates. Returns the links
 * taken, [{ to, lane, exit, entry }], or null when there is no way.
 */
function systemPath(state, ship, fromSys, toSys, options) {
  const best = new Map([[fromSys, 0]]);
  const back = new Map();
  const open = [{ id: fromSys, cost: 0, entry: null }];
  const entries = new Map([[fromSys, null]]);
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const { id, cost } = open.shift();
    if (id === toSys) break;
    if (cost > best.get(id)) continue;
    const entry = entries.get(id);
    for (const link of linksFrom(state, id, lanesFrom(id))) {
      const { to, lane, exit } = link;
      if (!mayEnter(state, to, options)) continue;
      // A system we only pass through must be one we know.
      if (to !== toSys && !isSurveyed(state, to)) continue;
      const crossing = entry ? flightTime(ship, entry, exit.id) : 0;
      const next = cost + crossing + jumpTime(state, lane);
      if (next < (best.get(to) ?? Infinity)) {
        best.set(to, next);
        back.set(to, { from: id, link });
        entries.set(to, link.entry.id);
        open.push({ id: to, cost: next });
      }
    }
  }
  if (!best.has(toSys)) return null;
  const path = [];
  for (let at = toSys; at !== fromSys; at = back.get(at).from) path.unshift(back.get(at).link);
  return path;
}

// Paths found so far, per save. They hold until the company surveys a
// system, researches something or investigates a signal (an ancient gate
// may open), which is when the known routes can change.
const paths = new WeakMap();

function cachedPath(state, ship, fromSys, toSys, options) {
  const generation = `${state.surveyed?.length ?? 0}|${state.research.done.length}|${Object.keys(state.signals ?? {}).length}`;
  let cache = paths.get(state);
  if (cache?.generation !== generation || cache.surveyed !== state.surveyed || cache.done !== state.research.done) {
    cache = { generation, surveyed: state.surveyed, done: state.research.done, map: new Map() };
    paths.set(state, cache);
  }
  const key = `${fromSys}|${toSys}|${speedOf(ship)}|${options.surveyTarget ?? ''}`;
  if (!cache.map.has(key)) cache.map.set(key, systemPath(state, ship, fromSys, toSys, options));
  return cache.map.get(key);
}

/**
 * How many ships a jump is paid for: a command ship pays for its fleet
 * aboard too, except on a mission, where the wing flies on its own.
 */
function shipsAboard(state, ship) {
  if (HULLS[ship.hull]?.role !== 'command') return 1;
  const lead = state.ships.find((s) => s.id === ship.id);
  if (!lead?.commander || lead.mission) return 1;
  return 1 + state.ships.filter((s) => s.fleet === lead.id).length;
}

/**
 * The course from one place to another, with times from 0:
 * { ok, legs, time, jumps, fees } or { ok: false, error }. Legs that jump
 * carry their `fee`.
 */
export function plotCourse(state, ship, fromId, toId, options = {}) {
  if (!fromId || !toId || fromId === toId) return { ok: true, legs: [], time: 0, jumps: 0, fees: 0 };
  const fromSys = systemOf(fromId);
  const toSys = systemOf(toId);
  if (fromSys === toSys) {
    const time = flightTime(ship, fromId, toId);
    return { ok: true, legs: [{ from: fromId, to: toId, start: 0, end: time }], time, jumps: 0, fees: 0 };
  }
  if (!canJump(state)) return { ok: false, error: 'The gates open with the warp drive research.' };
  const target = findSystem(toSys);
  const blocked = hazardNote(state, target);
  if (blocked) return { ok: false, error: blocked };
  if (!mayEnter(state, toSys, options)) return { ok: false, error: `${target?.name ?? 'That system'} has not been surveyed yet.` };
  const path = cachedPath(state, ship, fromSys, toSys, options);
  if (!path) return { ok: false, error: `No known route leads to ${target.name}.` };

  const legs = [];
  let t = 0;
  let at = fromId;
  let fees = 0;
  const aboard = shipsAboard(state, ship);
  for (const { exit, entry, lane } of path) {
    if (at !== exit.id) {
      const fly = flightTime(ship, at, exit.id);
      legs.push({ from: at, to: exit.id, start: t, end: t + fly });
      t += fly;
    }
    const jump = jumpTime(state, lane);
    const fee = jumpFee(state, lane) * aboard;
    legs.push({ from: exit.id, to: entry.id, start: t, end: t + jump, jump: true, fee });
    t += jump;
    fees += fee;
    at = entry.id;
  }
  if (at !== toId) {
    const fly = flightTime(ship, at, toId);
    legs.push({ from: at, to: toId, start: t, end: t + fly });
    t += fly;
  }
  return { ok: true, legs, time: t, jumps: path.length, fees };
}

/** Travel time in ms from one place to another, or Infinity when there is no way. */
export function travelTime(state, ship, fromId, toId, options) {
  const course = plotCourse(state, ship, fromId, toId, options);
  return course.ok ? course.time : Infinity;
}

/**
 * Where a ship is at time `at`, following its current order's legs:
 * { x, y, system, moving, to, place } in its system's map units, or, in a
 * jump, { jump: { from, to, t }, system: null } with the two systems' ids.
 * Ships parked at a place circle it slowly so the map feels alive.
 */
export function shipPosition(ship, at, index = 0) {
  const order = ship.order;
  if (!order) return parkedPosition(ship.at, at, index);
  const leg = order.legs.find((l) => at >= l.start && at < l.end) ?? (at < order.legs[0]?.start ? order.legs[0] : order.legs.at(-1));
  if (!leg) return parkedPosition(ship.at ?? order.target, at, index);
  const t = Math.min(1, Math.max(0, (at - leg.start) / Math.max(1, leg.end - leg.start)));
  if (leg.jump) {
    return { jump: { from: systemOf(leg.from), to: systemOf(leg.to), t }, system: null, moving: true, to: leg.to };
  }
  if (leg.from === leg.to) return parkedPosition(leg.from, at, index);
  const a = findPlace(leg.from);
  const b = findPlace(leg.to);
  const eased = t * t * (3 - 2 * t);
  return { x: a.x + (b.x - a.x) * eased, y: a.y + (b.y - a.y) * eased, system: systemOf(leg.from), moving: true, to: leg.to };
}

function parkedPosition(placeId, at, index) {
  const place = findPlace(placeId);
  if (!place) return { x: 0, y: 0, moving: false, system: null };
  const angle = at / (40 * SECOND) + index * 2.1;
  const r = 16 + (index % 3) * 4;
  return { x: place.x + Math.cos(angle) * r, y: place.y + Math.sin(angle) * r, moving: false, place: placeId, system: systemOf(placeId) };
}

/** The system a ship is in at `at`, or null while it jumps. */
export function shipSystem(ship, at) {
  return shipPosition(ship, at).system;
}
