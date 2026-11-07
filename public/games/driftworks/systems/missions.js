// Missions: a commander takes their wing to an area (a system and every
// system within a few jumps of it) for a set number of hours and picks each
// ship's next order itself. The ships really fly it: markets move, standing
// grows and fees are paid at the gate.
//
// A commander ship on a mission has
//   mission: { id, kind, center, reach, hours, startedAt, endsAt,
//              status: 'active' | 'returning', report, plans }
// When the time is up the mission is 'returning': each ship finishes its
// order, then the commander writes the captain's log into the company log.
//
// The simulation asks dispatch() for a ship's next order whenever one in a
// wing runs out of orders. Orders a commander gives carry `missionBy` (the
// commander's ship id), so what they earn counts toward the report. Between
// orders a commander takes a moment to decide (a 'standby' order), longer
// at low levels: that is what makes a fleet earn less than the same ships
// under the player's own orders.

import { GOODS, goodName } from '../content/goods.js';
import { HULLS } from '../content/ships.js';
import { DOCTRINE_DEFAULT, MINE_MISSION_TIER, MISSIONS, SECOND_TRAIT_LEVEL, TRAITS } from '../content/commanders.js';
import { findField, findSignal, findStation, findSystem, lanesFrom, systemOf } from '../content/galaxy.js';
import { HOUR, MINUTE, SECOND } from '../core/time.js';
import { formatCredits, formatDuration, formatNumber } from '../../../shared/js/format.js';
import { buyersOf, saleValue, tradePlan } from './advisor.js';
import { canCarry, cargoTotal } from './cargo.js';
import { commanderLevel, efficiency, fleetCommand, hasTrait, isCommander, leaderOf, traitText, wingOf } from './commanders.js';
import { isSurveyed, surveyable, surveyorOf } from './explore.js';
import { findShip } from './fleet.js';
import { knownAt } from './knowledge.js';
import { addLog } from './log.js';
import { affordableQty, marketEntries, marketView } from './market.js';
import { holdOf } from './modules.js';
import { buildOrder, startOrder } from './orders.js';
import { isShielded } from './shielding.js';
import { derelictLeft, fieldsOf, foundSignals, isInvestigated, linksFrom, workerAt } from './signals.js';
import { hasStanding } from './standing.js';
import { plotCourse } from './travel.js';

const fail = (error) => ({ ok: false, error });

/** How long a ship with nothing to do waits before its commander looks again. */
const IDLE_LOOK = 30 * MINUTE;
/** Buyers looked at for each good a station sells. */
const BUYERS_PER_GOOD = 3;
/** Least a trade run must make to be worth flying. */
const MIN_RUN_PROFIT = 200;

const ROLE_NAMES = { miner: 'miner', hauler: 'hauler', scout: 'scout' };
const role = (ship) => HULLS[ship.hull].role;

// ---------- The area ----------

const enterable = (state, id) => isShielded(state, findSystem(id));
const workable = (state, id) => isSurveyed(state, id) && enterable(state, id);

/**
 * Systems within `reach` jumps of a centre, by lanes and open ancient gates.
 * The search goes on only through surveyed systems; unsurveyed ones at its
 * edge are included, for surveys.
 */
export function areaAround(state, centerId, reach) {
  const depth = new Map([[centerId, 0]]);
  const queue = [centerId];
  while (queue.length) {
    const id = queue.shift();
    if (depth.get(id) >= reach || !workable(state, id)) continue;
    for (const { to } of linksFrom(state, id, lanesFrom(id))) {
      if (depth.has(to) || !enterable(state, to)) continue;
      depth.set(to, depth.get(id) + 1);
      queue.push(to);
    }
  }
  return [...depth.keys()];
}

/** The systems of a mission's area now (it grows as its scouts survey). */
export function missionArea(state, mission) {
  return areaAround(state, mission.center, mission.reach);
}

// ---------- Wings ----------

/** A ship waiting for its commander's next order stops waiting. */
function release(ship) {
  if (ship.order?.type !== 'standby') return;
  ship.at = ship.order.target;
  ship.order = null;
}

