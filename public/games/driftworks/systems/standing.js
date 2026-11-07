// Faction standing. Trading with a faction's stations (buying or selling)
// earns 1 point per 1,000 cr, and each level makes its markets better for
// you; Trusted also opens its shipyards' Heron-class freighters.
//
// Each faction also pays more for some goods and sells others cheaper (its
// specialities), whatever your standing: that is what makes routes between
// factions worth flying.

import { findFaction, findStation, HOME_FACTION, SPECIALITY } from '../content/galaxy.js';
import { addLog } from './log.js';

export const CREDITS_PER_POINT = 1000;

export const STANDING_LEVELS = [
  { id: 'neutral', name: 'Neutral', points: 0, bonus: 0 },
  // Trade margins are thin, so a few percent on both sides goes a long way.
  { id: 'friendly', name: 'Friendly', points: 50, bonus: 0.01 },
  { id: 'trusted', name: 'Trusted', points: 250, bonus: 0.02 },
  { id: 'allied', name: 'Allied', points: 1000, bonus: 0.03 },
];

export function standingPoints(state, factionId) {
  return state.standing?.[factionId] ?? 0;
}

/** The standing level with a faction: { id, name, points, bonus }. */
export function standingLevel(state, factionId) {
  const points = standingPoints(state, factionId);
  return STANDING_LEVELS.findLast((level) => points >= level.points);
}

/** The next level up, or null at Allied. */
export function nextLevel(state, factionId) {
  const points = standingPoints(state, factionId);
  return STANDING_LEVELS.find((level) => level.points > points) ?? null;
}

export function hasStanding(state, factionId, levelId) {
  const want = STANDING_LEVELS.findIndex((level) => level.id === levelId);
  return STANDING_LEVELS.indexOf(standingLevel(state, factionId)) >= want;
}

/** Factions the company is at least Friendly with. */
export function friendlyFactions(state) {
  return Object.keys(state.standing ?? {}).filter((id) => hasStanding(state, id, 'friendly'));
}

// Standing counts from the warp drive on, so act 1 prices stay as they were.
const counts = (state) => state.research.done.includes('warp-drive');

/**
 * Opens standing when the warp drive is done: Halcyon's starts from what
 * the company earned in act 1, so most companies arrive Trusted or better.
 */
export function openStanding(state) {
  if (!counts(state)) return;
  state.standing ??= {};
  state.standing[HOME_FACTION] = Math.max(standingPoints(state, HOME_FACTION), (state.stats.earned ?? 0) / CREDITS_PER_POINT);
}

/** Adds standing for a trade of `credits` at a station, and logs a new level. */
export function earnStanding(state, stationId, credits, at = state.now) {
  const factionId = findStation(stationId)?.faction;
  if (!factionId || credits <= 0 || !counts(state)) return;
  const before = standingLevel(state, factionId);
  state.standing ??= {};
  state.standing[factionId] = standingPoints(state, factionId) + credits / CREDITS_PER_POINT;
  const after = standingLevel(state, factionId);
  if (after !== before) addLog(state, at, `${after.name} with the ${findFaction(factionId)?.name ?? 'faction'}`, 'goal');
}

/**
 * What a station's price is multiplied by for you: its faction's
 * specialities, and your standing (it pays more, and charges less).
 * `side` is the station's side: 'buys' (you sell) or 'sells' (you buy).
 */
export function priceFactor(state, stationId, good, side) {
  const factionId = findStation(stationId)?.faction;
  const faction = findFaction(factionId);
  if (!faction || !counts(state)) return 1;
  const bonus = standingLevel(state, factionId).bonus;
  if (side === 'buys') return (faction.pays?.includes(good) ? SPECIALITY.pays : 1) * (1 + bonus);
  return (faction.cheap?.includes(good) ? SPECIALITY.cheap : 1) * (1 - bonus);
}
