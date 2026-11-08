// The order a commander gives while it works out a ship's next one, or when
// the ship has no part in the mission: { type: 'standby', ms, by }. The ship
// waits where it is. Players never give it; Cancel order ends it.

import { MINUTE } from '../core/time.js';

export function buildStandby(state, view, { ms, by }, start) {
  const end = start + Math.max(MINUTE, Math.round(ms));
  return {
    ok: true,
    order: {
      type: 'standby',
      label: `Waiting for ${by}'s orders`,
      target: view.at,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'standby', station: view.at }],
      legs: [{ from: view.at, to: view.at, start, end }],
      fees: 0,
      jumps: 0,
    },
  };
}
