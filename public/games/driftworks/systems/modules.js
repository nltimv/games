// A ship's numbers, from its hull and fitted modules, and what a refit to
// the newest modules would change and cost.

import { HULLS, MODULES } from '../content/ships.js';
import { bestModules } from './research.js';

/** Tonnes the ship can carry. */
export function holdOf(ship) {
  return MODULES.hold.levels[ship.modules.hold] * HULLS[ship.hull].holdScale;
}

/** Tonnes per minute at a field of richness 1, or 0 for ships that cannot mine. */
export function laserOf(ship) {
  return HULLS[ship.hull].role === 'miner' ? MODULES.laser.levels[ship.modules.laser] : 0;
}

/** Map units per minute. */
export function speedOf(ship) {
  return MODULES.engine.levels[ship.modules.engine] * HULLS[ship.hull].speedScale;
}

/** The module lines a hull uses: haulers have no mining laser. */
export function linesFor(hullId) {
  return Object.keys(MODULES).filter((line) => line !== 'laser' || HULLS[hullId].role === 'miner');
}

/**
 * The modules a refit would fit now: the newest of each line the hull uses.
 * Null when the ship already has them (or newer ones are on order).
 */
export function refitTarget(state, ship) {
  const best = bestModules(state);
  const have = { ...ship.modules };
  // A refit already on its way counts as fitted.
  for (const spec of [ship.order?.spec, ...ship.queue]) {
    if (spec?.type === 'refit') Object.assign(have, spec.modules);
  }
  const lines = linesFor(ship.hull).filter((line) => best[line] > have[line]);
  if (!lines.length) return null;
  return Object.fromEntries(linesFor(ship.hull).map((line) => [line, Math.max(best[line], ship.modules[line])]));
}

/**
 * A refit's price grows with the levels fitted: 40 cr x 2^(levels / 2),
 * about 60 cr for the first rack and a few thousand for the last modules.
 */
export function refitCost(modules) {
  const levels = Object.values(modules).reduce((sum, level) => sum + level, 0);
  return Math.round((40 * 2 ** (levels / 2)) / 10) * 10;
}
