// Checks company goals and pays their rewards once.

import { GOALS } from '../content/goals.js';
import { formatCredits } from '../../../shared/js/format.js';
import { addLog } from './log.js';

export function checkGoals(state, at = state.now) {
  const completed = [];
  for (const goal of GOALS) {
    if (state.goals.includes(goal.id)) continue;
    if (!goal.done(state)) continue;
    state.goals.push(goal.id);
    state.credits += goal.reward;
    addLog(state, at, `Goal complete: ${goal.title} (+${formatCredits(goal.reward)})`, 'goal', goal.reward);
    completed.push(goal);
  }
  return completed;
}

/** The first goal not yet done, or null when all are. */
export function currentGoal(state) {
  return GOALS.find((goal) => !state.goals.includes(goal.id)) ?? null;
}
