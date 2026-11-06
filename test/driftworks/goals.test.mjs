import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGoals, currentGoal, tutorialGoal } from '../../public/games/driftworks/systems/goals.js';
import { GOALS } from '../../public/games/driftworks/content/goals.js';
import { newGame } from './helpers.mjs';

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
  assert.equal(state.credits, 250 + GOALS[0].reward);
  assert.deepEqual(checkGoals(state), []);
  assert.equal(state.credits, 250 + GOALS[0].reward);
  assert.equal(currentGoal(state).id, 'first-research');
});

test('goals complete in order: a later goal waits for the ones before it', () => {
  const state = newGame();
  state.stats.contractsAccepted = 1;
  assert.deepEqual(checkGoals(state), []);
  state.stats.oreSold = 1;
  state.research.done.push('hold-1');
  assert.deepEqual(checkGoals(state).map((g) => g.id), ['first-sale', 'first-research']);
});

test('goal ids are unique, the tutorial comes first, and only the last goal is unpaid', () => {
  const ids = new Set(GOALS.map((g) => g.id));
  assert.equal(ids.size, GOALS.length);
  const firstFree = GOALS.findIndex((g) => !g.tutorial);
  assert.ok(GOALS.slice(firstFree).every((g) => !g.tutorial));
  for (const goal of GOALS.slice(0, -1)) assert.ok(goal.reward > 0, goal.id);
  assert.equal(GOALS.at(-1).id, 'warp-drive');
});
