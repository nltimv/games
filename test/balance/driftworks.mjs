// Balance check for Driftworks. A bot plays the real game code the way a
// player would and prints how the first session feels, when ships,
// research and goals land, and how much clicking each break takes.
//
//   npm run balance                     the worker profile, 6 days
//   npm run balance -- casual 4         a profile and a number of days
//   npm run balance -- all              every profile, side by side
//   npm run balance -- goals            worker and casual for 30 days: fails when
//                                       the action that completed a goal lost money
//
// Profiles:
//   newcomer  one long first session (60 min), watching closely
//   worker    a 30 min first session, then a 50/10 work rhythm from 9 to 17
//             with a look at the start of each break and again 8 min later
//   casual    a 15 min first session, then three looks a day, trading
//             only with buyers in the advisor's range and what Market
//             charts show
//
// After the warp drive the bot plays act 2 too: it keeps a scout surveying
// the nearest systems, trades and mines wherever routes pay best (jump fees
// included), and builds Heron freighters once a shipyard's faction trusts it.
//
// Ships: the bot builds the next ship while its points fit the fleet
// allowance, and researches the next Fleet licence once they don't. It plans
// one build at a time and has a hauler fetch the recipe. At the cap it
// salvages Kites into Herons once Herons are open and a sealed hold can
// carry their steel and glass.
// Run it for two weeks or so to see act 2: npm run balance -- worker 16
//
// In act 3 it investigates signals near its surveys, salvages derelicts,
// and, once Fleet command I is in, hires a commander (the trait that suits
// a kind of ship it has two free of) for each Fleet command level, sends
// ships to join the fleets once the command ship is built, and sends each
// fleet out, once every ship is aboard, for as long as a mission may last.
// --no-fleets plays act 3 by hand instead, to compare.
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
// Repeat to fill for every ship that has room is two clicks too: the Fleet
// panel, then its Repeat to fill.
//
// Starting from a save: act 3 takes weeks of game time, so a run can save
// the game when it reaches a goal and later runs can start from there:
//   npm run balance -- worker 16 --save-at=first-shielding:/tmp/act3.json
//   npm run balance -- worker 8 --from=/tmp/act3.json
// A run from a save starts the next morning, with no first session.
// --save-at=day5:/tmp/day5.json saves at the end of a day instead.
//
// Comparing hulls: --haulers=heron (or kite) turns every hauler in the save
// into Herons (or Kites) for the same points, and the bot then builds and
// salvages nothing. Two runs from one save give profit per point for each:
//   npm run balance -- worker 3 --from=/tmp/act3.json --haulers=heron

import { readFileSync, writeFileSync } from 'node:fs';
import { createGame } from '../../public/games/driftworks/core/state.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { HOUR, MINUTE, SECOND } from '../../public/games/driftworks/core/time.js';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { LICENCE_LINE, RESEARCH, SHIELDINGS } from '../../public/games/driftworks/content/research.js';
import { HULLS } from '../../public/games/driftworks/content/ships.js';
import { GOODS } from '../../public/games/driftworks/content/goods.js';
import { HOME_SYSTEM } from '../../public/games/driftworks/content/homeSystem.js';
import { allStations, allSystems, lanesFrom, systemOf, useGalaxy } from '../../public/games/driftworks/content/galaxy.js';
import { checkGoals } from '../../public/games/driftworks/systems/goals.js';
import { createShip, hullLock, missingLicence } from '../../public/games/driftworks/systems/fleet.js';
import {
  allowance,
  buildFee,
  freePoints,
  planBuild,
  pointsLock,
  pointsUsed,
  salvageLock,
  salvageShip,
  stillNeededAt,
  storeGoods,
} from '../../public/games/driftworks/systems/shipyard.js';
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
  canRunAgain,
  runAgain,
  clearQueue,
} from '../../public/games/driftworks/systems/orders.js';
import { freeLab, isResearched, orderSlots, researchCost, researchStatus, shieldingsDone, startResearch } from '../../public/games/driftworks/systems/research.js';
import { SHIELDED_DEPTH, isShielded } from '../../public/games/driftworks/systems/shielding.js';
import { bestTradeQty, farTrade, feesBack, salvageResale, saleValue, stationsInRange, tradePlan } from '../../public/games/driftworks/systems/advisor.js';
import { affordableQty, marketEntries, marketView, findEntry } from '../../public/games/driftworks/systems/market.js';
import { holdOf } from '../../public/games/driftworks/systems/modules.js';
import { canCarry, cargoTotal } from '../../public/games/driftworks/systems/cargo.js';
import { derelictLeft, foundSignals, isGateOpen, isInvestigated, workerAt } from '../../public/games/driftworks/systems/signals.js';
import { candidates, commanderLevel, commanders, commandersComing, fleetCommand, hireCommander, hireCost, joiningOf, mapShips, onMap, wingOf } from '../../public/games/driftworks/systems/commanders.js';
import { areaAround, joinFleet, startMission } from '../../public/games/driftworks/systems/missions.js';

const PROFILES = {
  newcomer: { firstSession: 60, checks: () => [] },
  worker: {
    firstSession: 30,
    // A look at the start of each break and one 8 minutes later, 9:50 to 16:50.
    checks: (day) => [...Array(8).keys()].flatMap((h) => [day + (9 + h) * HOUR + 50 * MINUTE, day + (9 + h) * HOUR + 58 * MINUTE]),
  },
  // A casual player trades by what the menus show: buyers in the advisor's range, plus Market charts.
  casual: { firstSession: 15, local: true, checks: (day) => [9, 13, 17].map((h) => day + h * HOUR) },
};

// Re-run a ship's last route unless a fresh one would earn this much more.
const RERUN_AT = 0.6;
// A trade must make at least this much to be worth a hauler's trip.
const MIN_TRADE = 20;
// The researches the act 1 tutorial asks for, in its order.
const TUTORIAL_RESEARCH = ['hold-1', 'brokerage', 'licence-1'];
const YARD = 'halcyon-shipyard';

/**
 * For comparing hulls: every hauler in a save becomes Herons or Kites
 * (`hull`) for the same points, with the same modules, at the first one's dock.
 */
function swapHaulers(state, hull) {
  const haulers = state.ships.filter((ship) => HULLS[ship.hull].role === 'hauler' && !ship.fleet);
  if (!haulers.length) throw new Error('No haulers in this save.');
  const points = Math.floor(haulers.reduce((sum, ship) => sum + HULLS[ship.hull].points, 0) / 2) * 2;
  const { modules } = haulers[0];
  const dock = haulers.find((ship) => ship.at)?.at ?? YARD;
  state.ships = state.ships.filter((ship) => !haulers.includes(ship));
  for (let i = 0; i < points / HULLS[hull].points; i += 1) createShip(state, hull, dock).modules = { ...modules };
}

