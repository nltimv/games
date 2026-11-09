// Ship hulls, the modules research unlocks for them, and how ships are built.
//
// A ship's numbers come from its hull and the modules fitted to it (see
// systems/modules.js). New ships leave the shipyard with the best modules
// researched so far; older ships get them with a refit.
//
// Ships are built at a shipyard from a recipe of goods (see
// systems/shipyard.js), and each hull takes points of the company's fleet
// allowance:
//   points        allowance points the hull takes
//   recipe        { good: tonnes } it is built from
//   buildMinutes  how long the yard takes
//   fee           what a faction's yard charges for the work
// and may be held back from the top modules:
//   maxRacks      (optional) the highest Cargo racks level it can be fitted with
//   maxTier       (optional) the highest goods tier it carries, whatever its hold

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
    points: 1,
    recipe: { iron: 12, graphite: 6 },
    buildMinutes: 5,
    fee: 50,
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
    // It stops at Cargo racks V and tier 3 goods (steel, glass): circuits
    // and hull plating need a Heron, which act 3 asks for.
    maxRacks: 5,
    maxTier: 3,
    points: 1,
    recipe: { iron: 20, silicon: 10 },
    buildMinutes: 8,
    fee: 100,
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
    // The research the shipyard needs before it builds this hull.
    licence: 'scout-licence',
    points: 1,
    recipe: { silicon: 20, graphite: 10, water: 10 },
    buildMinutes: 10,
    fee: 300,
  },
  heron: {
    name: 'Heron-class freighter',
    role: 'hauler',
    size: 'medium',
    // Two and a half Kite holds, Cargo racks VI, tier 4 goods, and a
    // quarter faster than a Kite for long routes: it takes two points, so
    // it has to earn more than two Kites.
    holdScale: 10,
    speedScale: 1.5,
    holdClass: 1,
    namePrefix: 'Heron',
    blurb: 'A big, fast freighter for long trade routes.',
    licence: 'warp-drive',
    // Built only at shipyards of factions that trust the company.
    standing: 'trusted',
    points: 2,
    recipe: { steel: 200, glass: 100, titanium: 100 },
    buildMinutes: 60,
    fee: 20000,
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
    points: 2,
    recipe: { 'titanium-alloy': 150, optics: 60 },
    buildMinutes: 120,
    fee: 40000,
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

/** The fleet allowance a company has before any Fleet licence. */
export const STARTING_ALLOWANCE = 3;

/** Allowance points each Fleet command level adds, so a command ship never costs a ship. */
export const COMMAND_POINTS = 2;

/** A shipyard sells goods missing from a recipe at this many times their value. */
export const BUILD_MARKUP = 1.75;

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
