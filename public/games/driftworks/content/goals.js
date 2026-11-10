// Company goals, done in order. The first ones are the tutorial (the guide
// card in ui/tutorial.js explains each); the rest lead to the warp drive,
// which ends act 1. Act 2's goals follow, its first three guided too, and
// end with the first hazard shielding. Act 3's (Pathfinder) end with Station
// blueprints, again with the first three guided. Each goal checks the state and pays
// its reward once. `progress` (optional) feeds the progress bar on the goal
// card.

import { findSystem } from './galaxy.js';
import { LEVEL_HOURS } from './commanders.js';

const HOUR = 3600 * 1000;
const researched = (s, id) => s.research.done.includes(id);
const SHIELDINGS = ['shield-debris', 'shield-ion', 'shield-radiation'];
const tonnesSold = (s, tier) => s.stats.tierTonnes?.[tier] ?? 0;
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
    id: 'carry-goods',
    title: 'Carry goods with the Kite',
    reward: 100,
    tutorial: true,
    done: (s) => (s.stats.haulerSales ?? 0) > 0,
  },
  {
    id: 'first-research',
    title: 'Research Cargo racks I',
    reward: 50,
    tutorial: true,
    done: (s) => researched(s, 'hold-1') || s.research.active?.id === 'hold-1',
  },
  {
    id: 'first-build',
    title: 'Build your first ship',
    reward: 200,
    tutorial: true,
    done: (s) => (s.stats.builds ?? 0) > 0,
  },
  {
    id: 'first-contract',
    title: 'Complete a contract',
    reward: 150,
    tutorial: true,
    done: (s) => s.stats.contracts > 0,
  },
  {
    id: 'first-licence',
    title: 'Research Fleet licence I',
    reward: 200,
    tutorial: true,
    done: (s) => researched(s, 'licence-1') || s.research.active?.id === 'licence-1',
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
    done: (s) => researched(s, 'queue-1'),
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
    title: 'Build a scout',
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
    id: 'sell-processed',
    title: 'Sell steel or glass',
    reward: 50000,
    act: 2,
    // Any processed material counts.
    done: (s) => tonnesSold(s, 3) > 0,
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
    id: 'first-shielding',
    title: 'Research your first hazard shielding',
    reward: 0,
    act: 2,
    done: (s) => SHIELDINGS.some((id) => researched(s, id)),
  },

  // Act 3: Pathfinder.
  {
    id: 'hazard-survey',
    title: 'Survey a system with a hazard',
    reward: 100000,
    act: 3,
    tutorial: true,
    done: (s) => (s.surveyed ?? []).some((id) => findSystem(id)?.hazard),
  },
  {
    id: 'first-commander',
    title: 'Hire a commander',
    reward: 150000,
    act: 3,
    tutorial: true,
    // Hired counts: the commander takes command once their Osprey is built.
    done: (s) => s.ships.some((ship) => ship.commander) || (s.builds ?? []).some((build) => build.commander),
  },
  {
    id: 'first-mission',
    title: 'Send a fleet on a mission',
    reward: 200000,
    act: 3,
    tutorial: true,
    done: (s) => s.ships.some((ship) => ship.mission) || (s.stats.missions ?? 0) > 0,
  },
  {
    id: 'sell-component',
    title: 'Sell circuits or hull plating',
    // Any component counts.
    reward: 300000,
    act: 3,
    done: (s) => tonnesSold(s, 4) > 0,
  },
  {
    id: 'first-salvage',
    title: 'Salvage a derelict',
    reward: 300000,
    act: 3,
    done: (s) => (s.stats.salvaged ?? 0) >= 1,
  },
  {
    id: 'survey-100',
    title: 'Survey 100 systems',
    reward: 500000,
    act: 3,
    done: (s) => (s.surveyed ?? []).length >= 100,
    progress: (s) => ({ value: (s.surveyed ?? []).length, target: 100, unit: 'systems' }),
  },
  {
    id: 'commander-3',
    title: 'Raise a commander to level 3',
    reward: 750000,
    act: 3,
    done: (s) => s.ships.some((ship) => (ship.commander?.missionTime ?? 0) >= LEVEL_HOURS[2] * HOUR),
    progress: (s) => ({ value: Math.floor(Math.max(0, ...s.ships.map((ship) => ship.commander?.missionTime ?? 0)) / HOUR), target: LEVEL_HOURS[2], unit: 'hours' }),
  },
  {
    id: 'station-blueprints',
    title: 'Research Station blueprints',
    reward: 0,
    act: 3,
    done: (s) => researched(s, 'station-blueprints'),
  },
];

/** Shown once every goal is done: where the game stands, and what the next update brings. */
export const ENDING = {
  eyebrow: 'Act 3 complete',
  title: 'The plans for your own stations are ready',
  note: 'Building stations comes with the next update.',
};
