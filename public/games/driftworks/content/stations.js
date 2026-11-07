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
};

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
    description: 'Smelts refined goods into steel and glass.',
    buys: ['iron', 'graphite', 'silicon'],
    sells: ['steel', 'glass'],
    buyCurve: 'input',
    sellCurve: 'output',
  },
  tradingPost: {
    label: 'Trading post',
    description: 'Buys most goods at thin margins and sells a few staples.',
    buys: ['ferrite-ore', 'silicate-rock', 'carbon-ore', 'iron', 'silicon', 'graphite'],
    sells: ['ice', 'water'],
    buyCurve: 'postBuys',
    sellCurve: 'postSells',
  },
  shipyard: {
    label: 'Shipyard',
    description: 'Sells ships and fits new modules.',
    buys: [],
    sells: [],
    hulls: ['mule', 'kite', 'lark', 'heron'],
  },
};
