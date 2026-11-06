// List panels: the system overview, the fleet, the company (goals, stats and
// log), and the locked warp gates.

import { GOALS, NEXT_CHAPTER } from '../../content/goals.js';
import { GOODS } from '../../content/goods.js';
import { HULLS } from '../../content/ships.js';
import { STATION_TYPES, FACTIONS } from '../../content/stations.js';
import { HOME_SYSTEM } from '../../content/homeSystem.js';
import { formatClock, formatCredits, formatNumber } from '../../../../shared/js/format.js';
import { currentGoal } from '../../systems/goals.js';
import { shipStatus } from '../../systems/orders.js';
import { bar, countdown, h } from '../dom.js';
import { button, chip, gateIcon, panelHead, sectionTitle, shipGlyph, stationIcon, swatch } from '../components.js';
import { plural } from '../format.js';
import { richnessLabel } from './field.js';

// ---------- System overview ----------

export function overviewPanel(ctx) {
  const system = HOME_SYSTEM;
  const stationRows = system.stations.map((station) =>
    h(
      'button',
      { type: 'button', class: 'dw-ship-row', onClick: () => ctx.select('station', station.id), dataset: { key: `ov-${station.id}` } },
      h('span', { class: 'dw-ship-icon', 'aria-hidden': 'true' }, stationIcon()),
      h('span', { class: 'dw-grow' }, h('strong', null, station.name), h('small', null, STATION_TYPES[station.type].description)),
    ),
  );
  const fieldRows = system.fields.map((field) =>
    h(
      'button',
      { type: 'button', class: 'dw-ship-row', onClick: () => ctx.select('field', field.id), dataset: { key: `ov-${field.id}` } },
      swatch(field.good),
      h('span', { class: 'dw-grow' }, h('strong', null, field.name), h('small', null, `${GOODS[field.good].name} · ${richnessLabel(field.richness).toLowerCase()}`)),
    ),
  );
  return [
    panelHead({
      title: `${system.name} system`,
      subtitle: `${FACTIONS[system.faction].name} space · your home`,
      onClose: ctx.isPhone() ? ctx.close : null,
    }),
    h('p', { class: 'dw-note' }, 'Pick a station or field here or on the map to see what you can do there.'),
    h('div', { class: 'dw-section' }, sectionTitle('Stations'), h('div', { class: 'dw-list' }, stationRows)),
    h('div', { class: 'dw-section' }, sectionTitle('Asteroid fields'), h('div', { class: 'dw-list' }, fieldRows)),
    h(
      'div',
      { class: 'dw-section' },
      sectionTitle('Warp gates'),
      h('p', { class: 'dw-note' }, `${plural(system.gates.length, 'gate')} lead out of ${system.name}. ${NEXT_CHAPTER}`),
    ),
  ];
}

// ---------- Gate ----------

export function gatePanel(ctx, gateId) {
  const gate = HOME_SYSTEM.gates.find((g) => g.id === gateId);
  return [
    panelHead({ icon: gateIcon(), title: gate.name, subtitle: 'Warp gate · locked', onClose: ctx.close }),
    h('p', { class: 'dw-note' }, `Gates link ${HOME_SYSTEM.name} to the systems next door. Each jump will cost credits and time.`),
    h('div', { class: 'dw-card is-gold' }, h('strong', null, 'Coming next'), h('p', { class: 'dw-note' }, NEXT_CHAPTER)),
  ];
}

// ---------- Fleet ----------

