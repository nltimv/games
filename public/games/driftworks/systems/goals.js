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

/** Whether the tutorial guide should show: a tutorial goal is next and it was not skipped. */
export function tutorialGoal(state) {
  const goal = currentGoal(state);
  return goal?.tutorial && !state.tutorial.skipped ? goal : null;
}