export function joinFleet(state, ship, commander, at = state.now) {
  const command = fleetCommand(state);
  if (!command) return fail('Fleets come with the Fleet command I research.');
  if (!ship || !isCommander(commander)) return fail('No such commander.');
  if (isCommander(ship)) return fail(`${ship.name} leads a fleet of their own.`);
  if (ship.fleet === commander.id) return fail(`${ship.name} is already in ${commander.name}'s fleet.`);
  if (wingOf(state, commander).length >= command.wing) return fail(`${commander.name}'s wing is full, at ${command.wing} ships.`);
  const before = leaderOf(state, ship);
  release(ship);
  ship.fleet = commander.id;
  addLog(state, at, `${ship.name} joined ${commander.name}'s fleet`, 'order');
  if (before) finishIfDone(state, before, at);
  dispatch(state, ship, at);
  return { ok: true };
}

export function leaveFleet(state, ship, at = state.now) {
  const commander = leaderOf(state, ship);
  if (!commander) return fail(`${ship?.name ?? 'That ship'} is not in a fleet.`);
  release(ship);
  ship.fleet = null;
  addLog(state, at, `${ship.name} left ${commander.name}'s fleet`, 'order');
  finishIfDone(state, commander, at);
  return { ok: true };
}

// ---------- Standing orders ----------

/** A commander's standing orders (see DOCTRINE_DEFAULT). */
export function doctrineOf(commander) {
  return { ...DOCTRINE_DEFAULT, ...commander?.commander?.doctrine };
}

export function setDoctrine(state, commander, patch) {
  if (!fleetCommand(state)?.doctrines) return fail('Standing orders come with Fleet command II.');
  if (!isCommander(commander)) return fail('No such commander.');
  commander.commander.doctrine = { ...doctrineOf(commander), ...patch };
  return { ok: true };
}

/** Whether a commander's standing orders let the fleet trade at a station. */
function tradesWith(state, doctrine, station) {
  if (doctrine.factions === 'any') return true;
  if (doctrine.factions === 'friendly') return hasStanding(state, station.faction, 'friendly');
  return station.faction === doctrine.factions;
}

// ---------- Starting and ending ----------

/** Whether a commander can start this mission now: { ok, area } or { ok: false, error }. */
export function canStartMission(state, commander, { kind, center, hours }) {
  const command = fleetCommand(state);
  if (!command) return fail('Missions come with the Fleet command I research.');
  if (!isCommander(commander)) return fail('No such commander.');
  if (commander.mission) return fail(`${commander.name} is already on a mission.`);
  const mission = MISSIONS[kind];
  if (!mission) return fail('Pick a mission.');
  if (!command.hours.includes(hours)) return fail(`Missions last ${command.hours.join(', ')} hours.`);
  if (!findSystem(center) || !workable(state, center)) return fail('The area needs a surveyed system at its centre.');
  const wing = wingOf(state, commander);
  if (!wing.length) return fail(`${commander.name} has no ships to lead yet.`);
  if (!wing.some((ship) => role(ship) === mission.lead)) return fail(`A ${mission.name.toLowerCase()} mission needs a ${ROLE_NAMES[mission.lead]} in the wing.`);
  return { ok: true, area: areaAround(state, center, command.reach), reach: command.reach };
}

const emptyReport = () => ({ credits: 0, fees: 0, jumps: 0, sold: 0, mined: 0, surveyed: 0, signals: 0, salvaged: 0, outside: 0, sales: {}, fields: {} });

