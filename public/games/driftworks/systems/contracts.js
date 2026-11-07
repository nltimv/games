// Contracts: a station wants a set amount of one good within a time limit,
// for a fixed price paid when the last tonne arrives. Deliveries go to the
// contract, not the market, so they neither move prices nor depend on them.
// A contract that runs out pays nothing, and what was delivered is gone.
//
// Offers turn up at stations on their own. Every surveyed system is
// checked now and then (CONTRACT_RULES.checkMinutes), and each check may
// bring one offer, with a chance that falls as the company surveys more
// systems: plenty early on, not one at every station later. The player
// only sees the offers, never the checks. Every roll comes from the save's
// seed. Offers start with the Brokerage research.

import { GOODS, goodName } from '../content/goods.js';
import { HOLD_CLASS_MAX_TIER, HULLS, MODULES } from '../content/ships.js';
import { TIER_STORAGE } from '../content/stations.js';
import { HOME_SYSTEM } from '../content/homeSystem.js';
import { allSystems, findStation, findSystem, systemOf } from '../content/galaxy.js';
import { formatCredits, formatNumber } from '../../../shared/js/format.js';
import { seededUnit } from '../core/rng.js';
import { HOUR, MINUTE } from '../core/time.js';
import { removeCargo } from './cargo.js';
import { marketEntries } from './market.js';
import { isSurveyed, knownStations } from './explore.js';
import { isResearched, researchLevel } from './research.js';
import { earnStanding } from './standing.js';
import { addLog } from './log.js';

export const CONTRACT_RULES = {
  // Minutes between two checks of a system, picked at random in this range.
  checkMinutes: [6, 12],
  // The chance a check brings an offer: start / surveyed systems ^ falloff,
  // never below min. Aurel alone gets one every 10 minutes or so. With
  // falloff above 1 the whole galaxy gets fewer an hour as it grows (under
  // 3 an hour with five systems, under 2 with twenty), spread over far more
  // stations.
  chance: { start: 0.9, falloff: 1.5, min: 0.008 },
  // Hours an offer waits to be accepted.
  offerHours: [2, 4],
  // Contracts the company can hold at once.
  maxActive: 3,
  // Offers a station can have waiting at once, each for a different good.
  perStation: 2,
  // Ore contracts ask for this many holds of the newest Mule, refined ones
  // for this many of the newest Kite.
  oreHolds: [3, 6],
  refinedHolds: [0.75, 1.75],
  // The price per tonne, in times the good's base value (selling at market
  // brings about 1.2 times).
  pay: [1.7, 2.3],
  // The time limit: a few hours, plus one and a half times what mining the
  // ore takes one Mule.
  baseHours: [2.5, 4.5],
};

/** Offers are for goods up to the tier a hold carries: a standard one, or a sealed one once researched. */
function maxTier(state) {
  return HOLD_CLASS_MAX_TIER[isResearched(state, 'sealed-holds') ? 2 : 1];
}
// Offers older than this are gone anyway, so a long absence only rolls the last stretch.
const LONGEST_OFFER = CONTRACT_RULES.offerHours[1] * HOUR;

const fail = (error) => ({ ok: false, error });
const lower = (good) => goodName(good).toLowerCase();
const lerp = ([a, b], t) => a + (b - a) * t;

export function boardOpen(state) {
  return isResearched(state, 'brokerage');
}

/** The chance one check brings an offer, by how many systems are surveyed. */
export function spawnChance(state) {
  const { start, falloff, min } = CONTRACT_RULES.chance;
  const systems = 1 + (state.surveyed?.length ?? 0);
  return Math.max(min, start / systems ** falloff);
}

/** A round number of tonnes or credits: 5s, then 10s, 50s and 100s. */
function nice(value) {
  const step = value < 100 ? 5 : value < 1000 ? 10 : value < 10000 ? 50 : 100;
  return Math.max(step, Math.round(value / step) * step);
}

