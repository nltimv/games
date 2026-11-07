// The home system, Aurel. Coordinates are map units with the star at the
// origin; +y points down, as on screen. Other systems are generated from the
// save's seed (see galaxy.js); the home system is hand-made so every save
// starts the same way.

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
  // Warp gates open with the warp drive research. Each points the way its
  // lane goes on the galaxy map; `short` names label the map when it is
  // zoomed far out.
  gates: [
    { id: 'gate-brennan', name: 'Gate to Brennan', short: 'Brennan', to: 'brennan', angle: -60, ...polar(470, -60) },
    { id: 'gate-dace', name: 'Gate to Dace', short: 'Dace', to: 'dace', angle: -150, ...polar(470, -150) },
    { id: 'gate-elm', name: 'Gate to Elm', short: 'Elm', to: 'elm', angle: 160, ...polar(470, 160) },
    { id: 'gate-fenn', name: 'Gate to Fenn', short: 'Fenn', to: 'fenn', angle: 100, ...polar(470, 100) },
  ],
  // The map is framed to show everything inside this radius.
  extent: 480,
};

export const START_STATION = 'halcyon-refinery';
