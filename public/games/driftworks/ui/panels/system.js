// System panels: a system picked on the galaxy map (or the one the System
// view shows, when nothing is selected), a warp gate, and the galaxy
// overview.

import { GOODS } from '../../content/goods.js';
import { HULLS } from '../../content/ships.js';
import { STATION_TYPES } from '../../content/stations.js';
import { HOME_SYSTEM } from '../../content/homeSystem.js';
import { allFactions, allSystems, findFaction, findGate, findSystem, laneBetween, systemOf } from '../../content/galaxy.js';
import { formatCredits } from '../../../../shared/js/format.js';
import { chartedSystems, isSurveyed, surveyable, surveyorOf } from '../../systems/explore.js';
import { findShip } from '../../systems/fleet.js';
import { giveOrder } from '../../systems/orders.js';
import { canJump, jumpFee, jumpTime, shipSystem } from '../../systems/travel.js';
import { h } from '../dom.js';
import { button, fieldIcon, gateIcon, panelHead, sectionTitle, stationIcon } from '../components.js';
import { orderToast } from '../contextMenu.js';
import { plural, span } from '../format.js';
import { richnessLabel } from './field.js';
import { shipRow } from './lists.js';

function where(system) {
  return system.id === HOME_SYSTEM.id ? 'home' : `${plural(system.depth, 'lane')} from home`;
}

function subtitle(state, system) {
  const faction = findFaction(system.faction);
  const known = isSurveyed(state, system.id) ? where(system) : system.hazard ?? 'unsurveyed';
  return `${faction?.name ?? 'Unclaimed'} · ${known}`;
}

/** Buttons that send a scout to survey a system, one per scout with room for the order. */
function surveyButtons(ctx, systemId) {
  const { state } = ctx;
  if (!surveyable(state, systemId)) return null;
  const surveyor = surveyorOf(state, systemId);
  if (surveyor) return h('p', { class: 'dw-note' }, `${surveyor.name} is on its way to survey it.`);
  const scouts = state.ships.filter((ship) => HULLS[ship.hull].role === 'scout');
  if (!scouts.length) return null;
  return h(
    'div',
    { class: 'dw-row-actions' },
    scouts.map((scout) =>
      button(`Survey with ${scout.name}`, {
        small: true,
        variant: 'primary',
        key: `survey-${scout.id}`,
        onClick: () => {
          const result = ctx.act((s) => giveOrder(s, findShip(s, scout.id), { type: 'survey', systemId }));
          if (result?.ok) orderToast(ctx, scout, result);
        },
      }),
    ),
  );
}

function placeRow(ctx, kind, place, icon, detail) {
  return h(
    'button',
    { type: 'button', class: 'dw-ship-row', onClick: () => ctx.select(kind, place.id), dataset: { key: `ov-${place.id}` } },
    h('span', { class: 'dw-ship-icon is-art', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'dw-grow' }, h('strong', null, place.name), h('small', null, detail)),
  );
}

function gateLine(state, system, gate) {
  const far = findSystem(gate.to);
  if (!canJump(state)) return 'Locked';
  if (far?.hazard) return `${far.name} has ${far.hazard}`;
  const lane = laneBetween(system.id, gate.to);
  const trip = `${span(jumpTime(state, lane))} jump · ${formatCredits(jumpFee(state, lane))}`;
  return isSurveyed(state, gate.to) ? trip : `${trip} · unsurveyed`;
}

/**
 * A system: its faction, stations, fields, gates and your ships there.
 * In the System view it is the overview of the system shown.
 */
