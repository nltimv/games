import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { currentGuide } from '../../public/games/driftworks/ui/tutorial.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

const onMap = (selection = null) => ({ view: 'system', selection, menu: null });
const SHORTCUTS = /repeat-fill|run-again|copy-/;

test('every tutorial step has a guide, and none makes a shortcut a step', () => {
  const tutorial = GOALS.filter((goal) => goal.tutorial);
  tutorial.forEach((goal, i) => {
    const state = newGame();
    state.goals = tutorial.slice(0, i).map((g) => g.id);
    const guide = currentGuide(state, onMap());
    assert.equal(guide?.goal.id, goal.id);
    assert.ok(guide.text, goal.id);
    assert.doesNotMatch(guide.selector ?? '', SHORTCUTS, goal.id);
  });
});

test('the first sale can wait for the hold to fill; queuing it now is only a tip', () => {
  const state = newGame();
  const mule = firstShip(state);
  const selected = onMap({ kind: 'ship', id: mule.id });
  assert.match(currentGuide(state, selected).text, /Mine a full hold/);
  giveOrder(state, mule, { type: 'mine', fieldId: 'carbon-drift', amount: null });
  const mining = currentGuide(state, selected);
  assert.match(mining.text, /When it is done/);
  assert.match(mining.tip, /queue/);
  advance(state, T0 + 10 * MINUTE); // waits at the field with a full hold
  const full = currentGuide(state, selected);
  assert.match(full.text, /hold is full/);
  assert.equal(full.tip, undefined);
});

test('a second Mule can be given any orders; copying is a tip', () => {
  const state = newGame();
  state.goals = ['first-sale', 'first-research'];
  const a = firstShip(state);
  giveOrder(state, a, { type: 'mine', fieldId: 'carbon-drift', amount: null });
  giveOrder(state, a, { type: 'sell', stationId: 'halcyon-refinery' });
  const b = createShip(state, 'mule', 'halcyon-shipyard');
  const guide = currentGuide(state, onMap({ kind: 'ship', id: b.id }));
  assert.match(guide.text, /Mine a full hold/);
  assert.match(guide.tip, new RegExp(`Copy orders from ${a.name}`));
});
