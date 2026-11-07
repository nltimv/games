// The research lab: one research at a time (two with the Second lab), paid
// up front, finished by the simulation clock (core/sim.js) even while the
// game is closed. The first lab's project is research.active, the second's
// research.second.

import { MODULE_LINES, ORDER_SLOTS } from '../content/ships.js';
import { RESEARCH, SHIELDINGS, SHIELDING_COUNT_NAMES, SHIELDING_STEPS, findResearch, prerequisites } from '../content/research.js';
import { formatCredits } from '../../../shared/js/format.js';
import { MINUTE } from '../core/time.js';
import { addLog } from './log.js';

const fail = (error) => ({ ok: false, error });

export function isResearched(state, id) {
  return state.research.done.includes(id);
}

/** The highest level researched in a line (hold, laser, engine, queue). */
export function researchLevel(state, line) {
  let level = 0;
  for (const id of state.research.done) {
    const research = findResearch(id);
    if (research?.line === line) level = Math.max(level, research.level);
  }
  return level;
}

/** The newest module of each line: what new ships and refits get. */
export function bestModules(state) {
  return Object.fromEntries(MODULE_LINES.map((line) => [line, researchLevel(state, line)]));
}

/** How many orders each ship holds, its current one included. */
export function orderSlots(state) {
  return ORDER_SLOTS[Math.min(ORDER_SLOTS.length - 1, researchLevel(state, 'queue'))];
}

export const LAB_SLOTS = ['active', 'second'];

/** How many labs the company has. */
export function labCount(state) {
  return isResearched(state, 'second-lab') ? 2 : 1;
}

/** The projects running now, oldest lab first. */
export function runningResearch(state) {
  return LAB_SLOTS.slice(0, 2).map((slot) => state.research[slot]).filter(Boolean);
}

/** The first free lab's slot, or null when every lab is busy. */
export function freeLab(state) {
  return LAB_SLOTS.slice(0, labCount(state)).find((slot) => !state.research[slot]) ?? null;
}

/** How many hazard shieldings the company has. */
export function shieldingsDone(state) {
  return SHIELDINGS.filter((r) => isResearched(state, r.id)).length;
}

/**
 * What a research costs now. A hazard shielding costs more for each one the
 * company has or has in the lab, whichever hazard it is for.
 */
export function researchCost(state, research) {
  return shieldingStep(state, research)?.cost ?? research.cost;
}

/** How many minutes a research takes, as researchCost. */
export function researchMinutes(state, research) {
  return shieldingStep(state, research)?.minutes ?? research.minutes;
}

function shieldingStep(state, research) {
  if (!research.hazard) return null;
  const others = SHIELDINGS.filter((r) => r.id !== research.id && (isResearched(state, r.id) || runningResearch(state).some((p) => p.id === r.id))).length;
  return SHIELDING_STEPS[Math.min(others, SHIELDING_STEPS.length - 1)];
}

/** What a research waits for, as names: "Lane charts and Jump drive I". */
export function requirementText(research) {
  const names = prerequisites(research).map((id) => findResearch(id).name);
  if (research.shields) names.push(SHIELDING_COUNT_NAMES[research.shields]);
  return names.join(' and ');
}

/** 'done', 'active', 'open' (can start when the lab is free) or 'locked'. */
export function researchStatus(state, research) {
  if (isResearched(state, research.id)) return 'done';
  if (runningResearch(state).some((project) => project.id === research.id)) return 'active';
  const met = prerequisites(research).every((id) => isResearched(state, id)) && shieldingsDone(state) >= (research.shields ?? 0);
  return met ? 'open' : 'locked';
}

export function canStartResearch(state, id) {
  const research = findResearch(id);
  if (!research) return fail('No such research.');
  const status = researchStatus(state, research);
  if (status === 'done') return fail(`${research.name} is already done.`);
  if (status === 'locked') return fail(`${research.name} needs ${requirementText(research)} first.`);
  if (!freeLab(state)) {
    const busy = runningResearch(state).map((project) => findResearch(project.id).name).join(' and ');
    return fail(labCount(state) > 1 ? `Both labs are busy, with ${busy}.` : `The lab is busy with ${busy}.`);
  }
  const cost = researchCost(state, research);
  if (state.credits < cost) return fail(`You need ${formatCredits(cost - state.credits)} more.`);
  return { ok: true, research, cost, minutes: researchMinutes(state, research) };
}

export function startResearch(state, id, at = state.now) {
  const check = canStartResearch(state, id);
  if (!check.ok) return check;
  const { research, cost, minutes } = check;
  state.credits -= cost;
  state.research[freeLab(state)] = { id, startedAt: at, endsAt: at + minutes * MINUTE };
  state.stats.research += 1;
  addLog(state, at, `Research started: ${research.name}`, 'research', -cost);
  return { ok: true, research, cost };
}

/** Called by the simulation when a lab's research time is up (the first lab by default). */
export function finishResearch(state, at, slot = 'active') {
  const active = state.research[slot];
  if (!active) return null;
  const research = findResearch(active.id);
  state.research[slot] = null;
  state.research.done.push(active.id);
  addLog(state, at, `Research done: ${research.name}`, 'goal');
  return research;
}

/** Researches the lab could start next, cheapest first. */
export function openResearch(state) {
  return RESEARCH.filter((r) => researchStatus(state, r) === 'open').sort((a, b) => researchCost(state, a) - researchCost(state, b));
}
