// Every tradeable good. `value` is the base price in credits per tonne;
// stations price around it depending on their stock. Each tier is worth
// roughly 1.3 to 1.6 times the goods it is made from.
//
// `look` drives the little resource swatches in the UI: raw goods are round,
// refined and processed goods are square.

export const GOODS = {
  'ferrite-ore': {
    name: 'Ferrite ore',
    tier: 1,
    value: 8,
    look: { shape: 'round', light: '#c6d4e8', mid: '#6d84a6', dark: '#3b4c66' },
  },
  'silicate-rock': {
    name: 'Silicate rock',
    tier: 1,
    value: 6,
    look: { shape: 'round', light: '#f3e2b4', mid: '#c9a45a', dark: '#7a5a22' },
  },
  'carbon-ore': {
    name: 'Carbon ore',
    tier: 1,
    value: 9,
    look: { shape: 'round', light: '#9a9cab', mid: '#5b5f70', dark: '#23252f' },
  },
  ice: {
    name: 'Ice',
    tier: 1,
    value: 7,
    look: { shape: 'round', light: '#bdf4ff', mid: '#42b8e0', dark: '#155a86' },
  },
  iron: {
    name: 'Iron',
    tier: 2,
    value: 16,
    look: { shape: 'square', light: '#d5deea', mid: '#a9b6c8', dark: '#8d9db4' },
  },
  silicon: {
    name: 'Silicon',
    tier: 2,
    value: 12,
    look: { shape: 'square', light: '#f3e2b4', mid: '#dcc185', dark: '#c9a45a' },
  },
  graphite: {
    name: 'Graphite',
    tier: 2,
    value: 15,
    look: { shape: 'square', light: '#b8bac6', mid: '#7a7e8e', dark: '#3a3d48' },
  },
  water: {
    name: 'Water',
    tier: 2,
    value: 11,
    look: { shape: 'square', light: '#b9e8ff', mid: '#7cc4f0', dark: '#4a9be0' },
  },
  'titanium-ore': {
    name: 'Titanium ore',
    tier: 1,
    value: 14,
    look: { shape: 'round', light: '#e4dcff', mid: '#9b8fd0', dark: '#4a3f7a' },
  },
  'crystal-ore': {
    name: 'Crystal ore',
    tier: 1,
    value: 18,
    look: { shape: 'round', light: '#ffe1f4', mid: '#e48fcf', dark: '#86307a' },
  },
  titanium: {
    name: 'Titanium',
    tier: 2,
    value: 28,
    look: { shape: 'square', light: '#efeaff', mid: '#c2b8ec', dark: '#8578c2' },
  },
  crystal: {
    name: 'Crystal',
    tier: 2,
    value: 36,
    look: { shape: 'square', light: '#fff0fa', mid: '#f4b6e2', dark: '#d46fbd' },
  },
  steel: {
    name: 'Steel',
    tier: 3,
    value: 42,
    look: { shape: 'square', light: '#e6eef8', mid: '#9fb0c6', dark: '#5f7390' },
  },
  glass: {
    name: 'Glass',
    tier: 3,
    value: 30,
    look: { shape: 'square', light: '#b8fff2', mid: '#7fe9de', dark: '#3fcdbf' },
  },
};

export const TIER_NAMES = {
  1: 'Raw ore',
  2: 'Refined',
  3: 'Processed material',
};

export function goodName(id) {
  return GOODS[id]?.name ?? id;
}
