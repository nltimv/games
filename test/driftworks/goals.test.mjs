import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGoals, currentGoal, tutorialGoal } from '../../public/games/driftworks/systems/goals.js';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { findResearch } from '../../public/games/driftworks/content/research.js';
import { newGame } from './helpers.mjs';
import { STARTING_CREDITS } from '../../public/games/driftworks/core/state.js';

test('the first goal is the first tutorial step', () => {
  const state = newGame();
  assert.equal(currentGoal(state).id, GOALS[0].id);
  assert.equal(tutorialGoal(state).id, GOALS[0].id);
  assert.deepEqual(checkGoals(state), []);
  state.tutorial.skipped = true;
  assert.equal(tutorialGoal(state), null);
});

test('a goal pays its reward exactly once', () => {
  const state = newGame();
  state.stats.oreSold = 1;
  const done = checkGoals(state);
  assert.deepEqual(done.map((g) => g.id), ['first-sale']);
  assert.equal(state.credits, STARTING_CREDITS + GOALS[0].reward);
  assert.deepEqual(checkGoals(state), []);
  assert.equal(state.credits, STARTING_CREDITS + GOALS[0].reward);
  assert.equal(currentGoal(state).id, 'carry-goods');
});

test('goals complete in order: a later goal waits for the ones before it', () => {
  const state = newGame();
  state.stats.contracts = 1;
  assert.deepEqual(checkGoals(state), []);
  state.stats.oreSold = 1;
  state.research.done.push('hold-1');
  assert.deepEqual(checkGoals(state).map((g) => g.id), ['first-sale']);
  state.stats.haulerSales = 1;
  assert.deepEqual(checkGoals(state).map((g) => g.id), ['carry-goods', 'first-research']);
});

test("goal ids are unique, each act's tutorial comes first, and only each act's last goal is unpaid", () => {
  const ids = new Set(GOALS.map((g) => g.id));
  assert.equal(ids.size, GOALS.length);
  for (const act of [1, 2]) {
    const goals = GOALS.filter((g) => (g.act ?? 1) === act);
    const firstFree = goals.findIndex((g) => !g.tutorial);
    assert.ok(firstFree > 0 && goals.slice(firstFree).every((g) => !g.tutorial), `act ${act}`);
    for (const goal of goals.slice(0, -1)) assert.ok(goal.reward > 0, goal.id);
    assert.equal(goals.at(-1).reward, 0);
  }
  assert.equal(GOALS.find((g) => !g.act && g.reward === 0).id, 'warp-drive');
  assert.equal(GOALS.filter((g) => g.act === 2).at(-1).id, 'first-shielding');
});

test('the act 1 tutorial teaches the Kite, building and the Fleet licence', () => {
  const tutorial = GOALS.filter((g) => g.tutorial && !g.act).map((g) => g.id);
  assert.deepEqual(tutorial, ['first-sale', 'carry-goods', 'first-research', 'first-build', 'first-contract', 'first-licence', 'first-refit']);
});

test('act 3 ends with Station blueprints, which needs deep shielding and Fleet command II', () => {
  const act3Goals = GOALS.filter((g) => g.act === 3);
  assert.deepEqual(act3Goals.filter((g) => g.tutorial).map((g) => g.id), ['hazard-survey', 'first-commander', 'first-mission']);
  assert.equal(act3Goals.at(-1).id, 'station-blueprints');
  assert.deepEqual(findResearch('station-blueprints').needs, ['deep-shielding', 'fleet-2']);
});
