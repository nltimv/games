// Balance check for Driftworks. A bot plays the real game code the way a
// player would and prints how the first session feels, when ships,
// research and goals land, and how much clicking each break takes.
//
//   npm run balance                     the worker profile, 6 days
//   npm run balance -- casual 4         a profile and a number of days
//   npm run balance -- all              every profile, side by side
//
// Profiles:
//   newcomer  one long first session (60 min), watching closely
//   worker    a 30 min first session, then a 50/10 work rhythm from 9 to 17
//             with a look at the start of each break and again 8 min later
//   casual    a 15 min first session, then three looks a day
//
// The bot counts one click per thing it does: a menu pick, a button.
// "Run all again" is one click for every idle ship that repeats its route.

import { createGame } from '../../public/games/driftworks/core/state.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { HOUR, MINUTE, SECOND } from '../../public/games/driftworks/core/time.js';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { RESEARCH } from '../../public/games/driftworks/content/research.js';
import { HULLS } from '../../public/games/driftworks/content/ships.js';
import { HOME_SYSTEM } from '../../public/games/driftworks/content/homeSystem.js';
import { checkGoals } from '../../public/games/driftworks/systems/goals.js';
import { buyShip, missingLicence, shipPrice } from '../../public/games/driftworks/systems/fleet.js';
import { acceptContract, boardOpen, CONTRACT_RULES } from '../../public/games/driftworks/systems/contracts.js';
import {
  buildOrder,
  canCopy,
  copyOrders,
  giveOrder,
  giveOrders,
  projectShip,
  refitAll,
  refitOffer,
  repeatToFill,
  roomForRounds,
  runAgain,
} from '../../public/games/driftworks/systems/orders.js';
import { researchStatus, startResearch } from '../../public/games/driftworks/systems/research.js';
import { bestBuyer, bestTradeQty, saleValue, tradePlan } from '../../public/games/driftworks/systems/advisor.js';
import { affordableQty, marketEntries, findEntry } from '../../public/games/driftworks/systems/market.js';
import { holdOf } from '../../public/games/driftworks/systems/modules.js';
import { cargoTotal } from '../../public/games/driftworks/systems/cargo.js';

const PROFILES = {
  newcomer: { firstSession: 60, checks: () => [] },
  worker: {
    firstSession: 30,
    // A look at the start of each break and one 8 minutes later, 9:50 to 16:50.
    checks: (day) => [...Array(8).keys()].flatMap((h) => [day + (9 + h) * HOUR + 50 * MINUTE, day + (9 + h) * HOUR + 58 * MINUTE]),
  },
  casual: { firstSession: 15, checks: (day) => [9, 13, 17].map((h) => day + h * HOUR) },
};

// Re-run a ship's last route unless a fresh one would earn this much more.
const RERUN_AT = 0.6;
// A trade must make at least this much to be worth a hauler's trip.
const MIN_TRADE = 20;

