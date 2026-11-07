// The research lab: one research at a time (two with the Second lab), paid
// up front, finished by the simulation clock (core/sim.js) even while the
// game is closed. The first lab's project is research.active, the second's
// research.second.

import { MODULE_LINES, ORDER_SLOTS } from '../content/ships.js';
import { RESEARCH, findResearch, prerequisites } from '../content/research.js';
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

/** 'done', 'active', 'open' (can start when the lab is free) or 'locked'. */
export function researchStatus(state, research) {
  if (isResearched(state, research.id)) return 'done';
  if (runningResearch(state).some((project) => project.id === research.id)) return 'active';
  return prerequisites(research).every((id) => isResearched(state, id)) ? 'open' : 'locked';
}

export function canStartResearch(state, id) {
  const research = findResearch(id);
  if (!research) return fail('No such research.');
  const status = researchStatus(state, research);
  if (status === 'done') return fail(`${research.name} is already done.`);
  if (status === 'locked') return fail(`${research.name} needs ${prerequisites(research).map((p) => findResearch(p).name).join(' and ')} first.`);
  if (!freeLab(state)) {
    const busy = runningResearch(state).map((project) => findResearch(project.id).name).join(' and ');
    return fail(labCount(state) > 1 ? `Both labs are busy, with ${busy}.` : `The lab is busy with ${busy}.`);
  }
  if (state.credits < research.cost) return fail(`You need ${formatCredits(research.cost - state.credits)} more.`);
  return { ok: true, research };
}

export function startResearch(state, id, at = state.now) {
  const check = canStartResearch(state, id);
  if (!check.ok) return check;
  const { research } = check;
  state.credits -= research.cost;
  state.research[freeLab(state)] = { id, startedAt: at, endsAt: at + research.minutes * MINUTE };
  state.stats.research += 1;
  addLog(state, at, `Research started: ${research.name}`, 'research', -research.cost);
  return { ok: true, research };
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
  return RESEARCH.filter((r) => researchStatus(state, r) === 'open').sort((a, b) => a.cost - b.cost);
}
