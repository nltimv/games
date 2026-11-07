// Company goals, done in order. The first ones are the tutorial (the guide
// card in ui/tutorial.js explains each); the rest lead to the warp drive,
// which ends act 1. Act 2's goals follow, its first three guided too, and
// end with Station blueprints. Each goal checks the state and pays its
// reward once. `progress` (optional) feeds the progress bar on the goal card.

const mules = (s) => s.ships.filter((ship) => ship.hull === 'mule');
const researched = (s, id) => s.research.done.includes(id);
const hasOrders = (ship) => Boolean(ship.order) || ship.plan.length > 0;
// Points for Friendly standing (see systems/standing.js), and the best
// standing with any faction but Halcyon.
const FRIENDLY = 50;
const otherStanding = (s) => Math.max(0, ...Object.entries(s.standing ?? {}).filter(([id]) => id !== 'halcyon').map(([, points]) => points));

export const GOALS = [
  {
    id: 'first-sale',
    title: 'Mine ore and sell it',
    reward: 100,
    tutorial: true,
    done: (s) => s.stats.oreSold > 0,
  },
  {
    id: 'first-research',
    title: 'Research Cargo racks I',
    reward: 50,
    tutorial: true,
    done: (s) => researched(s, 'hold-1') || s.research.active?.id === 'hold-1',
  },
  {
    id: 'second-mule',
    title: 'Buy a second Mule and give it orders',
    reward: 100,
    tutorial: true,
    done: (s) => mules(s).length >= 2 && mules(s).every(hasOrders),
  },
  {
    id: 'first-contract',
    title: 'Accept a contract',
    reward: 150,
    tutorial: true,
    done: (s) => s.stats.contractsAccepted > 0,
  },
  {
    id: 'third-mule',
    title: 'Buy a third Mule',
    reward: 200,
    tutorial: true,
    done: (s) => mules(s).length >= 3,
  },
  {
    id: 'first-refit',
    title: 'Refit a ship with bigger cargo racks',
    reward: 100,
    tutorial: true,
    done: (s) => s.stats.refits > 0,
  },
  {
    id: 'queue-research',
    title: 'Research Order queue I',
    reward: 200,
    tutorial: true,
    done: (s) => researched(s, 'queue-1'),
  },
  {
    id: 'first-hauler',
    title: 'Buy a hauler',
    reward: 300,
    done: (s) => s.ships.some((ship) => ship.hull === 'kite'),
  },
  {
    id: 'fleet-6',
    title: 'Run a fleet of six ships',
    reward: 1000,
    done: (s) => s.ships.length >= 6,
    progress: (s) => ({ value: s.ships.length, target: 6, unit: 'ships' }),
  },
  {
    id: 'earn-100000',
    title: 'Earn 100,000 credits in total',
    reward: 5000,
    done: (s) => s.stats.earned >= 100000,
    progress: (s) => ({ value: s.stats.earned, target: 100000, unit: 'credits' }),
  },
  {
    id: 'warp-drive',
    title: 'Research the warp drive',
    reward: 0,
    done: (s) => researched(s, 'warp-drive'),
  },

  // Act 2: Trader.
  {
    id: 'first-scout',
    title: 'Buy a scout',
    reward: 5000,
    act: 2,
    tutorial: true,
    done: (s) => s.ships.some((ship) => ship.hull === 'lark'),
  },
  {
    id: 'first-survey',
    title: 'Survey a system',
    reward: 10000,
    act: 2,
    tutorial: true,
    done: (s) => (s.stats.surveys ?? 0) >= 1,
  },
  {
    id: 'far-sale',
    title: 'Sell goods in another system',
    reward: 15000,
    act: 2,
    tutorial: true,
    done: (s) => (s.stats.farSales ?? 0) >= 1,
  },
  {
    id: 'survey-5',
    title: 'Survey five systems',
    reward: 25000,
    act: 2,
    done: (s) => (s.surveyed ?? []).length >= 5,
    progress: (s) => ({ value: (s.surveyed ?? []).length, target: 5, unit: 'systems' }),
  },
  {
    id: 'friendly-2',
    title: 'Become Friendly with a second faction',
    reward: 50000,
    act: 2,
    done: (s) => otherStanding(s) >= FRIENDLY,
    progress: (s) => ({ value: Math.floor(otherStanding(s)), target: FRIENDLY, unit: 'points' }),
  },
  {
    id: 'earn-2500000',
    title: 'Earn 2,500,000 credits in total',
    reward: 100000,
    act: 2,
    done: (s) => s.stats.earned >= 2500000,
    progress: (s) => ({ value: s.stats.earned, target: 2500000, unit: 'credits' }),
  },
  {
    id: 'fleet-12',
    title: 'Run a fleet of twelve ships',
    reward: 100000,
    act: 2,
    done: (s) => s.ships.length >= 12,
    progress: (s) => ({ value: s.ships.length, target: 12, unit: 'ships' }),
  },
  {
    id: 'station-blueprints',
    title: 'Research Station blueprints',
    reward: 0,
    act: 2,
    done: (s) => researched(s, 'station-blueprints'),
  },
];

/** Shown once Station blueprints are done: what the next update brings. */
export const NEXT_CHAPTER = 'Building your own stations comes with the next update.';
