import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../public/games/driftworks/core/session.js';
import { createMemoryStorage } from '../../public/shared/js/storage.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { sellCargo } from '../../public/games/driftworks/systems/cargo.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
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

const MINE = { type: 'mine', fieldId: 'kx14', amount: null };
const SELL = { type: 'sell', stationId: 'halcyon-refinery' };

test('a new session starts a company and actions save it', () => {
  const { session, storage, changes } = setup();
  session.act((state) => giveOrder(state, state.ships[0], MINE));
  assert.ok(session.act((state) => giveOrder(state, state.ships[0], SELL)).ok);
  // A sale on the spot completes the first goal within the same action.
  const result = session.act((state) => {
    const ship = createShip(state, 'mule', 'halcyon-refinery');
    ship.cargo['ferrite-ore'] = 10;
    return sellCargo(state, ship, 'ferrite-ore');
  });
  assert.ok(result.ok);
  assert.ok(session.state.goals.includes('first-sale'), 'goals are checked right after an action');
  assert.ok(storage.getItem('driftworks-save'));
  assert.equal(changes.at(-1).source, 'act');
  assert.ok(changes.at(-1).log.some((e) => e.kind === 'goal'));
});

test('tick reports what happened since the last tick', () => {
  const { session, changes, setNow } = setup();
  session.act((state) => giveOrder(state, state.ships[0], MINE));
  setNow(T0 + 0.5 * MINUTE);
  assert.equal(session.tick(), false);
  setNow(T0 + 6 * MINUTE);
  assert.equal(session.tick(), true);
  assert.ok(changes.at(-1).log.some((e) => e.kind === 'mined'));
});

test('a reload picks up where the last session left off', () => {
  const { session, storage } = setup();
  session.act((state) => giveOrder(state, state.ships[0], MINE));
  const later = createSession({ storage, clock: () => T0 + 10 * MINUTE });
  later.tick();
  const ship = later.state.ships[0];
  assert.equal(ship.at, 'kx14');
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
  assert.equal(session.state.credits, 250);
  assert.equal(session.importText('garbage'), false);
  assert.ok(session.importText(code));
  assert.equal(session.state.credits, 9999);
  assert.equal(JSON.parse(storage.getItem('driftworks-save')).credits, 9999);
});

test('a sale where the ship is docked happens within the action', () => {
  const { session } = setup();
  session.act((state) => {
    state.ships[0].cargo['ferrite-ore'] = 10;
  });
  const credits = session.state.credits;
  session.act((state) => giveOrder(state, state.ships[0], SELL));
  assert.ok(session.state.credits > credits);
  assert.equal(session.state.ships[0].order, null);
});

test('a save from before the rebuild starts a new company with a note', () => {
  const storage = createMemoryStorage();
  storage.setItem('driftworks-save', JSON.stringify({ version: 1, ships: [], credits: 5 }));
  const session = createSession({ storage, clock: () => T0 });
  assert.equal(session.state.credits, 250);
  assert.match(session.state.log.at(-1).text, /starts over/);
});
