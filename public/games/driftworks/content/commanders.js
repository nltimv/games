// Commanders (act 3): named characters who lead a wing of the company's
// ships on missions. See systems/commanders.js and systems/missions.js.

/** How each trait tilts a commander's picks. `note` is what the hiring card says. */
export const TRAITS = {
  greedy: { name: 'Greedy', note: 'Chases the top margin and flies further for it.' },
  thrifty: { name: 'Thrifty', note: 'Buys only what still pays, and spreads sales over more stations.' },
  cautious: { name: 'Cautious', note: 'Keeps to short routes and pays as few gates as it can.' },
  curious: { name: 'Curious', note: 'Goes for systems and signals nobody has looked at.' },
  prospector: { name: 'Prospector', note: 'Picks the richest fields, and holds ore for the best buyer.' },
};
export const TRAIT_IDS = Object.keys(TRAITS);

/** What each hire costs, in order; the last price holds after that. */
export const COMMANDER_PRICES = [750000, 1500000, 3000000, 5000000, 8000000];

/** Hours on missions to reach each level (1 to 5). */
export const LEVEL_HOURS = [0, 4, 12, 30, 60];
export const MAX_LEVEL = LEVEL_HOURS.length;
/** The level at which a commander shows a second trait. */
export const SECOND_TRAIT_LEVEL = 3;

/**
 * How much of a ship's time goes to work instead of waiting for the
 * commander's next order, per level: a fleet earns about this share of what
 * the same ships make under the player's own orders.
 */
export const LEVEL_EFFICIENCY = [0.75, 0.79, 0.83, 0.87, 0.9];

/** What each Fleet command research allows: wing size, area reach in jumps, mission lengths in hours. */
export const FLEET_COMMAND = [
  { research: 'fleet-1', wing: 4, reach: 1, hours: [1, 2, 4], doctrines: false },
  { research: 'fleet-2', wing: 6, reach: 2, hours: [1, 2, 4, 8], doctrines: true },
  { research: 'fleet-3', wing: 8, reach: 3, hours: [1, 2, 4, 8, 12], doctrines: true },
];

/**
 * Standing orders a commander keeps from mission to mission (Fleet command
 * II): the least a trade run must make per tonne, the most it may pay at
 * gates, and who it trades with ('any', 'friendly', or a faction id).
 */
export const DOCTRINE_DEFAULT = { margin: 0, feeLimit: null, factions: 'any' };
export const MARGIN_STEPS = [0, 2, 5, 10, 20];
export const FEE_LIMIT_STEPS = [null, 0, 500, 1000, 2500];

/**
 * Missions, and the ships that take part (others in the wing wait):
 *   mine    miners mine and sell; haulers trade ore and refined goods
 *   trade   haulers buy and sell on the best routes in the area
 *   survey  scouts survey, then investigate signals; haulers salvage
 */
export const MISSIONS = {
  mine: { name: 'Mine', roles: ['miner', 'hauler'], lead: 'miner', verb: 'Mining' },
  trade: { name: 'Trade', roles: ['hauler'], lead: 'hauler', verb: 'Trading' },
  survey: { name: 'Survey', roles: ['scout', 'hauler'], lead: 'scout', verb: 'Surveying' },
};
export const MISSION_IDS = Object.keys(MISSIONS);

/** Haulers on a Mine mission carry goods up to this tier. */
export const MINE_MISSION_TIER = 2;

export const FIRST_NAMES = [
  'Tamsin', 'Oren', 'Ilka', 'Rafe', 'Wren', 'Juno', 'Cass', 'Idris', 'Mara', 'Teo', 'Noor', 'Sabine',
  'Ansel', 'Petra', 'Lio', 'Hale', 'Ysolde', 'Bram', 'Kesi', 'Dag', 'Elin', 'Fenna', 'Ravi', 'Odile',
];

export const LAST_NAMES = [
  'Vey', 'Calder', 'Morrow', 'Ashby', 'Quill', 'Strand', 'Okafor', 'Lindqvist', 'Harrow', 'Pell', 'Sorensen', 'Achebe',
  'Rook', 'Varga', 'Ember', 'Tanaka', 'Wilde', 'Brask', 'Ivanova', 'Hollis', 'Marchetti', 'Dunmore', 'Keel', 'Sato',
];