export function startMission(state, commander, plan, at = state.now) {
  const check = canStartMission(state, commander, plan);
  if (!check.ok) return check;
  const { kind, center, hours } = plan;
  commander.commander.missions = (commander.commander.missions ?? 0) + 1;
  commander.mission = {
    id: commander.commander.missions,
    kind,
    center,
    reach: check.reach,
    hours,
    ships: wingOf(state, commander).length,
    startedAt: at,
    endsAt: at + hours * HOUR,
    status: 'active',
    report: emptyReport(),
    // Where each hauler means to sell what it bought: { [shipId]: { stationId, good } }.
    plans: {},
  };
  const system = findSystem(center);
  // The commander flies out to the centre of the area.
  if (!commander.order && commander.at && systemOf(commander.at) !== center) {
    const place = system.stations[0]?.id ?? system.gates[0]?.id;
    if (place) startOrder(state, commander, { type: 'fly', stationId: place });
  }
  const wing = wingOf(state, commander);
  addLog(state, at, `${commander.name} took ${wing.length} ${wing.length === 1 ? 'ship' : 'ships'} on a ${MISSIONS[kind].name.toLowerCase()} mission around ${system.name}, for ${hours} h`, 'order');
  for (const ship of wing) dispatch(state, ship, at);
  return { ok: true, mission: commander.mission };
}

/** Ends a mission early: each ship finishes its order, then the commander writes the log. */
export function recallMission(state, commander, at = state.now) {
  if (commander?.mission?.status !== 'active') return fail(`${commander?.name ?? 'That commander'} is not on a mission.`);
  endMission(state, commander, at, true);
  return { ok: true };
}

/** The time is up (or the player called the fleet back). */
export function endMission(state, commander, at, recalled = false) {
  const mission = commander.mission;
  if (mission?.status !== 'active') return;
  mission.status = 'returning';
  mission.endedAt = Math.min(at, mission.endsAt);
  mission.recalled = recalled;
  for (const ship of state.ships) if (ship.order?.missionBy === commander.id) release(ship);
  finishIfDone(state, commander, at);
}

/** Once a returning mission's ships have finished their orders, the commander writes the log. */
export function finishIfDone(state, commander, at) {
  const mission = commander?.mission;
  if (mission?.status !== 'returning') return;
  if (state.ships.some((ship) => ship.order?.missionBy === commander.id)) return;
  const before = commanderLevel(commander);
  const time = mission.endedAt - mission.startedAt;
  const text = captainsLog(state, commander, mission, time);
  commander.commander.missionTime = (commander.commander.missionTime ?? 0) + time;
  commander.commander.report = { ...mission.report, kind: mission.kind, center: mission.center, ships: mission.ships, time, recalled: mission.recalled, at, text };
  commander.mission = null;
  state.stats.missions = (state.stats.missions ?? 0) + 1;
  addLog(state, at, text, 'fleet');
  const after = commanderLevel(commander);
  if (after > before) {
    const second = after >= SECOND_TRAIT_LEVEL && before < SECOND_TRAIT_LEVEL ? `, and shows a second side: ${TRAITS[commander.commander.traits[1]].name.toLowerCase()}` : '';
    addLog(state, at, `${commander.name} reached level ${after}${second}`, 'goal');
  }
}

/** The next time a mission's hours run out, or null. */
export function nextMissionEnd(state) {
  let best = null;
  for (const ship of state.ships) {
    const mission = ship.mission;
    if (mission?.status === 'active' && (!best || mission.endsAt < best.at)) best = { commander: ship, at: mission.endsAt };
  }
  return best;
}

// ---------- The report ----------

/**
 * Runs one step (or a jump) of a ship's order and adds what it earned and
 * did to the mission that gave the order, if any.
 */
