// Company goals: a short guided path through act 1. Each goal checks the
// state, pays a small reward once, and points at the next thing to try.
// `progress` (optional) feeds the progress bar on the goal card.

export const GOALS = [
  {
    id: 'first-trip',
    title: 'Send Mule-1 mining',
    hint: 'Right-click an asteroid field on the map (or press and hold it) and pick a trip length.',
    reward: 100,
    done: (s) => s.stats.miningTrips >= 1,
  },
  {
    id: 'first-sale',
    title: 'Sell ore to a station',
    hint: 'When a miner is back, right-click its station and sell the cargo.',
    reward: 150,
    done: (s) => s.stats.oreSold >= 1,
  },
  {
    id: 'earn-3000',
    title: 'Earn 3,000 credits in total',
    hint: 'Longer trips pay a little more per minute.',
    reward: 250,
    done: (s) => s.stats.earned >= 3000,
    progress: (s) => ({ value: s.stats.earned, target: 3000 }),
  },
  {
    id: 'second-miner',
    title: 'Buy a second miner',
    hint: 'Ships are sold at the Halcyon Shipyard.',
    reward: 300,
    done: (s) => s.ships.filter((ship) => ship.hull === 'mule').length >= 2,
  },
  {
    id: 'first-hauler',
    title: 'Buy a hauler',
    hint: 'Haulers buy goods at one station and sell them at another.',
    reward: 400,
    done: (s) => s.ships.some((ship) => ship.hull === 'kite'),
  },
  {
    id: 'trade-profit',
    title: 'Make 1,000 cr profit from trading',
    hint: 'The refinery sells iron that the foundry buys for more. With a hauler at the refinery, right-click the foundry.',
    reward: 500,
    done: (s) => s.stats.tradeProfit >= 1000,
    progress: (s) => ({ value: s.stats.tradeProfit, target: 1000 }),
  },
  {
    id: 'earn-25000',
    title: 'Earn 25,000 credits in total',
    hint: 'Watch prices: selling a lot in one place lowers them for a few hours.',
    reward: 1000,
    done: (s) => s.stats.earned >= 25000,
    progress: (s) => ({ value: s.stats.earned, target: 25000 }),
  },
];

/** Shown after the last goal: what the next update brings. */
export const NEXT_CHAPTER = 'Warp drives, scouts and the galaxy map arrive in the next update.';
