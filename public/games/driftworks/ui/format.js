// Game-specific wording on top of the shared formatters.

import { formatClock, formatCredits, formatDuration, formatNumber } from '../../../shared/js/format.js';
import { goodName } from '../content/goods.js';

/** Prices per tonne: one decimal below 100 so small moves show. */
export function formatPrice(value) {
  return `${formatNumber(value, { decimals: value < 100 ? 1 : 0 })} cr`;
}

export function tonnes(qty, good) {
  const amount = `${formatNumber(Math.floor(qty))} t`;
  return good ? `${amount} ${goodName(good).toLowerCase()}` : amount;
}

export function plusCredits(value) {
  return `+${formatCredits(value)}`;
}

export function minusCredits(value) {
  return `−${formatCredits(value)}`;
}

/** "+120 cr" or "−40 cr". */
export function signedCredits(value) {
  const rounded = Math.round(value);
  return rounded >= 0 ? plusCredits(rounded) : minusCredits(-rounded);
}

/** "3 min" for travel times. */
export function trip(ms) {
  return formatDuration(ms);
}

/** "back 14:32" style clock times. */
export function at(timestamp) {
  return formatClock(timestamp);
}

/**
 * A length of time to the second, for how long a job or flight takes:
 * "45 s", "1 min 5 s", "12 min". (Countdowns use timeLeft in core/time.js.)
 */
export function span(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  if (seconds >= 600) return formatDuration(ms);
  const rest = seconds % 60;
  return rest ? `${Math.floor(seconds / 60)} min ${rest} s` : `${seconds / 60} min`;
}

/**
 * How long an order's job takes and, apart from it, its flight:
 * "After its orders · 1 min mining · 20 s flight". `job` names the work
 * ("mining"); orders whose job takes no time show only the flight.
 */
export function timing({ queued, flight = 0, work = 0, jumps = 0, fees = 0 }, job) {
  const parts = [];
  if (queued) parts.push('After its orders');
  if (job && work > 0) parts.push(`${span(work)} ${job}`);
  if (flight > 0) parts.push(`${span(flight)} flight`);
  if (jumps > 0) parts.push(`${plural(jumps, 'jump')}, ${formatCredits(fees)}`);
  return parts.join(' · ');
}

export function plural(count, word, many = `${word}s`) {
  return `${formatNumber(count)} ${count === 1 ? word : many}`;
}

/**
 * A route through the gates: "2 jumps, 900 cr · 24 min". A route inside
 * one system is just its time.
 */
export function routeText({ jumps = 0, time = 0, fees = 0 }) {
  if (!jumps) return span(time);
  return `${plural(jumps, 'jump')}, ${formatCredits(fees)} · ${span(time)}`;
}

/** How long ago something was: "just now", "25 min ago", "3 h ago", "2 days ago". */
export function ago(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
