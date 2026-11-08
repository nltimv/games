// What the company knows of station prices.
//
// A system where one of the company's ships is shows live prices (with
// Long-range scanners, the systems next to it too). Elsewhere the panels
// and the order menu use the prices as they were when a ship was last
// there. Markets only change when a ship trades, and otherwise drift back
// to their targets as a pure function of time, so the prices "as last seen"
// are simply the market's prices at that time: the time is all that needs
// keeping (state.seen, per system).

import { lanesFrom, systemOf } from '../content/galaxy.js';
import { isResearched } from './research.js';
import { shipSystem } from './travel.js';

const cache = new WeakMap();

/** The systems with live prices at `at`. */
export function liveSystems(state, at = state.now) {
  // Where a ship is at `at` follows from its orders, and orders given at
  // `at` start there, so the time, the fleet and the research make the key.
  const key = `${at}|${state.ships.length}|${state.research.done.length}`;
  const hit = cache.get(state);
  if (hit?.key === key) return hit.live;
  const live = new Set();
  for (const ship of state.ships) {
    const id = shipSystem(ship, at);
    if (id) live.add(id);
  }
  if (isResearched(state, 'scanners')) for (const id of [...live]) for (const { to } of lanesFrom(id)) live.add(to);
  cache.set(state, { key, live });
  return live;
}

export function isLive(state, systemId, at = state.now) {
  return liveSystems(state, at).has(systemId);
}

/** Notes that a ship saw a system's prices at `at`. */
export function markSeen(state, systemId, at) {
  if (!systemId) return;
  state.seen ??= {};
  state.seen[systemId] = Math.max(state.seen[systemId] ?? 0, at);
}

/** Notes every system with live prices as seen now. */
export function refreshSeen(state, at = state.now) {
  for (const id of liveSystems(state, at)) markSeen(state, id, at);
}

/** When a system's prices were last seen, or null when they are live (or never seen). */
export function seenAt(state, systemId, at = state.now) {
  if (isLive(state, systemId, at)) return null;
  return state.seen?.[systemId] ?? null;
}

/** The time to price a station at: `at` where prices are live, else when they were last seen. */
export function knownAt(state, stationId, at = state.now) {
  const seen = seenAt(state, systemOf(stationId), at);
  return seen == null ? at : Math.min(seen, at);
}
