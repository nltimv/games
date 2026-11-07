// The simulation clock. Instead of ticking every second, it jumps from one
// event to the next (an order step, a research finishing), so catching up
// after hours away is instant.
//
// Ships work through their queued orders on their own, then wait. How far a
// company gets while the player is away is bounded by the queue length and
// hold sizes research unlocks.

import { findPlace, findStation } from '../content/galaxy.js';
import { markSurveyed } from '../systems/explore.js';
import { buyCargo, freeHold, sellCargo } from '../systems/cargo.js';
import { expireContracts, refreshBoard } from '../systems/contracts.js';
import { logMined, startNextOrder } from '../systems/orders.js';
import { finishResearch } from '../systems/research.js';
import { checkGoals } from '../systems/goals.js';
import { addLog } from '../systems/log.js';
import { findEntry } from '../systems/market.js';

const MAX_STEPS = 50_000;

function nextDue(state, until) {
  let best = null;
  for (const ship of state.ships) {
    const step = ship.order?.steps[ship.order.stepIndex];
    if (!step || step.at > until) continue;
    if (!best || step.at < best.at) best = { ship, step, at: step.at };
  }
  const research = state.research.active;
  if (research && research.endsAt <= until && (!best || research.endsAt < best.at)) best = { research, at: research.endsAt };
  return best;
}

const STEP_HANDLERS = {
  mined(state, ship, step) {
    ship.at = step.field;
    const amount = Math.min(step.amount, Math.floor(freeHold(ship)));
    if (amount > 0) ship.cargo[step.good] = (ship.cargo[step.good] ?? 0) + amount;
    logMined(state, ship, { ...step, amount });
  },
  arrive(state, ship, step) {
    ship.at = step.station;
    const station = findStation(step.station);
    const place = findPlace(step.station);
    addLog(state, step.at, `${ship.name} ${station ? 'docked' : 'arrived'} at ${place?.name ?? 'its target'}`, 'arrival');
  },
  survey(state, ship, step) {
    ship.at = step.station;
    markSurveyed(state, step.system, step.at);
  },
  sell(state, ship, step) {
    ship.at = step.station;
    const goods = Object.keys(ship.cargo).filter((g) => (!step.good || g === step.good) && findEntry(step.station, g)?.side === 'buys');
    for (const good of goods) {
      const result = sellCargo(state, ship, good, Infinity, step.at);
      if (!result.ok) addLog(state, step.at, `${ship.name} could not sell: ${result.error}`, 'warning');
    }
  },
  buy(state, ship, step) {
    ship.at = step.station;
    const result = buyCargo(state, ship, step.good, step.qty, step.at);
    if (!result.ok) addLog(state, step.at, `${ship.name} could not buy: ${result.error}`, 'warning');
  },
  refit(state, ship, step) {
    ship.at = step.station;
    Object.assign(ship.modules, step.modules);
    state.stats.refits += 1;
    addLog(state, step.at, `${ship.name} has new modules`, 'arrival');
  },
};

/** Runs every event due up to `until` and moves the clock there. */
export function advance(state, until) {
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const due = nextDue(state, until);
    if (!due) break;
    state.now = Math.max(state.now, due.at);
    if (due.research) {
      finishResearch(state, due.at);
      refreshBoard(state, due.at);
    } else {
      const { ship, step } = due;
      STEP_HANDLERS[step.kind]?.(state, ship, step);
      ship.order.stepIndex += 1;
      if (ship.order.stepIndex >= ship.order.steps.length) startNextOrder(state, ship, step.at);
    }
    checkGoals(state, due.at);
  }
  state.now = Math.max(state.now, until);
  expireContracts(state, state.now);
  refreshBoard(state, state.now);
  return state;
}

/** When the next thing happens, or null if nothing is running. */
export function nextEventAt(state) {
  const times = [
    state.research.active?.endsAt,
    ...state.ships.map((ship) => ship.order?.steps[ship.order.stepIndex]?.at),
    ...state.contracts.active.map((c) => c.deadline),
    ...state.contracts.offers.map((o) => o.expiresAt),
  ].filter((t) => t != null);
  return times.length ? Math.min(...times) : null;
}