function play(profileName, days) {
  const profile = PROFILES[profileName];
  const T0 = Date.UTC(2026, 10, 2, 9, 0, 0);
  const state = createGame({ now: T0, seed: 20261106 });
  const report = { profileName, days, session: [], buys: [], research: [], breaks: [], perDay: [], spans: [], goals: {}, idleAfter: [] };
  let clicks = 0;

  const click = (n = 1) => {
    clicks += n;
  };
  const role = (ship) => HULLS[ship.hull].role;

  // ---------- Choosing routes ----------

  /** The best mine-and-sell round for a miner, by credits per minute. */
  function bestMiningRound(ship, now) {
    const view = projectShip(state, ship);
    let best = null;
    for (const field of HOME_SYSTEM.fields) {
      const mine = buildOrder(state, view, { type: 'mine', fieldId: field.id, amount: null }, view.time);
      if (!mine.ok) continue;
      const amount = mine.order.steps[0].amount;
      const buyer = bestBuyer(state, field.good, amount, now);
      if (!buyer) continue;
      const after = { ...view, at: field.id, cargo: { ...view.cargo, [field.good]: amount } };
      const sell = buildOrder(state, after, { type: 'sell', stationId: buyer.stationId }, mine.order.endsAt);
      const minutes = (sell.order.endsAt - view.time) / MINUTE;
      const rate = buyer.sale.total / minutes;
      if (!best || rate > best.rate) best = { fieldId: field.id, stationId: buyer.stationId, rate };
    }
    return best;
  }

  function roundRate(ship, round, now) {
    const view = projectShip(state, ship);
    const mine = buildOrder(state, view, { type: 'mine', fieldId: round.fieldId, amount: null }, view.time);
    if (!mine.ok) return 0;
    const { good, amount } = mine.order.steps[0];
    const after = { ...view, at: round.fieldId, cargo: { ...view.cargo, [good]: amount } };
    const sell = buildOrder(state, after, { type: 'sell', stationId: round.stationId }, mine.order.endsAt);
    if (!sell.ok) return 0;
    return saleValue(state, round.stationId, good, amount, now).total / ((sell.order.endsAt - view.time) / MINUTE);
  }

  /** The best buy-here, sell-there trade for a hauler, or null. */
  function bestTrade(ship, now) {
    let best = null;
    for (const from of HOME_SYSTEM.stations) {
      for (const entry of marketEntries(from.id)) {
        if (entry.side !== 'sells') continue;
        const max = affordableQty(state, from.id, entry.good, state.credits * 0.8, holdOf(ship) - cargoTotal(ship), now);
        if (max <= 0) continue;
        for (const to of HOME_SYSTEM.stations) {
          if (findEntry(to.id, entry.good)?.side !== 'buys') continue;
          const qty = bestTradeQty(state, ship, entry.good, to.id, max, now, from.id);
          if (qty.profit < MIN_TRADE) continue;
          const plan = tradePlan(state, ship, entry.good, qty.qty, to.id, now, from.id);
          const minutes = (plan.travel + (ship.at === from.id ? 0 : 5 * MINUTE)) / MINUTE + 1;
          const rate = plan.profit / minutes;
          if (!best || rate > best.rate) best = { from: from.id, to: to.id, good: entry.good, qty: plan.qty, rate };
        }
      }
    }
    return best;
  }

  // ---------- Research ----------

  const goingForWarp = () => currentGoalId() === 'warp-drive' && researchStatus(state, RESEARCH.find((r) => r.id === 'warp-drive')) === 'open';
  const currentGoalId = () => GOALS.find((g) => !state.goals.includes(g.id))?.id;

  /** Research in the list's order, but the warp drive first once it is the goal. */
  function nextResearch() {
    if (goingForWarp()) return RESEARCH.find((r) => r.id === 'warp-drive');
    return RESEARCH.find((r) => researchStatus(state, r) === 'open');
  }

  // ---------- One look at the game ----------

  function check(now, active) {
    advance(state, now);
    const before = clicks;

    // Research: the lab never waits if the next project is affordable.
    // Once the warp drive is the current goal, the bot saves for it.
    if (!state.research.active) {
      const next = nextResearch();
      if (next && state.credits >= next.cost && startResearch(state, next.id, now).ok) {
        click();
        report.research.push({ id: next.id, at: now });
      }
    }

    // Contracts: keep both slots busy.
    if (boardOpen(state)) {
      while (state.contracts.active.length < CONTRACT_RULES.maxActive && state.contracts.offers.length) {
        const offer = [...state.contracts.offers].sort((a, b) => b.qty - a.qty)[0];
        if (!acceptContract(state, offer.id, now).ok) break;
        click();
      }
    }

    // Ships: buy while it leaves money for the next research.
    for (let i = 0; i < 3; i += 1) {
      const mules = state.ships.filter((s) => s.hull === 'mule').length;
      const kites = state.ships.length - mules;
      const wantKites = (mules >= 2 ? 1 : 0) + (mules >= 5 ? 1 : 0) + (mules >= 9 ? 1 : 0);
      const hull = !missingLicence(state, 'kite') && kites < wantKites ? 'kite' : 'mule';
      const next = nextResearch();
      const reserve = state.research.active || !next || state.ships.length < 3 ? 0 : goingForWarp() ? next.cost : Math.min(next.cost, shipPrice(state));
      const price = shipPrice(state);
      if (state.credits < price + reserve) break;
      const bought = buyShip(state, hull, 'halcyon-shipyard');
      if (!bought.ok) break;
      click();
      report.buys.push({ at: now, n: state.ships.length, hull, price });
      // A new ship copies a sister ship's orders when one has a plan.
      const source = state.ships.find((s) => canCopy(state, s, bought.ship));
      if (source && copyOrders(state, bought.ship, source).ok) click();
    }

    // Refits: book them all once the money is there twice over.
    const behind = state.ships.filter((s) => refitOffer(state, s));
    const refitCost = behind.reduce((sum, s) => sum + refitOffer(state, s).cost, 0);
    if (behind.length && state.credits >= refitCost * 2 && refitAll(state).ok) click();

    // Idle ships: run the last route again (one click for all), or plan anew.
    const rerun = [];
    for (const ship of state.ships) {
      if (ship.order) continue;
      if (ship.plan.length && keepPlan(ship, now)) {
        rerun.push(ship);
        continue;
      }
      planAnew(ship, now, active);
    }
    if (rerun.length) {
      for (const ship of rerun) runAgain(state, ship);
      click();
    }
    // Between work blocks, fill every queue that has room for more rounds.
    if (!active) {
      for (const ship of state.ships) {
        if (ship.plan.length && roomForRounds(state, ship) > 0 && repeatToFill(state, ship).ok) click();
      }
    }

    checkGoals(state, now);
    for (const id of state.goals) report.goals[id] ??= now;
    return clicks - before;
  }

  function keepPlan(ship, now) {
    if (role(ship) === 'hauler') {
      const buy = ship.plan.find((s) => s.type === 'buy');
      const sell = ship.plan.find((s) => s.type === 'sell');
      if (!buy || !sell) return false;
      const qty = Math.min(buy.qty, affordableQty(state, buy.stationId, buy.good, state.credits * 0.8, holdOf(ship), now));
      return tradePlan(state, ship, buy.good, qty, sell.stationId, now, buy.stationId).profit > MIN_TRADE * 3;
    }
    if (cargoTotal(ship) > 0) return false;
    const mine = ship.plan.find((s) => s.type === 'mine');
    const sell = ship.plan.find((s) => s.type === 'sell');
    if (!mine || !sell) return false;
    const best = bestMiningRound(ship, now);
    return best && roundRate(ship, { fieldId: mine.fieldId, stationId: sell.stationId }, now) >= RERUN_AT * best.rate;
  }

  function planAnew(ship, now, active) {
    if (role(ship) === 'miner') {
      if (cargoTotal(ship) > 0) {
        const goods = Object.keys(ship.cargo);
        const buyer = bestBuyer(state, goods[0], ship.cargo[goods[0]], now);
        if (buyer && giveOrder(state, ship, { type: 'sell', stationId: buyer.stationId }).ok) click();
      }
      const round = bestMiningRound(ship, now);
      if (!round) return;
      const given = giveOrders(state, ship, [
        { type: 'mine', fieldId: round.fieldId, amount: null },
        { type: 'sell', stationId: round.stationId },
      ]);
      click(given.given ?? 0);
    } else {
      const trade = bestTrade(ship, now);
      if (!trade) return;
      const given = giveOrders(state, ship, [
        { type: 'buy', stationId: trade.from, good: trade.good, qty: trade.qty },
        { type: 'sell', stationId: trade.to, good: trade.good },
      ]);
      // The menu's "Bring" option gives both orders in one pick.
      if (given.ok) click(trade.from === ship.at ? 1 : 2);
    }
    if (!active && roomForRounds(state, ship) > 0 && repeatToFill(state, ship).ok) click();
  }

  // ---------- The schedule ----------

  const STEP = 20 * SECOND;
  let t = T0;
  for (; t < T0 + profile.firstSession * MINUTE; t += STEP) {
    const n = check(t, true);
    if (n) report.session.push({ at: (t - T0) / MINUTE, n });
  }
  for (let day = 0; day < days; day += 1) {
    const dayStart = T0 - 9 * HOUR + day * 24 * HOUR;
    const earnedBefore = state.stats.earned;
    const checks = profile.checks(dayStart).filter((c) => c >= t);
    let last = null;
    for (const at of checks) {
      const n = check(at, false);
      report.breaks.push({ day: day + 1, clicks: n });
      for (const ship of state.ships) {
        if (role(ship) === 'miner' && ship.order) report.spans.push({ day: day + 1, minutes: (projectShip(state, ship).time - at) / MINUTE });
      }
      last = at;
    }
    // How long the fleet keeps busy after the day's last look.
    if (last != null) {
      let busyUntil = last;
      for (let x = last; x < dayStart + 33 * HOUR; x += 5 * MINUTE) {
        advance(state, x);
        if (state.ships.some((s) => s.order)) busyUntil = x;
      }
      report.idleAfter.push((busyUntil - last) / MINUTE);
    }
    advance(state, dayStart + 33 * HOUR);
    report.perDay.push({ day: day + 1, earned: Math.round(state.stats.earned - earnedBefore), ships: state.ships.length, credits: Math.round(state.credits) });
  }
  report.T0 = T0;
  report.state = state;
  report.clicks = clicks;
  return report;
}

