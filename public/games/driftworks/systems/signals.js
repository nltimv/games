// Signals: about three in ten deep systems hold one, seeded from the save
// (see content/galaxy.js). A survey shows a signal as unknown; a scout's
// Investigate order shows what it is:
//   derelict   a wreck with processed goods or components aboard, taken
//              once by a hauler with a sealed hold (the Salvage order)
//   rich       an asteroid field far richer than others, which stays
//   gate       one end of an ancient gate, which opens as a lane (with no
//              fee) once both ends are investigated
// Nothing here is ever lost: a derelict waits until it is salvaged.

import { goodName } from '../content/goods.js';
import { allSystems, ancientLaneFrom, findSignal, findSystem, gateTo, signalIn, systemOf } from '../content/galaxy.js';
import { formatNumber } from '../../../shared/js/format.js';
import { MINUTE } from '../core/time.js';
import { isSurveyed } from './explore.js';
import { addLog } from './log.js';

/** How long investigating or salvaging takes once the ship is at the signal. */
export const SIGNAL_MINUTES = 15;
export const SIGNAL_TIME = SIGNAL_MINUTES * MINUTE;

const record = (state, signalId) => state.signals?.[signalId] ?? null;

/** Whether the company knows a signal is there: its system is surveyed. */
export function isFound(state, signal) {
  return Boolean(signal) && isSurveyed(state, systemOf(signal.id));
}

export function isInvestigated(state, signal) {
  return Boolean(signal && record(state, signal.id)?.investigatedAt != null);
}

/** Signals in surveyed systems, investigated or not. */
export function foundSignals(state) {
  return allSystems()
    .map((system) => system.signal)
    .filter((signal) => isFound(state, signal));
}

/** Tonnes still aboard a derelict. */
export function derelictLeft(state, signal) {
  if (signal?.kind !== 'derelict') return 0;
  return Math.max(0, signal.qty - (record(state, signal.id)?.salvaged ?? 0));
}

/** Whether both ends of an ancient gate are investigated, so ships can use it. */
export function isGateOpen(state, signal) {
  if (signal?.kind !== 'gate' || !isInvestigated(state, signal)) return false;
  return isInvestigated(state, signalIn(signal.to));
}

/**
 * The ancient lane out of a system when it is open, as a link for routes:
 * { to, lane, exit, entry } with the two gate places. Null otherwise.
 */
export function ancientLink(state, systemId) {
  const link = ancientLaneFrom(systemId);
  const signal = signalIn(systemId);
  if (!link || !isGateOpen(state, signal)) return null;
  return { to: link.to, lane: link.lane, exit: signal.gate, entry: signalIn(link.to).gate };
}

/** Every link out of a system: its lanes, and an open ancient gate. */
export function linksFrom(state, systemId, lanes) {
  const links = lanes.map(({ to, lane }) => ({ to, lane, exit: gateTo(systemId, to), entry: gateTo(to, systemId) }));
  const ancient = ancientLink(state, systemId);
  return ancient ? [...links, ancient] : links;
}

/** A rich field the company may mine: its signal has been investigated. */
export function isFieldOpen(state, field) {
  return !field?.signal || isInvestigated(state, findSignal(field.signal));
}

/** The fields of a system the company can see: its own, and a rich field once investigated. */
export function fieldsOf(state, system) {
  const rich = system?.signal?.field;
  return rich && isInvestigated(state, system.signal) ? [...system.fields, rich] : (system?.fields ?? []);
}

/** The ship with an order (now or queued) of `type` for a signal, or null. */
export function workerAt(state, signalId, type) {
  return state.ships.find((ship) => [ship.order?.spec, ...(ship.queue ?? [])].some((spec) => spec?.type === type && spec.signalId === signalId)) ?? null;
}

/** What a signal is, for lists and panels: "Unknown signal", "Derelict: 240 t circuits", … */
export function signalTitle(state, signal) {
  if (!isInvestigated(state, signal)) return 'Unknown signal';
  if (signal.kind === 'derelict') return derelictLeft(state, signal) > 0 ? 'Derelict freighter' : 'Empty derelict';
  if (signal.kind === 'rich') return signal.field.name;
  return signal.gate.name;
}

/** Called when a scout's Investigate order ends. */
export function investigateSignal(state, ship, signalId, at) {
  const signal = findSignal(signalId);
  if (!signal || isInvestigated(state, signal)) return null;
  state.signals ??= {};
  state.signals[signalId] = { ...record(state, signalId), investigatedAt: at };
  state.stats.signals = (state.stats.signals ?? 0) + 1;
  const system = findSystem(systemOf(signalId));
  if (signal.kind === 'derelict') {
    addLog(state, at, `${ship.name} found a derelict freighter in ${system.name}, with ${formatNumber(signal.qty)} t ${goodName(signal.good).toLowerCase()} aboard`, 'goal');
  } else if (signal.kind === 'rich') {
    addLog(state, at, `${ship.name} found ${signal.field.name} in ${system.name}: ${goodName(signal.field.good).toLowerCase()}, far richer than other fields`, 'goal');
  } else {
    const far = findSystem(signal.to);
    const open = isGateOpen(state, signal);
    addLog(state, at, open ? `The ancient gate between ${system.name} and ${far.name} is open` : `${ship.name} found an ancient gate in ${system.name}. It leads to ${far.name}, and opens from both ends`, 'goal');
  }
  return signal;
}

/** Called when a hauler's Salvage order ends: takes what fits of the derelict's cargo. Returns the tonnes taken. */
export function salvageSignal(state, ship, signalId, room, at) {
  const signal = findSignal(signalId);
  const left = derelictLeft(state, signal);
  const qty = Math.floor(Math.min(left, room));
  if (qty < 1) return 0;
  state.signals[signalId] = { ...record(state, signalId), salvaged: (record(state, signalId)?.salvaged ?? 0) + qty };
  ship.cargo[signal.good] = (ship.cargo[signal.good] ?? 0) + qty;
  state.stats.salvaged = (state.stats.salvaged ?? 0) + 1;
  const rest = left - qty;
  const system = findSystem(systemOf(signalId));
  addLog(state, at, `${ship.name} salvaged ${formatNumber(qty)} t ${goodName(signal.good).toLowerCase()} from the derelict in ${system.name}${rest > 0 ? ` (${formatNumber(rest)} t left)` : ''}`, 'arrival');
  return qty;
}
