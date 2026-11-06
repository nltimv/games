// Travel inside a system: distances, travel times and where a ship is drawn.

import { DOCK_SECONDS } from '../content/ships.js';
import { findPlace } from '../content/homeSystem.js';
import { MINUTE, SECOND } from '../core/time.js';
import { speedOf } from './modules.js';

export function distance(aId, bId) {
  const a = findPlace(aId);
  const b = findPlace(bId);
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * A ship's travel time in ms: undocking and docking, plus the flight at its
 * engines' speed, to the nearest 5 seconds.
 */
export function travelTime(ship, fromId, toId) {
  if (!fromId || fromId === toId) return 0;
  const ms = DOCK_SECONDS * SECOND + (distance(fromId, toId) / speedOf(ship)) * MINUTE;
  return Math.round(ms / (5 * SECOND)) * 5 * SECOND;
}

/**
 * The map position of a ship at time `at`, following its current order's
 * legs. Ships parked at a place circle it slowly so the map feels alive.
 */
export function shipPosition(ship, at, index = 0) {
  const order = ship.order;
  if (!order) return parkedPosition(ship.at, at, index);
  const leg = order.legs.find((l) => at >= l.start && at < l.end) ?? order.legs.at(-1);
  if (!leg) return parkedPosition(ship.at, at, index);
  if (leg.from === leg.to) return parkedPosition(leg.from, at, index);
  const a = findPlace(leg.from);
  const b = findPlace(leg.to);
  const t = Math.min(1, Math.max(0, (at - leg.start) / Math.max(1, leg.end - leg.start)));
  const eased = t * t * (3 - 2 * t);
  return { x: a.x + (b.x - a.x) * eased, y: a.y + (b.y - a.y) * eased, moving: true, to: leg.to };
}

function parkedPosition(placeId, at, index) {
  const place = findPlace(placeId);
  if (!place) return { x: 0, y: 0, moving: false };
  const angle = at / (40 * SECOND) + index * 2.1;
  const r = 16 + (index % 3) * 4;
  return { x: place.x + Math.cos(angle) * r, y: place.y + Math.sin(angle) * r, moving: false, place: placeId };
}
