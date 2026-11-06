// Company goals: a short guided path through act 1. Each goal checks the
// state and pays a small reward once.
// `progress` (optional) feeds the progress bar on the goal card.

export const GOALS = [
  {
    id: 'first-trip',
    title: 'Send Mule-1 mining',
    reward: 100,
    done: (s) => s.stats.miningTrips >= 1,
  },
  {
    id: 'first-sale',
    title: 'Sell ore to a station',
    reward: 150,
    done: (s) => s.stats.oreSold >= 1,
  },
  {
    id: 'earn-3000',
    title: 'Earn 3,000 credits in total',
    reward: 250,
    done: (s) => s.stats.earned >= 3000,
    progress: (s) => ({ value: s.stats.earned, target: 3000 }),
  },
  {
    id: 'second-miner',
    title: 'Buy a second miner',
    reward: 300,
    done: (s) => s.ships.filter((ship) => ship.hull === 'mule').length >= 2,
  },
  {
    id: 'first-hauler',
    title: 'Buy a hauler',
    reward: 400,
    done: (s) => s.ships.some((ship) => ship.hull === 'kite'),
  },
  {
    id: 'trade-profit',
    title: 'Make 1,000 cr profit from trading',
    reward: 500,
    done: (s) => s.stats.tradeProfit >= 1000,
    progress: (s) => ({ value: s.stats.tradeProfit, target: 1000 }),
  },
  {
    id: 'earn-25000',
    title: 'Earn 25,000 credits in total',
    reward: 1000,
    done: (s) => s.stats.earned >= 25000,
    progress: (s) => ({ value: s.stats.earned, target: 25000 }),
  },
];

/** Shown after the last goal: what the next update brings. */
export const NEXT_CHAPTER = 'Warp drives, scouts and the galaxy map arrive in the next update.';
