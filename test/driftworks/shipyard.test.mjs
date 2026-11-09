import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_MARKUP, HULLS, STARTING_ALLOWANCE } from '../../public/games/driftworks/content/ships.js';
import { GOODS } from '../../public/games/driftworks/content/goods.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { orderOptions } from '../../public/games/driftworks/systems/advisor.js';
import {
  addToStore,
  allowance,
  buildLock,
  buildNowCost,
  buildShip,
  cancelPlan,
  planBuild,
  pointsUsed,
  salvageLock,
  salvageReturn,
  salvageShip,
  stillNeededAt,
  storeAt,
} from '../../public/games/driftworks/systems/shipyard.js';
import { MINUTE, newGame } from './helpers.mjs';

const YARD = 'halcyon-shipyard';
const value = (goods) => Object.entries(goods).reduce((sum, [good, qty]) => sum + qty * GOODS[good].value, 0);

test('a new company has a Mule, a Kite and room for one more ship', () => {
  const state = newGame();
  assert.deepEqual(state.ships.map((ship) => ship.hull), ['mule', 'kite']);
  assert.equal(allowance(state), STARTING_ALLOWANCE);
  assert.equal(pointsUsed(state), 2);
  assert.equal(buildLock(state, 'mule', YARD), null);
  assert.match(buildLock(state, 'lark', YARD), /Scout licence/);
  assert.match(buildLock(state, 'mule', 'halcyon-refinery'), /not built here/);
});

test('Fleet licences, Fleet command and an old save bonus raise the allowance', () => {
  const state = newGame();
  state.research.done.push('licence-1');
  assert.equal(allowance(state), 4);
  state.research.done.push('licence-2');
  assert.equal(allowance(state), 6);
  state.research.done.push('fleet-1');
  assert.equal(allowance(state), 8);
  state.allowanceBonus = 3;
  assert.equal(allowance(state), 11);
});

test('Build now buys what the store lacks at the markup, plus the fee', () => {
  const state = newGame({ credits: 10_000 });
  const recipe = HULLS.mule.recipe;
  const empty = buildNowCost(state, 'mule', YARD);
  const markup = Object.entries(recipe).reduce((sum, [good, qty]) => sum + qty * Math.ceil(GOODS[good].value * BUILD_MARKUP), 0);
  assert.equal(empty.materials, markup);
  assert.equal(empty.fee, HULLS.mule.fee);
  addToStore(state, YARD, 'iron', 12);
  assert.ok(buildNowCost(state, 'mule', YARD).materials < markup, 'goods in store are used first');
  const credits = state.credits;
  const cost = buildNowCost(state, 'mule', YARD).total;
  const result = buildShip(state, 'mule', YARD);
  assert.ok(result.ok, result.error);
  assert.equal(state.credits, credits - cost);
  assert.deepEqual(storeAt(state, YARD), {}, 'the store gave its iron');
  assert.equal(state.stats.builds, 1);
});

test('a yard builds one ship at a time, and a build names and points are taken at once', () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('licence-1');
  const first = buildShip(state, 'mule', YARD, state.now).build;
  const second = buildShip(state, 'mule', YARD, state.now).build;
  assert.deepEqual([first.name, second.name], ['Mule-2', 'Mule-3']);
  assert.equal(second.startsAt, first.endsAt, 'the second waits for the first');
  assert.equal(first.endsAt - state.now, HULLS.mule.buildMinutes * MINUTE);
  assert.match(buildLock(state, 'mule', YARD), /allowance point/);
  advance(state, first.endsAt);
  const built = state.ships.find((ship) => ship.name === 'Mule-2');
  assert.equal(built.at, YARD);
  assert.equal(state.builds.length, 1);
  advance(state, second.endsAt);
  assert.equal(state.ships.length, 4);
  assert.equal(pointsUsed(state), 4);
});