/**
 * Goods the company can get hold of: ore from the fields it knows (it has
 * miners from the start), and with a hauler anything a known station sells.
 */
function suppliable(state) {
  const goods = new Set();
  for (const system of allSystems()) {
    if (isSurveyed(state, system.id)) for (const field of system.fields) goods.add(field.good);
  }
  if (state.ships.some((ship) => HULLS[ship.hull].role === 'hauler')) {
    for (const station of knownStations(state)) {
      for (const entry of marketEntries(station.id)) if (entry.side === 'sells') goods.add(entry.good);
    }
  }
  return goods;
}

/**
 * What a station could ask for now: goods it uses that the company can bring,
 * and that it has no offer or contract for yet.
 */
function wantedAt(state, station, goods) {
  const { offers, active } = state.contracts;
  const taken = new Set([...offers, ...active].filter((c) => c.stationId === station.id).map((c) => c.good));
  return marketEntries(station.id)
    .filter((entry) => entry.side === 'buys' && GOODS[entry.good].tier <= maxTier(state) && goods.has(entry.good) && !taken.has(entry.good))
    .map((entry) => entry.good);
}

/**
 * Makes an offer at a station for one of `goods`. `size` (0 to 1) sets the
 * amount and the time limit, rolled when null; `holdLevel` is the cargo rack
 * the amount is counted in, the newest researched when null.
 */
function makeOffer(state, station, goods, at, { size = null, holdLevel = null } = {}) {
  const id = state.contracts.nextId;
  state.contracts.nextId += 1;
  const roll = (label) => seededUnit(state.seed, `contract:${id}:${label}`);
  const ores = goods.filter((good) => GOODS[good].tier === 1);
  const refined = goods.filter((good) => GOODS[good].tier > 1);
  const pool = refined.length && (!ores.length || roll('kind') < 0.4) ? refined : ores;
  const good = pool[Math.floor(roll('good') * pool.length)];
  const s = size ?? roll('size');
  const muleHold = MODULES.hold.levels[holdLevel ?? researchLevel(state, 'hold')];
  const ore = GOODS[good].tier === 1;
  // Higher tiers come in smaller amounts, as stations keep less of them.
  const storage = TIER_STORAGE[GOODS[good].tier] ?? 1;
  const qty = nice(ore ? muleHold * lerp(CONTRACT_RULES.oreHolds, s) : muleHold * HULLS.kite.holdScale * storage * lerp(CONTRACT_RULES.refinedHolds, s));
  const reward = nice(qty * GOODS[good].value * lerp(CONTRACT_RULES.pay, roll('pay')));
  // Mining takes a Mule this long; buying takes no time at all.
  const miningMinutes = ore ? qty / MODULES.laser.levels[researchLevel(state, 'laser')] : 0;
  const hours = Math.ceil((lerp(CONTRACT_RULES.baseHours, roll('hours')) + (1.5 * miningMinutes) / 60) * 2) / 2;
  const offer = { id, stationId: station.id, good, qty, reward, hours, expiresAt: at + Math.round(lerp(CONTRACT_RULES.offerHours, roll('wait')) * HOUR) };
  state.contracts.offers.push(offer);
  return offer;
}

/** One check of a system at time `at`: maybe an offer at one of its stations. */
function checkSystem(state, system, at, goods) {
  const roll = (label) => seededUnit(state.seed, `contract-check:${system.id}:${at}:${label}`);
  if (roll('spawn') >= spawnChance(state)) return;
  const offersAt = (station) => state.contracts.offers.filter((offer) => offer.stationId === station.id).length;
  const stations = system.stations.filter((station) => offersAt(station) < CONTRACT_RULES.perStation && wantedAt(state, station, goods).length);
  if (!stations.length) return;
  const station = stations[Math.floor(roll('station') * stations.length)];
  makeOffer(state, station, wantedAt(state, station, goods), at);
}

