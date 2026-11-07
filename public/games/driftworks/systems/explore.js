// What the company knows of the galaxy: which systems its scouts have
// surveyed, which ones it has charted (seen on the map, one lane out from a
// surveyed system), and the market prices its ships have seen.
//
// Prices are live in a system where one of your ships is now. Elsewhere the
// game shows the prices last seen there, and how old they are.

import { HOME_SYSTEM } from '../content/homeSystem.js';
import { allStations, findSystem, lanesFrom, systemOf } from '../content/galaxy.js';
import { addLog } from './log.js';

export function isSurveyed(state, systemId) {
  return systemId === HOME_SYSTEM.id || (state.surveyed ?? []).includes(systemId);
}

/** Surveyed systems plus their unsurveyed neighbours (shown as fog). */
export function chartedSystems(state) {
  const charted = new Set([HOME_SYSTEM.id, ...(state.surveyed ?? [])]);
  for (const id of [...charted]) for (const { to } of lanesFrom(id)) charted.add(to);
  return charted;
}

export function isCharted(state, systemId) {
  return chartedSystems(state).has(systemId);
}

/** Systems a scout could survey next: charted, not surveyed, no hazard. */
export function surveyable(state, systemId) {
  const system = findSystem(systemId);
  return Boolean(system) && !system.hazard && !isSurveyed(state, systemId) && isCharted(state, systemId);
}

/** Marks a system surveyed and records its prices. */
export function markSurveyed(state, systemId, at) {
  if (isSurveyed(state, systemId)) return false;
  state.surveyed ??= [];
  state.surveyed.push(systemId);
  state.stats.surveys = (state.stats.surveys ?? 0) + 1;
  addLog(state, at, `Survey done: ${findSystem(systemId)?.name ?? systemId}`, 'goal');
  return true;
}

/** Stations in surveyed systems: the markets the company knows of. */
export function knownStations(state) {
  return allStations().filter((station) => isSurveyed(state, systemOf(station.id)));
}
