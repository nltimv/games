// Orders at signals (see systems/signals.js):
//   { type: 'investigate', signalId }  scouts: fly to a signal and find out
//                                      what it is
//   { type: 'salvage', signalId }      haulers with a sealed hold: fly to a
//                                      derelict and take its cargo aboard
// Both take SIGNAL_MINUTES at the signal.

import { goodName } from '../content/goods.js';
import { HULLS } from '../content/ships.js';
import { findSignal, findSystem, systemOf } from '../content/galaxy.js';
import { canCarry, cargoTotal, holdNote } from './cargo.js';
import { flight, route } from './courses.js';
import { isSurveyed } from './explore.js';
import { holdOf } from './modules.js';
import { SIGNAL_TIME, derelictLeft, isInvestigated, workerAt } from './signals.js';

const fail = (error) => ({ ok: false, error });

/** The flight to a signal and the stay there: { ok, legs, end, fees, jumps }. */
function signalLegs(state, view, signal, start) {
  const course = flight(state, view, signal.id, start);
  if (!course.ok) return course;
  const end = start + course.travel + SIGNAL_TIME;
  const legs = [...course.legs, { from: signal.id, to: signal.id, start: start + course.travel, end }];
  return { ok: true, legs, end, ...route(course) };
}

export function buildInvestigate(state, view, { signalId }, start) {
  if (HULLS[view.hull].role !== 'scout') return fail('Only scouts can investigate signals.');
  const signal = findSignal(signalId);
  const system = findSystem(systemOf(signalId));
  if (!signal || !isSurveyed(state, system.id)) return fail('No such signal.');
  if (isInvestigated(state, signal)) return fail(`The signal in ${system.name} has been investigated.`);
  const other = workerAt(state, signalId, 'investigate');
  if (other && other.id !== view.id) return fail(`${other.name} is already on its way to the signal.`);
  const course = signalLegs(state, view, signal, start);
  if (!course.ok) return course;
  return {
    ok: true,
    order: {
      type: 'investigate',
      label: `Investigating a signal in ${system.name}`,
      flightLabel: `Flying to the signal in ${system.name}`,
      target: signalId,
      startedAt: start,
      endsAt: course.end,
      steps: [{ at: course.end, kind: 'investigate', signal: signalId, station: signalId }],
      legs: course.legs,
      fees: course.fees,
      jumps: course.jumps,
    },
  };
}

export function buildSalvage(state, view, { signalId }, start) {
  if (HULLS[view.hull].role !== 'hauler') return fail('Only haulers can salvage.');
  const signal = findSignal(signalId);
  const system = findSystem(systemOf(signalId));
  if (!signal || signal.kind !== 'derelict' || !isInvestigated(state, signal)) return fail('There is nothing to salvage there.');
  const left = derelictLeft(state, signal);
  if (left < 1) return fail(`The derelict in ${system.name} is empty.`);
  if (!canCarry(view, signal.good)) return fail(holdNote(signal.good, view));
  const room = Math.floor(holdOf(view) - cargoTotal(view));
  if (room < 1) return fail(`${view.name}'s hold is full.`);
  const course = signalLegs(state, view, signal, start);
  if (!course.ok) return course;
  const qty = Math.min(left, room);
  return {
    ok: true,
    order: {
      type: 'salvage',
      label: `Salvaging ${goodName(signal.good).toLowerCase()} in ${system.name}`,
      flightLabel: `Flying to the derelict in ${system.name}`,
      target: signalId,
      startedAt: start,
      endsAt: course.end,
      steps: [{ at: course.end, kind: 'salvage', signal: signalId, station: signalId, good: signal.good, qty }],
      legs: course.legs,
      fees: course.fees,
      jumps: course.jumps,
    },
  };
}
