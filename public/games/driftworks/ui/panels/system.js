// System panels: a system picked on the galaxy map (or the one the System
// view shows, when nothing is selected), a warp gate, and the galaxy
// overview.

import { GOODS, goodName } from '../../content/goods.js';
import { HULLS } from '../../content/ships.js';
import { STATION_TYPES } from '../../content/stations.js';
import { HOME_SYSTEM } from '../../content/homeSystem.js';
import { sceneryOf, stationTint } from '../../content/scenery.js';
import { allFactions, allSystems, findFaction, findGate, findSystem, laneBetween, systemOf } from '../../content/galaxy.js';
import { formatCredits } from '../../../../shared/js/format.js';
import { systemMarket } from '../../systems/advisor.js';
import { contractMarks } from '../../systems/contracts.js';
import { chartedSystems, isSurveyed, surveyable, surveyorOf } from '../../systems/explore.js';
import { marketEntries } from '../../systems/market.js';
import { isResearched } from '../../systems/research.js';
import { seenAt } from '../../systems/knowledge.js';
import { findShip } from '../../systems/fleet.js';
import { giveOrder } from '../../systems/orders.js';
import { canJump, jumpFee, jumpTime, shipSystem } from '../../systems/travel.js';
import { hazardNote, isShielded, shieldingNeeded } from '../../systems/shielding.js';
import { h } from '../dom.js';
import { button, contractMark, fieldIcon, gateIcon, panelHead, sectionTitle, stationIcon, swatch } from '../components.js';
import { orderToast } from '../contextMenu.js';
import { ago, formatPrice, plural, span } from '../format.js';

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
import { richnessLabel } from './field.js';
import { factionRow, specialities } from './factions.js';
import { shipRow } from './lists.js';

function where(system) {
  return system.id === HOME_SYSTEM.id ? 'home' : `${plural(system.depth, 'lane')} from home`;
}

function subtitle(state, system) {
  const faction = findFaction(system.faction);
  const known = isSurveyed(state, system.id) ? where(system) : (shieldingNeeded(state, system) ? system.hazard : 'unsurveyed');
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

function placeRow(ctx, kind, place, icon, detail, extra = null) {
  return h(
    'button',
    { type: 'button', class: 'dw-ship-row', onClick: () => ctx.select(kind, place.id), dataset: { key: `ov-${place.id}` } },
    h('span', { class: 'dw-ship-icon is-art', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'dw-grow' }, h('strong', null, place.name), h('small', null, detail)),
    extra,
  );
}

/** The map's contract marks for a station, also said for screen readers. */
function contractMarksFor(marks) {
  if (!marks) return null;
  const said = [marks.offer ? 'contract offer' : null, marks.active ? 'contract running' : null].filter(Boolean).join(', ');
  return h('span', { class: 'dw-marks' }, marks.offer ? contractMark(false) : null, marks.active ? contractMark(true) : null, h('span', { class: 'dw-sr' }, said));
}

function gateLine(state, system, gate) {
  const far = findSystem(gate.to);
  if (!canJump(state)) return 'Locked';
  if (shieldingNeeded(state, far)) return `${far.name} has ${far.hazard}`;
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
      h('p', { class: 'dw-note' }, hazardNote(state, system) ?? `${system.name} has not been surveyed.`),
      surveyButtons(ctx, system.id),
    ];
  }

  const marks = contractMarks(state, ctx.now).stations;
  const stationRows = system.stations.map((station) =>
    placeRow(ctx, 'station', station, stationIcon(station.type, { size: 34, tint: stationTint(station) }), STATION_TYPES[station.type].description, contractMarksFor(marks.get(station.id))),
  );
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
  const faction = findFaction(system.faction);
  const special = faction && canJump(state) ? specialities(faction) : null;
  return [
    head,
    h('p', { class: 'dw-note' }, `${sceneryOf(system).star.name} · ${plural(system.planets.length, 'planet')}`),
    special ? h('p', { class: 'dw-note' }, `${faction.short}: ${lowerFirst(special)}.`) : null,
    open,
    ctx.ui.view === 'galaxy' && isResearched(state, 'market-charts') ? pricesSection(ctx, system) : null,
    ships.length ? h('div', { class: 'dw-section' }, sectionTitle('Your ships here', String(ships.length), { numeric: true }), h('ul', { class: 'dw-list' }, ships.map((ship) => shipRow(ctx, ship)))) : null,
    system.stations.length ? h('div', { class: 'dw-section' }, sectionTitle('Stations'), h('div', { class: 'dw-list' }, stationRows)) : null,
    system.fields.length ? h('div', { class: 'dw-section' }, sectionTitle('Asteroid fields'), h('div', { class: 'dw-list' }, fieldRows)) : null,
    h('div', { class: 'dw-section' }, sectionTitle('Warp gates'), h('div', { class: 'dw-list' }, gateRows)),
  ];
}