test('a planned build waits for its recipe, which a hauler delivers, and can be dropped for its fee back', () => {
  const state = newGame({ credits: 5000 });
  const credits = state.credits;
  const plan = planBuild(state, 'mule', YARD).build;
  assert.equal(plan.status, 'planned');
  assert.equal(state.credits, credits - HULLS.mule.fee);
  assert.equal(stillNeededAt(state, YARD, 'iron'), 12);
  assert.match(buildLock(state, 'mule', YARD), /allowance point/, 'its points are reserved');

  const kite = state.ships.find((ship) => ship.hull === 'kite');
  kite.cargo = { iron: 20, graphite: 6 };
  kite.at = YARD;
  const store = orderOptions(state, kite, { kind: 'station', id: YARD }).find((option) => option.kind === 'store');
  assert.deepEqual(store.goods, { iron: 12, graphite: 6 });
  assert.equal(store.completes, true);
  assert.deepEqual(store.builds.map((build) => build.name), ['Mule-2']);

  // Delivered from elsewhere: the goods go into store and start the build.
  kite.at = 'halcyon-refinery';
  assert.ok(giveOrder(state, kite, { type: 'store', stationId: YARD }).ok);
  advance(state, kite.order.endsAt);
  assert.deepEqual(kite.cargo, { iron: 8 }, 'only what the build needs');
  assert.equal(plan.status, 'queued');
  assert.equal(state.stats.builds, 1);

  const other = planBuild(state, 'kite', YARD);
  assert.equal(other.ok, false, 'no points left');
  state.research.done.push('licence-1');
  const drop = planBuild(state, 'kite', YARD).build;
  const before = state.credits;
  assert.ok(cancelPlan(state, drop.id).ok);
  assert.equal(state.credits, before + HULLS.kite.fee);
});

test('Buy is sized to what a planned build still needs, and says so', () => {
  const state = newGame({ credits: 5000 });
  planBuild(state, 'mule', YARD);
  const kite = state.ships.find((ship) => ship.hull === 'kite');
  const buy = orderOptions(state, kite, { kind: 'station', id: 'halcyon-refinery' }).find((option) => option.kind === 'buy' && option.good === 'graphite');
  assert.equal(buy.qty, 6);
  assert.equal(buy.build.name, 'Mule-2');
  assert.equal(buy.destId, YARD);
});

test('salvage frees the points, costs the fee and returns half the recipe to the store', () => {
  const state = newGame({ credits: 5000 });
  const mule = createShip(state, 'mule', YARD);
  assert.equal(pointsUsed(state), 3);
  const credits = state.credits;
  const result = salvageShip(state, mule.id);
  assert.ok(result.ok, result.error);
  assert.equal(pointsUsed(state), 2);
  assert.equal(state.credits, credits - HULLS.mule.fee);
  assert.deepEqual(storeAt(state, YARD), salvageReturn('mule'));
  assert.equal(state.stats.shipsSalvaged, 1);

  const kite = state.ships.find((ship) => ship.hull === 'kite');
  assert.match(salvageLock(state, kite), /shipyard/);
  kite.at = YARD;
  kite.cargo = { iron: 1 };
  assert.match(salvageLock(state, kite), /hold/);
});

test('salvage can never pay for itself', () => {
  for (const [id, hull] of Object.entries(HULLS)) {
    const back = value(salvageReturn(id));
    assert.ok(back < hull.fee + value(hull.recipe), id);
  }
});

test('an old save keeps a fleet over the cap, gets the licences it fills, and still loads', () => {
  const state = newGame({ credits: 1e6 });
  for (let i = 0; i < 9; i += 1) createShip(state, i < 3 ? 'kite' : 'mule', YARD);
  state.research.done.push('queue-1', 'warp-drive');
  state.goals = ['first-sale', 'first-research', 'first-refit', 'second-mule', 'first-contract', 'third-mule', 'queue-research', 'first-hauler'];
  const old = JSON.parse(serialize(state));
  old.version = 5;
  for (const key of ['builds', 'nextBuildId', 'stores', 'allowanceBonus']) delete old[key];
  old.research.active = { id: 'kite-licence', endsAt: state.now + MINUTE };
  const loaded = deserialize(JSON.stringify(old));
  assert.equal(loaded.ships.length, 11);
  assert.equal(pointsUsed(loaded), 11);
  assert.equal(allowance(loaded), 11, 'exactly at the cap');
  assert.ok(loaded.research.done.includes('licence-4'));
  assert.ok(!loaded.research.done.includes('licence-5'));
  assert.equal(loaded.allowanceBonus, 1);
  assert.equal(loaded.research.active, null);
  for (const id of ['carry-goods', 'first-build', 'first-licence']) assert.ok(loaded.goals.includes(id), id);
  assert.match(buildLock(loaded, 'mule', YARD), /allowance point/);
});

test('an old save in the tutorial picks up the new steps where it is', () => {
  const state = newGame();
  state.ships = state.ships.filter((ship) => ship.hull === 'mule');
  state.goals = ['first-sale', 'first-research'];
  const old = JSON.parse(serialize(state));
  old.version = 5;
  const loaded = deserialize(JSON.stringify(old));
  assert.ok(loaded.goals.includes('carry-goods'), 'no Kite, and past it');
  assert.ok(!loaded.goals.includes('first-build'));
});
