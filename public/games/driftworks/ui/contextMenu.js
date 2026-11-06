// The order menu: select a ship, then right-click (or press and hold) a
// field or station on the map and pick what the ship should do there. It is
// the quick way to give orders; the panels offer the same orders with more
// detail, and are the way in for keyboard and screen-reader players.

import { goodName } from '../content/goods.js';
import { HULLS } from '../content/ships.js';
import { STATION_TYPES } from '../content/stations.js';
import { findField, findPlace, findStation } from '../content/homeSystem.js';
import { formatCredits } from '../../../shared/js/format.js';
import { orderOptions } from '../systems/advisor.js';
import { carryOut } from '../systems/commands.js';
import { findShip } from '../systems/fleet.js';
import { h } from './dom.js';
import { fieldIcon, gateIcon, stationIcon, swatch } from './components.js';
import { at, plusCredits, tonnes, trip } from './format.js';

function headIcon(target) {
  const wrap = (icon) => h('span', { class: 'dw-menu-icon', 'aria-hidden': 'true' }, icon);
  if (target.kind === 'field') return wrap(fieldIcon(findField(target.id).good, 34));
  if (target.kind === 'station') return wrap(stationIcon(findStation(target.id).type, { size: 34 }));
  if (target.kind === 'gate') return wrap(gateIcon());
  return null;
}

function heading(target) {
  if (target.kind === 'field') {
    const field = findField(target.id);
    return { title: field.name, subtitle: `Asteroid field · ${goodName(field.good).toLowerCase()}` };
  }
  if (target.kind === 'station') {
    const station = findStation(target.id);
    return { title: station.name, subtitle: STATION_TYPES[station.type].label };
  }
  const place = findPlace(target.id);
  return { title: place?.name ?? 'Gate', subtitle: 'Jump gate · locked' };
}

/** The text of one option: { label, value, note, good }. */
function describe(option, now) {
  switch (option.kind) {
    case 'mine':
      return {
        label: `Mine for ${option.minutes} min`,
        value: option.disabled ? 'hold full' : `about ${formatCredits(option.value)}`,
        note: `${tonnes(option.amount)} · back ${at(option.endsAt)}`,
      };
    case 'sell':
      return { label: `Sell ${tonnes(option.qty, option.good)}`, value: plusCredits(option.total), note: 'Right now', good: option.good };
    case 'deliver':
      return {
        label: `Deliver ${tonnes(option.qty, option.good)}`,
        value: `about ${plusCredits(option.total)}`,
        note: `${trip(option.travel)} away · sells on arrival`,
        good: option.good,
      };
    case 'trade':
      return {
        label: `Bring ${tonnes(option.qty, option.good)}`,
        value: `about ${plusCredits(option.profit)}`,
        note: `Buys it for ${formatCredits(option.cost)} · arrives ${at(now + option.travel)}`,
        good: option.good,
      };
    case 'fly':
      return { label: 'Fly here', value: trip(option.travel), note: `Arrives ${at(now + option.travel)}` };
    default:
      return { label: option.kind, value: '', note: '' };
  }
}

function optionKey(option) {
  return `menu-${option.kind}-${option.minutes ?? option.good ?? ''}`;
}

/** Why the ship has no orders for the target. */
function emptyNote(ship, target) {
  if (target.kind === 'gate') return 'Gates open with warp drives in the next update.';
  if (ship.order) return `${ship.name} is busy until ${at(ship.order.endsAt)}.`;
  if (target.kind === 'field') {
    if (HULLS[ship.hull].role !== 'miner') return `${ship.name} is a hauler and cannot mine. Select a miner for this.`;
    return `${ship.name}'s hold is full. Sell the cargo first.`;
  }
  if (target.id === ship.at) return `${ship.name} is docked here and carries nothing this station buys.`;
  return `${ship.name} has nothing to do here.`;
}

/** The menu's content. `ctx` is the app context; `menu` is ui.menu. */
export function orderMenu(ctx, menu) {
  const { state, now } = ctx;
  const target = menu.target;
  const ship = findShip(state, menu.shipId);
  const { title, subtitle } = heading(target);
  const parts = [
    h(
      'div',
      { class: 'dw-menu-head' },
      headIcon(target),
      h('span', { class: 'dw-grow' }, h('strong', { id: 'menu-title' }, title), h('small', null, subtitle)),
    ),
  ];

  const options = orderOptions(state, ship, target, now);
  if (ship && options.length) {
    parts.push(
      h('p', { class: 'dw-menu-note' }, `${ship.name} at ${findStation(ship.at).name}`),
      h(
        'div',
        { class: 'dw-menu-items', role: 'group', 'aria-label': `Orders for ${ship.name}` },
        options.map((option) => {
          const text = describe(option, now);
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
  } else if (ship) {
    parts.push(h('p', { class: 'dw-menu-note' }, emptyNote(ship, target)));
  }

  parts.push(
    h(
      'button',
      {
        type: 'button',
        class: 'dw-menu-item is-plain',
        dataset: { key: 'menu-details', menuItem: '' },
        onClick: () => ctx.select(target.kind, target.id),
      },
      h('span', { class: 'dw-menu-row' }, h('strong', { class: 'dw-grow' }, 'Details'), h('span', { class: 'dw-menu-value', 'aria-hidden': 'true' }, '›')),
    ),
  );
  return parts;
}

function run(ctx, shipId, option) {
  const result = ctx.act((s) => carryOut(s, shipId, option));
  if (!result?.ok) return;
  ctx.closeMenu();
  const ship = findShip(ctx.state, shipId);
  if (!ship?.order) return; // A sale toasts by itself.
  const place = findPlace(ship.order.target);
  const verb = option.kind === 'mine' ? `is off to ${place.name}, back` : `is flying to ${place.name}, arrives`;
  ctx.toast(`${ship.name} ${verb} at ${at(ship.order.endsAt)}`, option.kind === 'trade' ? 'purchase' : 'arrival');
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

