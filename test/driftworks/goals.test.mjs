import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGoals, currentGoal } from '../../public/games/driftworks/systems/goals.js';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { newGame } from './helpers.mjs';

test('the first goal is to send the miner out', () => {
  const state = newGame();
  assert.equal(currentGoal(state).id, GOALS[0].id);
  assert.deepEqual(checkGoals(state), []);
});

test('a goal pays its reward exactly once', () => {
  const state = newGame();
  state.stats.miningTrips = 1;
  const done = checkGoals(state);
  assert.deepEqual(done.map((g) => g.id), ['first-trip']);
  assert.equal(state.credits, 600 + GOALS[0].reward);
  assert.deepEqual(checkGoals(state), []);
  assert.equal(state.credits, 600 + GOALS[0].reward);
  assert.equal(currentGoal(state).id, 'first-sale');
});

test('goal ids are unique and every goal has a reward', () => {
  const ids = new Set(GOALS.map((g) => g.id));
  assert.equal(ids.size, GOALS.length);
  for (const goal of GOALS) assert.ok(goal.reward > 0);
});
