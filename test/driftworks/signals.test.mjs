import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAZARD_DEPTH, allSystems, currentGalaxy, findSystem, signalIn, systemOf, useGalaxy } from '../../public/games/driftworks/content/galaxy.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { derelictLeft, fieldsOf, investigateSignal, isGateOpen, isInvestigated, signalTitle } from '../../public/games/driftworks/systems/signals.js';
import { plotCourse } from '../../public/games/driftworks/systems/travel.js';
import { newGame } from './helpers.mjs';

const OPEN_ALL = ['warp-drive', 'scout-licence', 'lane-charts', 'jump-1', 'kite-licence', 'sealed-holds', 'shield-debris', 'shield-ion', 'shield-radiation', 'deep-shielding'];

/** A company that can fly anywhere and has surveyed the whole galaxy. */
function deepGame() {
  const state = newGame({ credits: 1e9 });
  useGalaxy(state.seed);
  state.research.done.push(...OPEN_ALL);
  for (const system of allSystems()) markSurveyed(state, system.id, state.now);
  return state;
}

const signalsOf = (kind) => allSystems().filter((s) => s.signal?.kind === kind).map((s) => s.signal);

test('about three in ten deep systems hold a signal, and ancient gates come in pairs', () => {
  newGame();
  const deep = allSystems().filter((s) => s.depth >= HAZARD_DEPTH);
  const share = deep.filter((s) => s.signal).length / deep.length;
  assert.ok(share > 0.2 && share < 0.4, `share ${share}`);
  assert.ok(allSystems().every((s) => !s.signal || s.depth >= HAZARD_DEPTH));
  assert.ok(signalsOf('derelict').length > 0 && signalsOf('rich').length > 0);
  const gates = signalsOf('gate');
  assert.ok(gates.length >= 4 && gates.length % 2 === 0);
  for (const signal of gates) assert.equal(signalIn(signal.to).to, systemOf(signal.id), 'the far end leads back');
  assert.equal(currentGalaxy().ancientLanes.length, gates.length / 2);
  assert.ok(currentGalaxy().ancientLanes.every((lane) => lane.fee === 0));
});

test('a scout investigates a derelict, and a hauler with a sealed hold salvages it', () => {
  const state = deepGame();
  const derelict = signalsOf('derelict')[0];
  const kite = createShip(state, 'kite', 'halcyon-shipyard');
  assert.equal(signalTitle(state, derelict), 'Unknown signal');
  assert.equal(giveOrder(state, kite, { type: 'salvage', signalId: derelict.id }).ok, false, 'not investigated yet');

  const lark = createShip(state, 'lark', 'halcyon-shipyard');
  const sent = giveOrder(state, lark, { type: 'investigate', signalId: derelict.id });
  assert.ok(sent.ok, sent.error);
  const other = createShip(state, 'lark', 'halcyon-shipyard');
  assert.match(giveOrder(state, other, { type: 'investigate', signalId: derelict.id }).error, /already on its way/);
  advance(state, lark.order.endsAt + 1);
  assert.ok(isInvestigated(state, derelict));
  assert.equal(state.stats.signals, 1);
  assert.equal(signalTitle(state, derelict), 'Derelict freighter');
  assert.match(giveOrder(state, other, { type: 'investigate', signalId: derelict.id }).error, /has been investigated/);

  // Only haulers salvage, and only with a sealed hold.
  assert.match(giveOrder(state, state.ships[0], { type: 'salvage', signalId: derelict.id }).error, /Only haulers/);
  kite.modules.seal = 0;
  assert.match(giveOrder(state, kite, { type: 'salvage', signalId: derelict.id }).error, /sealed hold/);
  kite.modules.seal = 1;
  const salvage = giveOrder(state, kite, { type: 'salvage', signalId: derelict.id });
  assert.ok(salvage.ok, salvage.error);
  advance(state, kite.order.endsAt + 1);
  const taken = kite.cargo[derelict.good];
  assert.ok(taken > 0);
  assert.equal(derelictLeft(state, derelict), derelict.qty - taken);
  assert.equal(state.stats.salvaged, 1);
  if (derelictLeft(state, derelict) === 0) assert.equal(signalTitle(state, derelict), 'Empty derelict');
});

test('an ancient gate opens once both ends are investigated, and routes use it for free', () => {
  const state = deepGame();
  const here = signalsOf('gate')[0];
  const there = signalIn(here.to);
  const lark = createShip(state, 'lark', 'halcyon-shipyard');
  const before = plotCourse(state, lark, here.id, there.id);
  assert.ok(before.ok);

  investigateSignal(state, lark, here.id, state.now);
  assert.equal(isGateOpen(state, here), false, 'one end is not enough');
  investigateSignal(state, lark, there.id, state.now);
  assert.ok(isGateOpen(state, here) && isGateOpen(state, there));

  const after = plotCourse(state, lark, here.id, there.id);
  assert.ok(after.ok);
  assert.equal(after.jumps, 1);
  assert.equal(after.fees, 0);
  assert.ok(after.time < before.time);
  assert.match(state.log.at(-1).text, /ancient gate between .* is open/);
});

test('a rich field opens to miners once its signal is investigated', () => {
  const state = deepGame();
  const signal = signalsOf('rich')[0];
  const system = findSystem(systemOf(signal.id));
  const mule = state.ships[0];
  assert.ok(!fieldsOf(state, system).includes(signal.field));
  assert.equal(giveOrder(state, mule, { type: 'mine', fieldId: signal.field.id }).ok, false);
  investigateSignal(state, mule, signal.id, state.now);
  assert.ok(fieldsOf(state, system).includes(signal.field));
  assert.ok(signal.field.richness >= 3);
  const mine = giveOrder(state, mule, { type: 'mine', fieldId: signal.field.id });
  assert.ok(mine.ok, mine.error);
});

test('signals are kept in the save', () => {
  const state = deepGame();
  const signal = signalsOf('derelict')[0];
  investigateSignal(state, state.ships[0], signal.id, state.now);
  const loaded = deserialize(serialize(state));
  assert.ok(isInvestigated(loaded, signal));

  const old = JSON.parse(serialize(newGame()));
  old.version = 4;
  delete old.signals;
  assert.deepEqual(deserialize(JSON.stringify(old)).signals, {});
});
