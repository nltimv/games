// The research tree. The lab works on one research at a time and keeps
// going while the game is closed.
//
// Module lines (hold, laser, engine) raise the level of a module; ships get
// it from a refit at the shipyard, and new ships come with it. The queue
// line, the Fleet licence line (`allowance`: the fleet allowance it gives)
// and the single researches apply to the whole company at once. Each level
// needs the one before it in its line. `endsAct` marks the researches that
// end an act (any one hazard shielding ends act 2); the wide Research view
// lays the tree out by act from it (render/researchLayout.js).
//
// The Hauler licence ('kite-licence') is gone: a new company starts with a
// Kite. Old saves keep it in their done list, where it does nothing.

/** The Fleet licence line: the allowance each level gives, its cost and time, and what it waits for. */
const LICENCES = [
  { allowance: 4, cost: 300, minutes: 1 },
  { allowance: 6, cost: 1500, minutes: 3 },
  { allowance: 8, cost: 15000, minutes: 15 },
  { allowance: 10, cost: 60000, minutes: 30 },
  { allowance: 12, cost: 150000, minutes: 60 },
  { allowance: 14, cost: 350000, minutes: 120 },
  // Act 2.
  { allowance: 16, cost: 800000, minutes: 180, needs: ['warp-drive'] },
  { allowance: 18, cost: 1500000, minutes: 240 },
  // Act 3.
  { allowance: 20, cost: 2500000, minutes: 360, shields: 1 },
  { allowance: 24, cost: 4000000, minutes: 480 },
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export const LICENCE_LINE = LICENCES.map(({ needs, ...licence }, i) => ({
  id: `licence-${i + 1}`,
  name: `Fleet licence ${ROMAN[i]}`,
  line: 'licence',
  level: i + 1,
  ...licence,
  // A level that waits for more than the one before it lists both.
  ...(needs ? { needs: [`licence-${i}`, ...needs] } : {}),
}));

export const RESEARCH = [
  { id: 'hold-1', name: 'Cargo racks I', line: 'hold', level: 1, cost: 100, minutes: 1 },
  ...LICENCE_LINE,
  { id: 'brokerage', name: 'Brokerage', cost: 50, minutes: 1, effect: 'Stations offer contracts: a fixed price for a set amount of one good.' },
  { id: 'queue-1', name: 'Order queue I', line: 'queue', level: 1, cost: 300, minutes: 3 },
  { id: 'laser-1', name: 'Mining laser I', line: 'laser', level: 1, cost: 500, minutes: 4 },
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
    endsAct: 1,
    cost: 250000,
    minutes: 480,
    effect: 'Ships can jump through the gates. This ends act 1.',
  },
  // Act 2: the galaxy.
  { id: 'scout-licence', name: 'Scout licence', needs: ['warp-drive'], cost: 50000, minutes: 30, effect: 'Shipyards sell Lark-class scouts, which survey unknown systems.' },
  { id: 'market-charts', name: 'Market charts', needs: ['warp-drive'], cost: 80000, minutes: 45, effect: 'The galaxy map shows where each good sells cheapest and pays best.' },
  { id: 'trade-desk', name: 'Trade desk', needs: ['warp-drive'], cost: 150000, minutes: 90, effect: 'The trade card and Buy notes look at systems up to 2 jumps away.' },
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
  { id: 'shield-debris', name: 'Debris shielding', hazard: 'dense debris', endsAct: 2, needs: ['lane-charts', 'jump-1'], cost: 2500000, minutes: 600 },
  { id: 'shield-ion', name: 'Ion shielding', hazard: 'ion storms', endsAct: 2, needs: ['lane-charts', 'jump-1'], cost: 2500000, minutes: 600 },
  { id: 'shield-radiation', name: 'Radiation shielding', hazard: 'radiation', endsAct: 2, needs: ['lane-charts', 'jump-1'], cost: 2500000, minutes: 600 },
  // Act 3: Pathfinder.
  { id: 'fleet-1', name: 'Fleet command I', shields: 1, cost: 1000000, minutes: 480, effect: 'Shipyards offer commanders, who lead wings of 4 ships on missions within 1 jump, for up to 16 hours.' },
  { id: 'fleet-2', name: 'Fleet command II', needs: ['fleet-1'], cost: 1500000, minutes: 600, effect: 'Wings of 6, areas of 2 jumps and missions of up to 24 hours.' },
  { id: 'fleet-3', name: 'Fleet command III', needs: ['fleet-2'], shields: 2, cost: 2500000, minutes: 840, effect: 'Wings of 8, areas of 3 jumps and missions of up to 48 hours.' },
  { id: 'trade-network', name: 'Trade network', needs: ['trade-desk'], shields: 1, cost: 1200000, minutes: 360, effect: 'The trade card and Buy notes look at every surveyed system.' },
  { id: 'deep-shielding', name: 'Deep shielding', shields: 3, cost: 4000000, minutes: 720, effect: 'Every ship can enter the systems past 8 lanes from home, whatever their hazard.' },
  {
    id: 'station-blueprints',
    name: 'Station blueprints',
    needs: ['deep-shielding', 'fleet-2'],
    cost: 4500000,
    minutes: 720,
    effect: 'Plans for your own stations.',
  },
];

/**
 * What each hazard shielding costs, by how many the company already has (or
 * has in the lab): the second costs more than the first, whichever it is.
 */
export const SHIELDING_STEPS = [
  { cost: 2500000, minutes: 600 },
  { cost: 3000000, minutes: 660 },
  { cost: 4000000, minutes: 720 },
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
