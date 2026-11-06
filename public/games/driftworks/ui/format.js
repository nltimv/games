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

/** "3 min" for travel times. */
export function trip(ms) {
  return formatDuration(ms);
}

/** "back 14:32" style clock times. */
export function at(timestamp) {
  return formatClock(timestamp);
}

export function plural(count, word, many = `${word}s`) {
  return `${formatNumber(count)} ${count === 1 ? word : many}`;
}