function nextCheck(state, systemId, at) {
  const [min, max] = CONTRACT_RULES.checkMinutes;
  return at + Math.round(min + (max - min) * seededUnit(state.seed, `contract-wait:${systemId}:${at}`)) * MINUTE;
}

/**
 * Brings offers and contracts up to `until`: ends contracts whose time ran
 * out, drops stale offers and runs the checks that came due. Cheap; call it
 * freely.
 */
export function updateContracts(state, until = state.now) {
  if (!boardOpen(state)) return;
  expireContracts(state, until);
  const contracts = state.contracts;
  contracts.checks ??= {};
  const goods = suppliable(state);
  for (const system of allSystems()) {
    if (!isSurveyed(state, system.id)) continue;
    // A system's first check comes a while after the board opens or its survey.
    let at = contracts.checks[system.id] ?? nextCheck(state, system.id, until);
    if (at < until - LONGEST_OFFER) at = nextCheck(state, system.id, until - LONGEST_OFFER);
    while (at <= until) {
      contracts.offers = contracts.offers.filter((offer) => offer.expiresAt > at);
      checkSystem(state, system, at, goods);
      at = nextCheck(state, system.id, at);
    }
    contracts.checks[system.id] = at;
  }
  contracts.offers = contracts.offers.filter((offer) => offer.expiresAt > until);
  firstOffer(state, until, goods);
}

/**
 * Until the company has filled its first contract, Aurel always has an
 * offer it can take on: a small one, for ore mined in Aurel.
 */
function firstOffer(state, at, goods) {
  const contracts = state.contracts;
  if (state.stats.contracts > 0 || contracts.active.length || contracts.offers.some((offer) => systemOf(offer.stationId) === HOME_SYSTEM.id)) return;
  const ores = new Set(HOME_SYSTEM.fields.map((field) => field.good).filter((good) => goods.has(good)));
  const station = HOME_SYSTEM.stations.find((s) => wantedAt(state, s, ores).length);
  // Counted in the racks every Mule starts with, so it fits ships not yet refitted.
  if (station) makeOffer(state, station, wantedAt(state, station, ores), at, { size: 0, holdLevel: 0 });
}

/** The offers waiting at a station. */
export function offersAt(state, stationId, at = state.now) {
  return state.contracts.offers.filter((offer) => offer.stationId === stationId && offer.expiresAt > at);
}

/** The contracts running at a station. */
export function activeAt(state, stationId, at = state.now) {
  return state.contracts.active.filter((c) => c.stationId === stationId && c.deadline > at);
}

export function acceptContract(state, offerId, at = state.now) {
  const contracts = state.contracts;
  const offer = contracts.offers.find((o) => o.id === offerId && o.expiresAt > at);
  if (!offer) return fail('That offer is gone.');
  if (contracts.active.length >= CONTRACT_RULES.maxActive) return fail(`You can hold ${CONTRACT_RULES.maxActive} contracts at once.`);
  contracts.offers = contracts.offers.filter((o) => o !== offer);
  const contract = {
    id: offer.id,
    stationId: offer.stationId,
    good: offer.good,
    qty: offer.qty,
    delivered: 0,
    // What the delivered goods cost to buy, so "earned" counts only the profit.
    basis: 0,
    reward: offer.reward,
    acceptedAt: at,
    deadline: at + offer.hours * HOUR,
  };
  contracts.active.push(contract);
  state.stats.contractsAccepted += 1;
  addLog(state, at, `Contract accepted: ${formatNumber(contract.qty)} t ${lower(contract.good)} for ${findStation(contract.stationId).name}, ${formatCredits(contract.reward)}`, 'order');
  return { ok: true, contract };
}

/** The running contract for a good at a station, if any. */
export function contractFor(state, stationId, good, at = state.now) {
  return state.contracts.active.find((c) => c.stationId === stationId && c.good === good && c.deadline > at && c.delivered < c.qty) ?? null;
}

/** Tonnes a contract still needs. */
export function stillNeeded(contract) {
  return Math.max(0, contract.qty - contract.delivered);
}

