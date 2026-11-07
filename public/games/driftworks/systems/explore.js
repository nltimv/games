// What the company knows of the galaxy: which systems its scouts have
// surveyed, which ones it has charted (seen on the map, one lane out from a
// surveyed system), and the market prices its ships have seen.
//
// Prices are live in a system where one of your ships is now. Elsewhere the
// game shows the prices last seen there, and how old they are.

import { HOME_SYSTEM } from '../content/homeSystem.js';
import { allStations, findFaction, findSystem, lanesFrom, systemOf } from '../content/galaxy.js';
import { formatCredits } from '../../../shared/js/format.js';
import { addLog } from './log.js';
import { earnFactionStanding } from './standing.js';
import { isShielded } from './shielding.js';

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

/** Systems a scout could survey next: charted, not surveyed, and no hazard the company has no shielding for. */
export function surveyable(state, systemId) {
  const system = findSystem(systemId);
  return isShielded(state, system) && !isSurveyed(state, systemId) && isCharted(state, systemId);
}

/** The ship with an order (now or queued) to survey a system, or null. */
export function surveyorOf(state, systemId) {
  return state.ships.find((ship) => [ship.order?.spec, ...(ship.queue ?? [])].some((spec) => spec?.type === 'survey' && spec.systemId === systemId)) ?? null;
}

/** Cartography: what a system's faction pays for the first survey, per lane from home. */
export const CHART_PAY_PER_DEPTH = 1000;

export function chartPay(system) {
  return (system?.depth ?? 0) * CHART_PAY_PER_DEPTH;
}

/**
 * Marks a system surveyed and records its prices. The system's faction pays
 * for the charts, and that counts toward standing with it like trade does.
 */
export function markSurveyed(state, systemId, at) {
  if (isSurveyed(state, systemId)) return false;
  state.surveyed ??= [];
  state.surveyed.push(systemId);
  state.stats.surveys = (state.stats.surveys ?? 0) + 1;
  // The survey reads the system's markets.
  state.seen ??= {};
  state.seen[systemId] = Math.max(state.seen[systemId] ?? 0, at);
  const system = findSystem(systemId);
  const pay = chartPay(system);
  const faction = findFaction(system?.faction);
  if (pay > 0 && faction) {
    state.credits += pay;
    state.stats.earned += pay;
    state.stats.chartPay = (state.stats.chartPay ?? 0) + pay;
    earnFactionStanding(state, faction.id, pay, at);
    addLog(state, at, `Survey done: ${system.name}. The ${faction.name} paid ${formatCredits(pay)} for the charts`, 'goal', pay);
  } else {
    addLog(state, at, `Survey done: ${system?.name ?? systemId}`, 'goal');
  }
  return true;
}

/** Stations in surveyed systems: the markets the company knows of. */
export function knownStations(state) {
  return allStations().filter((station) => isSurveyed(state, systemOf(station.id)));
}
