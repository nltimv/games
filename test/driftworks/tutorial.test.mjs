import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { markSurveyed } from '../../public/games/driftworks/systems/explore.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { guideSkipped, skipGuide } from '../../public/games/driftworks/systems/goals.js';
import { giveOrder, orderRefit } from '../../public/games/driftworks/systems/orders.js';
import { acceptContract } from '../../public/games/driftworks/systems/contracts.js';
import { planBuild } from '../../public/games/driftworks/systems/shipyard.js';
import { HOME_SYSTEM } from '../../public/games/driftworks/content/homeSystem.js';
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
  state.research.done.push('warp-drive');
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

test('the refit guide waits for Cargo racks I, then sends the first Mule to the shipyard', () => {
  const state = newGame();
  state.goals = ['first-sale', 'carry-goods', 'first-research', 'first-build', 'first-contract', 'first-licence'];
  state.research.active = { id: 'hold-1', endsAt: T0 + MINUTE };
  assert.match(currentGuide(state, onMap()).text, /Cargo racks I is done at/);
  state.research.active = null;
  state.research.done.push('hold-1');
  const find = currentGuide(state, onMap());
  assert.equal(find.goal.id, 'first-refit');
  assert.deepEqual(find.map, { kind: 'station', id: 'halcyon-shipyard' });
  const mule = firstShip(state);
  assert.equal(currentGuide(state, onMap({ kind: 'station', id: 'halcyon-shipyard' })).selector, '[data-key^="refit-"]');
  assert.ok(orderRefit(state, mule, 'halcyon-shipyard').ok);
  assert.deepEqual(currentGuide(state, onMap()).map, { kind: 'ship', id: mule.id });
});

test('a new Mule can be given any orders; copying is a tip', () => {
  const state = newGame();
  state.goals = ['first-sale', 'carry-goods', 'first-research', 'first-build'];
  state.research.done.push('brokerage');
  advance(state, T0);
  const offer = state.contracts.offers.find((o) => HOME_SYSTEM.fields.some((f) => f.good === o.good));
  acceptContract(state, offer.id, T0);
  const a = firstShip(state);
  giveOrder(state, a, { type: 'mine', fieldId: 'carbon-drift', amount: null });
  giveOrder(state, a, { type: 'sell', stationId: 'halcyon-refinery' });
  const b = createShip(state, 'mule', 'halcyon-shipyard');
  const guide = currentGuide(state, onMap({ kind: 'ship', id: b.id }));
  assert.match(guide.text, /Mine a full hold/);
  assert.match(guide.tip, new RegExp(`Copy orders from ${a.name}`));
});

test('the Kite step buys iron at the refinery and sells it at the foundry', () => {
  const state = newGame();
  state.goals = ['first-sale'];
  const kite = state.ships.find((ship) => ship.hull === 'kite');
  assert.deepEqual(currentGuide(state, onMap()).map, { kind: 'ship', id: kite.id });
  const selected = onMap({ kind: 'ship', id: kite.id });
  assert.deepEqual(currentGuide(state, selected).map, { kind: 'station', id: 'halcyon-refinery' });
  const menu = { ...selected, menu: { target: { kind: 'station', id: 'halcyon-refinery' } } };
  assert.equal(currentGuide(state, menu).selector, '[data-key="menu-buy-iron"]');
  assert.ok(giveOrder(state, kite, { type: 'buy', stationId: 'halcyon-refinery', good: 'iron', qty: 20 }).ok);
  const sell = currentGuide(state, selected);
  assert.deepEqual(sell.map, { kind: 'station', id: 'halcyon-foundry' });
  giveOrder(state, kite, { type: 'sell', stationId: 'halcyon-foundry' });
  assert.match(currentGuide(state, onMap()).text, /sells the iron/);
  advance(state, kite.order.endsAt + 1);
  advance(state, kite.order?.endsAt ?? state.now);
  assert.ok(state.goals.includes('carry-goods'));
});

test('the build step plans a Mule, has the Kite fetch its recipe and starts the build', () => {
  const state = newGame({ credits: 5000 });
  state.goals = ['first-sale', 'carry-goods', 'first-research'];
  const yard = onMap({ kind: 'station', id: 'halcyon-shipyard' });
  assert.match(currentGuide(state, onMap()).text, /allowance/);
  const plan = currentGuide(state, yard);
  assert.equal(plan.selector, '[data-key="plan-mule"]');
  assert.match(plan.tip, /Build now/);
  assert.ok(planBuild(state, 'mule', 'halcyon-shipyard').ok);
  const kite = state.ships.find((ship) => ship.hull === 'kite');
  const menu = { ...onMap({ kind: 'ship', id: kite.id }), menu: { target: { kind: 'station', id: 'halcyon-refinery' } } };
  assert.equal(currentGuide(state, menu).selector, '[data-key="menu-buy-iron"]');
  giveOrder(state, kite, { type: 'buy', stationId: 'halcyon-refinery', good: 'iron', qty: 12 });
  assert.equal(currentGuide(state, menu).selector, '[data-key="menu-buy-graphite"]');
  giveOrder(state, kite, { type: 'buy', stationId: 'halcyon-refinery', good: 'graphite', qty: 6 });
  advance(state, kite.order.endsAt);
  const deliver = currentGuide(state, { ...onMap({ kind: 'ship', id: kite.id }), menu: { target: { kind: 'station', id: 'halcyon-shipyard' } } });
  assert.equal(deliver.selector, '[data-key="menu-store-"]');
  assert.ok(giveOrder(state, kite, { type: 'store', stationId: 'halcyon-shipyard' }).ok);
  assert.match(currentGuide(state, onMap()).text, /brings the goods/);
  advance(state, kite.queue.length ? state.now : kite.order.endsAt);
  advance(state, kite.order?.endsAt ?? state.now);
  assert.equal(state.builds[0].status, 'queued');
  assert.ok(state.goals.includes('first-build'));
});

test('the contract guide finds the offer, then has its ore mined and delivered', () => {
  const state = newGame();
  state.goals = ['first-sale', 'carry-goods', 'first-research', 'first-build'];
  state.research.done.push('brokerage');
  advance(state, T0);
  const [offer] = state.contracts.offers;
  const find = currentGuide(state, onMap());
  assert.match(find.text, /gold !/);
  assert.deepEqual(find.map, { kind: 'station', id: offer.stationId });
  assert.equal(currentGuide(state, onMap({ kind: 'station', id: offer.stationId })).selector, `[data-key="accept-${offer.id}"]`);

  acceptContract(state, offer.id, T0);
  const mule = firstShip(state);
  const field = HOME_SYSTEM.fields.find((f) => f.good === offer.good);
  assert.deepEqual(currentGuide(state, onMap({ kind: 'ship', id: mule.id })).map, { kind: 'field', id: field.id });
  giveOrder(state, mule, { type: 'mine', fieldId: field.id, amount: null });
  const deliver = currentGuide(state, { ...onMap({ kind: 'ship', id: mule.id }), menu: { target: { kind: 'station', id: offer.stationId } } });
  assert.equal(deliver.selector, `[data-key="menu-deliver-${offer.good}"]`);
  assert.match(deliver.tip, /queue/);
  giveOrder(state, mule, { type: 'deliver', stationId: offer.stationId, good: offer.good });
  assert.match(currentGuide(state, onMap()).text, /pays when the last tonne arrives/);
});
