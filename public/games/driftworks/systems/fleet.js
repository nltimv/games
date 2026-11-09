// Ships: making one, naming it, and which hulls a shipyard may build (see
// systems/shipyard.js for building them).

import { HULLS } from '../content/ships.js';
import { fittable } from './modules.js';
import { findResearch } from '../content/research.js';
import { STATION_TYPES } from '../content/stations.js';
import { findFaction, findStation } from '../content/galaxy.js';
import { bestModules, isResearched } from './research.js';
import { hasStanding, STANDING_LEVELS } from './standing.js';

/** A new ship docked at `stationId`, named `name` or the next free "Mule-3". */
export function createShip(state, hullId, stationId, name = null) {
  const hull = HULLS[hullId];
  const taken = new Set(state.ships.map((s) => s.name));
  let n = state.ships.filter((s) => s.hull === hullId).length + 1;
  while (taken.has(`${hull.namePrefix}-${n}`)) n += 1;
  const ship = {
    id: `ship-${state.nextShipId}`,
    name: name ?? `${hull.namePrefix}-${n}`,
    hull: hullId,
    at: stationId,
    cargo: {},
    costBasis: {},
    // Fitted module levels; new ships get the newest researched that fit the hull.
    modules: fittable(hullId, bestModules(state)),
    order: null,
    // Orders waiting to start after the current one.
    queue: [],
    // The orders given since the ship was last idle, for "Run again" and
    // "Copy orders".
    plan: [],
  };
  state.nextShipId += 1;
  state.ships.push(ship);
  return ship;
}

/**
 * Hulls a shipyard stocks, licensed or not. Hulls that need standing show
 * from the warp drive on, when standing starts to count.
 */
export function hullsForSale(state, stationId) {
  const station = findStation(stationId);
  if (!station) return [];
  return (STATION_TYPES[station.type].hulls ?? []).filter((id) => !HULLS[id].standing || isResearched(state, 'warp-drive'));
}

/** The research a hull still needs before the company may build it, or null. */
export function missingLicence(state, hullId) {
  const licence = HULLS[hullId]?.licence;
  return licence && !isResearched(state, licence) ? findResearch(licence) : null;
}

/** Why the company may not build a hull at a shipyard yet (research or standing), or null. */
export function hullLock(state, hullId, stationId) {
  const hull = HULLS[hullId];
  const licence = missingLicence(state, hullId);
  if (licence) return `Needs the ${licence.name} research.`;
  const faction = findStation(stationId)?.faction;
  if (hull?.standing && !hasStanding(state, faction, hull.standing)) {
    const level = STANDING_LEVELS.find((l) => l.id === hull.standing);
    return `Needs ${level.name} standing with the ${findFaction(faction)?.name ?? 'faction'}.`;
  }
  return null;
}

export function findShip(state, shipId) {
  return state.ships.find((s) => s.id === shipId) ?? null;
}