export function trackMission(state, ship, step, run) {
  const commander = ship.order?.missionBy ? findShip(state, ship.order.missionBy) : null;
  const report = commander?.mission?.report;
  if (!report) return run();
  const { stats } = state;
  const before = { credits: state.credits, cargo: cargoTotal(ship), held: { ...ship.cargo }, surveys: stats.surveys ?? 0, signals: stats.signals ?? 0, salvaged: stats.salvaged ?? 0, jumps: stats.jumps ?? 0, fees: stats.jumpFees ?? 0 };
  const result = run();
  report.credits += state.credits - before.credits;
  report.jumps += (stats.jumps ?? 0) - before.jumps;
  report.fees += (stats.jumpFees ?? 0) - before.fees;
  report.surveyed += (stats.surveys ?? 0) - before.surveys;
  report.signals += (stats.signals ?? 0) - before.signals;
  report.salvaged += (stats.salvaged ?? 0) - before.salvaged;
  if (step?.kind === 'sell') {
    for (const good of Object.keys(before.held)) {
      const sold = before.held[good] - (ship.cargo[good] ?? 0);
      if (sold <= 0) continue;
      report.sold += sold;
      const key = `${good}>${step.station}`;
      report.sales[key] = (report.sales[key] ?? 0) + 1;
      if (!missionArea(state, commander.mission).includes(systemOf(step.station))) report.outside += 1;
    }
  }
  if (step?.kind === 'mined') {
    const mined = cargoTotal(ship) - before.cargo;
    report.mined += mined;
    report.fields[step.field] = (report.fields[step.field] ?? 0) + mined;
  }
  return result;
}

const mostOf = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? null;

/** Three or four lines in the commander's voice, from what happened. */
export function captainsLog(state, commander, mission, time) {
  const r = mission.report;
  const area = findSystem(mission.center)?.name ?? 'Unknown';
  const lines = [`${commander.name}, level ${commanderLevel(commander)}, ${traitText(commander).toLowerCase()}. ${area} area, ${mission.recalled ? `called back after ${formatDuration(time)}` : `${mission.hours} h`}.`];

  const field = mostOf(r.fields);
  if (r.mined > 0) lines.push(`Mined ${formatNumber(r.mined)} t${field ? `, most of it at ${findField(field[0])?.name ?? 'a field'}` : ''}.`);
  const sale = mostOf(r.sales);
  if (sale) {
    const [good, stationId] = sale[0].split('>');
    lines.push(`Sold ${goodName(good).toLowerCase()} at ${findStation(stationId)?.name ?? 'a station'} ${sale[1] === 1 ? 'once' : `${sale[1]} times`}.`);
  }
  if (r.surveyed || r.signals) {
    const parts = [r.surveyed ? `surveyed ${r.surveyed} ${r.surveyed === 1 ? 'system' : 'systems'}` : null, r.signals ? `looked into ${r.signals} ${r.signals === 1 ? 'signal' : 'signals'}` : null].filter(Boolean);
    lines.push(`${parts.join(' and ').replace(/^./, (c) => c.toUpperCase())}.`);
  }
  if (r.salvaged) lines.push(`Salvaged ${r.salvaged === 1 ? 'a derelict' : `${r.salvaged} derelicts`}.`);
  if (lines.length === 1) lines.push('Found nothing worth doing.');

  const trait = commander.commander.traits[0];
  const stations = new Set(Object.keys(r.sales).map((key) => key.split('>')[1])).size;
  const flavour = {
    greedy: r.outside ? `Went outside the area ${r.outside === 1 ? 'once' : `${r.outside} times`} for a better price.` : null,
    thrifty: stations > 1 ? `Spread the sales over ${stations} stations.` : null,
    cautious: r.jumps ? `Kept to short hops, ${r.jumps} ${r.jumps === 1 ? 'jump' : 'jumps'} in all.` : 'Never left the system.',
    curious: r.signals ? 'Looked into everything new on the way.' : null,
    prospector: field ? `Stayed with the richest ore going.` : null,
  }[trait];
  if (flavour) lines.push(flavour);

  const gates = r.fees > 0 ? `Paid ${formatCredits(r.fees)} at the gates and ` : '';
  lines.push(r.credits > 0 ? `${gates}${gates ? 'brought' : 'Brought'} in ${formatCredits(r.credits)}.` : `${gates}${gates ? 'made' : 'Made'} nothing.`);
  return lines.join(' ');
}

// ---------- Orders ----------

function startTagged(state, ship, commander, spec) {
  const result = startOrder(state, ship, spec);
  if (result.ok) ship.order.missionBy = commander.id;
  return result;
}

