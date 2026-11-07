// Time units used throughout the simulation. All game times are epoch
// milliseconds (Date.now()), so orders keep running while the tab is closed.

import { formatDuration } from '../../../shared/js/format.js';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/**
 * Time left on a countdown: to the second under ten minutes ("1 min 15 s",
 * "45 s"), then like formatDuration ("12 min", "2 h 05").
 */
export function timeLeft(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const seconds = Math.ceil(ms / SECOND);
  if (seconds < 60) return `${seconds} s`;
  if (seconds >= 600) return formatDuration(ms);
  const rest = seconds % 60;
  return rest ? `${Math.floor(seconds / 60)} min ${rest} s` : `${seconds / 60} min`;
}
