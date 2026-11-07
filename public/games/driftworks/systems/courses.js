// Courses for orders: the flight to a place, shifted to the order's start,
// and the legs for an order that ends at a station.

import { plotCourse } from './travel.js';

/** The course to `to`, shifted to start at `start`: { ok, travel, legs, fees, jumps } or { ok: false, error }. */
export function flight(state, view, to, start, options) {
  const course = plotCourse(state, view, view.at, to, options);
  if (!course.ok) return course;
  const legs = course.legs.map((leg) => ({ ...leg, start: leg.start + start, end: leg.end + start }));
  return { ok: true, travel: course.time, legs, fees: course.fees, jumps: course.jumps };
}

export const route = (course) => ({ fees: course.fees, jumps: course.jumps });

/** The legs to a station and an optional stay there: { ok, end, legs, fees, jumps }. */
export function stationLegs(state, view, stationId, start, stay = 0, options) {
  const course = flight(state, view, stationId, start, options);
  if (!course.ok) return course;
  const { travel, legs } = course;
  const end = start + travel + stay;
  if (!legs.length || stay) legs.push({ from: stationId, to: stationId, start: start + travel, end });
  return { ok: true, end, legs, ...route(course) };
}