function play(profileName, days, { from = null, saveAt = {}, fleets = true, haulers = null } = {}) {
  const profile = PROFILES[profileName];
  const DAY = 24 * HOUR;
  const state = from ? deserialize(readFileSync(from, 'utf8')) : createGame({ now: Date.UTC(2026, 10, 2, 9, 0, 0), seed: 20261106 });
  if (!state) throw new Error(`Could not load ${from}`);
  useGalaxy(state.seed);
  // --haulers=heron|kite: the fleet stays as it is, so the hulls compare like for like.
  if (haulers) swapHaulers(state, haulers);
  // A run from a save starts at 9:00 on the morning after it.
  const T0 = from ? Math.floor(state.now / DAY) * DAY + DAY + 9 * HOUR : state.now;
  const report = { profileName, days, from, fleets, session: [], buys: [], research: [], breaks: [], perDay: [], spans: [], goals: {}, idleAfter: [], tradeRates: [], surveys: [], contracts: [], missions: [], salvaged: [], actEnds: {}, pointHours: {} };
  for (const id of state.goals) report.goals[id] = -Infinity;
  report.startStats = structuredClone(state.stats);
  report.goalActions = {};
  const ledger = goalLedger(state, report.goalActions);
  let clicks = 0;
  // Clicks by what they were for, since the last look began.
  let kinds = {};

  const click = (n = 1, kind = 'other') => {
    // Repeat to fill for any number of ships is one press in the Fleet panel
    // (open it, press): two clicks a look, however many ships it fills.
    if (kind === 'repeat to fill') {
      n = kinds[kind] ? 0 : 2;
      if (!n) return;
    }
    clicks += n;
    kinds[kind] = (kinds[kind] ?? 0) + n;
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
    // Points held by each hull over time, run by hand or by a commander, for profit per point.
    const hours = Math.max(0, t - state.now) / HOUR;
    for (const ship of state.ships) {
      const row = (report.pointHours[ship.hull] ??= { hand: 0, fleet: 0 });
      row[ship.fleet || ship.commander ? 'fleet' : 'hand'] += HULLS[ship.hull].points * hours;
    }
    advance(state, t);
    ledger.digest();
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

  /**
   * Stations the player weighs from `placeId`: every known one, or for a
   * profile that reads the menus, those in the advisor's range plus the one
   * Market charts names for the good.
   */
  function weighed(placeId, good, side) {
    if (!profile.local || !placeId) return knownStations(state);
    const near = stationsInRange(state, placeId);
    if (!isResearched(state, 'market-charts') || !good) return near;
    let chart = null;
    for (const station of knownStations(state)) {
      if (findEntry(station.id, good)?.side !== side) continue;
      const price = marketView(state, station.id, good, state.now).price;
      if (!chart || (side === 'buys' ? price > chart.price : price < chart.price)) chart = { station, price };
    }
    return chart && !near.includes(chart.station) ? [...near, chart.station] : near;
  }

  /** The best place to sell `qty` of `good` from `placeId` (in one system, if given), among the stations weighed. */
  function bestBuyer(good, qty, now, placeId, systemId = null) {
    let best = null;
    for (const station of weighed(placeId, good, 'buys')) {
      if ((systemId && systemOf(station.id) !== systemId) || findEntry(station.id, good)?.side !== 'buys') continue;
      const sale = saleValue(state, station.id, good, qty, now);
      if (sale.qty > 0 && (!best || sale.total > best.sale.total)) best = { stationId: station.id, sale };
    }
    return best;
  }

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
      const buyers = [bestBuyer(field.good, amount, now, field.id, systemOf(field.id)), bestBuyer(field.good, amount, now, field.id)].filter(Boolean);
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
  function bestTrade(ship, now, homeOnly = false, minTier = 0) {
    let best = null;
    const stations = homeOnly ? HOME_SYSTEM.stations : knownStations(state);
    const room = holdOf(ship) - cargoTotal(ship);
    // A player reading the menus starts from stations in range of the ship.
    const starts = profile.local && !homeOnly ? stationsInRange(state, ship.at) : stations;
    // Goods other haulers already go to buy somewhere: a player spreads them out
    // rather than sending two after the same stock.
    const taken = new Set(
      state.ships
        .filter((s) => s !== ship && role(s) === 'hauler')
        .flatMap((s) => [s.order?.spec, ...s.queue].filter((spec) => spec?.type === 'buy').map((spec) => `${spec.stationId}|${spec.good}`)),
    );
    for (const from of starts) {
      const start = ship.at === from.id ? { ok: true, time: 0, fees: 0 } : plotCourse(state, ship, ship.at, from.id);
      if (!start.ok) continue;
      for (const entry of marketEntries(from.id)) {
        if (entry.side !== 'sells' || !canCarry(ship, entry.good) || GOODS[entry.good].tier < minTier || taken.has(`${from.id}|${entry.good}`)) continue;
        const max = affordableQty(state, from.id, entry.good, cash() * 0.8, room, now);
        if (max <= 0) continue;
        const cost = marketView(state, from.id, entry.good, now).price;
        for (const to of homeOnly ? stations : weighed(from.id, entry.good, 'buys')) {
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
    const ships = mapShips(state).filter((ship) => role(ship) === (ore ? 'miner' : 'hauler') && (active || !ship.order));
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
      const ships = mapShips(state).filter((ship) => role(ship) === (ore ? 'miner' : 'hauler'));
      const ship = ships.find((s) => !s.order) ?? ships[0];
      if (!ship) continue;
      const rate = ore ? contractRound(ship, contract, offer.qty)?.rate : supplyRun(ship, now, contract, offer.qty)?.rate;
      const otherwise = ore ? bestMiningRound(ship, now)?.rate : bestTrade(ship, now)?.rate;
      // The first contract is the tutorial's: taken as soon as it shows.
      if (!tutorial && !(rate > (otherwise ?? 0))) continue;
      if (acceptContract(state, offer.id, now).ok) {
        click(2, 'contracts');
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

  /** Hands cargo to a contract or a planned build that wants it, or sells it where it pays best. */
  function unload(ship, now) {
    const yard = plannedYard();
    if (yard && Object.keys(storeGoods(state, yard, ship.cargo)).length && giveOrder(state, ship, { type: 'store', stationId: yard }).ok) click(1, 'unload');
    for (const good of Object.keys(ship.cargo)) {
      if (yard && stillNeededAt(state, yard, good) > 0) continue;
      const contract = running(now).find((c) => c.good === good && openNeed(c) >= 1);
      if (contract && giveOrder(state, ship, { type: 'deliver', stationId: contract.stationId, good }).ok) {
        click(1, 'unload');
        continue;
      }
      const buyer = bestBuyer(good, ship.cargo[good], now, ship.at ?? ship.order?.target);
      if (buyer && giveOrder(state, ship, { type: 'sell', stationId: buyer.stationId, good }).ok) click(1, 'unload');
    }
  }

  // ---------- Building ----------

  /** The yard with a planned build waiting for goods, or null. */
  const plannedYard = () => (state.builds ?? []).find((b) => b.status === 'planned')?.stationId ?? null;

  /** Tonnes of `good` a yard's plans still need after what ships already bring. */
  function buildNeed(yard, good) {
    const lined = state.ships.reduce((sum, ship) => sum + (projectShip(state, ship).stored[`${yard}:${good}`] ?? 0), 0);
    return stillNeededAt(state, yard, good) - lined;
  }

  /**
   * A buy-and-deliver run for a planned build: the first good its recipe
   * still lacks, from the nearest station selling it. { from, good, qty,
   * yard }, or null.
   */
  function buildRun(ship, now) {
    const yard = plannedYard();
    if (!yard) return null;
    const build = state.builds.find((b) => b.status === 'planned');
    const room = holdOf(ship) - cargoTotal(ship);
    for (const good of Object.keys(HULLS[build.hull].recipe)) {
      const need = Math.min(buildNeed(yard, good), room);
      if (need < 1 || !canCarry(ship, good)) continue;
      let best = null;
      for (const from of knownStations(state)) {
        if (findEntry(from.id, good)?.side !== 'sells') continue;
        const qty = affordableQty(state, from.id, good, cash() * 0.8, need, now);
        if (qty < 1) continue;
        const start = ship.at === from.id ? { ok: true, time: 0 } : plotCourse(state, ship, ship.at, from.id);
        const there = plotCourse(state, ship, from.id, yard);
        if (!start.ok || !there.ok) continue;
        const time = start.time + there.time;
        if (!best || time < best.time) best = { from: from.id, good, qty, yard, time };
      }
      if (best) return best;
    }
    return null;
  }

  /** Whether a hauler can carry a Heron's steel and glass. */
  const sealedHauler = () => state.ships.some((s) => role(s) === 'hauler' && canCarry(s, 'steel'));

  /** Which hull to build next: a scout while short of them, a hauler while short of those, else a Mule. */
  function nextHull() {
    const mules = state.ships.filter((s) => s.hull === 'mule').length;
    const haulers = state.ships.filter((s) => role(s) === 'hauler').length;
    const wantHaulers = (mules >= 2 ? 1 : 0) + (mules >= 5 ? 1 : 0) + (mules >= 9 ? 1 : 0) + (canJump(state) ? Math.floor(mules / 2) : 0);
    const scouts = state.ships.filter((s) => role(s) === 'scout').length + (state.builds ?? []).filter((b) => b.hull === 'lark').length;
    const hauler = !hullLock(state, 'heron', YARD) && sealedHauler() ? 'heron' : 'kite';
    // One scout in act 2; three once shielding opens the deep galaxy.
    const wantScouts = shieldingsDone(state) > 0 ? 3 : 1;
    if (!missingLicence(state, 'lark') && scouts < wantScouts) return 'lark';
    return haulers < wantHaulers ? hauler : 'mule';
  }

  /** Points kept free for a commander's Osprey, one per Fleet command level. */
  function commandReserve() {
    if (!fleets || !fleetCommand(state)) return 0;
    const levels = ['fleet-1', 'fleet-2', 'fleet-3'].filter((id) => state.research.done.includes(id)).length;
    return commanders(state).length + commandersComing(state).length < levels ? HULLS.osprey.points : 0;
  }

  // Kites on their way to the yard to be salvaged for a Heron's points.
  const retiring = new Set();

  /** At the cap with Herons open: salvage idle Kites at the yard, and send more there. */
  function retireKites(now) {
    for (const ship of state.ships) {
      if (!retiring.has(ship.id) || ship.order) continue;
      if (ship.at !== YARD) {
        if (giveOrder(state, ship, { type: 'fly', stationId: YARD }).ok) click(2, 'salvage ships');
        continue;
      }
      if (cargoTotal(ship) > 0) continue;
      if (!salvageLock(state, ship) && salvageShip(state, ship.id, now).ok) {
        click(3, 'salvage ships');
        retiring.delete(ship.id);
        report.salvaged.push({ at: now, hull: ship.hull });
      }
    }
    // Two Kites make room for a Heron, once Herons are open and the licences are the limit.
    if (retiring.size || hullLock(state, 'heron', YARD) || !sealedHauler() || freePoints(state) - commandReserve() >= HULLS.heron.points) return;
    if (!LICENCE_LINE.every((l) => state.research.done.includes(l.id)) && !canJump(state)) return;
    const kites = state.ships.filter((s) => s.hull === 'kite' && !s.fleet && !s.commander);
    const herons = state.ships.filter((s) => s.hull === 'heron').length;
    if (kites.length < 2 || herons >= kites.length) return;
    for (const kite of kites.slice(0, 2)) retiring.add(kite.id);
  }

  /** Plans one build at a time while points fit, for a hauler to fetch its recipe. */
  function buildShips(now) {
    const hull = nextHull();
    if (plannedYard() || freePoints(state) - commandReserve() < HULLS[hull].points || hullLock(state, hull, YARD)) return;
    const next = nextResearch();
    const fee = buildFee(state, hull, YARD);
    const goods = Object.entries(HULLS[hull].recipe).reduce((sum, [good, qty]) => sum + qty * GOODS[good].value, 0);
    const forResearch = !freeLab(state) || !next || state.ships.length < 3 ? 0 : goingForWarp() ? costOf(next) : Math.min(costOf(next), fee + goods);
    // Saves up for the first commander once Fleet command I is in.
    const reserve = forResearch + (commandReserve() ? hireCost(state, YARD).total : 0);
    if (cash() < fee + reserve) return;
    const planned = planBuild(state, hull, YARD, now);
    if (!planned.ok) return;
    click(2, 'build');
    report.buys.push({ at: now, n: state.ships.length + state.builds.length, hull });
  }

  // ---------- Scouts ----------

  /** The nearest found signal of interest a ship can reach: { signal, time }. */
  function nearestSignal(ship, wanted) {
    let best = null;
    for (const signal of foundSignals(state)) {
      if (!wanted(signal)) continue;
      const course = plotCourse(state, ship, ship.at, signal.id);
      if (course.ok && (!best || course.time < best.time)) best = { signal, time: course.time };
    }
    return best;
  }

  /** Sends an idle scout to survey the nearest system it can, or to investigate a signal on the way. */
  function keepSurveying(scout) {
    if (scout.order || !scout.at) return;
    let best = null;
    for (const system of allSystems()) {
      if (!surveyable(state, system.id) || surveyorOf(state, system.id)) continue;
      const course = plotCourse(state, scout, scout.at, system.gates[0]?.id, { surveyTarget: system.id });
      if (course.ok && (!best || course.time < best.time)) best = { id: system.id, time: course.time };
    }
    // A player looks into a signal that is not much further than the next survey.
    const signal = nearestSignal(scout, (s) => !isInvestigated(state, s) && !workerAt(state, s.id, 'investigate'));
    if (signal && (!best || signal.time <= best.time + HOUR)) {
      if (giveOrder(state, scout, { type: 'investigate', signalId: signal.signal.id }).ok) {
        click(1, 'scouts');
        ledger.elsewhere(scout);
      }
      return;
    }
    if (best && giveOrder(state, scout, { type: 'survey', systemId: best.id }).ok) {
      click(1, 'scouts');
      ledger.surveyBy(best.id, scout);
    }
  }

  /** Sends a hauler with a sealed hold to the nearest derelict nobody is salvaging. Returns whether it went. */
  function salvage(ship) {
    if (holdOf(ship) - cargoTotal(ship) < 1) return false;
    // The salvage order's note gives the best sale after the jump fees both ways: a player goes when it pays.
    const pays = (s) => {
      const qty = Math.min(holdOf(ship) - cargoTotal(ship), derelictLeft(state, s));
      const out = plotCourse(state, ship, ship.at, s.id);
      return out.ok && (salvageResale(state, ship, s, qty, out.fees)?.profit ?? 0) > 0;
    };
    const wreck = nearestSignal(ship, (s) => s.kind === 'derelict' && derelictLeft(state, s) > 0 && canCarry(ship, s.good) && !workerAt(state, s.id, 'salvage') && pays(s));
    if (!wreck || wreck.time > 3 * HOUR) return false;
    if (!giveOrder(state, ship, { type: 'salvage', signalId: wreck.signal.id }).ok) return false;
    click(1, 'derelicts');
    return true;
  }

  // ---------- Fleets ----------

  // The traits the bot looks for in a commander for each kind of wing, best first.
  const WANTED_TRAITS = { miner: ['prospector', 'thrifty', 'cautious'], hauler: ['thrifty', 'greedy', 'cautious'], scout: ['curious'] };
  const MISSION_FOR = { miner: 'mine', hauler: 'trade', scout: 'survey' };
  // Ships aboard a fleet, or on their way to one, are the commanders' to run.
  const joining = () => new Set(commanders(state).flatMap((c) => joiningOf(state, c)));
  const freeShips = (r) => {
    const coming = joining();
    return state.ships.filter((s) => role(s) === r && onMap(s) && !coming.has(s));
  };
  // The kind of ship each new commander was hired for, by name.
  const wanted = new Map();
  /** The kind of ship a commander leads: its wing's, what it was hired for, or what its trait suits. */
  function wingRole(commander) {
    const wing = wingOf(state, commander);
    if (wing.length) return role(wing[0]);
    if (wanted.has(commander.name)) return wanted.get(commander.name);
    const trait = commander.commander.traits[0];
    return Object.keys(WANTED_TRAITS).find((r) => WANTED_TRAITS[r][0] === trait) ?? 'hauler';
  }
  /** Where a wing works best: where its lead ship's best job is, or for scouts where most is left to survey. */
  function missionCenter(commander, r) {
    // The wing sets out from where the command ship docks.
    const lead = { ...wingOf(state, commander)[0], at: commander.at };
    const command = fleetCommand(state);
    if (r === 'miner') {
      const round = bestMiningRound(lead, state.now);
      if (round) return systemOf(round.fieldId);
    } else if (r === 'hauler') {
      const trade = bestTrade(lead, state.now);
      if (trade) return systemOf(trade.from);
    } else {
      let best = null;
      for (const system of allSystems()) {
        if (!isSurveyed(state, system.id) || !isShielded(state, system)) continue;
        const open = areaAround(state, system.id, command.reach).filter((id) => surveyable(state, id)).length;
        if (open && (!best || open > best.open || (open === best.open && system.depth < best.depth))) best = { id: system.id, open, depth: system.depth };
      }
      if (best) return best.id;
    }
    return systemOf(lead.at ?? lead.order?.target) ?? HOME_SYSTEM.id;
  }
  /** Sends a ship to join a commander, dropping the rest of its queue so it goes after its current order. */
  function enlist(ship, commander, now) {
    if (ship.queue.length && clearQueue(state, ship).ok) click(1, 'fleets');
    if (joinFleet(state, ship, commander, now).ok) click(1, 'fleets');
  }
  /** Hires a commander for every two free ships of a kind, fills wings, and sends idle fleets out for as long as they may go. */
  function manageFleets(now) {
    const command = fleetCommand(state);
    if (!fleets || !command) return;
    const next = nextResearch();
    const price = hireCost(state, YARD).total;
    // The first commander comes before anything else; later ones leave money for research, as ships do.
    const reserve = commanders(state).length && freeLab(state) && next ? Math.min(costOf(next), price) : 0;
    for (const r of ['miner', 'hauler', 'scout']) {
      // A commander away on a mission takes no ships until it is back, so only one at hand counts as room.
      const room = (c) => !c.mission && wingOf(state, c).length + joiningOf(state, c).length < command.wing;
      if (freeShips(r).length < 2 || commanders(state).some((c) => wingRole(c) === r && room(c))) continue;
      // One commander at a time: the next waits until the last one's Osprey is built.
      if (commandersComing(state).length || pointsLock(state, 'osprey')) continue;
      if (cash() < price + reserve) continue;
      const rank = (c) => {
        const i = WANTED_TRAITS[r].indexOf(c.traits[0]);
        return i < 0 ? 99 : i;
      };
      const pick = [...candidates(state)].sort((a, b) => rank(a) - rank(b))[0];
      const hired = hireCommander(state, pick.id, YARD, now);
      if (!hired.ok) continue;
      click(2, 'fleets');
      report.missions.push({ hired: true, at: now, trait: pick.traits[0], role: r });
      // The wing joins once the Osprey is built.
      wanted.set(hired.build.name, r);
    }
    for (const c of commanders(state)) {
      if (c.mission) continue;
      const r = wingRole(c);
      for (const ship of freeShips(r).slice(0, command.wing - wingOf(state, c).length - joiningOf(state, c).length)) enlist(ship, c, now);
    }
    for (const c of commanders(state)) {
      // A fleet sets out once every ship on its way is aboard.
      if (c.mission || !wingOf(state, c).length || joiningOf(state, c).length || c.order) continue;
      const r = wingRole(c);
      const started = startMission(state, c, { kind: MISSION_FOR[r], center: missionCenter(c, r), hours: missionHours(command, now) }, now);
      if (started.ok) click(3, 'fleets');
    }
  }
  /** The bot's next look after `at`. */
  function nextLook(at) {
    const day = Math.floor((at - (T0 - 9 * HOUR)) / DAY);
    for (const d of [day, day + 1, day + 2]) {
      const next = profile.checks(T0 - 9 * HOUR + d * DAY).find((c) => c > at);
      if (next != null) return next;
    }
    return at + DAY;
  }
  /**
   * The mission length a player would pick: the one that keeps the wing at
   * work for the largest share of the time until the look after it is back
   * (an hour to come home), the longer one on a tie.
   */
  function missionHours(command, now) {
    let best = null;
    for (const hours of command.hours) {
      const share = hours / ((nextLook(now + (hours + 1) * HOUR) - now) / HOUR);
      if (!best || share >= best.share - 0.02) best = { hours, share };
    }
    return best.hours;
  }
  /** Mission reports that came in since the last look. */
  const seenReports = new Set();
  function collectReports() {
    for (const c of commanders(state)) {
      const r = c.commander.report;
      if (!r || seenReports.has(r.at + c.id)) continue;
      seenReports.add(r.at + c.id);
      report.missions.push({ at: r.at, name: c.name, trait: c.commander.traits[0], level: commanderLevel(c), kind: r.kind, ships: r.ships, hours: r.time / HOUR, credits: r.credits, fees: r.fees });
    }
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

  // Goals that need a research, such as the one that ends each act: the bot saves for it once it is the goal.
  const byId = (id) => () => RESEARCH.find((r) => r.id === id);
  const ACT_ENDS = {
    'warp-drive': byId('warp-drive'),
    'sell-processed': byId('sealed-holds'),
    'first-shielding': bestShielding,
    'first-commander': () => (fleets ? byId('fleet-1')() : null),
    'station-blueprints': byId('station-blueprints'),
  };
  const currentGoalId = () => GOALS.find((g) => !state.goals.includes(g.id))?.id;
  const actEnd = () => {
    const research = ACT_ENDS[currentGoalId()]?.();
    return research && researchStatus(state, research) === 'open' ? research : null;
  };
  const goingForWarp = () => Boolean(actEnd());
  const costOf = (research) => researchCost(state, research);

  /**
   * Research in the list's order, but the act's last one first once it is
   * the goal. Market charts, Trade
   * desk and Trade network only change what the menus show: only a profile
   * that trades by the menus takes them.
   * Of the hazard shieldings it takes the one that opens the most systems.
   */
  function nextResearch() {
    // In the tutorial, the researches its guide asks for, in its order.
    const guided = TUTORIAL_RESEARCH.map((id) => RESEARCH.find((r) => r.id === id)).find((r) => researchStatus(state, r) === 'open');
    if (guided && GOALS.some((g) => g.tutorial && !g.act && !state.goals.includes(g.id))) return guided;
    // With fleets: Fleet command I as soon as the first shielding opens it.
    const command = RESEARCH.find((r) => r.id === 'fleet-1');
    if (fleets && researchStatus(state, command) === 'open') return command;
    // The next Fleet licence once the fleet fills its allowance, in place of buying ships.
    const licence = LICENCE_LINE.find((r) => researchStatus(state, r) === 'open');
    const atCap = freePoints(state) - commandReserve() < HULLS[nextHull()].points;
    // Market charts and the trade research only change what the menus show; only a profile that reads them wants them.
    const menusOnly = (r) => ['market-charts', 'trade-desk', 'trade-network'].includes(r.id) && !profile.local;
    // At the cap, the licence or the next other research, whichever costs less, the way a ship purchase used to wait its turn.
    const other = RESEARCH.find((r) => !menusOnly(r) && r.line !== 'licence' && researchStatus(state, r) === 'open');
    const next = actEnd() ?? (licence && atCap && (!other || costOf(licence) <= costOf(other)) ? licence : null) ?? other;
    return next?.hazard ? bestShielding() : next;
  }

  // ---------- One look at the game ----------

  let lastDay = null;
  let freshDay = false;
  function check(now, active) {
    step(now);
    const before = clicks;
    kinds = {};
    const today = Math.floor(now / (24 * HOUR));
    freshDay = today !== lastDay;
    lastDay = today;

    // Research: the lab never waits if the next project is affordable.
    // Once the warp drive is the current goal, the bot saves for it.
    while (freeLab(state)) {
      const next = nextResearch();
      if (!next || cash() < costOf(next) || !startResearch(state, next.id, now).ok) break;
      click(1, 'research');
      report.research.push({ id: next.id, at: now });
    }

    if (boardOpen(state)) takeContracts(now, active);

    // Ships: build while points fit, and make room for Herons.
    if (!haulers) {
      retireKites(now);
      buildShips(now);
    }

    // Refits: book them all once the money is there twice over.
    const behind = mapShips(state).filter((s) => refitOffer(state, s));
    const refitCost = behind.reduce((sum, s) => sum + refitOffer(state, s).cost, 0);
    if (behind.length && cash() >= refitCost * 2 && refitAll(state).ok) click(1, 'refits');

    collectReports();
    manageFleets(now);

    // Idle ships: run the last route again (one click for all), or plan anew.
    const rerun = [];
    const coming = joining();
    for (const ship of mapShips(state)) {
      if (role(ship) === 'command' || coming.has(ship)) continue;
      if (role(ship) === 'scout') {
        keepSurveying(ship);
        continue;
      }
      // A ship just booked for a refit gets its next orders queued after it.
      const refitting = ship.order?.type === 'refit' && !ship.queue.length;
      if (ship.order && !refitting) continue;
      if (retiring.has(ship.id)) continue;
      // A new ship copies a sister ship's orders when one has a plan.
      if (!ship.plan.length && !refitting && role(ship) === 'miner') {
        const source = state.ships.find((s) => canCopy(state, s, ship));
        if (source && copyOrders(state, ship, source).ok) {
          click(1, 'copy orders');
          continue;
        }
      }
      if (!refitting && ship.plan.length && keepPlan(ship, now)) {
        rerun.push(ship);
        continue;
      }
      planAnew(ship, now, active);
    }
    if (rerun.length) {
      for (const ship of rerun) runAgain(state, ship);
      click(2, 'run again');
    }
    // Between work blocks, fill every queue that has room for more rounds.
    if (!active) {
      for (const ship of mapShips(state)) {
        if (role(ship) !== 'scout' && role(ship) !== 'command' && !coming.has(ship) && ship.plan.length && roomForRounds(state, ship) > 0 && repeatToFill(state, ship).ok) click(1, 'repeat to fill');
      }
    }

    checkGoals(state, now);
    for (const id of state.goals) {
      if (report.goals[id] == null && ['warp-drive', 'first-shielding', 'station-blueprints'].includes(id)) {
        report.actEnds[id] = { at: now, credits: Math.round(state.credits), spend: { ...state.stats.shipSpend }, points: pointsUsed(state), allowance: allowance(state), ships: state.ships.length };
        // Act 3 by itself, for profit per point with fleets against the same hulls by hand.
        if (id === 'first-shielding') report.act3 = { pointHours: structuredClone(report.pointHours), shipCash: structuredClone(state.stats.shipCash ?? {}) };
      }
      report.goals[id] ??= now;
      if (saveAt[id]) {
        writeFileSync(saveAt[id], serialize(state));
        delete saveAt[id];
      }
    }
    return clicks - before;
  }

  function keepPlan(ship, now) {
    // Run again is greyed out when the plan's first order cannot start.
    if (!canRunAgain(state, ship)) return false;
    // Once a day the bot looks for a better route for each hauler.
    if (role(ship) === 'hauler' && freshDay) return false;
    // A contract run goes on while its contract still needs more.
    const delivery = ship.plan.find((s) => s.type === 'deliver');
    if (delivery) {
      const contract = contractFor(state, delivery.stationId, delivery.good, now);
      return Boolean(contract) && openNeed(contract) >= 1 && cargoTotal(ship) === 0;
    }
    // A contract that pays better than the round comes first, and a planned build's recipe before that.
    if (role(ship) === 'hauler' && (retiring.has(ship.id) || ship.plan.some((s) => s.type === 'store') || plannedYard())) return false;
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
        click(given.given ?? 0, 'plan miners');
        if (active) return;
        // Between work blocks: as many rounds as the contract needs, then market rounds after them.
        if (roomForRounds(state, ship) > 0 && repeatToFill(state, ship).ok) click(1, 'repeat to fill');
        const after = bestMiningRound(ship, now);
        let more = 0;
        while (after && freeSlots(state, ship) >= 2 && giveOrders(state, ship, [{ type: 'mine', fieldId: after.fieldId, amount: null }, { type: 'sell', stationId: after.stationId }]).given === 2) more += 1;
        if (more) click(more > 1 ? 3 : 2, 'plan miners');
        return;
      } else {
        if (!round) return;
        const given = giveOrders(state, ship, [
          { type: 'mine', fieldId: round.fieldId, amount: null },
          { type: 'sell', stationId: round.stationId },
        ]);
        click(given.given ?? 0, 'plan miners');
      }
    } else {
      if (retiring.has(ship.id)) return;
      // A planned build's recipe comes first, then a derelict, then trade.
      const run = cargoTotal(ship) === 0 ? buildRun(ship, now) : null;
      if (run) {
        const given = giveOrders(state, ship, [
          { type: 'buy', stationId: run.from, good: run.good, qty: run.qty },
          { type: 'store', stationId: run.yard },
        ]);
        if (given.given) click(given.given, 'plan haulers');
        return;
      }
      if (cargoTotal(ship) === 0 && salvage(ship)) return;
      // "Sell goods in another system": a player follows the guide's trade
      // (select the hauler, Buy at the station, then pick the buyer on the
      // galaxy map and Sell), once.
      if (currentGoalId() === 'far-sale' && cargoTotal(ship) === 0 && !state.ships.some((s) => [s.order?.spec, ...s.queue].some((spec) => spec?.type === 'sell' && systemOf(spec.stationId) !== HOME_SYSTEM.id))) {
        const guided = farTrade(state, ship, now);
        if (guided && guided.profit > 0) {
          const given = giveOrders(state, ship, [
            { type: 'buy', stationId: guided.fromId, good: guided.good, qty: guided.qty },
            { type: 'sell', stationId: guided.destId, good: guided.good },
          ]);
          if (given.ok) {
            click(5, 'plan haulers');
            return;
          }
        }
      }
      // A player after "Sell steel or glass" (or a tier 4 good) sends a hauler on such a run, even if another route pays more.
      const goalTier = { 'sell-processed': 3, 'sell-component': 4 }[currentGoalId()];
      const forGoal = goalTier && canCarry(ship, goalTier === 3 ? 'steel' : 'circuits') ? bestTrade(ship, now, false, goalTier) : null;
      const trade = forGoal ?? bestTrade(ship, now);
      const supply = forGoal ? null : bestSupply(ship, now);
      if (supply && supply.rate > (trade?.rate ?? 0)) {
        const given = giveOrders(state, ship, [
          { type: 'buy', stationId: supply.from, good: supply.contract.good, qty: supply.qty },
          { type: 'deliver', stationId: supply.contract.stationId, good: supply.contract.good },
        ]);
        // Like a Bring, both orders come from one menu pick.
        if (given.ok) click(supply.from === ship.at ? 1 : 2, 'plan haulers');
        if (!active && roomForRounds(state, ship) > 0 && repeatToFill(state, ship).ok) click(1, 'repeat to fill');
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
      if (given.ok) click(trade.from === ship.at ? 1 : 2, 'plan haulers');
    }
    if (!active && roomForRounds(state, ship) > 0 && repeatToFill(state, ship).ok) click(1, 'repeat to fill');
  }

  // ---------- The schedule ----------

  const STEP = 20 * SECOND;
  let t = from ? state.now : T0;
  for (; !from && t < T0 + profile.firstSession * MINUTE; t += STEP) {
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
      const act = state.goals.includes('first-shielding') ? 3 : state.goals.includes('warp-drive') ? 2 : 1;
      const n = check(at, false);
      report.breaks.push({ day: day + 1, clicks: n, act, kinds, ships: mapShips(state).length });
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
    // --save-at=day5:path saves at the end of day 5.
    if (saveAt[`day${day + 1}`]) writeFileSync(saveAt[`day${day + 1}`], serialize(state));
    report.perDay.push({
      day: day + 1,
      earned: Math.round(state.stats.earned - earnedBefore),
      ships: state.ships.length,
      points: `${pointsUsed(state)}/${allowance(state)}`,
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

// ---------- What each goal's completing action made ----------

/**
 * Watches the company log for the action that completed each goal (the
 * entry just before "Goal complete", at the same moment) and works out what
 * that action made:
 *   sale      the sale, less what the goods cost and the jump fees the ship
 *             paid since its last sale, and the fees back to where it set
 *             out from when it sold in another system
 *   contract  the reward, less the goods and fees of the ship that brought
 *             the last tonnes
 *   survey    the chart pay, less the fees the scout paid on its way
 *   mission   what the mission brought in, fees paid (its captain's log)
 * A buy, a salvage or anything else a ship did is settled at that ship's
 * next sale. Research, builds and the like are investments, not trades:
 * they are listed without a figure. Each `actions[goal]` is
 * { kind, net, by, at }.
 */
// Goals a trade, a survey, a salvage or a mission completes. The rest are
// research, ships, standing totals and the like: money spent, not made.
const ACTION_GOALS = ['first-sale', 'carry-goods', 'first-contract', 'first-survey', 'far-sale', 'survey-5', 'friendly-2', 'sell-processed', 'hazard-survey', 'first-mission', 'sell-component', 'first-salvage', 'survey-100'];

function goalLedger(state, actions) {
  const tapped = [];
  // The game keeps the last 200 log entries; a copy of every push keeps them all.
  class TapLog extends Array {
    push(...items) {
      tapped.push(...items);
      return super.push(...items);
    }
  }
  state.log = TapLog.from(state.log);
  const stationByName = new Map(allStations().map((s) => [s.name, s.id]));
  const titles = new Map(GOALS.map((g) => [g.title, g.id]));
  // Per ship (by name): fees and buys since its last sale, and where that was.
  const books = new Map();
  const book = (name) => {
    if (!books.has(name)) books.set(name, { fees: 0, buys: 0, base: YARD });
    return books.get(name);
  };
  const pending = new Map();
  const surveyors = new Map();
  // What each scout's last order was: only a survey's jumps count toward it.
  const purpose = new Map();
  // Surveys since the last goal: survey-5 and survey-100 count all of theirs.
  let surveyRun = { net: 0, n: 0 };
  let done = 0;

  const ownerOf = (text) => state.ships.map((s) => s.name).sort((a, b) => b.length - a.length).find((name) => text.startsWith(`${name} `) || text.startsWith(`${name},`)) ?? null;
  const stationIn = (text) => {
    const m = text.match(/ at (.+?): [+−]/) ?? text.match(/ for (.+?): \+/);
    return m ? stationByName.get(m[1]) ?? null : null;
  };
  const settle = (name, gross, stationId) => {
    const b = book(name);
    const ship = state.ships.find((s) => s.name === name);
    const back = ship && stationId ? feesBack(state, ship, stationId, b.base) : 0;
    const net = gross + b.fees - back;
    for (const goal of pending.get(name) ?? []) actions[goal] = { ...actions[goal], net, back };
    pending.delete(name);
    books.set(name, { fees: 0, buys: 0, base: stationId ?? b.base });
    return { net, back };
  };

  function record(goal, entry, at) {
    if (!entry) {
      actions[goal] = { kind: 'other', net: null, at };
      return;
    }
    const owner = ownerOf(entry.text);
    if (entry.text.startsWith('Survey done:')) {
      const count = goal === 'survey-5' || goal === 'survey-100';
      actions[goal] = count
        ? { kind: `${surveyRun.n} surveys`, net: surveyRun.net, by: 'scouts', at }
        : { kind: 'survey', net: entry.net ?? null, by: entry.by ?? 'a fleet', at };
    } else if (entry.text.startsWith('Contract complete:')) {
      actions[goal] = { kind: 'contract', net: entry.lastNet ?? entry.amount, by: entry.by, at };
    } else if (owner && entry.kind === 'sale') {
      actions[goal] = { kind: 'sale', net: entry.net, back: entry.back, by: owner, at };
    } else if (owner && entry.text.includes(' mission around ')) {
      actions[goal] = { kind: 'mission', net: null, by: owner, at };
      pending.set(owner, [...(pending.get(owner) ?? []), goal]);
    } else if (owner && entry.amount != null && entry.kind !== 'trade' && entry.kind !== 'purchase') {
      actions[goal] = { kind: 'other', net: null, by: owner, at };
    } else if (owner) {
      // Settled at the ship's next sale.
      actions[goal] = { kind: 'trip', net: null, by: owner, at };
      pending.set(owner, [...(pending.get(owner) ?? []), goal]);
    } else {
      actions[goal] = { kind: 'other', net: null, at };
    }
  }

  return {
    surveyBy(systemId, scout) {
      surveyors.set(allSystems().find((s) => s.id === systemId)?.name, scout.name);
      purpose.set(scout.name, 'survey');
    },
    /** A scout sent on something other than a survey: its jumps don't count toward the next survey. */
    elsewhere(scout) {
      purpose.set(scout.name, 'other');
    },
    digest() {
      for (; done < tapped.length; done += 1) {
        const entry = tapped[done];
        const owner = ownerOf(entry.text);
        if (entry.text.startsWith('Goal complete: ')) {
          const goal = titles.get(entry.text.slice(15).replace(/ \(\+.*\)$/, ''));
          // A goal right after another one at the same moment was met before it was the goal: nothing pushed it.
          const chained = tapped[done - 1]?.at === entry.at && tapped[done - 1].text.startsWith('Goal complete: ');
          let k = done - 1;
          while (k >= 0 && tapped[k].at === entry.at && / reached level /.test(tapped[k].text)) k -= 1;
          if (ACTION_GOALS.includes(goal)) {
            if (chained) actions[goal] = { kind: 'earlier', net: null, at: entry.at };
            else record(goal, k >= 0 && tapped[k].at === entry.at ? tapped[k] : null, entry.at);
          }
          surveyRun = { net: 0, n: 0 };
          continue;
        }
        if (entry.text.startsWith('Survey done:')) {
          // The chart pay, less the fees the scout paid on its way there.
          const scout = surveyors.get(entry.text.slice(13).split('.')[0]);
          if (scout) {
            entry.by = scout;
            entry.net = (entry.amount ?? 0) + book(scout).fees;
            books.set(scout, { ...book(scout), fees: 0 });
            surveyRun = { net: surveyRun.net + entry.net, n: surveyRun.n + 1 };
          }
          continue;
        }
        if (owner && entry.kind === 'purchase' && / paid .* to jump to /.test(entry.text)) {
          if (purpose.get(owner) !== 'other') book(owner).fees += entry.amount;
        }
        else if (owner && entry.kind === 'trade') book(owner).buys += entry.amount;
        else if (owner && entry.kind === 'sale') {
          // A hauler's sale says its profit over what the goods cost; a miner's ore cost nothing.
          const profit = Number((entry.text.match(/profit ([−-]?[\d,.]+) cr/)?.[1] ?? '').replace(/,/g, '').replace('−', '-'));
          const gross = Number.isFinite(profit) && /profit/.test(entry.text) ? profit : entry.amount;
          Object.assign(entry, settle(owner, gross, stationIn(entry.text)));
        } else if (owner && entry.kind === 'fleet') {
          // A captain's log: what the mission brought in, fees paid.
          for (const goal of pending.get(owner) ?? []) actions[goal] = { ...actions[goal], net: entry.amount ?? 0 };
          pending.delete(owner);
        } else if (owner && / delivered .* to /.test(entry.text)) {
          const next = tapped[done + 1];
          if (next?.text.startsWith('Contract complete:') && next.at === entry.at) {
            // The reward, less the goods this ship bought for it and its fees.
            const b = book(owner);
            next.by = owner;
            Object.assign(next, settle(owner, next.amount + b.buys, stationIn(next.text)));
            next.lastNet = next.net;
          }
        }
      }
    },
  };
}

// ---------- Printing ----------

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

function clock(report, at) {
  const m = Math.round((at - report.T0) / MINUTE);
  const d = Math.floor((m + 9 * 60) / 1440);
  const minutesOfDay = (m + 9 * 60) % 1440;
  return `${d ? `day ${d + 1} ` : ''}${String(Math.floor(minutesOfDay / 60)).padStart(2, '0')}:${String(minutesOfDay % 60).padStart(2, '0')}`;
}

/**
 * Credits each hull brought in per point it held, per hour, by hand and in
 * fleets, and the fleets against hand play: the wings' earnings over their
 * points, with and without the command ships' points (Fleet command adds
 * allowance for those).
 */
function printPerPoint(label, pointHours, start, cash) {
  const earned = (hull, mode) => (cash[hull]?.[mode] ?? 0) - (start[hull]?.[mode] ?? 0);
  const rows = Object.entries(pointHours).map(([hull, hours]) => {
    const rate = (mode) => (hours[mode] > 1 ? `${Math.round(earned(hull, mode) / hours[mode])}` : '-');
    return `${hull} ${rate('hand')} by hand, ${rate('fleet')} in fleets (${Math.round(hours.hand + hours.fleet)} point-hours)`;
  });
  console.log(`  ${label}cr per point-hour: ${rows.join('; ')}`);
  const sum = (mode, pick) =>
    Object.entries(pointHours)
      .filter(([hull]) => pick(hull))
      .reduce((acc, [hull, hours]) => ({ cash: acc.cash + earned(hull, mode), hours: acc.hours + hours[mode] }), { cash: 0, hours: 0 });
  const wings = sum('fleet', (hull) => HULLS[hull].role !== 'command');
  if (wings.hours <= 1) return;
  const command = sum('fleet', (hull) => HULLS[hull].role === 'command');
  // By hand, the same hulls the wings fly, weighted by the wings' hours.
  const same = Object.entries(pointHours).filter(([hull, h]) => HULLS[hull].role !== 'command' && h.fleet > 1 && h.hand > 1);
  const handSame = same.reduce((sum2, [hull, h]) => sum2 + (earned(hull, 'hand') / h.hand) * h.fleet, 0) / Math.max(1, same.reduce((sum2, [, h]) => sum2 + h.fleet, 0));
  const per = (x, hours) => Math.round(x / Math.max(1, hours));
  console.log(
    `  ${label}fleets: ${per(wings.cash + command.cash, wings.hours + command.hours)} cr per point-hour with the command ships' points, ${per(wings.cash, wings.hours)} without; the same hulls by hand ${Math.round(handSame)}`,
  );
}

function print(report) {
  const { state } = report;
  const firstSession = report.from ? 0 : PROFILES[report.profileName].firstSession;
  const looks = report.breaks.length ? `, then ${report.days} days` : '';
  console.log(`\n== ${report.profileName}: ${report.from ? `from ${report.from}` : `${firstSession} min first session`}${looks}`);
  for (const [a, b] of [[0, 5], [5, 15], [15, 30], [30, 60]].filter(([a]) => a < firstSession)) {
    const inWindow = report.session.filter((s) => s.at >= a && s.at < b);
    const times = [a, ...inWindow.map((s) => s.at)];
    const gaps = times.slice(1).map((x, i) => x - times[i]);
    const trailing = Math.min(b, firstSession) - times.at(-1);
    console.log(
      `  first session ${String(a).padStart(2)}-${String(b).padEnd(2)} min: ${String(inWindow.length).padStart(2)} moments to act, ${String(inWindow.reduce((s, x) => s + x.n, 0)).padStart(3)} clicks, longest wait ${Math.max(trailing, ...gaps).toFixed(1)} min`,
    );
  }
  const hullName = { mule: '', kite: ' Kite', lark: ' Lark', heron: ' Heron' };
  console.log(`  builds planned: ${report.buys.map((b) => `#${b.n}${hullName[b.hull] ?? ''} ${clock(report, b.at)}`).join(', ')}`);
  const spend = state.stats.shipSpend ?? {};
  console.log(
    `  ${report.buys.length} builds; ${report.salvaged.length} salvaged; spent ${Math.round(spend.licences ?? 0)} cr on licences, ${Math.round(spend.materials ?? 0)} on materials, ${Math.round(spend.fees ?? 0)} on fees`,
  );
  console.log(`  research: ${report.research.map((r) => `${r.id} ${clock(report, r.at)}`).join(', ')}`);
  for (const d of report.perDay) {
    const breaks = report.breaks.filter((x) => x.day === d.day);
    if (!breaks.length) continue;
    const clicks = breaks.length ? (breaks.reduce((s, x) => s + x.clicks, 0) / breaks.length).toFixed(1) : '-';
    const spans = report.spans.filter((x) => x.day === d.day).map((x) => x.minutes);
    const idle = report.idleAfter[d.day - 1];
    console.log(
      `  day ${d.day}: earned ${String(d.earned).padStart(8)} cr, ${String(d.ships).padStart(2)} ships, ${d.points.padStart(5)} points, credits ${String(d.credits).padStart(8)}, ${clicks} clicks a look, miner queues ${median(spans)?.toFixed(0) ?? '-'} min, fleet busy ${idle?.toFixed(0) ?? '-'} min after the last look, ${d.contracts} contracts paid ${d.contractPay} cr, ${d.surveyed}/${d.enterable} systems surveyed/open`,
    );
  }
  console.log('  goals, and what the action that completed each made (sales and contracts after cost and jump fees both ways):');
  for (const goal of GOALS) {
    const at = report.goals[goal.id];
    const action = report.goalActions[goal.id];
    const made = action ? `${action.kind.padEnd(8)} ${action.net == null ? 'not settled' : `${Math.round(action.net) >= 0 ? '+' : ''}${Math.round(action.net)} cr`}${action.by ? ` (${action.by})` : ''}` : '';
    console.log(`    ${goal.title.padEnd(42)} ${(at == null ? 'not reached' : at === -Infinity ? 'before the save' : clock(report, at)).padEnd(13)} ${made}`);
  }
  console.log(`  total clicks ${report.clicks}, credits ${Math.round(state.credits)}, earned ${Math.round(state.stats.earned)}, research ${state.research.done.length}/${RESEARCH.length}`);
  for (const act of [1, 2, 3]) {
    const looks = report.breaks.filter((b) => b.act === act).map((b) => b.clicks);
    if (!looks.length) continue;
    const sorted = [...looks].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    console.log(`  act ${act} clicks a look: median ${median(looks)}, 10th to 90th percentile ${pct(0.1)} to ${pct(0.9)}, most ${sorted.at(-1)} (${looks.length} looks)`);
    // Where the clicks go: the average per look, by what they were for.
    const breaks = report.breaks.filter((b) => b.act === act);
    const byKind = {};
    for (const b of breaks) for (const [kind, n] of Object.entries(b.kinds)) byKind[kind] = (byKind[kind] ?? 0) + n;
    const parts = Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${kind} ${(n / breaks.length).toFixed(1)}`);
    console.log(`    per look: ${parts.join(', ')}; ${median(breaks.map((b) => b.ships))} ships on the map (median)`);
  }
  for (const [id, end] of Object.entries(report.actEnds)) {
    console.log(`  at ${id} (${clock(report, end.at)}): ${end.credits} cr on hand, ${end.ships} ships, ${end.points}/${end.allowance} points, spent ${Math.round(end.spend.licences ?? 0)} licences, ${Math.round(end.spend.materials ?? 0)} materials, ${Math.round(end.spend.fees ?? 0)} fees`);
  }
  // Credits a hull brought in per point it held, per hour: by hand and in fleets.
  printPerPoint('', report.pointHours, report.startStats.shipCash ?? {}, state.stats.shipCash ?? {});
  if (report.act3) {
    const hours = Object.fromEntries(
      Object.entries(report.pointHours).map(([hull, h]) => [hull, { hand: h.hand - (report.act3.pointHours[hull]?.hand ?? 0), fleet: h.fleet - (report.act3.pointHours[hull]?.fleet ?? 0) }]),
    );
    printPerPoint('act 3 ', hours, report.act3.shipCash, state.stats.shipCash ?? {});
  }
  const share = (report.contractPay / Math.max(1, state.stats.earned)) * 100;
  const first = report.contracts[0];
  console.log(
    `  contracts: ${state.stats.contractsAccepted} accepted, ${state.stats.contracts} complete, ${Math.round(report.contractPay)} cr paid (${share.toFixed(0)}% of earnings); first accepted ${first ? clock(report, first.at) : 'never'}`,
  );
  const warp = report.research.find((r) => r.id === 'warp-drive');
  if (canJump(state)) {
    // This run's share of the counts, for runs from a save.
    const stats = Object.fromEntries(Object.entries(state.stats).map(([key, value]) => [key, typeof value === 'number' ? value - (report.startStats[key] ?? 0) : value]));
    stats.tierProfit = Object.fromEntries(Object.entries(state.stats.tierProfit ?? {}).map(([tier, p]) => [tier, p - (report.startStats.tierProfit?.[tier] ?? 0)]));
    const ratio = median(report.tradeRates);
    const shielded = report.goals['first-shielding'];
    console.log(`  galaxy: ${state.surveyed.length} systems surveyed, ${stats.jumps} jumps, ${stats.farSales} sales in other systems, ${Math.round(stats.chartPay ?? 0)} cr for charts`);
    const found = foundSignals(state);
    const gates = found.filter((s) => s.kind === 'gate');
    console.log(
      `    signals: ${found.length} found, ${stats.signals ?? 0} investigated, ${stats.salvaged ?? 0} salvage trips, ${gates.filter((s) => isGateOpen(state, s)).length / 2} of ${allSystems().filter((s) => s.signal?.kind === 'gate').length / 2} ancient gates open`,
    );
    const traded = stats.tradeProfit + report.contractMargin;
    console.log(`    jump fees ${Math.round(stats.jumpFees)} cr, ${((stats.jumpFees / Math.max(1, traded + stats.jumpFees)) * 100).toFixed(0)}% of trade profit before fees (contracts for bought goods count as trade)`);
    console.log(`    routes between systems pay ${ratio ? ratio.toFixed(2) : '-'}x the best home trade (median of ${report.tradeRates.length} picks)`);
    console.log(`    standing: ${Object.entries(state.standing).map(([id, p]) => `${id} ${Math.floor(p)}`).join(', ')}`);
    if (warp) console.log(`    first hazard shielding ${shielded ? `${((shielded - warp.at) / (24 * HOUR)).toFixed(1)} days after starting the warp drive` : 'not reached'}`);
    // Act 3's length: from the first shielding, or from the start of a run from a save made then.
    const blueprints = report.goals['station-blueprints'];
    if (blueprints > -Infinity) {
      const since = shielded > -Infinity ? shielded : report.T0;
      console.log(`    Station blueprints ${((blueprints - since) / (24 * HOUR)).toFixed(1)} days after ${shielded > -Infinity ? 'the first hazard shielding' : 'the start of this run'}`);
    }
    const missions = report.missions.filter((m) => !m.hired);
    if (missions.length) {
      const fleetEarned = missions.reduce((sum, m) => sum + m.credits, 0);
      console.log(`    fleets: ${commanders(state).length} commanders, ${missions.length} missions, ${Math.round(fleetEarned)} cr (${((fleetEarned / Math.max(1, stats.earned)) * 100).toFixed(0)}% of earnings)`);
      const groups = {};
      for (const m of missions) {
        const key = `${m.kind} ${m.trait}`;
        groups[key] ??= { credits: 0, shipHours: 0, n: 0, levels: [] };
        groups[key].credits += m.credits;
        groups[key].shipHours += m.ships * m.hours;
        groups[key].n += 1;
        groups[key].levels.push(m.level);
      }
      for (const [key, g] of Object.entries(groups)) console.log(`      ${key.padEnd(20)} ${String(g.n).padStart(3)} missions, ${Math.round(g.credits / Math.max(1, g.shipHours))} cr per ship-hour, levels ${Math.min(...g.levels)}-${Math.max(...g.levels)}`);
    } else if (!report.fleets) console.log('    fleets: off');
    const tiers = Object.entries(stats.tierProfit ?? {});
    const profit = tiers.reduce((sum, [, p]) => sum + Math.max(0, p), 0);
    console.log(`    sales profit by tier: ${tiers.map(([tier, p]) => `tier ${tier} ${((Math.max(0, p) / Math.max(1, profit)) * 100).toFixed(0)}%`).join(', ')}`);
  }
}

const args = process.argv.slice(2);
const flag = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const [first = 'worker', second] = args.filter((a) => !a.startsWith('--'));
const names = first === 'all' ? Object.keys(PROFILES) : [first];
const days = Number(second ?? 6);
const from = flag('from')[0] ?? null;
const saveAt = Object.fromEntries(flag('save-at').map((s) => [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)]));
// npm run balance -- goals: the worker and the casual player through act 3,
// failing when the action that completed a goal lost money.
const goalsCheck = first === 'goals';
const profiles = goalsCheck ? ['worker', 'casual'] : names;
const runDays = goalsCheck ? Number(second ?? 30) : days;
const losses = [];
for (const name of profiles) {
  if (!PROFILES[name]) throw new Error(`Unknown profile "${name}". Try: ${Object.keys(PROFILES).join(', ')}, all, goals`);
  const report = play(name, runDays, { from, saveAt: { ...saveAt }, fleets: !args.includes('--no-fleets'), haulers: flag('haulers')[0] ?? null });
  print(report);
  for (const [goal, action] of Object.entries(report.goalActions)) {
    if (action.net == null && !['other', 'earlier'].includes(action.kind)) losses.push(`${name}: ${GOALS.find((g) => g.id === goal).title}: ${action.kind} by ${action.by} not settled by the end of the run`);
    else if (action.net != null && action.net < 0) losses.push(`${name}: ${GOALS.find((g) => g.id === goal).title}: ${action.kind} by ${action.by}, ${Math.round(action.net)} cr`);
  }
}
if (losses.length) {
  console.log(`\nGoals whose completing action lost money:\n  ${losses.join('\n  ')}`);
  if (goalsCheck) process.exitCode = 1;
} else {
  console.log('\nEvery goal completed by a trade, survey or mission made money.');
}
