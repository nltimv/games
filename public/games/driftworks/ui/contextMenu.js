// The order menu: select a ship, then right-click (or press and hold) a
// field or station on the map and pick what the ship should do there. It is
// the quick way to give orders; the panels offer the same orders with more
// detail, and are the way in for keyboard and screen-reader players.

import { goodName } from '../content/goods.js';
import { stationTint } from '../content/scenery.js';
import { HOLD_CLASS_NAMES, HULLS, MODULES } from '../content/ships.js';
import { STATION_TYPES } from '../content/stations.js';
import { findFaction, findField, findGate, findPlace, findSignal, findStation, findSystem, systemOf } from '../content/galaxy.js';
import { formatCredits } from '../../../shared/js/format.js';
import { groupOrderOptions, orderOptions } from '../systems/advisor.js';
import { carryOut, carryOutGroup } from '../systems/commands.js';
import { marketEntries } from '../systems/market.js';
import { findShip } from '../systems/fleet.js';
import { isSurveyed } from '../systems/explore.js';
import { freeSlots, giveOrder, isBusy, lowerFirst, orderTimes } from '../systems/orders.js';
import { orderSlots } from '../systems/research.js';
import { canJump } from '../systems/travel.js';
import { hazardNote, isShielded } from '../systems/shielding.js';
import { derelictLeft, fieldsOf, isInvestigated, signalTitle } from '../systems/signals.js';
import { h } from './dom.js';
import { fieldIcon, gateIcon, signalIcon, stationIcon, swatch } from './components.js';
import { amountSlider } from './amount.js';
import { richnessLabel } from './panels/field.js';
import { at, minusCredits, plural, plusCredits, routeText, signedCredits, span, timing, tonnes } from './format.js';

/** Note parts joined with dots, leaving out the empty ones. */
const joinNote = (...parts) => parts.filter(Boolean).join(' · ');

function headIcon(target, size = 34, state = null) {
  const wrap = (icon) => h('span', { class: 'dw-menu-icon', 'aria-hidden': 'true' }, icon);
  if (target.kind === 'field') return wrap(fieldIcon(findField(target.id).good, size));
  if (target.kind === 'station') return wrap(stationIcon(findStation(target.id).type, { size, tint: stationTint(findStation(target.id)) }));
  if (target.kind === 'gate') return wrap(gateIcon({ ancient: Boolean(findGate(target.id)?.ancient) }));
  if (target.kind === 'signal') return wrap(signalIcon(state, findSignal(target.id), size));
  if (target.kind === 'system') {
    const color = findFaction(findSystem(target.id)?.faction)?.color;
    return h('span', { class: 'dw-menu-icon', 'aria-hidden': 'true' }, h('span', { class: 'dw-faction-dot is-large', style: { background: color } }));
  }
  return null;
}

/** Why nobody can go to a system: locked gates, a hazard, or no survey yet. */
function closedNote(state, systemId) {
  const system = findSystem(systemId);
  if (!canJump(state)) return 'Gates open with the warp drive.';
  const blocked = hazardNote(state, system);
  if (blocked) return blocked;
  if (!isSurveyed(state, systemId)) return `${system?.name ?? 'That system'} has not been surveyed yet.`;
  return null;
}

function heading(state, target) {
  if (target.kind === 'field') {
    const field = findField(target.id);
    return { title: field.name, subtitle: `Asteroid field · ${goodName(field.good).toLowerCase()}` };
  }
  if (target.kind === 'station') {
    const station = findStation(target.id);
    return { title: station.name, subtitle: STATION_TYPES[station.type].label };
  }
  if (target.kind === 'system') {
    const system = findSystem(target.id);
    const faction = findFaction(system?.faction);
    return { title: `${system?.name ?? '?'} system`, subtitle: `${faction?.name ?? 'Unclaimed'}${isSurveyed(state, target.id) ? '' : ' · unsurveyed'}` };
  }
  if (target.kind === 'signal') {
    const signal = findSignal(target.id);
    return { title: signalTitle(state, signal), subtitle: `Signal · ${findSystem(systemOf(target.id))?.name ?? '?'}` };
  }
  const gate = findGate(target.id);
  const far = findSystem(gate?.to);
  if (gate?.ancient) return { title: gate.name, subtitle: 'Ancient gate' };
  return { title: gate?.name ?? 'Gate', subtitle: canJump(state) ? `Warp gate to ${far?.name ?? '?'}` : 'Warp gate · locked' };
}


