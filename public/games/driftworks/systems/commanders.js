// Commanders: three seeded candidates at every shipyard, hired with their
// Osprey-class command ship, who gain levels from hours on missions and
// lead a wing of the company's ships (see systems/missions.js).
//
// A commander is a ship with a `commander` record:
//   { traits: [first, second], portrait, missionTime, missions, report }
// The second trait shows from SECOND_TRAIT_LEVEL on. A ship in a wing has
// `fleet` set to its commander's ship id.

import {
  COMMANDER_PRICES,
  FIRST_NAMES,
  FLEET_COMMAND,
  LAST_NAMES,
  LEVEL_EFFICIENCY,
  LEVEL_HOURS,
  SECOND_TRAIT_LEVEL,
  TRAITS,
  TRAIT_IDS,
} from '../content/commanders.js';
import { findStation } from '../content/galaxy.js';
import { createRng, hashString } from '../core/rng.js';
import { HOUR } from '../core/time.js';
import { formatCredits } from '../../../shared/js/format.js';
import { addLog } from './log.js';
import { createShip, findShip } from './fleet.js';
import { isResearched } from './research.js';

const fail = (error) => ({ ok: false, error });

/** What the company's Fleet command research allows ({ wing, reach, hours }), or null before Fleet command I. */
export function fleetCommand(state) {
  return FLEET_COMMAND.filter((level) => isResearched(state, level.research)).at(-1) ?? null;
}

export const isCommander = (ship) => Boolean(ship?.commander);

export function commanders(state) {
  return state.ships.filter(isCommander);
}

/** The ships a commander leads. */
export function wingOf(state, commander) {
  return state.ships.filter((ship) => ship.fleet === commander.id);
}

/** The commander a ship flies for, or null. */
export function leaderOf(state, ship) {
  return ship?.fleet ? findShip(state, ship.fleet) : null;
}

// ---------- Candidates ----------

function shuffled(rng, list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The three commanders a shipyard offers now: { id, name, traits, portrait }.
 * They come from the save's seed and the number of hires so far, so they
 * stay the same until the next hire, and each has a different first trait.
 */
export function candidates(state) {
  const round = state.hires ?? 0;
  const firsts = shuffled(createRng(hashString(`${state.seed}:commanders:${round}`)), TRAIT_IDS);
  const taken = new Set(state.ships.map((ship) => ship.name));
  return [0, 1, 2].map((i) => {
    const rng = createRng(hashString(`${state.seed}:commander:${round}:${i}`));
    const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
    let last = Math.floor(rng() * LAST_NAMES.length);
    while (taken.has(`${first} ${LAST_NAMES[last]}`)) last = (last + 1) % LAST_NAMES.length;
    const name = `${first} ${LAST_NAMES[last]}`;
    taken.add(name);
    const others = TRAIT_IDS.filter((id) => id !== firsts[i]);
    const second = others[Math.floor(rng() * others.length)];
    const portrait = { hue: Math.floor(rng() * 360), skin: Math.floor(rng() * 5), hair: Math.floor(rng() * 6), hairTone: Math.floor(rng() * 5), badge: Math.floor(rng() * 360) };
    return { id: `${round}-${i}`, name, traits: [firsts[i], second], portrait };
  });
}

/** What the next commander costs. */
export function commanderPrice(state) {
  return COMMANDER_PRICES[Math.min(state.hires ?? 0, COMMANDER_PRICES.length - 1)];
}

/** Whether a commander can be hired at this station now, or why not. */
export function hireLock(state, stationId) {
  if (!fleetCommand(state)) return 'Needs the Fleet command I research.';
  if (findStation(stationId)?.type !== 'shipyard') return 'Commanders are hired at shipyards.';
  return null;
}

export function hireCommander(state, candidateId, stationId, at = state.now) {
  const lock = hireLock(state, stationId);
  if (lock) return fail(lock);
  const candidate = candidates(state).find((c) => c.id === candidateId);
  if (!candidate) return fail('That commander has taken other work.');
  const price = commanderPrice(state);
  if (state.credits < price) return fail(`You need ${formatCredits(price - state.credits)} more.`);
  state.credits -= price;
  const ship = createShip(state, 'osprey', stationId);
  ship.name = candidate.name;
  ship.commander = { traits: candidate.traits, portrait: candidate.portrait, missionTime: 0, missions: 0, report: null };
  state.hires = (state.hires ?? 0) + 1;
  addLog(state, at, `Hired ${candidate.name}, a ${TRAITS[candidate.traits[0]].name.toLowerCase()} commander, with an Osprey-class command ship, for ${formatCredits(price)}`, 'purchase', -price);
  return { ok: true, ship };
}

// ---------- Levels and traits ----------

/** Level 1 to 5, from hours on missions. */
export function commanderLevel(commander) {
  const hours = (commander?.commander?.missionTime ?? 0) / HOUR;
  return LEVEL_HOURS.filter((needed) => hours >= needed).length;
}

/** Hours on missions so far and for the next level ({ hours, next }); next is null at the top. */
export function levelProgress(commander) {
  const level = commanderLevel(commander);
  return { hours: (commander.commander.missionTime ?? 0) / HOUR, from: LEVEL_HOURS[level - 1], next: LEVEL_HOURS[level] ?? null };
}

/** The traits a commander shows: one, and the second from SECOND_TRAIT_LEVEL. */
export function traitsOf(commander) {
  const traits = commander?.commander?.traits ?? [];
  return commanderLevel(commander) >= SECOND_TRAIT_LEVEL ? traits : traits.slice(0, 1);
}

export function hasTrait(commander, trait) {
  return traitsOf(commander).includes(trait);
}

/** "Greedy" or "Greedy and thrifty". */
export function traitText(commander) {
  return traitsOf(commander)
    .map((id, i) => (i ? TRAITS[id].name.toLowerCase() : TRAITS[id].name))
    .join(' and ');
}

/** The share of a ship's time spent working rather than waiting for this commander's next order. */
export function efficiency(commander) {
  return LEVEL_EFFICIENCY[commanderLevel(commander) - 1];
}
