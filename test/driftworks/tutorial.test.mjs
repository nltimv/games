import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { guideSkipped, skipGuide } from '../../public/games/driftworks/systems/goals.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { currentGuide } from '../../public/games/driftworks/ui/tutorial.js';
import { newGame, firstShip, MINUTE, T0 } from './helpers.mjs';

const onMap = (selection = null) => ({ view: 'system', selection, menu: null });
const SHORTCUTS = /repeat-fill|run-again|copy-/;

test('every tutorial step has a guide, and none makes a shortcut a step', () => {
  const tutorial = GOALS.filter((goal) => goal.tutorial && !goal.act);
  tutorial.forEach((goal, i) => {
    const state = newGame();
    state.goals = tutorial.slice(0, i).map((g) => g.id);
    const guide = currentGuide(state, onMap());
    assert.equal(guide?.goal.id, goal.id);
    assert.ok(guide.text, goal.id);
    assert.doesNotMatch(guide.selector ?? '', SHORTCUTS, goal.id);
  });
});

test('the act 2 guide covers the scout, the survey and the first far sale, and can be skipped on its own', () => {
  const act1 = GOALS.filter((goal) => !goal.act).map((goal) => goal.id);
  const guided = GOALS.filter((goal) => goal.tutorial && goal.act === 2);
  assert.deepEqual(guided.map((g) => g.id), ['first-scout', 'first-survey', 'far-sale']);
  const state = newGame({ credits: 1e6 });
  state.tutorial.skipped = true; // skipping act 1's tutorial leaves act 2's guide on
  state.research.done.push('kite-licence', 'warp-drive');
  createShip(state, 'kite', 'halcyon-refinery');
  state.goals = [...act1];
  assert.match(currentGuide(state, onMap()).text, /Scout licence/);
  state.research.done.push('scout-licence');
  assert.match(currentGuide(state, onMap()).text, /Halcyon Shipyard/);
  const lark = createShip(state, 'lark', 'halcyon-shipyard');
  state.goals.push('first-scout');
  const galaxy = (selection = null) => ({ view: 'galaxy', selection, menu: null });
  assert.match(currentGuide(state, onMap()).text, /Galaxy map/);
  assert.match(currentGuide(state, galaxy()).text, /Select Lark-1/);
  const survey = currentGuide(state, galaxy({ kind: 'ship', id: lark.id }));
  assert.equal(survey.map.kind, 'system');
  assert.match(survey.text, /pick Survey/);
  giveOrder(state, lark, { type: 'survey', systemId: survey.map.id });
  assert.match(currentGuide(state, galaxy()).text, /surveys it/);
  advance(state, lark.order.endsAt);
  // Survey a neighbour with a station that buys refined goods, for the far sale.
  for (const id of ['brennan', 'dace', 'elm', 'fenn']) markSurveyed(state, id, state.now);
  state.goals.push('first-survey');
  const sale = currentGuide(state, galaxy());
  assert.equal(sale.goal.id, 'far-sale');
  assert.match(sale.text, /Kite-1/);
  // Skipping hides only act 2's guide.
  skipGuide(state, 2);
  assert.equal(currentGuide(state, galaxy()), null);
  assert.equal(guideSkipped(state, 1), true);
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