/** The text of one option: { label, value, note, good }. */
function describe(option) {
  const blocked = option.disabled ? option.note : null;
  switch (option.kind) {
    case 'mine':
      return {
        label: 'Mine a full hold',
        value: blocked ?? `about ${formatCredits(option.value)}`,
        note: blocked ? null : joinNote(tonnes(option.qty), timing(option, 'mining')),
      };
    case 'mine-amount':
      return { label: 'Mine an amount', value: blocked ?? '›', note: `1 to ${tonnes(option.max)}` };
    case 'sell':
      return {
        label: option.goods.length === 1 ? `Sell ${goodName(option.goods[0]).toLowerCase()}` : 'Sell all cargo',
        value: blocked ?? `${option.now ? '' : 'about '}${plusCredits(option.total)}`,
        note: option.now ? 'Right now' : timing(option),
        good: option.goods[0],
      };
    case 'deliver':
      return {
        label: `Deliver ${tonnes(option.qty, option.good)}`,
        value: blocked ?? contractValue(option),
        note: joinNote(option.now ? 'Right now' : timing(option), progressText(option.contract)),
        good: option.good,
      };
    case 'buy':
      return { label: `Buy ${tonnes(option.qty, option.good)}`, value: blocked ?? minusCredits(option.cost), note: joinNote(buyUse(option), timing(option)), good: option.good };
    case 'refit':
      return { label: 'Refit with the newest modules', value: blocked ?? minusCredits(option.cost), note: joinNote(modulesText(option.modules), timing(option, 'refit')) };
    case 'fly':
      return { label: 'Fly here', value: blocked ?? `arrives ${at(option.endsAt)}`, note: timing(option) };
    case 'jump':
      return { label: jumpLabel(option), value: blocked ?? `arrives ${at(option.endsAt)}`, note: `${option.queued ? 'After its orders · ' : ''}${routeText({ jumps: option.jumps, time: option.flight, fees: option.fees })}` };
    case 'survey':
      return {
        label: `Survey ${findSystem(option.systemId).name}`,
        value: blocked ?? `done ${at(option.endsAt)}`,
        note: timing(option, 'surveying'),
      };
    case 'investigate':
      return { label: 'Investigate the signal', value: blocked ?? `done ${at(option.endsAt)}`, note: timing(option, 'investigating') };
    case 'salvage':
      return { label: `Salvage ${tonnes(option.qty, option.good)}`, value: blocked ?? `done ${at(option.endsAt)}`, note: timing(option, 'salvaging'), good: option.good };
    default:
      return { label: option.kind, value: '', note: '' };
  }
}

/** What a delivery is worth: the price when it brings the last tonnes, else what it works toward. */
function contractValue(option) {
  return option.completes ? plusCredits(option.reward) : `toward ${formatCredits(option.reward)}`;
}

/** Where a buy is headed: a contract, the best buyer known, or nowhere better yet. */
function buyUse(option) {
  if (option.contract) return `For the contract at ${placeName(option.destId, option.stationId)}${option.completes ? `, which pays ${formatCredits(option.reward)}` : ''}`;
  if (option.destId) return `Sells for about ${signedCredits(option.profit)} at ${placeName(option.destId, option.stationId)}`;
  return 'No known buyer pays more';
}

/** "40 t of 120 t delivered": how far a contract is. */
function progressText(contract) {
  return `${tonnes(contract.delivered)} of ${tonnes(contract.qty)} delivered`;
}