export function systemPanel(ctx, systemId, { overview = false } = {}) {
  const { state } = ctx;
  const system = findSystem(systemId) ?? HOME_SYSTEM;
  const surveyed = isSurveyed(state, system.id);
  const head = panelHead({
    title: `${system.name} system`,
    subtitle: subtitle(state, system),
    onClose: overview && !ctx.isPhone() ? null : ctx.close,
  });
  const ships = state.ships.filter((ship) => shipSystem(ship, ctx.now) === system.id);
  const open = ctx.ui.view === 'galaxy' && surveyed ? button(`Open the ${system.name} map`, { key: 'open-system', variant: 'primary', block: true, onClick: () => ctx.openSystem(system.id) }) : null;

  if (!surveyed) {
    return [
      head,
      h('p', { class: 'dw-note' }, system.hazard ? `${system.name} has ${system.hazard}. Ships need shielding to go there.` : `${system.name} has not been surveyed.`),
      surveyButtons(ctx, system.id),
    ];
  }

  const stationRows = system.stations.map((station) => placeRow(ctx, 'station', station, stationIcon(station.type, { size: 34 }), STATION_TYPES[station.type].description));
  const fieldRows = system.fields.map((field) =>
    placeRow(ctx, 'field', field, fieldIcon(field.good, 34), `${GOODS[field.good].name} · ${richnessLabel(field.richness).toLowerCase()}`),
  );
  const gateRows = system.gates.map((gate) =>
    h(
      'button',
      {
        type: 'button',
        class: 'dw-ship-row',
        onClick: () => (ctx.ui.view === 'galaxy' ? ctx.select('system', gate.to) : ctx.select('gate', gate.id)),
        dataset: { key: `ov-${gate.id}` },
      },
      h('span', { class: 'dw-ship-icon is-art', 'aria-hidden': 'true' }, gateIcon()),
      h('span', { class: 'dw-grow' }, h('strong', null, gate.name), h('small', null, gateLine(state, system, gate))),
    ),
  );
  return [
    head,
    open,
    ships.length ? h('div', { class: 'dw-section' }, sectionTitle('Your ships here', String(ships.length), { numeric: true }), h('ul', { class: 'dw-list' }, ships.map((ship) => shipRow(ctx, ship)))) : null,
    system.stations.length ? h('div', { class: 'dw-section' }, sectionTitle('Stations'), h('div', { class: 'dw-list' }, stationRows)) : null,
    system.fields.length ? h('div', { class: 'dw-section' }, sectionTitle('Asteroid fields'), h('div', { class: 'dw-list' }, fieldRows)) : null,
    h('div', { class: 'dw-section' }, sectionTitle('Warp gates'), h('div', { class: 'dw-list' }, gateRows)),
  ];
}

/** A warp gate: where it leads, and what a jump costs. */
export function gatePanel(ctx, gateId) {
  const { state } = ctx;
  const gate = findGate(gateId);
  if (!gate) return systemPanel(ctx, ctx.ui.systemId, { overview: true });
  const system = findSystem(systemOf(gateId));
  const far = findSystem(gate.to);
  const known = isSurveyed(state, gate.to);
  const facts = canJump(state)
    ? gateLine(state, system, gate)
    : 'Locked. The gates open with the warp drive research.';
  return [
    panelHead({ icon: gateIcon(), title: gate.name, subtitle: `Warp gate · ${system.name} to ${far?.name ?? '?'}`, onClose: ctx.close }),
    h('p', { class: 'dw-note' }, facts),
    canJump(state) && far
      ? button(known ? `Open the ${far.name} map` : `Show ${far.name} on the galaxy map`, {
          key: 'gate-open',
          variant: known ? 'primary' : undefined,
          block: true,
          onClick: () => (known ? ctx.openSystem(far.id) : ctx.select('system', far.id)),
        })
      : null,
    canJump(state) ? surveyButtons(ctx, gate.to) : null,
  ];
}

/** The galaxy map with nothing selected: the factions and the systems you know. */
export function galaxyPanel(ctx) {
  const { state } = ctx;
  const charted = chartedSystems(state);
  const surveyed = allSystems().filter((system) => isSurveyed(state, system.id));
  const unsurveyed = allSystems().filter((system) => charted.has(system.id) && !isSurveyed(state, system.id) && !system.hazard);
  const row = (system) =>
    h(
      'button',
      { type: 'button', class: 'dw-ship-row', onClick: () => ctx.select('system', system.id), dataset: { key: `gx-${system.id}` } },
      h('span', { class: 'dw-faction-dot', style: { background: findFaction(system.faction)?.color }, 'aria-hidden': 'true' }),
      h('span', { class: 'dw-grow' }, h('strong', null, system.name), h('small', null, subtitle(state, system))),
    );
  const factions = allFactions().filter((faction) => surveyed.some((system) => system.faction === faction.id));
  return [
    panelHead({ title: 'Galaxy', subtitle: `${plural(surveyed.length, 'system')} surveyed · ${plural(unsurveyed.length, 'system')} to survey`, onClose: ctx.isPhone() ? ctx.close : null }),
    h(
      'div',
      { class: 'dw-section' },
      sectionTitle('Factions you have met'),
      h(
        'ul',
        { class: 'dw-list' },
        factions.map((faction) =>
          h('li', { class: 'dw-faction-row' }, h('span', { class: 'dw-faction-dot', style: { background: faction.color }, 'aria-hidden': 'true' }), h('strong', null, faction.name)),
        ),
      ),
    ),
    h('div', { class: 'dw-section' }, sectionTitle('Surveyed systems'), h('div', { class: 'dw-list' }, surveyed.sort((a, b) => a.depth - b.depth).map(row))),
    unsurveyed.length ? h('div', { class: 'dw-section' }, sectionTitle('Not surveyed yet'), h('div', { class: 'dw-list' }, unsurveyed.sort((a, b) => a.depth - b.depth).map(row))) : null,
  ];
}
