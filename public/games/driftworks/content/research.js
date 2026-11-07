// The research tree. The lab works on one research at a time and keeps
// going while the game is closed.
//
// Module lines (hold, laser, engine) raise the level of a module; ships get
// it from a refit at the shipyard, and new ships come with it. The queue
// line and the single researches apply to the whole company at once.
// Each level needs the one before it in its line.

export const RESEARCH = [
  { id: 'hold-1', name: 'Cargo racks I', line: 'hold', level: 1, cost: 100, minutes: 1 },
  { id: 'brokerage', name: 'Brokerage', cost: 50, minutes: 1, effect: 'Stations offer contracts: a fixed price for a set amount of one good.' },
  { id: 'queue-1', name: 'Order queue I', line: 'queue', level: 1, cost: 300, minutes: 3 },
  { id: 'laser-1', name: 'Mining laser I', line: 'laser', level: 1, cost: 500, minutes: 4 },
  { id: 'kite-licence', name: 'Hauler licence', cost: 700, minutes: 5, effect: 'Halcyon Shipyard sells Kite-class haulers.' },
  { id: 'hold-2', name: 'Cargo racks II', line: 'hold', level: 2, cost: 1500, minutes: 8 },
  { id: 'engine-1', name: 'Engines I', line: 'engine', level: 1, cost: 2500, minutes: 12 },
  { id: 'queue-2', name: 'Order queue II', line: 'queue', level: 2, cost: 4000, minutes: 20 },
  { id: 'laser-2', name: 'Mining laser II', line: 'laser', level: 2, cost: 6000, minutes: 30 },
  { id: 'hold-3', name: 'Cargo racks III', line: 'hold', level: 3, cost: 9000, minutes: 45 },
  { id: 'queue-3', name: 'Order queue III', line: 'queue', level: 3, cost: 15000, minutes: 60 },
  { id: 'laser-3', name: 'Mining laser III', line: 'laser', level: 3, cost: 25000, minutes: 90 },
  { id: 'hold-4', name: 'Cargo racks IV', line: 'hold', level: 4, cost: 60000, minutes: 90 },
  { id: 'engine-2', name: 'Engines II', line: 'engine', level: 2, cost: 60000, minutes: 90 },
  { id: 'queue-4', name: 'Order queue IV', line: 'queue', level: 4, cost: 100000, minutes: 120 },
  { id: 'laser-4', name: 'Mining laser IV', line: 'laser', level: 4, cost: 150000, minutes: 180 },
  { id: 'hold-5', name: 'Cargo racks V', line: 'hold', level: 5, cost: 220000, minutes: 240 },
  { id: 'queue-5', name: 'Order queue V', line: 'queue', level: 5, cost: 300000, minutes: 300 },
  {
    id: 'warp-drive',
    name: 'Warp drive',
    needs: ['engine-2'],
    cost: 250000,
    minutes: 480,
    effect: 'Ships can jump through the gates. This ends act 1.',
  },
  // Act 2: the galaxy.
  { id: 'scout-licence', name: 'Scout licence', needs: ['warp-drive'], cost: 50000, minutes: 30, effect: 'Shipyards sell Lark-class scouts, which survey unknown systems.' },
  { id: 'market-charts', name: 'Market charts', needs: ['warp-drive'], cost: 80000, minutes: 45, effect: 'The galaxy map shows where each good sells cheapest and pays best.' },
  { id: 'lane-charts', name: 'Lane charts', needs: ['warp-drive'], cost: 300000, minutes: 120, effect: 'Jump fees are halved.' },
  { id: 'jump-1', name: 'Jump drive I', needs: ['warp-drive'], cost: 400000, minutes: 180, effect: 'Jumps take 25% less time.' },
  { id: 'scanners', name: 'Long-range scanners', needs: ['scout-licence'], cost: 600000, minutes: 240, effect: 'Surveys take half as long, and systems next to your ships show live prices.' },
  { id: 'hold-6', name: 'Cargo racks VI', line: 'hold', level: 6, needs: ['hold-5', 'warp-drive'], cost: 900000, minutes: 360 },
  { id: 'second-lab', name: 'Second lab', needs: ['warp-drive'], cost: 1000000, minutes: 360, effect: 'Two researches can run at once.' },
  { id: 'sealed-holds', name: 'Sealed holds', line: 'seal', level: 1, needs: ['warp-drive'], cost: 1200000, minutes: 360 },
  { id: 'jump-2', name: 'Jump drive II', needs: ['jump-1'], cost: 1500000, minutes: 480, effect: 'Jumps take 40% less time than without a jump drive.' },
  // Hazard shielding: one research per hazard, in the order the player
  // picks. Each one costs more than the one before (SHIELDING_STEPS), and
  // the first ends act 2.
  { id: 'shield-debris', name: 'Debris shielding', hazard: 'dense debris', needs: ['lane-charts', 'jump-1'], cost: 2500000, minutes: 600 },
  { id: 'shield-ion', name: 'Ion shielding', hazard: 'ion storms', needs: ['lane-charts', 'jump-1'], cost: 2500000, minutes: 600 },
  { id: 'shield-radiation', name: 'Radiation shielding', hazard: 'radiation', needs: ['lane-charts', 'jump-1'], cost: 2500000, minutes: 600 },
  // Act 3: Pathfinder.
  {
    id: 'station-blueprints',
    name: 'Station blueprints',
    shields: 3,
    cost: 7000000,
    minutes: 1440,
    effect: 'Plans for your own stations.',
  },
];

/**
 * What each hazard shielding costs, by how many the company already has (or
 * has in the lab): the second costs more than the first, whichever it is.
 */
export const SHIELDING_STEPS = [
  { cost: 2500000, minutes: 600 },
  { cost: 3500000, minutes: 720 },
  { cost: 5000000, minutes: 840 },
];

/** Hazard shieldings get their own names in requirement lines. */
export const SHIELDING_COUNT_NAMES = { 1: 'a hazard shielding', 2: 'two hazard shieldings', 3: 'all three hazard shieldings' };

export function findResearch(id) {
  return RESEARCH.find((r) => r.id === id) ?? null;
}

/** The hazard shielding researches. */
export const SHIELDINGS = RESEARCH.filter((r) => r.hazard);

/** The shielding research for a hazard. */
export function shieldingFor(hazard) {
  return SHIELDINGS.find((r) => r.hazard === hazard) ?? null;
}

/** What a research needs first: its own `needs`, or the level below it. */
export function prerequisites(research) {
  if (research.needs) return research.needs;
  if (research.line && research.level > 1) {
    return RESEARCH.filter((r) => r.line === research.line && r.level === research.level - 1).map((r) => r.id);
  }
  return [];
}