/** How the commander's traits tilt a pick. */
function tilt(state, commander) {
  const cautious = hasTrait(commander, 'cautious');
  // Standing orders count from Fleet command II on.
  const doctrine = fleetCommand(state)?.doctrines ? doctrineOf(commander) : DOCTRINE_DEFAULT;
  return {
    margin: doctrine.margin,
    feeLimit: doctrine.feeLimit ?? Infinity,
    allows: (station) => tradesWith(state, doctrine, station),
    feeWeight: cautious ? 1.5 : 1,
    maxJumps: cautious ? 1 : Infinity,
    pause: cautious ? 0.7 : 1,
    outside: hasTrait(commander, 'greedy'),
    spread: hasTrait(commander, 'thrifty'),
    curious: hasTrait(commander, 'curious'),
    prospector: hasTrait(commander, 'prospector'),
  };
}

/**
 * Gives an idle ship in a wing on a mission its next order: a short wait
 * after real work (the commander deciding), then the best pick for its part
 * in the mission, or a wait when there is nothing to do.
 */
export function dispatch(state, ship, at, finished = null) {
  const commander = leaderOf(state, ship);
  const mission = commander?.mission;
  if (mission?.status !== 'active' || ship.order || ship.queue.length || !ship.at) return;
  const left = mission.endsAt - at;
  if (left <= 0) return;
  const t = tilt(state, commander);
  const wait = (ms) => startTagged(state, ship, commander, { type: 'standby', ms: Math.min(ms, left), by: commander.name });
  if (finished?.missionBy === commander.id && finished.type !== 'standby') {
    const pause = (finished.endsAt - finished.startedAt) * (1 / efficiency(commander) - 1) * t.pause;
    if (pause >= 20 * SECOND) {
      wait(pause);
      return;
    }
  }
  if (!MISSIONS[mission.kind].roles.includes(role(ship))) {
    wait(left);
    return;
  }
  const spec = nextSpec(state, ship, commander, mission, t, at);
  if (spec && startTagged(state, ship, commander, spec).ok) return;
  wait(IDLE_LOOK);
}

/** Gives every idle ship in a wing on a mission its next order. */
export function wakeFleets(state, at) {
  for (const ship of state.ships) if (ship.fleet && !ship.order) dispatch(state, ship, at);
}

function nextSpec(state, ship, commander, mission, t, at) {
  const r = role(ship);
  const area = missionArea(state, mission);
  if (r === 'scout') return scoutSpec(state, ship, mission, t, area);
  const work = area.filter((id) => workable(state, id));
  if (cargoTotal(ship) > 0) return sellSpec(state, ship, commander, mission, t, work, at);
  if (r === 'miner') return mineSpec(state, ship, mission, t, work, at);
  if (mission.kind === 'survey') return salvageSpec(state, ship, t, area);
  return tradeSpec(state, ship, commander, mission, t, work, at);
}

const here = { ok: true, time: 0, fees: 0, jumps: 0 };
const courseTo = (state, ship, fromId, toId) => (fromId === toId ? here : plotCourse(state, ship, fromId, toId));

/** Systems next to an area, for a Greedy commander's sales. */
function aroundArea(state, area) {
  const seen = new Set(area);
  for (const id of area) for (const { to } of linksFrom(state, id, lanesFrom(id))) if (workable(state, to)) seen.add(to);
  return seen;
}

/** Where other ships in the wing are taking each good: { 'stationId|good': ships }. */
function claims(state, commander, ship) {
  const counts = {};
  for (const other of wingOf(state, commander)) {
    if (other === ship) continue;
    const plan = commander.mission.plans[other.id];
    if (plan && (other.order?.type === 'buy' || other.order?.type === 'sell')) counts[`${plan.stationId}|${plan.good}`] = (counts[`${plan.stationId}|${plan.good}`] ?? 0) + 1;
  }
  return counts;
}