/**
 * Market charts, for one system on the galaxy map: each good traded there,
 * with the cheapest price a station sells it for and the best one pays.
 * Picking a good shows it on the map.
 */
function pricesSection(ctx, system) {
  const { state, now, ui } = ctx;
  const traded = new Set(system.stations.flatMap((station) => marketEntries(station.id).map((entry) => entry.good)));
  const goods = Object.keys(GOODS).filter((good) => traded.has(good));
  if (!goods.length) return null;
  const seen = seenAt(state, system.id, now);
  const price = (value) => h('span', { class: `dw-price${value == null ? ' is-none' : ''}` }, value == null ? '–' : formatPrice(value));
  const rows = goods.map((good) => {
    const { sells, buys } = systemMarket(state, system.id, good, now);
    return h(
      'button',
      {
        type: 'button',
        class: 'dw-price-row',
        'aria-pressed': String(ui.marketGood === good),
        dataset: { key: `prices-${good}` },
        onClick: () => ctx.update({ marketGood: ui.marketGood === good ? null : good }),
      },
      swatch(good),
      h('span', { class: 'dw-name' }, goodName(good)),
      price(sells),
      price(buys),
    );
  });
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('Best prices', seen == null ? 'per tonne' : `seen ${ago(now - seen)}`),
    h(
      'div',
      { class: 'dw-list dw-price-table' },
      h('div', { class: 'dw-price-row is-head', 'aria-hidden': 'true' }, h('span'), h('span', { class: 'dw-name' }, 'Good'), h('span', null, 'Buy for'), h('span', null, 'Sell for')),
      rows,
    ),
  );
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

/**
 * Market charts: pick a good and the galaxy map shows its prices in every
 * surveyed system; the panel lists the cheapest and best-paying ones.
 */
function marketSection(ctx, surveyed, row) {
  const { state, now, ui } = ctx;
  const traded = new Set(surveyed.flatMap((system) => system.stations.flatMap((station) => marketEntries(station.id).map((entry) => entry.good))));
  const goods = Object.keys(GOODS).filter((good) => traded.has(good));
  const picked = traded.has(ui.marketGood) ? ui.marketGood : null;
  const parts = [
    sectionTitle('Market charts'),
    h(
      'div',
      { class: 'dw-choices is-pills' },
      goods.map((good) =>
        h(
          'button',
          { type: 'button', class: 'dw-choice', 'aria-pressed': String(good === picked), dataset: { key: `market-${good}` }, onClick: () => ctx.update({ marketGood: good === picked ? null : good }) },
          swatch(good),
          goodName(good),
        ),
      ),
    ),
  ];
  if (picked) {
    const markets = surveyed.map((system) => ({ system, ...systemMarket(state, system.id, picked, now) }));
    const top = (side, order) =>
      markets
        .filter((m) => m[side] != null)
        .sort((a, b) => order * (a[side] - b[side]))
        .slice(0, 3);
    const list = (title, entries, side) =>
      entries.length
        ? h('div', { class: 'dw-section' }, sectionTitle(title, 'per tonne'), h('div', { class: 'dw-list' }, entries.map((m) => withPrice(row(m.system), formatPrice(m[side])))))
        : null;
    parts.push(list('Sells cheapest', top('sells', 1), 'sells'), list('Pays best', top('buys', -1), 'buys'));
  }
  return h('div', { class: 'dw-section' }, parts);
}

/** A system row with a price on its right. */
function withPrice(rowEl, text) {
  rowEl.append(h('strong', { class: 'dw-row-price' }, text));
  return rowEl;
}

/** The galaxy map with nothing selected: the factions and the systems you know. */
export function galaxyPanel(ctx) {
  const { state } = ctx;
  const charted = chartedSystems(state);
  const surveyed = allSystems().filter((system) => isSurveyed(state, system.id));
  const unsurveyed = allSystems().filter((system) => charted.has(system.id) && !isSurveyed(state, system.id) && isShielded(state, system));
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
    isResearched(state, 'market-charts') ? marketSection(ctx, surveyed, row) : null,
    h(
      'div',
      { class: 'dw-section' },
      sectionTitle('Factions you have met'),
      h(
        'ul',
        { class: 'dw-list' },
        factions.map((faction) => factionRow(state, faction)),
      ),
    ),
    h('div', { class: 'dw-section' }, sectionTitle('Surveyed systems'), h('div', { class: 'dw-list' }, surveyed.sort((a, b) => a.depth - b.depth).map(row))),
    unsurveyed.length ? h('div', { class: 'dw-section' }, sectionTitle('Not surveyed yet'), h('div', { class: 'dw-list' }, unsurveyed.sort((a, b) => a.depth - b.depth).map(row))) : null,
  ];
}
