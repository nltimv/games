// Station types and how they price goods.
//
// A station either BUYS a good (an input it consumes) or SELLS it (an output
// it makes). Price is a straight line between `high` and `low` times the
// good's base value, by how full the station's storage is: a station short of
// an input pays more for it, and one full of its output sells it cheaply.
// Stock drifts back toward `target` over a few hours (see systems/market.js).

export const CURVES = {
  // Production stations buying their inputs.
  input: { high: 1.5, low: 0.7, cap: 4000, target: 0.3 },
  // Production stations selling their outputs.
  output: { high: 1.3, low: 0.75, cap: 3000, target: 0.6 },
  // Trading posts buy almost anything, but cheaply.
  postBuys: { high: 1.05, low: 0.55, cap: 2000, target: 0.35 },
  // Trading posts sell a few staples at a markup.
  postSells: { high: 1.45, low: 1.05, cap: 1500, target: 0.55 },
  // Shipyards pay well for the materials their hulls are built from.
  materials: { high: 1.6, low: 0.8, cap: 4000, target: 0.25 },
  // Aurel's neighbours pay well for the goods they are short of (see
  // HOME_IMPORTS in galaxy.js): enough over Aurel's price that a hold of
  // them pays for the jumps there and back.
  imports: { high: 1.8, low: 1.0, cap: 4000, target: 0.25 },
};

/**
 * Stations keep less of tier 3 goods: their storage is half the curve's cap.
 * Each tonne pays more, so a full hold is not the only good answer. Tier 4
 * goods, which only a Heron carries, come in full stores, so its big racks
 * fill: a load there goes well past the 800 to 900 t where tier 3 prices
 * sag.
 */
export const TIER_STORAGE = { 3: 0.5, 4: 1 };

export const STATION_TYPES = {
  refinery: {
    label: 'Refinery',
    description: 'Refines raw ore into iron, silicon, graphite and water.',
    buys: ['ferrite-ore', 'silicate-rock', 'carbon-ore', 'ice'],
    sells: ['iron', 'silicon', 'graphite', 'water'],
    buyCurve: 'input',
    sellCurve: 'output',
  },
  foundry: {
    label: 'Foundry',
    description: 'Smelts refined goods into processed materials.',
    buys: ['iron', 'graphite', 'silicon'],
    sells: ['steel', 'glass'],
    buyCurve: 'input',
    sellCurve: 'output',
  },
  tradingPost: {
    label: 'Trading post',
    description: 'Buys most goods at thin margins and sells a few staples.',
    buys: ['ferrite-ore', 'silicate-rock', 'carbon-ore', 'iron', 'silicon', 'graphite', 'steel', 'glass', 'circuits'],
    sells: ['ice', 'water'],
    buyCurve: 'postBuys',
    sellCurve: 'postSells',
  },
  factory: {
    label: 'Factory',
    description: 'Builds ship components from processed materials.',
    buys: ['steel', 'glass', 'titanium-alloy', 'optics'],
    sells: ['hull-plating', 'circuits', 'sensor-arrays'],
    buyCurve: 'input',
    sellCurve: 'output',
  },
  shipyard: {
    label: 'Shipyard',
    description: 'Builds ships, fits new modules and buys hull materials.',
    buys: ['steel', 'titanium-alloy', 'hull-plating', 'circuits', 'sensor-arrays'],
    sells: [],
    buyCurve: 'materials',
    hulls: ['mule', 'kite', 'lark', 'heron'],
  },
};
