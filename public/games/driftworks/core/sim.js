// The simulation clock. Instead of ticking every second, it jumps from one
// order step to the next, so catching up after hours away is instant.
//
// The rule that keeps a company from running away while the player works:
// orders already given always finish, but a queued order only starts if the
// previous one ends inside the autonomy window (see core/state.js).

import { goodName } from '../content/goods.js';
import { findField, findStation } from '../content/homeSystem.js';
import { formatNumber } from '../../../shared/js/format.js';
import { sellCargo } from '../systems/cargo.js';
import { giveOrder } from '../systems/orders.js';
import { checkGoals } from '../systems/goals.js';
import { addLog } from '../systems/log.js';
import { autonomyEndsAt } from './state.js';

const MAX_STEPS = 10_000;

function nextDue(state, until) {
  let best = null;
  for (const ship of state.ships) {
    const step = ship.order?.steps[ship.order.stepIndex];
    if (!step || step.at > until) continue;
    if (!best || step.at < best.step.at) best = { ship, step };
  }
  return best;
}

const STEP_HANDLERS = {
  mined(state, ship, step) {
    ship.at = step.station;
    ship.cargo[step.good] = (ship.cargo[step.good] ?? 0) + step.amount;
    addLog(
      state,
      step.at,
      `${ship.name} is back at ${findStation(step.station).name} with ${formatNumber(step.amount)} t ${goodName(step.good).toLowerCase()} from ${findField(step.field).name}`,
      'arrival',
    );
  },
  arrive(state, ship, step) {
    ship.at = step.station;
    addLog(state, step.at, `${ship.name} docked at ${findStation(step.station).name}`, 'arrival');
  },
  sell(state, ship, step) {
    const result = sellCargo(state, ship, step.good, Infinity, step.at);
    if (!result.ok) addLog(state, step.at, `${ship.name} could not sell: ${result.error}`, 'warning');
  },
};

function finishOrder(state, ship, at) {
  ship.order = null;
  const next = ship.queue.shift();
  if (!next) return;
  if (at > autonomyEndsAt(state)) {
    // Keep it queued: it starts when the player is back.
    ship.queue.unshift(next);
    return;
  }
  const result = giveOrder(state, ship, next);
  if (!result.ok) addLog(state, at, `${ship.name} skipped a queued order: ${result.error}`, 'warning');
}

/** Runs every order step due up to `until` and moves the clock there. */
export function advance(state, until) {
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const due = nextDue(state, until);
    if (!due) break;
    const { ship, step } = due;
    state.now = Math.max(state.now, step.at);
    STEP_HANDLERS[step.kind]?.(state, ship, step);
    ship.order.stepIndex += 1;
    if (ship.order.stepIndex >= ship.order.steps.length) finishOrder(state, ship, step.at);
    checkGoals(state, step.at);
  }
  state.now = Math.max(state.now, until);
  return state;
}

/** Call on any player action: it restarts the autonomy window. */
export function registerVisit(state, now) {
  advance(state, now);
  state.lastVisitAt = now;
  // Queued orders that were waiting for the player start now.
  for (const ship of state.ships) {
    if (!ship.order && ship.queue.length) finishOrder(state, ship, now);
  }
}

/** When the next thing happens, or null if the fleet is idle. */
export function nextEventAt(state) {
  let best = null;
  for (const ship of state.ships) {
    const step = ship.order?.steps[ship.order.stepIndex];
    if (step && (best == null || step.at < best)) best = step.at;
  }
  return best;
}
