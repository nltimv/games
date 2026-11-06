// Ship hulls for sale at shipyards. Upgrades and bigger hulls arrive with
// research in later acts.

export const HULLS = {
  mule: {
    name: 'Mule-class miner',
    role: 'miner',
    size: 'small',
    price: 2500,
    hold: 80,
    // Tonnes per minute at a field of richness 1.
    miningRate: 0.8,
    // Map units per minute when travelling inside a system.
    speed: 120,
    holdClass: 1,
    namePrefix: 'Mule',
    blurb: 'Mines raw ore at asteroid fields.',
  },
  kite: {
    name: 'Kite-class hauler',
    role: 'hauler',
    size: 'small',
    price: 3000,
    hold: 160,
    miningRate: 0,
    speed: 150,
    holdClass: 1,
    namePrefix: 'Kite',
    blurb: 'Buys, carries and sells goods between stations.',
  },
};

/** The highest goods tier each hold class may carry. */
export const HOLD_CLASS_MAX_TIER = {
  1: 2,
  2: 4,
  3: 6,
};

export const HOLD_CLASS_NAMES = {
  1: 'Standard hold',
  2: 'Sealed hold',
  3: 'Secure hold',
};

/**
 * Mining trip lengths the player picks from, matched to a work block.
 * Longer trips yield a bit more per minute, so a real work block is the
 * best play.
 */
export const TRIP_LENGTHS = [
  { minutes: 5, bonus: 0 },
  { minutes: 15, bonus: 0.1 },
  { minutes: 25, bonus: 0.2 },
  { minutes: 50, bonus: 0.3 },
];
