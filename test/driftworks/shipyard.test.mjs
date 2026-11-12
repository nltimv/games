import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_MARKUP, HULLS, STARTING_ALLOWANCE } from '../../public/games/driftworks/content/ships.js';
import { GOODS } from '../../public/games/driftworks/content/goods.js';
import { advance } from '../../public/games/driftworks/core/sim.js';
import { deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { createShip } from '../../public/games/driftworks/systems/fleet.js';
import { cancelOrder, giveOrder, orderRefit, refitOffer } from '../../public/games/driftworks/systems/orders.js';
import { orderOptions } from '../../public/games/driftworks/systems/advisor.js';
import {
  addToStore,
  allowance,
  buildHiredShip,
  buildLock,
  cancelPlan,
  hiredShipCost,
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
  assert.match(buildLock(state, 'lark', YARD), /Warp drive/);
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

/** Puts a hull's recipe in the yard's store and plans it, so the build starts at once. */
function buildFromStore(state, hullId) {
  for (const [good, qty] of Object.entries(HULLS[hullId].recipe)) addToStore(state, YARD, good, qty);
  return planBuild(state, hullId, YARD, state.now);
}

test('a ship is only built from delivered goods; a hired commander’s ship is built at once', () => {
  const state = newGame({ credits: 1e7 });
  assert.equal(buildHiredShip(state, 'mule', YARD).ok, false, 'no buying a Mule outright');
  state.research.done.push('fleet-1');
  const empty = hiredShipCost(state, 'osprey', YARD);
  const markup = Object.entries(HULLS.osprey.recipe).reduce((sum, [good, qty]) => sum + qty * Math.ceil(GOODS[good].value * BUILD_MARKUP), 0);
  assert.equal(empty.materials, markup);
  assert.equal(empty.fee, HULLS.osprey.fee);
  addToStore(state, YARD, 'optics', 60);
  assert.ok(hiredShipCost(state, 'osprey', YARD).materials < markup, 'goods in store are used first');
  const credits = state.credits;
  const cost = hiredShipCost(state, 'osprey', YARD).total;
  const result = buildHiredShip(state, 'osprey', YARD);
  assert.ok(result.ok, result.error);
  assert.equal(state.credits, credits - cost);
  assert.deepEqual(storeAt(state, YARD), {}, 'the store gave its optics');
  assert.equal(state.stats.builds, 1);
});

test('a yard builds one ship at a time, and a build names and points are taken at once', () => {
  const state = newGame({ credits: 10_000 });
  state.research.done.push('licence-1');
  const first = buildFromStore(state, 'mule').build;
  const second = buildFromStore(state, 'mule').build;
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
  kite.cargo = {};
  assert.match(salvageLock(state, kite), /last hauler/, 'ships are built from what a hauler brings');
  createShip(state, 'kite', YARD);
  assert.equal(salvageLock(state, kite), null);
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

test('an old save in the tutorial picks up the new steps where it is, with a Kite to carry goods', () => {
  const state = newGame();
  state.ships = state.ships.filter((ship) => ship.hull === 'mule');
  state.goals = ['first-sale', 'first-research'];
  const old = JSON.parse(serialize(state));
  old.version = 5;
  const loaded = deserialize(JSON.stringify(old));
  assert.ok(loaded.goals.includes('carry-goods'), 'past it');
  assert.ok(!loaded.goals.includes('first-build'));
  const kite = loaded.ships.find((ship) => ship.hull === 'kite');
  assert.equal(kite?.at, YARD, 'a company without a hauler gets a Kite');
  assert.ok(pointsUsed(loaded) <= allowance(loaded), 'the Kite fits');
  assert.match(loaded.log.at(-1).text, /Kite-1 joined the fleet/);
});

test('big refits take steel or titanium alloy, from the build store first, and give it back if dropped', () => {
  const state = newGame({ credits: 1e6 });
  const kite = state.ships.find((ship) => ship.hull === 'kite');
  kite.at = YARD;
  state.research.done.push('hold-1', 'hold-2', 'hold-3', 'hold-4');
  assert.deepEqual(refitOffer(state, kite, YARD).goods, {}, 'small racks need only credits');
  state.research.done.push('hold-5', 'warp-drive', 'sealed-holds');
  const offer = refitOffer(state, kite, YARD);
  assert.deepEqual(offer.goods, { steel: 4 * HULLS.kite.holdScale, 'titanium-alloy': 20 });
  assert.equal(offer.cost, offer.fitting + offer.bought);
  addToStore(state, YARD, 'steel', 10);
  const cheaper = refitOffer(state, kite, YARD);
  assert.deepEqual(cheaper.stored, { steel: 10 });
  assert.ok(cheaper.cost < offer.cost);
  const credits = state.credits;
  assert.ok(orderRefit(state, kite, YARD).ok);
  assert.equal(state.credits, credits - cheaper.cost);
  assert.deepEqual(storeAt(state, YARD), {});
  cancelOrder(state, kite);
  assert.equal(state.credits, credits, 'the refit is refunded');
  assert.deepEqual(storeAt(state, YARD), { steel: 10 }, 'and the steel goes back');
});
