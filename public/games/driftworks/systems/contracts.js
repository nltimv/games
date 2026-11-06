// Contracts: a buyer pays more than market for a set amount of one good at
// one station, for a few hours. They make goods worth more, never mining
// faster. The board opens with the Brokerage research.
//
// Offers wait on the board until accepted or stale. An accepted contract
// counts every sale of its good at its station until it is filled or its
// time runs out; running out costs nothing.

import { GOODS, goodName } from '../content/goods.js';
import { HULLS, MODULES } from '../content/ships.js';
import { HOME_SYSTEM, findStation } from '../content/homeSystem.js';
import { formatNumber } from '../../../shared/js/format.js';
import { seededUnit } from '../core/rng.js';
import { HOUR } from '../core/time.js';
import { findEntry } from './market.js';
import { isResearched, researchLevel } from './research.js';
import { addLog } from './log.js';

export const CONTRACT_RULES = {
  // Offers on the board at once, and how long each stays.
  board: 3,
  boardHours: 4,
  // Contracts the company can hold at once.
  maxActive: 2,
  // Paid on top of the market price.
  premium: 0.5,
  hours: 4,
  // An ore contract asks for this many holds of the newest Mule.
  holds: 3,
};

const ORES = ['ferrite-ore', 'carbon-ore', 'silicate-rock', 'ice'];
const REFINED = ['iron', 'silicon', 'graphite', 'water'];

const fail = (error) => ({ ok: false, error });

export function boardOpen(state) {
  return isResearched(state, 'brokerage');
}

function roundTo(value, step) {
  return Math.max(step, Math.round(value / step) * step);
}

function newOffer(state, at) {
  const id = state.contracts.nextId;
  state.contracts.nextId += 1;
  const roll = (label) => seededUnit(state.seed, `contract:${id}:${label}`);
  const hasHauler = state.ships.some((ship) => HULLS[ship.hull].role === 'hauler');
  const taken = new Set([...state.contracts.offers, ...state.contracts.active].map((c) => `${c.stationId}:${c.good}`));

  const pool = hasHauler && roll('kind') < 0.4 ? REFINED : ORES;
  const choices = [];
  for (const good of pool) {
    for (const station of HOME_SYSTEM.stations) {
      if (findEntry(station.id, good)?.side === 'buys' && !taken.has(`${station.id}:${good}`)) choices.push({ good, stationId: station.id });
    }
  }
  if (!choices.length) return null;
  const pick = choices[Math.floor(roll('pick') * choices.length)];
  const muleHold = MODULES.hold.levels[researchLevel(state, 'hold')];
  const qty = GOODS[pick.good].tier === 1 ? roundTo(muleHold * CONTRACT_RULES.holds, 5) : roundTo(muleHold * HULLS.kite.holdScale, 5);
  return { id, ...pick, qty, premium: CONTRACT_RULES.premium, expiresAt: at + CONTRACT_RULES.boardHours * HOUR };
}

/** Drops stale offers and tops the board up. Cheap; call it freely. */
export function refreshBoard(state, at = state.now) {
  if (!boardOpen(state)) return;
  const contracts = state.contracts;
  contracts.offers = contracts.offers.filter((offer) => offer.expiresAt > at);
  while (contracts.offers.length < CONTRACT_RULES.board) {
    const offer = newOffer(state, at);
    if (!offer) break;
    contracts.offers.push(offer);
  }
}

export function acceptContract(state, offerId, at = state.now) {
  const contracts = state.contracts;
  const offer = contracts.offers.find((o) => o.id === offerId);
  if (!offer) return fail('That offer is gone.');
  if (contracts.active.length >= CONTRACT_RULES.maxActive) return fail(`You can hold ${CONTRACT_RULES.maxActive} contracts at once.`);
  contracts.offers = contracts.offers.filter((o) => o !== offer);
  const contract = {
    id: offer.id,
    stationId: offer.stationId,
    good: offer.good,
    qty: offer.qty,
    delivered: 0,
    premium: offer.premium,
    acceptedAt: at,
    deadline: at + CONTRACT_RULES.hours * HOUR,
  };
  contracts.active.push(contract);
  state.stats.contractsAccepted += 1;
  addLog(state, at, `Contract accepted: ${formatNumber(contract.qty)} t ${goodName(contract.good).toLowerCase()} for ${findStation(contract.stationId).name}`, 'order');
  refreshBoard(state, at);
  return { ok: true, contract };
}

/** The running contract for a good at a station, if any. */
export function contractFor(state, stationId, good, at = state.now) {
  return state.contracts.active.find((c) => c.stationId === stationId && c.good === good && c.deadline > at && c.delivered < c.qty) ?? null;
}

/** The extra a sale of `qty` at `average` per tonne would earn, without changing anything. */
export function contractBonus(state, stationId, good, qty, average, at = state.now) {
  const contract = contractFor(state, stationId, good, at);
  if (!contract || qty <= 0) return 0;
  return Math.min(qty, contract.qty - contract.delivered) * average * contract.premium;
}

/** Books a sale against its contract. Returns the extra credits it earned. */
export function deliverToContract(state, stationId, good, qty, average, at = state.now) {
  const contract = contractFor(state, stationId, good, at);
  if (!contract || qty <= 0) return 0;
  const covered = Math.min(qty, contract.qty - contract.delivered);
  contract.delivered += covered;
  const bonus = covered * average * contract.premium;
  if (contract.delivered >= contract.qty) {
    state.contracts.active = state.contracts.active.filter((c) => c !== contract);
    state.stats.contracts += 1;
    addLog(state, at, `Contract filled: ${formatNumber(contract.qty)} t ${goodName(good).toLowerCase()} for ${findStation(stationId).name}`, 'goal');
    refreshBoard(state, at);
  }
  return bonus;
}

/** Ends contracts whose time ran out. */
export function expireContracts(state, at) {
  const contracts = state.contracts;
  for (const contract of contracts.active.filter((c) => c.deadline <= at)) {
    addLog(
      state,
      contract.deadline,
      `Contract ended: ${formatNumber(contract.delivered)} of ${formatNumber(contract.qty)} t ${goodName(contract.good).toLowerCase()} delivered to ${findStation(contract.stationId).name}`,
      'info',
    );
  }
  contracts.active = contracts.active.filter((c) => c.deadline > at);
}

/** "+50%" for the UI. */
export function premiumText(contract) {
  return `+${Math.round(contract.premium * 100)}%`;
}
