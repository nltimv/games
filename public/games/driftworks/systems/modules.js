// A ship's numbers, from its hull and fitted modules, and what a refit to
// the newest modules would change and cost.

import { HOLD_CLASS_MAX_TIER, HULLS, MODULES } from '../content/ships.js';
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

/** The ship's hold class: haulers get sealed holds from a refit, other hulls keep their own. */
export function holdClassOf(ship) {
  return linesFor(ship.hull).includes('seal') ? MODULES.seal.levels[ship.modules.seal ?? 0] : HULLS[ship.hull].holdClass;
}

/** The highest goods tier the ship's hold carries. */
export function maxTierOf(ship) {
  return HOLD_CLASS_MAX_TIER[holdClassOf(ship)];
}

/**
 * The module lines a hull uses: only miners have a mining laser, scouts
 * have no hold, and only haulers take a sealed hold.
 */
export function linesFor(hullId) {
  const hull = HULLS[hullId];
  const uses = { laser: hull.role === 'miner', hold: hull.holdScale > 0, seal: hull.role === 'hauler' };
  return Object.keys(MODULES).filter((line) => uses[line] ?? true);
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
  const lines = linesFor(ship.hull).filter((line) => best[line] > (have[line] ?? 0));
  if (!lines.length) return null;
  return Object.fromEntries(linesFor(ship.hull).map((line) => [line, Math.max(best[line], ship.modules[line] ?? 0)]));
}

/**
 * A refit's price grows with the levels fitted: 40 cr x 2^(levels / 2),
 * about 60 cr for the first rack and a few thousand for the last modules.
 */
export function refitCost(modules) {
  const levels = Object.values(modules).reduce((sum, level) => sum + level, 0);
  return Math.round((40 * 2 ** (levels / 2)) / 10) * 10;
}
