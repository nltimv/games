// Checks company goals and pays their rewards once. Goals complete in order:
// the next one only counts once the one before it is done.

import { GOALS } from '../content/goals.js';
import { formatCredits } from '../../../shared/js/format.js';
import { addLog } from './log.js';

export function checkGoals(state, at = state.now) {
  const completed = [];
  for (const goal of GOALS) {
    if (state.goals.includes(goal.id)) continue;
    if (!goal.done(state)) break;
    state.goals.push(goal.id);
    state.credits += goal.reward;
    const reward = goal.reward ? ` (+${formatCredits(goal.reward)})` : '';
    addLog(state, at, `Goal complete: ${goal.title}${reward}`, 'goal', goal.reward || undefined);
    completed.push(goal);
  }
  return completed;
}

/** The first goal not yet done, or null when all are. */
export function currentGoal(state) {
  return GOALS.find((goal) => !state.goals.includes(goal.id)) ?? null;
}

/** Whether the guide for an act's tutorial was skipped (each act's can be skipped on its own). */
export function guideSkipped(state, act = 1) {
  return act === 1 ? Boolean(state.tutorial.skipped) : Boolean(state.tutorial.skippedActs?.includes(act));
}

export function skipGuide(state, act = 1) {
  if (act === 1) state.tutorial.skipped = true;
  else state.tutorial.skippedActs = [...new Set([...(state.tutorial.skippedActs ?? []), act])];
}

/** Whether the tutorial guide should show: a tutorial goal is next and its act's guide was not skipped. */
export function tutorialGoal(state) {
  const goal = currentGoal(state);
  return goal?.tutorial && !guideSkipped(state, goal.act ?? 1) ? goal : null;
}
