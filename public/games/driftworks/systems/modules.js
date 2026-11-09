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

/** The highest goods tier the ship carries: its hold's, or its hull's if lower. */
export function maxTierOf(ship) {
  return Math.min(HOLD_CLASS_MAX_TIER[holdClassOf(ship)], HULLS[ship.hull].maxTier ?? Infinity);
}

/** The highest level of a module line a hull can be fitted with. */
export function topLevel(hullId, line) {
  const top = MODULES[line].levels.length - 1;
  return line === 'hold' ? Math.min(top, HULLS[hullId].maxRacks ?? top) : top;
}

/**
 * Of the modules researched (`best`, see bestModules), the ones a hull can
 * be fitted with. A ship that has more from before keeps them.
 */
export function fittable(hullId, best) {
  return Object.fromEntries(Object.entries(best).map(([line, level]) => [line, Math.min(level, topLevel(hullId, line))]));
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
  const best = fittable(ship.hull, bestModules(state));
  const have = { ...ship.modules };
  // A refit already on its way counts as fitted.
  for (const spec of [ship.order?.spec, ...ship.queue]) {
    if (spec?.type === 'refit') Object.assign(have, spec.modules);
  }
  const lines = linesFor(ship.hull).filter((line) => best[line] > (have[line] ?? 0));
  if (!lines.length) return null;
  return Object.fromEntries(linesFor(ship.hull).map((line) => [line, Math.max(best[line], ship.modules[line] ?? 0)]));
}

// Big refits take goods as well as credits: steel for each level of Cargo
// racks from V on (per Mule hold of the hull's size), titanium alloy for a
// sealed hold.
export const REFIT_GOODS = {
  hold: { from: 5, good: 'steel', perScale: 4 },
  seal: { from: 1, good: 'titanium-alloy', each: 20 },
};

/** The goods a refit to `modules` takes: { good: t }. */
export function refitGoods(ship, modules) {
  const goods = {};
  const scale = HULLS[ship.hull].holdScale;
  for (const [line, rule] of Object.entries(REFIT_GOODS)) {
    const have = ship.modules[line] ?? 0;
    for (let level = Math.max(have + 1, rule.from); level <= (modules[line] ?? have); level += 1) {
      goods[rule.good] = (goods[rule.good] ?? 0) + (rule.each ?? rule.perScale * scale);
    }
  }
  return goods;
}

/**
 * A refit's price grows with the levels fitted: 40 cr x 2^(levels / 2),
 * about 60 cr for the first rack and a few thousand for the last modules.
 */
export function refitCost(modules) {
  const levels = Object.values(modules).reduce((sum, level) => sum + level, 0);
  return Math.round((40 * 2 ** (levels / 2)) / 10) * 10;
}