const jumpLabel = (option) => `${option.jumps > 1 ? 'Fly' : 'Jump'} to ${findSystem(option.systemId).name}`;

/** "Hold 25 t, laser 12 t/min" for the levels a refit fits. */
export function modulesText(modules) {
  const parts = [];
  if (modules.hold != null) parts.push(`hold ${MODULES.hold.levels[modules.hold]} t (Mule)`);
  if (modules.laser != null && modules.laser > 0) parts.push(`laser ${MODULES.laser.levels[modules.laser]} t/min`);
  if (modules.engine != null && modules.engine > 0) parts.push(`engines ${MODULES.engine.levels[modules.engine]} u/min`);
  if (modules.seal != null && modules.seal > 0) parts.push(HOLD_CLASS_NAMES[MODULES.seal.levels[modules.seal]].toLowerCase());
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function optionKey(option) {
  return `menu-${option.kind}-${option.good ?? ''}`;
}

/** Where goods go: the station, and its system when that is another one and the name does not say. */
function placeName(stationId, fromId) {
  const station = findStation(stationId);
  const system = findSystem(systemOf(stationId));
  return systemOf(stationId) === systemOf(fromId) || station.name.startsWith(system.name) ? station.name : `${station.name} in ${system.name}`;
}

/** Why the ship has no orders for the target. */
function emptyNote(state, ship, target) {
  if (target.kind === 'gate' || target.kind === 'system') {
    const systemId = target.kind === 'gate' ? findGate(target.id)?.to : target.id;
    const closed = closedNote(state, systemId);
    if (closed) return closed;
    if (systemOf(ship.at) === systemId) return `${ship.name} is already in ${findSystem(systemId).name}.`;
  }
  if (target.kind === 'field' && HULLS[ship.hull].role !== 'miner') return `${ship.name} is a hauler and cannot mine.`;
  return `${ship.name} has nothing to do here.`;
}

function shipLine(state, ship) {
  if (!ship.order) {
    const place = findPlace(ship.at);
    return `${ship.name} at ${place?.name ?? 'its post'}`;
  }
  if (!isBusy(state, ship)) return `${ship.name} turns around for a new order`;
  const free = freeSlots(state, ship);
  return `${ship.name} is busy · ${free} of ${orderSlots(state)} orders free`;
}

/**
 * The menu's content. `ctx` is the app context; `menu` is ui.menu. On the
 * galaxy map a system's menu lists its stations and fields; picking one
 * opens its orders as a sub-menu (`menu.place`), with a way back.
 */
export function orderMenu(ctx, menu) {
  const { state, now } = ctx;
  const target = menu.place ?? menu.target;
  const ship = findShip(state, menu.shipId);
  const { title, subtitle } = heading(state, target);
  const parts = [
    h(
      'div',
      { class: 'dw-menu-head' },
      headIcon(target, 34, state),
      h('span', { class: 'dw-grow' }, h('strong', { id: 'menu-title' }, title), h('small', null, subtitle)),
    ),
  ];
  if (menu.shipIds) return parts.concat(groupItems(ctx, menu, target));
  if (!ship) return parts;

  if (menu.slider && target.kind === 'field') {
    parts.push(
      h('p', { class: 'dw-menu-note' }, shipLine(state, ship)),
      amountSlider(ctx, {
        shipId: ship.id,
        fieldId: target.id,
        amount: menu.slider.amount,
        key: 'menu-amount',
        onChange: (amount) => {
          menu.slider.amount = amount;
        },
        onConfirm: (amount) => run(ctx, ship.id, { kind: 'mine', fieldId: target.id, amount }),
      }),
      menuButton('Back', '‹', 'menu-back', () => ctx.update({ menu: { ...menu, slider: null } })),
    );
    return parts;
  }

  const options = orderOptions(state, ship, target, now);
  const places = target.kind === 'system' ? placeItems(ctx, menu, [ship]) : null;
  if (options.length || places) parts.push(h('p', { class: 'dw-menu-note' }, shipLine(state, ship)));
  if (options.length) {
    parts.push(
      h(
        'div',
        { class: 'dw-menu-items', role: 'group', 'aria-label': `Orders for ${ship.name}` },
        options.map((option) => {
          const text = describe(option);
          return h(
            'button',
            {
              type: 'button',
              class: 'dw-menu-item',
              disabled: Boolean(option.disabled),
              dataset: { key: optionKey(option), menuItem: '' },
              onClick: () => run(ctx, ship.id, option),
            },
            h('span', { class: 'dw-menu-row' }, text.good ? swatch(text.good) : null, h('strong', { class: 'dw-grow' }, text.label), h('span', { class: 'dw-menu-value' }, text.value)),
            text.note ? h('small', null, text.note) : null,
          );
        }),
      ),
    );
  } else if (!places) {
    parts.push(h('p', { class: 'dw-menu-note' }, emptyNote(state, ship, target)));
  }
  parts.push(places, ...menuLinks(ctx, menu, target));
  return parts;
}

/** The system's signal, for ships with work there: scouts while it is unknown, haulers at a derelict. */
function signalItem(state, system, roles) {
  const signal = system.signal;
  if (!signal) return [];
  const known = isInvestigated(state, signal);
  const work = (roles.has('scout') && !known) || (roles.has('hauler') && known && derelictLeft(state, signal) > 0);
  return work ? [{ kind: 'signal', place: { id: signal.id, name: signalTitle(state, signal) }, note: known ? goodName(signal.good) : 'Signal' }] : [];
}

/**
 * The stations, fields and signal of a surveyed system the ships can work
 * at, each opening its own orders. Fields only for miners.
 */
function placeItems(ctx, menu, ships) {
  const system = findSystem(menu.target.id);
  if (!isShielded(ctx.state, system) || !canJump(ctx.state) || !isSurveyed(ctx.state, system.id)) return null;
  const roles = new Set(ships.map((ship) => HULLS[ship.hull].role));
  const places = [
    ...(roles.has('miner') ? fieldsOf(ctx.state, system).map((field) => ({ kind: 'field', place: field, note: `${goodName(field.good)} · ${richnessLabel(field.richness).toLowerCase()}` })) : []),
    ...(roles.has('miner') || roles.has('hauler') ? system.stations.map((station) => ({ kind: 'station', place: station, note: stationNote(station) })) : []),
    ...signalItem(ctx.state, system, roles),
  ];
  if (!places.length) return null;
  return h(
    'div',
    { class: 'dw-menu-items is-places', role: 'group', 'aria-label': `Places in ${system.name}` },
    places.map(({ kind, place, note }) =>
      h(
        'button',
        {
          type: 'button',
          class: 'dw-menu-item is-place',
          dataset: { key: `menu-place-${place.id}`, menuItem: '' },
          onClick: () => {
            ctx.update({ menu: { ...menu, place: { kind, id: place.id }, slider: null } });
            requestAnimationFrame(() => document.querySelector('#menu [data-menu-item]:not(:disabled)')?.focus());
          },
        },
        h('span', { class: 'dw-menu-row' }, headIcon({ kind, id: place.id }, 26, ctx.state), h('strong', { class: 'dw-grow' }, place.name), h('span', { class: 'dw-menu-value', 'aria-hidden': 'true' }, '›')),
        h('small', null, note),
      ),
    ),
  );
}

/** What a station trades, in a few words: "Buys 6 goods · sells iron, silicon". */
function stationNote(station) {
  const entries = marketEntries(station.id);
  const sells = entries.filter((entry) => entry.side === 'sells').map((entry) => goodName(entry.good).toLowerCase());
  const buys = entries.filter((entry) => entry.side === 'buys').length;
  const parts = [STATION_TYPES[station.type].label];
  if (buys) parts.push(`buys ${plural(buys, 'good')}`);
  if (sells.length) parts.push(`sells ${sells.join(', ')}`);
  return parts.join(' · ');
}

/**
 * Back to the system (in a sub-menu), details, and for a surveyed system
 * its map (the selected ships stay selected).
 */
function menuLinks(ctx, menu, target) {
  const links = [];
  if (menu.place) links.push(menuButton(`Back to ${findSystem(menu.target.id)?.name ?? 'the system'}`, '‹', 'menu-back', () => ctx.update({ menu: { ...menu, place: null, slider: null } })));
  if (target.kind === 'system' && isSurveyed(ctx.state, target.id)) {
    links.push(menuButton(`Open the ${findSystem(target.id).name} map`, '›', 'menu-open', () => ctx.openSystem(target.id)));
  }
  links.push(menuButton('Details', '›', 'menu-details', () => ctx.select(target.kind, target.id)));
  return links;
}

// ---------- Several ships ----------

/** "3 ships", or "2 of 3 ships" when some cannot take the order. */
function whoText(option) {
  if (option.disabled) return option.note ?? 'None of them can';
  const n = option.members.length;
  return n === option.of ? `${n} ships` : `${n} of ${option.of} ships`;
}

/** The text of a group option (see advisor.groupOrderOptions). */
function describeGroup(option) {
  const blocked = option.disabled ? '' : null;
  switch (option.kind) {
    case 'mine':
      return { label: 'Mine a full hold', value: blocked ?? `about ${formatCredits(option.value)}` };
    case 'sell':
      return {
        label: option.goods.length === 1 ? `Sell ${goodName(option.goods[0]).toLowerCase()}` : 'Sell all cargo',
        value: blocked ?? `about ${plusCredits(option.total)}`,
        good: option.goods.length === 1 ? option.goods[0] : null,
      };
    case 'deliver':
      return { label: `Deliver ${tonnes(option.qty, option.good)}`, value: blocked ?? contractValue(option), note: progressText(option.contract), good: option.good };
    case 'buy':
      return { label: `Buy ${tonnes(option.qty, option.good)}`, value: blocked ?? minusCredits(option.cost), note: option.disabled ? null : lowerFirst(buyUse(option)), good: option.good };
    case 'refit':
      return { label: 'Refit with the newest modules', value: blocked ?? minusCredits(option.cost) };
    case 'fly':
      return { label: 'Fly here', value: '' };
    case 'jump':
      return { label: `Fly to ${findSystem(option.systemId).name}`, value: '' };
    default:
      return { label: option.kind, value: '' };
  }
}

function groupKey(option) {
  return `menu-${option.kind}-${option.good ?? ''}`;
}

/** The menu for several selected ships: each order goes to every ship that can take it. */
function groupItems(ctx, menu, target) {
  const { state, now } = ctx;
  const ships = menu.shipIds.map((id) => findShip(state, id)).filter(Boolean);
  const options = groupOrderOptions(state, ships, target, now);
  const places = target.kind === 'system' ? placeItems(ctx, menu, ships) : null;
  const parts = [h('p', { class: 'dw-menu-note' }, `${ships.length} ships selected`)];
  if (options.length) {
    parts.push(
      h(
        'div',
        { class: 'dw-menu-items', role: 'group', 'aria-label': `Orders for ${ships.length} ships` },
        options.map((option) => {
          const text = describeGroup(option);
          return h(
            'button',
            { type: 'button', class: 'dw-menu-item', disabled: option.disabled, dataset: { key: groupKey(option), menuItem: '' }, onClick: () => runGroup(ctx, option) },
            h('span', { class: 'dw-menu-row' }, text.good ? swatch(text.good) : null, h('strong', { class: 'dw-grow' }, text.label), h('span', { class: 'dw-menu-value' }, text.value)),
            h('small', null, text.note && !option.disabled ? `${whoText(option)} · ${text.note}` : whoText(option)),
          );
        }),
      ),
    );
  } else if (!places) {
    parts.push(h('p', { class: 'dw-menu-note' }, 'None of these ships has anything to do here.'));
  }
  parts.push(places, ...menuLinks(ctx, menu, target));
  return parts;
}

function runGroup(ctx, option) {
  const result = ctx.act((s) => carryOutGroup(s, option));
  if (!result?.ok) return;
  ctx.closeMenu();
  ctx.toast(`${result.count === 1 ? '1 ship has' : `${result.count} ships have`} new orders`, 'order');
  if (result.error) ctx.toast(result.error, 'warning');
}

function menuButton(label, mark, key, onClick) {
  return h(
    'button',
    { type: 'button', class: 'dw-menu-item is-plain', dataset: { key, menuItem: '' }, onClick },
    h('span', { class: 'dw-menu-row' }, h('strong', { class: 'dw-grow' }, label), h('span', { class: 'dw-menu-value', 'aria-hidden': 'true' }, mark)),
  );
}

/**
 * A toast that says what an order does and how long its job and its flight
 * take: "Mule-1: mining Carbon Drift for 1 min, after a 20 s flight".
 */
export function orderToast(ctx, ship, result) {
  const order = result?.order;
  if (!order) return;
  const { flight, work } = orderTimes(order);
  let text = lowerFirst(order.label);
  if (work > 0) text += ` for ${span(work)}`;
  if (flight > 0) text += `${work > 0 ? ',' : ''} after a ${span(flight)} flight`;
  ctx.toast(`${ship.name}${result.queued ? ' (queued)' : ''}: ${text}`, 'order');
}

function run(ctx, shipId, option) {
  if (option.kind === 'mine-amount') {
    ctx.update({ menu: { ...ctx.ui.menu, slider: { amount: option.max } } });
    requestAnimationFrame(() => document.querySelector('[data-key="menu-amount-range"]')?.focus());
    return;
  }
  const result =
    option.kind === 'mine' && option.amount != null
      ? ctx.act((s) => giveOrder(s, findShip(s, shipId), { type: 'mine', fieldId: option.fieldId, amount: option.amount }))
      : ctx.act((s) => carryOut(s, shipId, option));
  if (!result?.ok) return;
  ctx.closeMenu();
  const ship = findShip(ctx.state, shipId);
  if (result.order) orderToast(ctx, ship, result);
  else if (result.given) ctx.toast(`${ship.name} has ${result.given} new orders`, 'order');
}

/**
 * Places the menu next to the pointer, inside the window. On touch it goes
 * above the finger so the finger does not hide it.
 */
export function placeMenu(el, { x, y, touch }) {
  const margin = 8;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = touch ? x - width / 2 : x + 6;
  if (!touch && left + width > vw - margin) left = x - width - 6;
  let top = touch ? y - height - 28 : y + 6;
  if (touch && top < margin) top = y + 28;
  if (!touch && top + height > vh - margin) top = y - height - 6;
  left = Math.max(margin, Math.min(vw - width - margin, left));
  top = Math.max(margin, Math.min(vh - height - margin, top));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

/** Arrow keys, Home and End move between the menu's buttons. */
export function menuKeydown(e, el) {
  // A slider uses the arrow keys itself.
  if (e.target.type === 'range') return false;
  const items = [...el.querySelectorAll('[data-menu-item]:not(:disabled)')];
  if (!items.length) return false;
  const index = items.indexOf(document.activeElement);
  let next = null;
  if (e.key === 'ArrowDown') next = items[(index + 1) % items.length];
  else if (e.key === 'ArrowUp') next = index <= 0 ? items.at(-1) : items[index - 1];
  else if (e.key === 'Home') next = items[0];
  else if (e.key === 'End') next = items.at(-1);
  if (!next) return false;
  e.preventDefault();
  next.focus();
  return true;
}

