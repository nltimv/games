// The simulation clock. Instead of ticking every second, it jumps from one
// event to the next (an order step, a research finishing), so catching up
// after hours away is instant.
//
// Ships work through their queued orders on their own, then wait. How far a
// company gets while the player is away is bounded by the queue length and
// hold sizes research unlocks.

import { findPlace, findStation, systemOf } from '../content/galaxy.js';
import { markSurveyed } from '../systems/explore.js';
import { investigateSignal, salvageSignal } from '../systems/signals.js';
import { markSeen, refreshSeen } from '../systems/knowledge.js';
import { openStanding } from '../systems/standing.js';
import { buyCargo, freeHold, sellCargo } from '../systems/cargo.js';
import { deliverCargo, nextContractEvent, updateContracts } from '../systems/contracts.js';
import { logMined, nextJump, payJump, startNextOrder } from '../systems/orders.js';
import { LAB_SLOTS, finishResearch } from '../systems/research.js';
import { checkGoals } from '../systems/goals.js';
import { addLog } from '../systems/log.js';
import { findEntry } from '../systems/market.js';
import { dispatch, endMission, finishIfDone, nextMissionEnd, trackMission, wakeFleets } from '../systems/missions.js';
import { findShip } from '../systems/fleet.js';

const MAX_STEPS = 50_000;

function nextDue(state, until) {
  const end = nextMissionEnd(state);
  let best = end && end.at <= until ? { mission: end.commander, at: end.at } : null;
  for (const ship of state.ships) {
    // A jump is paid as the ship enters it, before anything later in the order.
    const jump = nextJump(ship.order);
    if (jump && jump.start <= until) {
      if (!best || jump.start < best.at) best = { ship, jump, at: jump.start };
      continue;
    }
    const step = ship.order?.steps[ship.order.stepIndex];
    if (!step || step.at > until) continue;
    if (!best || step.at < best.at) best = { ship, step, at: step.at };
  }
  for (const slot of LAB_SLOTS) {
    const research = state.research[slot];
    if (research && research.endsAt <= until && (!best || research.endsAt < best.at)) best = { research, slot, at: research.endsAt };
  }
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
  investigate(state, ship, step) {
    ship.at = step.station;
    investigateSignal(state, ship, step.signal, step.at);
  },
  salvage(state, ship, step) {
    ship.at = step.station;
    salvageSignal(state, ship, step.signal, freeHold(ship), step.at);
  },
  sell(state, ship, step) {
    ship.at = step.station;
    const goods = Object.keys(ship.cargo).filter((g) => (!step.good || g === step.good) && findEntry(step.station, g)?.side === 'buys');
    for (const good of goods) {
      const result = sellCargo(state, ship, good, Infinity, step.at);
      if (!result.ok) addLog(state, step.at, `${ship.name} could not sell: ${result.error}`, 'warning');
    }
  },
  deliver(state, ship, step) {
    ship.at = step.station;
    const result = deliverCargo(state, ship, step.good, step.at);
    if (!result.ok) addLog(state, step.at, `${ship.name} could not deliver: ${result.error}`, 'warning');
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
  standby(state, ship, step) {
    ship.at = step.station;
  },
};

/** After a ship's order ends: its commander's next order, and the log of a mission that is over. */
function afterOrder(state, ship, finished, at) {
  if (!ship.order) dispatch(state, ship, at, finished);
  if (finished?.missionBy) finishIfDone(state, findShip(state, finished.missionBy), at);
}

/** Runs every event due up to `until` and moves the clock there. */
export function advance(state, until) {
  wakeFleets(state, state.now);
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const due = nextDue(state, until);
    if (!due) break;
    state.now = Math.max(state.now, due.at);
    if (due.mission) {
      endMission(state, due.mission, due.at);
    } else if (due.research) {
      finishResearch(state, due.at, due.slot);
      openStanding(state);
      updateContracts(state, due.at);
    } else if (due.jump) {
      const { ship } = due;
      const order = ship.order;
      const paid = trackMission(state, ship, null, () => payJump(state, ship, due.jump));
      if (!paid?.ok) afterOrder(state, ship, order, due.at);
    } else {
      const { ship, step } = due;
      trackMission(state, ship, step, () => STEP_HANDLERS[step.kind]?.(state, ship, step));
      markSeen(state, systemOf(ship.at), step.at);
      ship.order.stepIndex += 1;
      if (ship.order.stepIndex >= ship.order.steps.length) {
        const finished = ship.order;
        startNextOrder(state, ship, step.at);
        afterOrder(state, ship, finished, step.at);
      }
    }
    checkGoals(state, due.at);
  }
  state.now = Math.max(state.now, until);
  refreshSeen(state, state.now);
  updateContracts(state, state.now);
  return state;
}

/** When the next thing happens, or null if nothing is running. */
export function nextEventAt(state) {
  const times = [
    state.research.active?.endsAt,
    state.research.second?.endsAt,
    ...state.ships.map((ship) => nextJump(ship.order)?.start ?? ship.order?.steps[ship.order.stepIndex]?.at),
    nextMissionEnd(state)?.at,
    nextContractEvent(state),
  ].filter((t) => t != null);
  return times.length ? Math.min(...times) : null;
}
