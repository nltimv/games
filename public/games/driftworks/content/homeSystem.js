// The home system, Aurel. Coordinates are map units with the star at the
// origin; +y points down, as on screen. Later systems will be generated from
// the save's seed; the home system is hand-made so every save starts the same
// way.

function polar(radius, degrees) {
  const rad = (degrees * Math.PI) / 180;
  return { x: Math.round(radius * Math.cos(rad)), y: Math.round(radius * Math.sin(rad)) };
}

export const HOME_SYSTEM = {
  id: 'aurel',
  name: 'Aurel',
  faction: 'halcyon',
  star: { radius: 34 },
  orbits: [120, 200, 380],
  belt: { radius: 290, width: 36 },
  planets: [
    { id: 'cinder', name: 'Cinder', kind: 'rocky', radius: 11, ...polar(120, 10) },
    { id: 'tethra', name: 'Tethra', kind: 'ice', radius: 17, ...polar(380, 75) },
  ],
  fields: [
    { id: 'kx14', name: 'KX-14', good: 'ferrite-ore', richness: 1.0, ...polar(290, 200) },
    { id: 'carbon-drift', name: 'Carbon Drift', good: 'carbon-ore', richness: 0.8, ...polar(290, -20) },
    { id: 'silica-reef', name: 'Silica Reef', good: 'silicate-rock', richness: 1.2, ...polar(290, 110) },
    { id: 'rime', name: 'Rime Field', good: 'ice', richness: 1.1, ...polar(400, 30) },
  ],
  stations: [
    { id: 'halcyon-refinery', name: 'Halcyon Refinery', short: 'Refinery', type: 'refinery', faction: 'halcyon', ...polar(160, -60) },
    { id: 'halcyon-foundry', name: 'Halcyon Foundry', short: 'Foundry', type: 'foundry', faction: 'halcyon', ...polar(200, 60) },
    { id: 'aurel-post', name: 'Aurel Trading Post', short: 'Trading Post', type: 'tradingPost', faction: 'halcyon', ...polar(200, 160) },
    { id: 'halcyon-shipyard', name: 'Halcyon Shipyard', short: 'Shipyard', type: 'shipyard', faction: 'halcyon', ...polar(200, -130) },
  ],
  // Warp gates arrive with warp drives (act 2); for now they show as locked.
  // `short` names label the map when it is zoomed far out.
  gates: [
    { id: 'gate-brennan', name: 'Gate to Brennan', short: 'Brennan', ...polar(470, -60) },
    { id: 'gate-dace', name: 'Gate to Dace', short: 'Dace', ...polar(470, -150) },
    { id: 'gate-elm', name: 'Gate to Elm', short: 'Elm', ...polar(470, 160) },
    { id: 'gate-fenn', name: 'Gate to Fenn', short: 'Fenn', ...polar(470, 100) },
  ],
  // The map is framed to show everything inside this radius.
  extent: 480,
};

export const START_STATION = 'halcyon-refinery';

export function findStation(id) {
  return HOME_SYSTEM.stations.find((s) => s.id === id) ?? null;
}

export function findField(id) {
  return HOME_SYSTEM.fields.find((f) => f.id === id) ?? null;
}

/** Any placed thing (station, field, planet or gate) by id. */
export function findPlace(id) {
  return (
    findStation(id) ??
    findField(id) ??
    HOME_SYSTEM.planets.find((p) => p.id === id) ??
    HOME_SYSTEM.gates.find((g) => g.id === id) ??
    null
  );
}