/** The best buyer for what the ship carries, inside the area (and next to it for a Greedy commander). */
function sellSpec(state, ship, commander, mission, t, work, at) {
  const systems = t.outside ? aroundArea(state, work) : new Set(work);
  const taken = t.spread ? claims(state, commander, ship) : {};
  // Prospectors hold out for the best price; others sell in the field's own system when they can.
  const homeOnly = role(ship) === 'miner' && !t.prospector;
  const local = systemOf(ship.at);
  // A hauler sells where it meant to when it bought, if that still pays.
  const plan = mission.plans[ship.id];
  if (plan && ship.cargo[plan.good] >= 1 && saleValue(state, plan.stationId, plan.good, ship.cargo[plan.good], at).total > 0 && courseTo(state, ship, ship.at, plan.stationId).ok) {
    return { type: 'sell', stationId: plan.stationId };
  }
  let best = null;
  for (const good of Object.keys(ship.cargo)) {
    if (ship.cargo[good] < 1) continue;
    let buyers = buyersOf(state, good, at).filter(({ station }) => systems.has(systemOf(station.id)) && t.allows(station));
    if (homeOnly && buyers.some(({ station }) => systemOf(station.id) === local)) buyers = buyers.filter(({ station }) => systemOf(station.id) === local);
    for (const { station } of buyers) {
      const course = courseTo(state, ship, ship.at, station.id);
      if (!course.ok || course.jumps > t.maxJumps || course.fees > t.feeLimit) continue;
      const sale = saleValue(state, station.id, good, ship.cargo[good], at);
      const share = 0.8 ** (taken[`${station.id}|${good}`] ?? 0);
      const score = (sale.total * share - course.fees * t.feeWeight) / (course.time / MINUTE + 2);
      if (!best || score > best.score) best = { score, stationId: station.id, good };
    }
  }
  // Nobody in the area buys it: the best buyer the company knows.
  if (!best) {
    const good = Object.keys(ship.cargo).find((g) => ship.cargo[g] >= 1);
    const buyer = good ? buyersOf(state, good, at).find(({ station }) => courseTo(state, ship, ship.at, station.id).ok) : null;
    if (!buyer) return null;
    best = { stationId: buyer.station.id, good };
  }
  mission.plans[ship.id] = { stationId: best.stationId, good: best.good };
  return { type: 'sell', stationId: best.stationId };
}

function mineSpec(state, ship, mission, t, work, at) {
  let best = null;
  for (const systemId of work) {
    for (const field of fieldsOf(state, findSystem(systemId))) {
      const built = buildOrder(state, ship, { type: 'mine', fieldId: field.id, amount: null }, at);
      if (!built.ok || (built.order.jumps ?? 0) > t.maxJumps || (built.order.fees ?? 0) > t.feeLimit) continue;
      const { good, amount } = built.order.steps[0];
      const buyer = buyersOf(state, good, at).find(({ station }) => work.includes(systemOf(station.id)) && t.allows(station));
      if (!buyer) continue;
      const value = saleValue(state, buyer.station.id, good, amount, at).total;
      const minutes = (built.order.endsAt - at) / MINUTE;
      let score = (value - (built.order.fees ?? 0) * t.feeWeight) / minutes;
      if (t.prospector) score *= Math.sqrt(field.richness);
      if (!best || score > best.score) best = { score, fieldId: field.id };
    }
  }
  return best ? { type: 'mine', fieldId: best.fieldId, amount: null } : null;
}

/** The most a trade run makes for `max` tonnes or fewer, in a few steps: { qty, plan }. */
function sizeTrade(state, ship, good, fromId, toId, max, at, course) {
  let best = null;
  const step = Math.max(1, Math.ceil(max / 10));
  for (let qty = step; qty < max + step; qty += step) {
    const plan = tradePlan(state, ship, good, Math.min(qty, max), toId, at, fromId, course);
    if (!best || plan.profit > best.plan.profit) best = { qty: plan.qty, plan };
  }
  return best;
}

