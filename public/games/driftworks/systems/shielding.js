// Hazards and shielding. Every system from HAZARD_DEPTH out has a hazard
// (radiation, ion storms or dense debris). A hazard shielding lets every
// ship of the company into systems with that hazard, out to SHIELDED_DEPTH
// lanes from home; Deep shielding opens everything further out. Shielding
// is company-wide research, so no ship needs a refit for it.

import { shieldingFor } from '../content/research.js';
import { isResearched } from './research.js';

/** Hazard shieldings reach this many lanes from home; Deep shielding goes past it. */
export const SHIELDED_DEPTH = 8;

/** Whether ships may fly into a system as far as its hazard goes. */
export function isShielded(state, system) {
  if (!system?.hazard) return Boolean(system);
  if (system.depth > SHIELDED_DEPTH) return isResearched(state, 'deep-shielding');
  return isResearched(state, shieldingFor(system.hazard)?.id);
}

/** The research a system's hazard needs, or null when ships may go there. */
export function shieldingNeeded(state, system) {
  if (isShielded(state, system)) return null;
  return system.depth > SHIELDED_DEPTH ? 'Deep shielding' : shieldingFor(system.hazard)?.name;
}

/** "Talos has ion storms. Ships need Ion shielding to go there.", or null when they may. */
export function hazardNote(state, system) {
  const needed = shieldingNeeded(state, system);
  return needed ? `${system.name} has ${system.hazard}. Ships need ${needed} to go there.` : null;
}