export function fleetPanel(ctx) {
  const { state } = ctx;
  const ships = [...state.ships].sort((a, b) => (a.order?.endsAt ?? 0) - (b.order?.endsAt ?? 0));
  const idle = ships.filter((s) => !s.order).length;
  const rows = ships.map((ship) =>
    h(
      'li',
      null,
      h(
        'button',
        { type: 'button', class: 'dw-ship-row', onClick: () => ctx.select('ship', ship.id), dataset: { key: `fleet-${ship.id}` } },
        shipGlyph(ship.hull),
        h(
          'span',
          { class: 'dw-grow' },
          h('strong', null, `${ship.name} · ${HULLS[ship.hull].role === 'hauler' ? 'hauler' : 'miner'}`),
          h('small', null, shipStatus(ship)),
          ship.order ? bar({ start: ship.order.startedAt, end: ship.order.endsAt }) : null,
        ),
        ship.order ? countdown(ship.order.endsAt) : chip('Idle', 'gold'),
      ),
    ),
  );
  return [
    panelHead({ title: 'Fleet', subtitle: `${plural(ships.length, 'ship')} · ${idle} waiting for orders`, onClose: ctx.close }),
    h('ul', { class: 'dw-list' }, rows),
    button('Buy ships at Halcyon Shipyard', { key: 'fleet-shipyard', block: true, onClick: () => ctx.select('station', 'halcyon-shipyard') }),
  ];
}

// ---------- Company ----------

export function companyPanel(ctx) {
  const { state } = ctx;
  const goal = currentGoal(state);
  const stats = state.stats;

  const goalCard = goal
    ? h(
        'div',
        { class: 'dw-card is-gold' },
        h('span', { class: 'dw-eyebrow' }, 'Current goal'),
        h('div', { class: 'dw-card-head' }, h('strong', null, goal.title), h('span', { class: 'dw-goal-reward' }, `+${formatCredits(goal.reward)}`)),
        h('p', { class: 'dw-note' }, goal.hint),
        goal.progress ? goalProgress(goal.progress(state)) : null,
      )
    : h('div', { class: 'dw-card is-aqua' }, h('strong', null, 'All goals done'), h('p', { class: 'dw-note' }, NEXT_CHAPTER));

  const goals = GOALS.map((g) => {
    const done = state.goals.includes(g.id);
    const isCurrent = goal?.id === g.id;
    return h(
      'li',
      { class: `dw-goal${done ? ' is-done' : ''}${!done && !isCurrent ? ' is-locked' : ''}` },
      h('span', { class: 'dw-goal-mark', 'aria-hidden': 'true' }, done ? '✓' : ''),
      h('span', { class: 'dw-goal-title' }, g.title, done ? h('span', { class: 'dw-sr' }, ' (done)') : null),
      h('span', { class: 'dw-goal-reward' }, `+${formatCredits(g.reward)}`),
    );
  });

  const log = [...state.log]
    .reverse()
    .slice(0, 40)
    .map((entry) =>
      h('li', null, h('time', { datetime: new Date(entry.at).toISOString() }, formatClock(entry.at)), h('span', { class: `dw-dot is-${entry.kind}`, 'aria-hidden': 'true' }), h('span', null, entry.text)),
    );

  return [
    panelHead({ title: 'Your company', subtitle: `Founded ${new Date(state.createdAt).toLocaleDateString()} · ${HOME_SYSTEM.name}`, onClose: ctx.close }),
    goalCard,
    h('div', { class: 'dw-section' }, sectionTitle('Goals', `${state.goals.length} / ${GOALS.length}`, { numeric: true }), h('ul', { class: 'dw-list' }, goals)),
    h(
      'div',
      { class: 'dw-section' },
      sectionTitle('Totals'),
      h(
        'div',
        { class: 'dw-stats-grid' },
        stat('Earned', formatCredits(stats.earned)),
        stat('Ore sold', `${formatNumber(stats.oreSold)} t`),
        stat('Trade profit', formatCredits(stats.tradeProfit)),
        stat('Mining trips', formatNumber(stats.miningTrips)),
      ),
    ),
    h('div', { class: 'dw-section' }, sectionTitle('Log'), h('ul', { class: 'dw-log' }, log)),
    button('Settings and backups', { key: 'open-settings', block: true, onClick: ctx.openSettings }),
  ];
}

function goalProgress({ value, target }) {
  return h(
    'div',
    { class: 'dw-section' },
    bar({ fraction: value / target, variant: 'gold' }),
    h('span', { class: 'dw-note' }, `${formatCredits(Math.min(value, target))} of ${formatCredits(target)}`),
  );
}

function stat(label, value) {
  return h('div', { class: 'dw-stat' }, h('span', null, label), h('strong', null, value));
}
