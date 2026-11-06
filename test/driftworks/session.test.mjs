import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../public/games/driftworks/core/session.js';
import { createMemoryStorage } from '../../public/shared/js/storage.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { sellCargo } from '../../public/games/driftworks/systems/cargo.js';
import { MINUTE, T0 } from './helpers.mjs';

function setup() {
  let now = T0;
  const storage = createMemoryStorage();
  const clock = () => now;
  const session = createSession({ storage, clock });
  const changes = [];
  session.subscribe((change) => changes.push(change));
  return { session, storage, clock, changes, setNow: (t) => (now = t) };
}

test('a new session starts a company and actions save it', () => {
  const { session, storage, changes } = setup();
  const result = session.act((state) => giveOrder(state, state.ships[0], { type: 'mine', fieldId: 'kx14', minutes: 5 }));
  assert.ok(result.ok);
  assert.ok(session.state.goals.includes('first-trip'), 'goals are checked right after an action');
  assert.ok(storage.getItem('driftworks-save'));
  assert.equal(changes.at(-1).source, 'act');
  assert.ok(changes.at(-1).log.some((e) => e.kind === 'goal'));
});

test('tick reports what happened since the last tick', () => {
  const { session, changes, setNow } = setup();
  session.act((state) => giveOrder(state, state.ships[0], { type: 'mine', fieldId: 'kx14', minutes: 5 }));
  setNow(T0 + 2 * MINUTE);
  assert.equal(session.tick(), false);
  setNow(T0 + 6 * MINUTE);
  assert.equal(session.tick(), true);
  assert.ok(changes.at(-1).log.some((e) => e.kind === 'arrival'));
});

test('a reload picks up where the last session left off', () => {
  const { session, storage } = setup();
  session.act((state) => giveOrder(state, state.ships[0], { type: 'mine', fieldId: 'kx14', minutes: 5 }));
  const later = createSession({ storage, clock: () => T0 + 10 * MINUTE });
  later.tick();
  const ship = later.state.ships[0];
  assert.equal(ship.at, 'halcyon-refinery');
  assert.ok(ship.cargo['ferrite-ore'] > 0);
});

test('failed actions are passed back and still emit a change', () => {
  const { session, changes } = setup();
  const result = session.act((state) => sellCargo(state, state.ships[0], 'iron'));
  assert.equal(result.ok, false);
  assert.equal(changes.at(-1).result, result);
});

test('import replaces the company, and reset starts over', () => {
  const { session, storage } = setup();
  session.act((state) => {
    state.credits = 9999;
  });
  const code = session.exportText();
  session.reset();
  assert.equal(session.state.credits, 600);
  assert.equal(session.importText('garbage'), false);
  assert.ok(session.importText(code));
  assert.equal(session.state.credits, 9999);
  assert.equal(JSON.parse(storage.getItem('driftworks-save')).credits, 9999);
});