/**
 * Hands a docked ship's `good` to the contract at its station: as much as
 * it carries, up to what the contract still needs. The last tonne pays the
 * price. Returns { ok, qty, contract, completed, reward } or an error.
 */
export function deliverCargo(state, ship, good, at = state.now) {
  const stationId = ship.at;
  const station = findStation(stationId);
  if (!station) return fail(`${ship.name} is not docked.`);
  const contract = contractFor(state, stationId, good, at);
  if (!contract) return fail(`${station.name} has no contract for ${lower(good)} running.`);
  const qty = Math.min(Math.floor(ship.cargo[good] ?? 0), stillNeeded(contract));
  if (qty < 1) return fail(`${ship.name} has no ${lower(good)} aboard.`);
  contract.basis += removeCargo(ship, good, qty);
  contract.delivered += qty;
  const completed = contract.delivered >= contract.qty;
  addLog(state, at, `${ship.name} delivered ${formatNumber(qty)} t ${lower(good)} to ${station.name} (${formatNumber(contract.delivered)} of ${formatNumber(contract.qty)} t)`, 'arrival');
  if (completed) {
    state.contracts.active = state.contracts.active.filter((c) => c !== contract);
    state.credits += contract.reward;
    state.stats.contracts += 1;
    state.stats.earned += Math.max(0, contract.reward - contract.basis);
    earnStanding(state, stationId, contract.reward, at);
    addLog(state, at, `Contract complete: ${formatNumber(contract.qty)} t ${lower(good)} for ${station.name}: +${formatCredits(contract.reward)}`, 'sale', contract.reward);
  }
  return { ok: true, qty, contract, completed, reward: completed ? contract.reward : 0 };
}

/** Ends contracts whose time ran out. Nothing is paid for them. */
export function expireContracts(state, at) {
  const contracts = state.contracts;
  for (const contract of contracts.active.filter((c) => c.deadline <= at)) {
    addLog(
      state,
      contract.deadline,
      `Contract ran out: ${formatNumber(contract.delivered)} of ${formatNumber(contract.qty)} t ${lower(contract.good)} delivered to ${findStation(contract.stationId).name}`,
      'warning',
    );
  }
  contracts.active = contracts.active.filter((c) => c.deadline > at);
}

/**
 * What the map marks: for each station (and each system) with contracts,
 * whether it has an offer waiting and whether one is running.
 * Returns { stations: Map, systems: Map } of { offer, active }.
 */
export function contractMarks(state, at = state.now) {
  const stations = new Map();
  const systems = new Map();
  const mark = (stationId, key) => {
    for (const [map, id] of [[stations, stationId], [systems, systemOf(stationId)]]) {
      const entry = map.get(id) ?? { offer: false, active: false };
      entry[key] = true;
      map.set(id, entry);
    }
  };
  for (const offer of state.contracts.offers) if (offer.expiresAt > at) mark(offer.stationId, 'offer');
  for (const contract of state.contracts.active) if (contract.deadline > at) mark(contract.stationId, 'active');
  return { stations, systems };
}

/** When the next contract event is due: a time running out or a check. */
export function nextContractEvent(state) {
  if (!boardOpen(state)) return null;
  const times = [
    ...state.contracts.active.map((c) => c.deadline),
    ...state.contracts.offers.map((o) => o.expiresAt),
    ...Object.entries(state.contracts.checks ?? {})
      .filter(([id]) => isSurveyed(state, id))
      .map(([, at]) => at),
  ];
  return times.length ? Math.min(...times) : null;
}

/** Where a contract is, for lists: the station, and its system when that is not home and the name does not say. */
export function contractPlace(contract) {
  const station = findStation(contract.stationId);
  const system = findSystem(systemOf(contract.stationId));
  return system.id === HOME_SYSTEM.id || station.name.startsWith(system.name) ? station.name : `${station.name} in ${system.name}`;
}
