// Balance check for Driftworks: simulates a player who works in blocks and
// plays on the breaks between them, then prints when each goal lands and
// how income grows. Run with `npm run balance` (optionally: days, block
// minutes, break minutes), e.g. `npm run balance -- 5 50 10`.
//
// The bot is simple on purpose: on each break it sells what it can, sends
// idle miners out for the next work block, makes the best hauler trade,
// and buys a ship when it can afford one.

import { createGame } from '../../public/games/driftworks/core/state.js';
import { advance, registerVisit } from '../../public/games/driftworks/core/sim.js';
import { HOUR, MINUTE } from '../../public/games/driftworks/core/time.js';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { HULLS, TRIP_LENGTHS } from '../../public/games/driftworks/content/ships.js';
import { HOME_SYSTEM } from '../../public/games/driftworks/content/homeSystem.js';
import { checkGoals } from '../../public/games/driftworks/systems/goals.js';
import { buyCargo, sellCargo } from '../../public/games/driftworks/systems/cargo.js';
import { buyShip } from '../../public/games/driftworks/systems/fleet.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { marketEntries } from '../../public/games/driftworks/systems/market.js';
import { bestTradeQty, deliveryOptions, maxPurchase, saleHere, tripPreview } from '../../public/games/driftworks/systems/advisor.js';

const [days = 5, blockMinutes = 50, breakMinutes = 10] = process.argv.slice(2).map(Number);
const WORK_START = 9;
const WORK_END = 17;
const T0 = Date.UTC(2026, 10, 2, WORK_START, 0, 0);

const state = createGame({ now: T0, seed: 20261106 });
const goalTimes = {};
const daily = [];
let breaks = 0;
let actions = 0;

const role = (ship) => HULLS[ship.hull].role;

function act(now, fn) {
  registerVisit(state, now);
  const result = fn();
  checkGoals(state, now);
  if (result?.ok) actions += 1;
  return result;
}

function sellEverything(now) {
  for (const ship of state.ships.filter((s) => !s.order && s.at)) {
    for (const good of Object.keys(ship.cargo)) {
      const here = saleHere(state, ship, good, now);
      const away = deliveryOptions(state, ship, good, ship.cargo[good], now).sort((a, b) => b.sale.total - a.sale.total)[0];
      // Deliver elsewhere only when it clearly pays for the trip.
      if (away && (!here || away.sale.total > here.total * 1.15)) {
        act(now, () => giveOrder(state, ship, { type: 'move', stationId: away.stationId, sell: good }));
        break;
      }
      if (here?.qty > 0) act(now, () => sellCargo(state, ship, good, Infinity, now));
    }
  }
}

function sendMiners(now, untilNextBreak) {
  const trip = [...TRIP_LENGTHS].reverse().find((t) => t.minutes * MINUTE <= untilNextBreak) ?? TRIP_LENGTHS[0];
  for (const ship of state.ships.filter((s) => role(s) === 'miner' && !s.order && s.at)) {
    const best = HOME_SYSTEM.fields
      .map((field) => ({ field, preview: tripPreview(state, ship, field.id, trip.minutes, now) }))
      .sort((a, b) => b.preview.value - a.preview.value)[0];
    if (best.preview.amount > 0) act(now, () => giveOrder(state, ship, { type: 'mine', fieldId: best.field.id, minutes: trip.minutes }));
  }
}

function trade(now) {
  for (const ship of state.ships.filter((s) => role(s) === 'hauler' && !s.order && s.at)) {
    let best = null;
    for (const entry of marketEntries(ship.at).filter((e) => e.side === 'sells')) {
      const max = maxPurchase(state, ship, entry.good, now);
      if (max <= 0) continue;
      for (const dest of HOME_SYSTEM.stations) {
        if (dest.id === ship.at) continue;
        const plan = bestTradeQty(state, ship, entry.good, dest.id, max, now);
        if (plan.profit > 60 && (!best || plan.profit > best.profit)) best = { ...plan, good: entry.good, dest: dest.id };
      }
    }
    if (best) {
      act(now, () => {
        const bought = buyCargo(state, ship, best.good, best.qty, now);
        return bought.ok ? giveOrder(state, ship, { type: 'move', stationId: best.dest, sell: best.good }) : bought;
      });
    } else if (ship.at !== 'halcyon-refinery') {
      // Reposition to the refinery, where most trades start.
      act(now, () => giveOrder(state, ship, { type: 'move', stationId: 'halcyon-refinery' }));
    }
  }
}

function shop(now) {
  const miners = state.ships.filter((s) => role(s) === 'miner').length;
  const haulers = state.ships.filter((s) => role(s) === 'hauler').length;
  const want = miners < 2 ? 'mule' : haulers < 1 ? 'kite' : miners < 4 ? 'mule' : haulers < 2 ? 'kite' : 'mule';
  if (state.credits >= HULLS[want].price + 300) act(now, () => buyShip(state, want, 'halcyon-shipyard'));
}

function playBreak(start, untilNextBreak) {
  breaks += 1;
  // A break is a few check-ins a couple of minutes apart.
  for (let t = start; t <= start + breakMinutes * MINUTE; t += 2 * MINUTE) {
    advance(state, t);
    sellEverything(t);
    trade(t);
    shop(t);
    sendMiners(t, untilNextBreak - (t - start));
  }
}

for (let day = 0; day < days; day += 1) {
  const dayStart = T0 + day * 24 * HOUR;
  const earnedBefore = state.stats.earned;
  for (let t = dayStart; t < dayStart + (WORK_END - WORK_START) * HOUR; t += (blockMinutes + breakMinutes) * MINUTE) {
    playBreak(t, (blockMinutes + breakMinutes) * MINUTE);
    advance(state, t + (blockMinutes + breakMinutes) * MINUTE);
    for (const id of state.goals) goalTimes[id] ??= t;
  }
  advance(state, dayStart + 24 * HOUR);
  daily.push({
    day: day + 1,
    earned: Math.round(state.stats.earned - earnedBefore),
    credits: Math.round(state.credits),
    fleet: state.ships.map((s) => s.name).join(' '),
  });
}

const fmtHours = (t) => {
  const hours = (t - T0) / HOUR;
  const day = Math.floor(hours / 24) + 1;
  return `day ${day}, ${String(WORK_START + Math.floor(hours % 24)).padStart(2, '0')}:${String(Math.round(((hours % 24) % 1) * 60)).padStart(2, '0')}`;
};

console.log(`Driftworks balance: ${days} days, ${blockMinutes} min work blocks, ${breakMinutes} min breaks (${breaks} breaks, ${actions} actions)\n`);
console.log('Goals');
for (const goal of GOALS) {
  const when = goalTimes[goal.id];
  console.log(`  ${goal.title.padEnd(36)} ${when ? fmtHours(when) : 'not reached'}`);
}
console.log('\nPer day');
for (const d of daily) {
  console.log(`  day ${d.day}: earned ${String(d.earned).padStart(7)} cr, holding ${String(d.credits).padStart(7)} cr, fleet ${d.fleet}`);
}
console.log(`\nTotals: earned ${Math.round(state.stats.earned)} cr, ore sold ${Math.round(state.stats.oreSold)} t, trade profit ${Math.round(state.stats.tradeProfit)} cr`);
