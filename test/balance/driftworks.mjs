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
// After the warp drive the bot plays act 2 too: it keeps a scout surveying
// the nearest systems, trades and mines wherever routes pay best (jump fees
// included), and buys Heron freighters once a shipyard's faction trusts it.
// Run it for two weeks or so to see act 2: npm run balance -- worker 16
//
// Contracts: the bot accepts offers that pay better per minute than its
// best market round and that its fleet can fill in time (two clicks: open
// the station, accept). While playing it counts on looking again soon;
// before a work block, on one round of queued orders. Goods bought for a
// contract must fit in half its money. It sees the guide's first contract
// through, and any contract it has started delivering to, since nothing is
// paid until the last tonne.
//
// The bot counts one click per thing it does: a menu pick, a button.
// Re-running several ships' routes is two clicks: select them, then Run again.

import { createGame } from '../../public/games/driftworks/core/state.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { HOUR, MINUTE, SECOND } from '../../public/games/driftworks/core/time.js';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { RESEARCH, SHIELDINGS } from '../../public/games/driftworks/content/research.js';
import { HULLS } from '../../public/games/driftworks/content/ships.js';
import { GOODS } from '../../public/games/driftworks/content/goods.js';
import { HOME_SYSTEM } from '../../public/games/driftworks/content/homeSystem.js';
import { allSystems, lanesFrom, systemOf } from '../../public/games/driftworks/content/galaxy.js';
import { checkGoals } from '../../public/games/driftworks/systems/goals.js';
import { buyShip, hullLock, missingLicence, shipPrice } from '../../public/games/driftworks/systems/fleet.js';
import { isSurveyed, knownStations, surveyable, surveyorOf } from '../../public/games/driftworks/systems/explore.js';
import { canJump, plotCourse } from '../../public/games/driftworks/systems/travel.js';
import { acceptContract, boardOpen, contractFor, CONTRACT_RULES, stillNeeded } from '../../public/games/driftworks/systems/contracts.js';
import {
  buildOrder,
  canCopy,
  freeSlots,
  copyOrders,
  feesDue,
  giveOrder,
  giveOrders,
  projectShip,
  refitAll,
  refitOffer,
  repeatToFill,
  roomForRounds,
  runAgain,
} from '../../public/games/driftworks/systems/orders.js';
import { freeLab, orderSlots, researchCost, researchStatus, startResearch } from '../../public/games/driftworks/systems/research.js';
import { SHIELDED_DEPTH, isShielded } from '../../public/games/driftworks/systems/shielding.js';
import { bestBuyer, bestTradeQty, saleValue, tradePlan } from '../../public/games/driftworks/systems/advisor.js';
import { affordableQty, marketEntries, marketView, findEntry } from '../../public/games/driftworks/systems/market.js';
import { holdOf } from '../../public/games/driftworks/systems/modules.js';
import { canCarry, cargoTotal } from '../../public/games/driftworks/systems/cargo.js';

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
  const report = { profileName, days, session: [], buys: [], research: [], breaks: [], perDay: [], spans: [], goals: {}, idleAfter: [], tradeRates: [], surveys: [], contracts: [] };
  let clicks = 0;

  const click = (n = 1) => {
    clicks += n;
  };
  // What the bot can spend: its credits less the jump fees its ships still
  // pay at the gates, as a player watching the order menu would keep.
  const cash = () => state.credits - feesDue(state);

  // Contracts paid out: running contracts are watched across each advance,
  // and one that is gone with all it needed delivered was paid.
  let contractPay = 0;
  let contractsDone = 0;
  // What contracts paid over the cost of goods bought for them: trade, by another road.
  let contractMargin = 0;
  const step = (t) => {
    const watched = [...state.contracts.active];
    advance(state, t);
    for (const c of watched) {
      if (!state.contracts.active.includes(c) && c.delivered >= c.qty) {
        contractPay += c.reward;
        contractsDone += 1;
        if (c.basis > 0) contractMargin += c.reward - c.basis;
      }
    }
  };
  const role = (ship) => HULLS[ship.hull].role;

  // ---------- Choosing routes ----------

  // Fields and stations in surveyed systems: Aurel's in act 1.
  const knownFields = () => allSystems().filter((system) => isSurveyed(state, system.id)).flatMap((system) => system.fields);

  /** The best mine-and-sell round for a miner, by credits per minute, jump fees taken off. */
  function bestMiningRound(ship, now) {
    const view = projectShip(state, ship);
    let best = null;
    for (const field of knownFields()) {
      const mine = buildOrder(state, view, { type: 'mine', fieldId: field.id, amount: null }, view.time);
      if (!mine.ok) continue;
      const amount = mine.order.steps[0].amount;
      // The best buyer in the field's system, and the best anywhere.
      const buyers = [bestBuyer(state, field.good, amount, now, systemOf(field.id)), bestBuyer(state, field.good, amount, now)].filter(Boolean);
      for (const buyer of buyers) {
        const after = { ...view, at: field.id, cargo: { ...view.cargo, [field.good]: amount } };
        const sell = buildOrder(state, after, { type: 'sell', stationId: buyer.stationId }, mine.order.endsAt);
        if (!sell.ok) continue;
        const minutes = (sell.order.endsAt - view.time) / MINUTE;
        const fees = (mine.order.fees ?? 0) + (sell.order.fees ?? 0);
        const rate = (buyer.sale.total - fees) / minutes;
        if (!best || rate > best.rate) best = { fieldId: field.id, stationId: buyer.stationId, rate };
      }
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
    const fees = (mine.order.fees ?? 0) + (sell.order.fees ?? 0);
    return (saleValue(state, round.stationId, good, amount, now).total - fees) / ((sell.order.endsAt - view.time) / MINUTE);
  }

  // A route is judged as a few rounds of buy, sell and fly back, after the
  // flight to its start: what Repeat to fill would make of it.
  const ROUNDS = 3;

  /**
   * The best buy-there, sell-there trade for a hauler, or null, by profit
   * per minute over a few rounds, jump fees both ways and the flight to its
   * start included. `homeOnly` keeps it in Aurel (to compare routes between
   * systems with home trade).
   */
  function bestTrade(ship, now, homeOnly = false) {
    let best = null;
    const stations = homeOnly ? HOME_SYSTEM.stations : knownStations(state);
    const room = holdOf(ship) - cargoTotal(ship);
    for (const from of stations) {
      const start = ship.at === from.id ? { ok: true, time: 0, fees: 0 } : plotCourse(state, ship, ship.at, from.id);
      if (!start.ok) continue;
      for (const entry of marketEntries(from.id)) {
        if (entry.side !== 'sells' || !canCarry(ship, entry.good)) continue;
        const max = affordableQty(state, from.id, entry.good, cash() * 0.8, room, now);
        if (max <= 0) continue;
        const cost = marketView(state, from.id, entry.good, now).price;
        for (const to of stations) {
          if (to.id === from.id || findEntry(to.id, entry.good)?.side !== 'buys') continue;
          if (marketView(state, to.id, entry.good, now).price <= cost) continue;
          const qty = bestTradeQty(state, ship, entry.good, to.id, max, now, from.id);
          if (qty.profit < MIN_TRADE) continue;
          const plan = tradePlan(state, ship, entry.good, qty.qty, to.id, now, from.id);
          const back = plotCourse(state, ship, to.id, from.id);
          const minutes = (start.time + ROUNDS * (plan.travel + back.time)) / MINUTE + ROUNDS;
          const rate = (ROUNDS * (plan.profit - back.fees) - start.fees) / minutes;
          if (!best || rate > best.rate) best = { from: from.id, to: to.id, good: entry.good, qty: plan.qty, rate };
        }
      }
    }
    return best;
  }

  // ---------- Contracts ----------

  const running = (now) => state.contracts.active.filter((c) => contractFor(state, c.stationId, c.good, now));

  /** Tonnes a contract still needs after the deliveries ships already have lined up. */
  function openNeed(contract) {
    const lined = state.ships.reduce((sum, ship) => sum + (projectShip(state, ship).delivered[contract.id] ?? 0), 0);
    return stillNeeded(contract) - lined;
  }

  /** Whether the fleet can get hold of a good: ore from a known field, or anything a known station sells once it has a hauler. */
  function canFill(good) {
    if (knownFields().some((field) => field.good === good)) return true;
    return state.ships.some((ship) => role(ship) === 'hauler') && knownStations(state).some((station) => findEntry(station.id, good)?.side === 'sells');
  }

  const isOre = (good) => GOODS[good].tier === 1;

  /**
   * A contract the bot sees through whatever else pays: the guide's first
   * one, as a player following it would, and one already partly delivered,
   * since nothing is paid until it is complete.
   */
  const mustFinish = (contract) => state.stats.contracts === 0 || contract.delivered > 0;

  /**
   * Tonnes of ore (or of other goods) the fleet can bring for contracts that
   * run `hours`. While playing, the bot looks often enough to keep ships on
   * them: half the rounds of ten minutes that fit. Between work blocks it is
   * one fill of the queues, by the ships that are free now (the others are
   * not looked at again in time), with room left for their own trips.
   */
  function capacity(ore, active, hours) {
    const ships = state.ships.filter((ship) => role(ship) === (ore ? 'miner' : 'hauler') && (active || !ship.order));
    const holds = ships.reduce((sum, ship) => sum + holdOf(ship), 0);
    if (active) return 0.5 * holds * Math.floor((hours * 60) / 10);
    return 0.6 * holds * Math.max(1, Math.floor(orderSlots(state) / 2));
  }

  /**
   * Accepts the offers that pay better than what a free ship would do
   * otherwise, as long as the fleet can fill them on top of what it has
   * taken on. The best paying first.
   */
  function takeContracts(now, active) {
    const worth = (offer) => offer.reward / (offer.qty * GOODS[offer.good].value);
    const offers = state.contracts.offers.filter((offer) => offer.expiresAt > now && canFill(offer.good)).sort((a, b) => worth(b) - worth(a));
    for (const offer of offers) {
      if (state.contracts.active.length >= CONTRACT_RULES.maxActive) break;
      const ore = isOre(offer.good);
      const taken = running(now).filter((c) => isOre(c.good) === ore).reduce((sum, c) => sum + stillNeeded(c), 0);
      const tutorial = state.stats.contracts === 0;
      if (!tutorial && taken + offer.qty > capacity(ore, active, offer.hours)) continue;
      // Goods bought for a contract are paid up front: only what the money covers.
      if (!ore && !knownStations(state).some((from) => findEntry(from.id, offer.good)?.side === 'sells' && affordableQty(state, from.id, offer.good, cash() * 0.5, taken + offer.qty, now) >= taken + offer.qty)) continue;
      const contract = { ...offer, delivered: 0, deadline: now + offer.hours * HOUR };
      const ships = state.ships.filter((ship) => role(ship) === (ore ? 'miner' : 'hauler'));
      const ship = ships.find((s) => !s.order) ?? ships[0];
      if (!ship) continue;
      const rate = ore ? contractRound(ship, contract, offer.qty)?.rate : supplyRun(ship, now, contract, offer.qty)?.rate;
      const otherwise = ore ? bestMiningRound(ship, now)?.rate : bestTrade(ship, now)?.rate;
      // The first contract is the tutorial's: taken as soon as it shows.
      if (!tutorial && !(rate > (otherwise ?? 0))) continue;
      if (acceptContract(state, offer.id, now).ok) {
        click(2);
        report.contracts.push({ at: now, qty: offer.qty, reward: offer.reward, good: offer.good });
      }
    }
  }

  /**
   * A mine-and-deliver round for a miner, by credits per minute (the price
   * counted per tonne): { fieldId, contract, rate }, or null when it would
   * arrive too late.
   */
  function contractRound(ship, contract, need) {
    const view = projectShip(state, ship);
    let best = null;
    for (const field of knownFields().filter((f) => f.good === contract.good)) {
      const mine = buildOrder(state, view, { type: 'mine', fieldId: field.id, amount: null }, view.time);
      if (!mine.ok) continue;
      // Delivering flies like a plain flight there.
      const fly = buildOrder(state, { ...view, at: field.id }, { type: 'fly', stationId: contract.stationId }, mine.order.endsAt);
      if (!fly.ok || fly.order.endsAt > contract.deadline) continue;
      const amount = Math.min(mine.order.steps[0].amount, need);
      const minutes = (fly.order.endsAt - view.time) / MINUTE;
      const rate = ((contract.reward * amount) / contract.qty - (mine.order.fees ?? 0) - (fly.order.fees ?? 0)) / minutes;
      if (!best || rate > best.rate) best = { fieldId: field.id, contract, rate };
    }
    return best;
  }

  function bestContractRound(ship, now) {
    let best = null;
    for (const contract of running(now)) {
      const need = openNeed(contract);
      const round = need >= 1 ? contractRound(ship, contract, need) : null;
      if (round && (!best || round.rate > best.rate)) best = round;
    }
    return best;
  }

  /** A buy-and-deliver run for a hauler: { from, contract, qty, rate }, or null. */
  function supplyRun(ship, now, contract, needed) {
    let best = null;
    const need = Math.min(needed, holdOf(ship) - cargoTotal(ship));
    if (need < 1 || !canCarry(ship, contract.good)) return null;
    for (const from of knownStations(state)) {
      if (findEntry(from.id, contract.good)?.side !== 'sells') continue;
      const qty = affordableQty(state, from.id, contract.good, cash() * 0.8, need, now);
      if (qty < 1) continue;
      const start = ship.at === from.id ? { ok: true, time: 0, fees: 0 } : plotCourse(state, ship, ship.at, from.id);
      const there = plotCourse(state, ship, from.id, contract.stationId);
      if (!start.ok || !there.ok || now + start.time + there.time > contract.deadline) continue;
      const cost = tradePlan(state, ship, contract.good, qty, contract.stationId, now, from.id).buy.total;
      const minutes = (start.time + there.time) / MINUTE + 1;
      const rate = ((contract.reward * qty) / contract.qty - cost - start.fees - there.fees) / minutes;
      if (rate > 0 && (!best || rate > best.rate)) best = { from: from.id, contract, qty, rate };
    }
    return best;
  }

  function bestSupply(ship, now) {
    let best = null;
    for (const contract of running(now)) {
      const run = supplyRun(ship, now, contract, openNeed(contract));
      if (run && (!best || run.rate > best.rate)) best = run;
    }
    return best;
  }

  /** Hands cargo to a contract that wants it, or sells it where it pays best. */
  function unload(ship, now) {
    for (const good of Object.keys(ship.cargo)) {
      const contract = running(now).find((c) => c.good === good && openNeed(c) >= 1);
      if (contract && giveOrder(state, ship, { type: 'deliver', stationId: contract.stationId, good }).ok) {
        click();
        continue;
      }
      const buyer = bestBuyer(state, good, ship.cargo[good], now);
      if (buyer && giveOrder(state, ship, { type: 'sell', stationId: buyer.stationId, good }).ok) click();
    }
  }

  // ---------- Scouts ----------

  /** Sends an idle scout to survey the nearest system it can. */
  function keepSurveying(scout) {
    if (scout.order || !scout.at) return;
    let best = null;
    for (const system of allSystems()) {
      if (!surveyable(state, system.id) || surveyorOf(state, system.id)) continue;
      const course = plotCourse(state, scout, scout.at, system.gates[0]?.id, { surveyTarget: system.id });
      if (course.ok && (!best || course.time < best.time)) best = { id: system.id, time: course.time };
    }
    if (best && giveOrder(state, scout, { type: 'survey', systemId: best.id }).ok) click();
  }

  // ---------- Research ----------

  /** How many systems ships could enter with one more shielding: the bot picks the one that opens most. */
  function openedBy(research) {
    const open = (system) => isShielded(state, system) || (system.hazard === research.hazard && system.depth <= SHIELDED_DEPTH);
    const seen = new Set([HOME_SYSTEM.id]);
    const queue = [HOME_SYSTEM.id];
    while (queue.length) {
      const id = queue.shift();
      for (const { to } of lanesFrom(id)) {
        if (seen.has(to) || !open(allSystems().find((s) => s.id === to))) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    return seen.size;
  }
  const bestShielding = () =>
    SHIELDINGS.filter((r) => researchStatus(state, r) === 'open')
      .map((r) => ({ r, opens: openedBy(r) }))
      .sort((a, b) => b.opens - a.opens)[0]?.r ?? null;

  // The goal that ends each act, and the research it needs: the bot saves for it once it is the goal.
  const ACT_ENDS = { 'warp-drive': () => RESEARCH.find((r) => r.id === 'warp-drive'), 'first-shielding': bestShielding };
  const currentGoalId = () => GOALS.find((g) => !state.goals.includes(g.id))?.id;
  const actEnd = () => {
    const research = ACT_ENDS[currentGoalId()]?.();
    return research && researchStatus(state, research) === 'open' ? research : null;
  };
  const goingForWarp = () => Boolean(actEnd());
  const costOf = (research) => researchCost(state, research);

  /**
   * Research in the list's order, but the act's last one first once it is
   * the goal, and scouts right after the warp drive. Market charts only
   * change what the galaxy map shows, and the bot reads every price anyway.
   * Of the hazard shieldings it takes the one that opens the most systems.
   */
  function nextResearch() {
    const scouts = RESEARCH.find((r) => r.id === 'scout-licence');
    if (researchStatus(state, scouts) === 'open') return scouts;
    const next = actEnd() ?? RESEARCH.find((r) => r.id !== 'market-charts' && researchStatus(state, r) === 'open');
    return next?.hazard ? bestShielding() : next;
  }

  // ---------- One look at the game ----------

  function check(now, active) {
    step(now);
    const before = clicks;

    // Research: the lab never waits if the next project is affordable.
    // Once the warp drive is the current goal, the bot saves for it.
    while (freeLab(state)) {
      const next = nextResearch();
      if (!next || cash() < costOf(next) || !startResearch(state, next.id, now).ok) break;
      click();
      report.research.push({ id: next.id, at: now });
    }

    if (boardOpen(state)) takeContracts(now, active);

    // Ships: buy while it leaves money for the next research.
    for (let i = 0; i < 3; i += 1) {
      const mules = state.ships.filter((s) => s.hull === 'mule').length;
      const haulers = state.ships.filter((s) => role(s) === 'hauler').length;
      const wantHaulers = (mules >= 2 ? 1 : 0) + (mules >= 5 ? 1 : 0) + (mules >= 9 ? 1 : 0) + (canJump(state) ? Math.floor(mules / 2) : 0);
      const scouts = state.ships.filter((s) => role(s) === 'scout').length;
      const hauler = !hullLock(state, 'heron', 'halcyon-shipyard') ? 'heron' : 'kite';
      const hull = !missingLicence(state, 'lark') && scouts < 1 ? 'lark' : !missingLicence(state, 'kite') && haulers < wantHaulers ? hauler : 'mule';
      const next = nextResearch();
      const reserve = !freeLab(state) || !next || state.ships.length < 3 ? 0 : goingForWarp() ? costOf(next) : Math.min(costOf(next), shipPrice(state));
      const price = shipPrice(state);
      if (cash() < price + reserve) break;
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
    if (behind.length && cash() >= refitCost * 2 && refitAll(state).ok) click();

    // Idle ships: run the last route again (one click for all), or plan anew.
    const rerun = [];
    for (const ship of state.ships) {
      if (role(ship) === 'scout') {
        keepSurveying(ship);
        continue;
      }
      // A ship just booked for a refit gets its next orders queued after it.
      const refitting = ship.order?.type === 'refit' && !ship.queue.length;
      if (ship.order && !refitting) continue;
      if (!refitting && ship.plan.length && keepPlan(ship, now)) {
        rerun.push(ship);
        continue;
      }
      planAnew(ship, now, active);
    }
    if (rerun.length) {
      for (const ship of rerun) runAgain(state, ship);
      click(2);
    }
    // Between work blocks, fill every queue that has room for more rounds.
    if (!active) {
      for (const ship of state.ships) {
        if (role(ship) !== 'scout' && ship.plan.length && roomForRounds(state, ship) > 0 && repeatToFill(state, ship).ok) click();
      }
    }

    checkGoals(state, now);
    for (const id of state.goals) report.goals[id] ??= now;
    return clicks - before;
  }

  function keepPlan(ship, now) {
    // A contract run goes on while its contract still needs more.
    const delivery = ship.plan.find((s) => s.type === 'deliver');
    if (delivery) {
      const contract = contractFor(state, delivery.stationId, delivery.good, now);
      return Boolean(contract) && openNeed(contract) >= 1 && cargoTotal(ship) === 0;
    }
    // A contract that pays better than the round comes first.
    if (role(ship) === 'hauler' && bestSupply(ship, now)) return false;
    if (role(ship) === 'hauler') {
      const buy = ship.plan.find((s) => s.type === 'buy');
      const sell = ship.plan.find((s) => s.type === 'sell');
      if (!buy || !sell) return false;
      const qty = Math.min(buy.qty, affordableQty(state, buy.stationId, buy.good, cash() * 0.8, holdOf(ship), now));
      const back = plotCourse(state, ship, sell.stationId, buy.stationId);
      return back.ok && tradePlan(state, ship, buy.good, qty, sell.stationId, now, buy.stationId).profit - back.fees > MIN_TRADE * 3;
    }
    if (cargoTotal(ship) > 0) return false;
    const mine = ship.plan.find((s) => s.type === 'mine');
    const sell = ship.plan.find((s) => s.type === 'sell');
    if (!mine || !sell) return false;
    const best = bestMiningRound(ship, now);
    const rate = roundRate(ship, { fieldId: mine.fieldId, stationId: sell.stationId }, now);
    const work = bestContractRound(ship, now);
    if (work && mustFinish(work.contract)) return false;
    if ((work?.rate ?? 0) > rate) return false;
    return best && rate >= RERUN_AT * best.rate;
  }

  function planAnew(ship, now, active) {
    if (cargoTotal(ship) > 0) unload(ship, now);
    if (role(ship) === 'miner') {
      const round = bestMiningRound(ship, now);
      const work = bestContractRound(ship, now);
      if (work && (mustFinish(work.contract) || work.rate > (round?.rate ?? 0))) {
        const given = giveOrders(state, ship, [
          { type: 'mine', fieldId: work.fieldId, amount: null },
          { type: 'deliver', stationId: work.contract.stationId, good: work.contract.good },
        ]);
        click(given.given ?? 0);
        if (active) return;
        // Between work blocks: as many rounds as the contract needs, then market rounds after them.
        if (roomForRounds(state, ship) > 0 && repeatToFill(state, ship).ok) click();
        const after = bestMiningRound(ship, now);
        let more = 0;
        while (after && freeSlots(state, ship) >= 2 && giveOrders(state, ship, [{ type: 'mine', fieldId: after.fieldId, amount: null }, { type: 'sell', stationId: after.stationId }]).given === 2) more += 1;
        if (more) click(more > 1 ? 3 : 2);
        return;
      } else {
        if (!round) return;
        const given = giveOrders(state, ship, [
          { type: 'mine', fieldId: round.fieldId, amount: null },
          { type: 'sell', stationId: round.stationId },
        ]);
        click(given.given ?? 0);
      }
    } else {
      const trade = bestTrade(ship, now);
      const supply = bestSupply(ship, now);
      if (supply && supply.rate > (trade?.rate ?? 0)) {
        const given = giveOrders(state, ship, [
          { type: 'buy', stationId: supply.from, good: supply.contract.good, qty: supply.qty },
          { type: 'deliver', stationId: supply.contract.stationId, good: supply.contract.good },
        ]);
        // Like a Bring, both orders come from one menu pick.
        if (given.ok) click(supply.from === ship.at ? 1 : 2);
        if (!active && roomForRounds(state, ship) > 0 && repeatToFill(state, ship).ok) click();
        return;
      }
      if (!trade) return;
      // How a route between systems compares with the best one at home.
      const away = systemOf(trade.from) !== HOME_SYSTEM.id || systemOf(trade.to) !== HOME_SYSTEM.id;
      if (canJump(state) && away) {
        const home = bestTrade(ship, now, true);
        if (home) report.tradeRates.push(trade.rate / home.rate);
      }
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
    const doneBefore = contractsDone;
    const payBefore = contractPay;
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
        step(x);
        if (state.ships.some((s) => s.order)) busyUntil = x;
      }
      report.idleAfter.push((busyUntil - last) / MINUTE);
    }
    step(dayStart + 33 * HOUR);
    report.perDay.push({
      day: day + 1,
      earned: Math.round(state.stats.earned - earnedBefore),
      ships: state.ships.length,
      credits: Math.round(state.credits),
      contracts: contractsDone - doneBefore,
      contractPay: Math.round(contractPay - payBefore),
      surveyed: (state.surveyed?.length ?? 0) + 1,
      enterable: allSystems().filter((system) => isShielded(state, system)).length,
    });
  }
  report.T0 = T0;
  report.contractPay = contractPay;
  report.contractMargin = contractMargin;
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
      `  day ${d.day}: earned ${String(d.earned).padStart(8)} cr, ${String(d.ships).padStart(2)} ships, ${clicks} clicks a look, miner queues ${median(spans)?.toFixed(0) ?? '-'} min, fleet busy ${idle?.toFixed(0) ?? '-'} min after the last look, ${d.contracts} contracts paid ${d.contractPay} cr, ${d.surveyed}/${d.enterable} systems surveyed/open`,
    );
  }
  console.log('  goals:');
  for (const goal of GOALS) {
    const at = report.goals[goal.id];
    console.log(`    ${goal.title.padEnd(42)} ${at == null ? 'not reached' : clock(report, at)}`);
  }
  console.log(`  total clicks ${report.clicks}, credits ${Math.round(state.credits)}, earned ${Math.round(state.stats.earned)}, research ${state.research.done.length}/${RESEARCH.length}`);
  const share = (report.contractPay / Math.max(1, state.stats.earned)) * 100;
  const first = report.contracts[0];
  console.log(
    `  contracts: ${state.stats.contractsAccepted} accepted, ${state.stats.contracts} complete, ${Math.round(report.contractPay)} cr paid (${share.toFixed(0)}% of earnings); first accepted ${first ? clock(report, first.at) : 'never'}`,
  );
  const warp = report.research.find((r) => r.id === 'warp-drive');
  if (warp) {
    const stats = state.stats;
    const ratio = median(report.tradeRates);
    const shielded = report.goals['first-shielding'];
    console.log(`  act 2: ${state.surveyed.length} systems surveyed, ${stats.jumps} jumps, ${stats.farSales} sales in other systems`);
    const traded = stats.tradeProfit + report.contractMargin;
    console.log(`    jump fees ${Math.round(stats.jumpFees)} cr, ${((stats.jumpFees / Math.max(1, traded + stats.jumpFees)) * 100).toFixed(0)}% of trade profit before fees (contracts for bought goods count as trade)`);
    console.log(`    routes between systems pay ${ratio ? ratio.toFixed(2) : '-'}x the best home trade (median of ${report.tradeRates.length} picks)`);
    console.log(`    standing: ${Object.entries(state.standing).map(([id, p]) => `${id} ${Math.floor(p)}`).join(', ')}`);
    console.log(`    first hazard shielding ${shielded ? `${((shielded - warp.at) / (24 * HOUR)).toFixed(1)} days after starting the warp drive` : 'not reached'}`);
    const tiers = Object.entries(stats.tierProfit ?? {});
    const profit = tiers.reduce((sum, [, p]) => sum + Math.max(0, p), 0);
    console.log(`    sales profit by tier: ${tiers.map(([tier, p]) => `tier ${tier} ${((Math.max(0, p) / Math.max(1, profit)) * 100).toFixed(0)}%`).join(', ')}`);
  }
}

const [first = 'worker', second] = process.argv.slice(2);
const names = first === 'all' ? Object.keys(PROFILES) : [first];
const days = Number(second ?? 6);
for (const name of names) {
  if (!PROFILES[name]) throw new Error(`Unknown profile "${name}". Try: ${Object.keys(PROFILES).join(', ')}, all`);
  print(play(name, days));
}
