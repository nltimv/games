// Ship hulls, the modules research unlocks for them, and what ships cost.
//
// A ship's numbers come from its hull and the modules fitted to it (see
// systems/modules.js). New ships leave the shipyard with the best modules
// researched so far; older ships get them with a refit.

export const HULLS = {
  mule: {
    name: 'Mule-class miner',
    role: 'miner',
    size: 'small',
    // Multiplies the cargo racks' size and the engines' speed.
    holdScale: 1,
    speedScale: 1,
    holdClass: 1,
    namePrefix: 'Mule',
    blurb: 'Mines raw ore at asteroid fields.',
  },
  kite: {
    name: 'Kite-class hauler',
    role: 'hauler',
    size: 'small',
    holdScale: 4,
    speedScale: 1.2,
    holdClass: 1,
    namePrefix: 'Kite',
    blurb: 'Buys, carries and sells goods between stations.',
    // The research the shipyard needs before it sells this hull.
    licence: 'kite-licence',
  },
  lark: {
    name: 'Lark-class scout',
    role: 'scout',
    size: 'small',
    // Scouts carry no cargo; they survey systems beyond the fog.
    holdScale: 0,
    speedScale: 1.6,
    holdClass: 1,
    namePrefix: 'Lark',
    blurb: 'Surveys unknown systems, so other ships can go there.',
    licence: 'scout-licence',
  },
  heron: {
    name: 'Heron-class freighter',
    role: 'hauler',
    size: 'medium',
    // Twice a Kite's hold, a little slower.
    holdScale: 8,
    speedScale: 0.9,
    holdClass: 1,
    namePrefix: 'Heron',
    blurb: 'A big freighter for long trade routes.',
    licence: 'warp-drive',
    // Sold only at shipyards of factions that trust the company.
    standing: 'trusted',
  },
  osprey: {
    name: 'Osprey-class command ship',
    role: 'command',
    size: 'medium',
    // A commander's ship carries no cargo; it leads a wing on missions.
    holdScale: 0,
    speedScale: 1.3,
    holdClass: 1,
    namePrefix: 'Osprey',
    blurb: 'Carries a commander, who leads a wing of your ships on missions.',
    licence: 'fleet-1',
    // Comes with a commander, hired at a shipyard (see systems/commanders.js).
    hired: true,
  },
};

/**
 * Module lines and their sizes per level. Level 0 is what the first ships
 * carry; each research in the line adds a level.
 *   hold    tonnes of cargo on a Mule (a Kite carries holdScale times more)
 *   laser   tonnes mined per minute at a field of richness 1
 *   engine  map units per minute
 *   seal    the hold class of a hauler (see HOLD_CLASS_MAX_TIER)
 */
export const MODULES = {
  hold: { name: 'Cargo racks', levels: [10, 25, 60, 150, 350, 800, 1800] },
  laser: { name: 'Mining laser', levels: [10, 12, 15, 18, 22] },
  engine: { name: 'Engines', levels: [400, 480, 580] },
  seal: { name: 'Hold type', levels: [1, 2] },
};

export const MODULE_LINES = Object.keys(MODULES);

/** Undocking and docking add this to every flight. */
export const DOCK_SECONDS = 15;

/** How long a refit takes once the ship is at the shipyard. */
export const REFIT_MINUTES = 1;

/** How many orders a ship holds (its current one included), per Order queue level. */
export const ORDER_SLOTS = [2, 4, 6, 8, 12, 16];

/**
 * What the next ship costs, by how many ships the company has: the second
 * ship costs SHIP_PRICES[0], the third SHIP_PRICES[1], and so on. Every hull
 * costs the same. Past the end of the list each ship costs half as much again.
 */
export const SHIP_PRICES = [150, 300, 600, 1500, 3000, 6000, 12000, 22000, 40000, 65000, 100000, 150000, 225000, 340000, 500000];
export const SHIP_PRICE_GROWTH = 1.5;

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
