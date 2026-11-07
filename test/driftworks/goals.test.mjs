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
  state.stats.contracts = 1;
  assert.deepEqual(checkGoals(state), []);
  state.stats.oreSold = 1;
  state.research.done.push('hold-1');
  assert.deepEqual(checkGoals(state).map((g) => g.id), ['first-sale', 'first-research']);
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
  assert.equal(GOALS.at(-1).id, 'station-blueprints');
});
