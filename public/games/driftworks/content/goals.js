// Company goals, done in order. The first ones are the tutorial (the guide
// card in ui/tutorial.js explains each); the rest lead to the warp drive,
// which ends act 1. Each goal checks the state and pays its reward once.
// `progress` (optional) feeds the progress bar on the goal card.

const mules = (s) => s.ships.filter((ship) => ship.hull === 'mule');
const researched = (s, id) => s.research.done.includes(id);
const plans = (s, type) => s.ships.some((ship) => ship.plan.some((spec) => spec.type === type));

export const GOALS = [
  {
    id: 'first-orders',
    title: 'Mine ore and queue its sale',
    reward: 50,
    tutorial: true,
    done: (s) => (plans(s, 'mine') && plans(s, 'sell')) || s.stats.oreSold > 0,
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
    done: (s) => mules(s).length >= 2 && mules(s).every((ship) => ship.plan.length > 0),
  },
  {
    id: 'first-sale',
    title: 'Sell ore',
    reward: 100,
    tutorial: true,
    done: (s) => s.stats.oreSold > 0,
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
    id: 'fill-queue',
    title: 'Research Order queue I and fill a queue',
    reward: 200,
    tutorial: true,
    done: (s) => researched(s, 'queue-1') && (s.stats.repeats > 0 || s.ships.some((ship) => (ship.order ? 1 : 0) + ship.queue.length >= 3)),
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
];

/** Shown once the warp drive is done: what the next update brings. */
export const NEXT_CHAPTER = 'The gates open with the next update: scouts, new systems and the galaxy map.';