function tradeSpec(state, ship, commander, mission, t, work, at) {
  const maxTier = mission.kind === 'mine' ? MINE_MISSION_TIER : Infinity;
  const sellers = new Set(work);
  const buyerSystems = t.outside ? aroundArea(state, work) : sellers;
  const taken = t.spread ? claims(state, commander, ship) : {};
  const room = Math.floor(holdOf(ship) - cargoTotal(ship));
  if (room < 1) return null;
  let best = null;
  for (const systemId of sellers) {
    for (const from of findSystem(systemId).stations) {
      if (!t.allows(from)) continue;
      const there = courseTo(state, ship, ship.at, from.id);
      if (!there.ok || there.jumps > t.maxJumps || there.fees > t.feeLimit) continue;
      const known = knownAt(state, from.id, at);
      for (const entry of marketEntries(from.id)) {
        if (entry.side !== 'sells' || GOODS[entry.good].tier > maxTier || !canCarry(ship, entry.good)) continue;
        const good = entry.good;
        const max = affordableQty(state, from.id, good, state.credits - there.fees, room, known);
        if (max < 1) continue;
        const asks = marketView(state, from.id, good, known).price;
        const buyers = buyersOf(state, good, at)
          .filter(({ station, view }) => station.id !== from.id && view.price > asks + t.margin && buyerSystems.has(systemOf(station.id)) && t.allows(station))
          .slice(0, BUYERS_PER_GOOD);
        for (const { station } of buyers) {
          const course = plotCourse(state, ship, from.id, station.id);
          if (!course.ok || course.jumps > t.maxJumps || there.fees + course.fees > t.feeLimit) continue;
          const sized = sizeTrade(state, ship, good, from.id, station.id, max, at, course);
          if (!sized || sized.plan.profit < MIN_RUN_PROFIT || sized.plan.profit < t.margin * sized.qty) continue;
          const share = 0.8 ** (taken[`${station.id}|${good}`] ?? 0);
          const profit = sized.plan.profit * share - there.fees * t.feeWeight - course.fees * (t.feeWeight - 1);
          const score = profit / ((there.time + course.time) / MINUTE + 4);
          if (score > 0 && (!best || score > best.score)) best = { score, from: from.id, good, qty: sized.qty, to: station.id };
        }
      }
    }
  }
  if (!best) return null;
  mission.plans[ship.id] = { stationId: best.to, good: best.good };
  return { type: 'buy', stationId: best.from, good: best.good, qty: best.qty };
}

function nearest(state, ship, list, placeOf) {
  let best = null;
  for (const item of list) {
    const course = plotCourse(state, ship, ship.at, placeOf(item), { surveyTarget: item.surveyTarget });
    if (course.ok && (!best || course.time < best.time)) best = { item, time: course.time };
  }
  return best?.item ?? null;
}

/** Scouts survey every system in the area they can, then look into its signals. Curious ones reach a jump further and look into signals first. */
function scoutSpec(state, ship, mission, t, area) {
  const reach = t.curious ? areaAround(state, mission.center, mission.reach + 1) : area;
  const systems = reach.filter((id) => surveyable(state, id) && !surveyorOf(state, id)).map((id) => findSystem(id));
  const signals = foundSignals(state).filter((signal) => reach.includes(systemOf(signal.id)) && !isInvestigated(state, signal) && !workerAt(state, signal.id, 'investigate'));
  const survey = () => {
    const system = nearest(state, ship, systems.map((s) => ({ ...s, surveyTarget: s.id })), (s) => s.gates[0]?.id);
    return system ? { type: 'survey', systemId: system.id } : null;
  };
  const investigate = () => {
    const signal = nearest(state, ship, signals, (s) => s.id);
    return signal ? { type: 'investigate', signalId: signal.id } : null;
  };
  return t.curious ? (investigate() ?? survey()) : (survey() ?? investigate());
}

/** Haulers on a survey mission salvage the derelicts its scouts find. */
function salvageSpec(state, ship, t, area) {
  const wrecks = foundSignals(state).filter(
    (signal) => signal.kind === 'derelict' && area.includes(systemOf(signal.id)) && isInvestigated(state, signal) && derelictLeft(state, signal) > 0 && canCarry(ship, signal.good) && !workerAt(state, signal.id, 'salvage'),
  );
  const wreck = nearest(state, ship, wrecks, (s) => s.id);
  return wreck && findSignal(wreck.id) ? { type: 'salvage', signalId: wreck.id } : null;
}