// ---------- Printing ----------

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

function clock(report, at) {
  const m = Math.round((at - report.T0) / MINUTE);
  const d = Math.floor((m + 9 * 60) / 1440);
  const minutesOfDay = (m + 9 * 60) % 1440;
  return `${d ? `day ${d + 1} ` : ''}${String(Math.floor(minutesOfDay / 60)).padStart(2, '0')}:${String(minutesOfDay % 60).padStart(2, '0')}`;
}

function print(report) {
  const { state } = report;
  const firstSession = PROFILES[report.profileName].firstSession;
  const looks = report.breaks.length ? `, then ${report.days} days` : '';
  console.log(`\n== ${report.profileName}: ${firstSession} min first session${looks}`);
  for (const [a, b] of [[0, 5], [5, 15], [15, 30], [30, 60]].filter(([a]) => a < firstSession)) {
    const inWindow = report.session.filter((s) => s.at >= a && s.at < b);
    const times = [a, ...inWindow.map((s) => s.at)];
    const gaps = times.slice(1).map((x, i) => x - times[i]);
    const trailing = Math.min(b, firstSession) - times.at(-1);
    console.log(
      `  first session ${String(a).padStart(2)}-${String(b).padEnd(2)} min: ${String(inWindow.length).padStart(2)} moments to act, ${String(inWindow.reduce((s, x) => s + x.n, 0)).padStart(3)} clicks, longest wait ${Math.max(trailing, ...gaps).toFixed(1)} min`,
    );
  }
  console.log(`  ships: ${report.buys.map((b) => `#${b.n}${b.hull === 'kite' ? ' Kite' : ''} ${clock(report, b.at)} (${b.price})`).join(', ')}`);
  console.log(`  research: ${report.research.map((r) => `${r.id} ${clock(report, r.at)}`).join(', ')}`);
  for (const d of report.perDay) {
    const breaks = report.breaks.filter((x) => x.day === d.day);
    if (!breaks.length) continue;
    const clicks = breaks.length ? (breaks.reduce((s, x) => s + x.clicks, 0) / breaks.length).toFixed(1) : '-';
    const spans = report.spans.filter((x) => x.day === d.day).map((x) => x.minutes);
    const idle = report.idleAfter[d.day - 1];
    console.log(
      `  day ${d.day}: earned ${String(d.earned).padStart(8)} cr, ${String(d.ships).padStart(2)} ships, ${clicks} clicks a look, miner queues ${median(spans)?.toFixed(0) ?? '-'} min, fleet busy ${idle?.toFixed(0) ?? '-'} min after the last look`,
    );
  }
  console.log('  goals:');
  for (const goal of GOALS) {
    const at = report.goals[goal.id];
    console.log(`    ${goal.title.padEnd(42)} ${at == null ? 'not reached' : clock(report, at)}`);
  }
  console.log(`  total clicks ${report.clicks}, credits ${Math.round(state.credits)}, research ${state.research.done.length}/${RESEARCH.length}`);
}

const [first = 'worker', second] = process.argv.slice(2);
const names = first === 'all' ? Object.keys(PROFILES) : [first];
const days = Number(second ?? 6);
for (const name of names) {
  if (!PROFILES[name]) throw new Error(`Unknown profile "${name}". Try: ${Object.keys(PROFILES).join(', ')}, all`);
  print(play(name, days));
}
