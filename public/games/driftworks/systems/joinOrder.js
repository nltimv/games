// The order that takes a ship into a commander's fleet:
//   { type: 'join', commanderId }
// The ship flies to where the command ship is, or is flying to, waits for
// it there and goes aboard the fleet (see joinFleet in systems/missions.js).
// From then on it has no place of its own on the maps until it leaves.

import { SECOND } from '../core/time.js';
import { route, stationLegs } from './courses.js';
import { findShip } from './fleet.js';

const fail = (error) => ({ ok: false, error });

/** Going aboard takes a moment, so a ship already there still has an order to finish. */
const BOARDING = 30 * SECOND;

/** Where a ship meets a commander: where the command ship is, or the dock it is flying to. */
export const meetingPlace = (commander) => commander.order?.target ?? commander.at;

export function buildJoin(state, view, { commanderId }, start) {
  const commander = findShip(state, commanderId);
  if (!commander?.commander) return fail('No such commander.');
  if (commander.mission) return fail(`${commander.name} is away on a mission.`);
  const place = meetingPlace(commander);
  if (!place) return fail(`${commander.name} has no dock to meet at.`);
  const course = stationLegs(state, view, place, start);
  if (!course.ok) return course;
  // The ship waits at the meeting place for the command ship to dock.
  const end = Math.max(course.end + BOARDING, commander.order?.endsAt ?? 0);
  const legs = [...course.legs.filter((leg) => leg.end > leg.start), { from: place, to: place, start: course.end, end }];
  return {
    ok: true,
    order: {
      type: 'join',
      label: `Joining ${commander.name}'s fleet`,
      flightLabel: `Flying to meet ${commander.name}`,
      target: place,
      startedAt: start,
      endsAt: end,
      steps: [{ at: end, kind: 'join', station: place, commander: commanderId }],
      legs,
      ...route(course),
    },
  };
}
