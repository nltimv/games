// The order menu: select a ship, then right-click (or press and hold) a
// field or station on the map and pick what the ship should do there. It is
// the quick way to give orders; the panels offer the same orders with more
// detail, and are the way in for keyboard and screen-reader players.

import { goodName } from '../content/goods.js';
import { HULLS, MODULES } from '../content/ships.js';
import { STATION_TYPES } from '../content/stations.js';
import { findField, findPlace, findStation } from '../content/homeSystem.js';
import { formatCredits } from '../../../shared/js/format.js';
import { orderOptions } from '../systems/advisor.js';
import { carryOut } from '../systems/commands.js';
import { findShip } from '../systems/fleet.js';
import { freeSlots, giveOrder, lowerFirst } from '../systems/orders.js';
import { orderSlots } from '../systems/research.js';
import { h } from './dom.js';
import { fieldIcon, gateIcon, stationIcon, swatch } from './components.js';
import { amountSlider } from './amount.js';
import { at, minusCredits, plusCredits, tonnes } from './format.js';

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

function when(option, verb = 'done') {
  return `${option.queued ? 'After its orders · ' : ''}${verb} ${at(option.endsAt)}`;
}

/** The text of one option: { label, value, note, good }. */
function describe(option) {
  const blocked = option.disabled ? option.note : null;
  switch (option.kind) {
    case 'mine':
      return {
        label: 'Mine a full hold',
        value: blocked ?? `about ${formatCredits(option.value)}`,
        note: blocked ? null : `${tonnes(option.qty)} · ${when(option)}`,
      };
    case 'mine-amount':
      return { label: 'Mine an amount', value: blocked ?? '›', note: `1 to ${tonnes(option.max)}` };
    case 'sell':
      return {
        label: option.goods.length === 1 ? `Sell ${goodName(option.goods[0]).toLowerCase()}` : 'Sell all cargo',
        value: blocked ?? `${option.now ? '' : 'about '}${plusCredits(option.total)}`,
        note: option.now ? 'Right now' : when(option, 'sold'),
        good: option.goods[0],
      };
    case 'buy':
      return { label: `Buy ${tonnes(option.qty, option.good)}`, value: blocked ?? minusCredits(option.cost), note: when(option, 'loaded'), good: option.good };
    case 'trade':
      return {
        label: `Bring ${tonnes(option.qty, option.good)}`,
        value: blocked ?? `about ${plusCredits(option.profit)}`,
        note: `Bought at ${findStation(option.fromId).name} for ${formatCredits(option.cost)} · 2 orders`,
        good: option.good,
      };
    case 'refit':
      return { label: 'Refit with the newest modules', value: blocked ?? minusCredits(option.cost), note: `${modulesText(option.modules)} · ${when(option)}` };
    case 'fly':
      return { label: 'Fly here', value: blocked ?? at(option.endsAt), note: option.queued ? 'After its orders' : 'Arrival time' };
    default:
      return { label: option.kind, value: '', note: '' };
  }
}

/** "Hold 25 t, laser 12 t/min" for the levels a refit fits. */
export function modulesText(modules) {
  const parts = [];
  if (modules.hold != null) parts.push(`hold ${MODULES.hold.levels[modules.hold]} t (Mule)`);
  if (modules.laser != null && modules.laser > 0) parts.push(`laser ${MODULES.laser.levels[modules.laser]} t/min`);
  if (modules.engine != null && modules.engine > 0) parts.push(`engines ${MODULES.engine.levels[modules.engine]} u/min`);
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function optionKey(option) {
  return `menu-${option.kind}-${option.good ?? ''}`;
}

/** Why the ship has no orders for the target. */
function emptyNote(ship, target) {
  if (target.kind === 'gate') return 'Gates open with the warp drive.';
  if (target.kind === 'field' && HULLS[ship.hull].role !== 'miner') return `${ship.name} is a hauler and cannot mine.`;
  return `${ship.name} has nothing to do here.`;
}

function shipLine(state, ship) {
  if (!ship.order) {
    const place = findPlace(ship.at);
    return `${ship.name} at ${place?.name ?? 'its post'}`;
  }
  const free = freeSlots(state, ship);
  return `${ship.name} is busy · ${free} of ${orderSlots(state)} orders free`;
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
  if (options.length) {
    parts.push(
      h('p', { class: 'dw-menu-note' }, shipLine(state, ship)),
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
  } else {
    parts.push(h('p', { class: 'dw-menu-note' }, emptyNote(ship, target)));
  }

  parts.push(menuButton('Details', '›', 'menu-details', () => ctx.select(target.kind, target.id)));
  return parts;
}

function menuButton(label, mark, key, onClick) {
  return h(
    'button',
    { type: 'button', class: 'dw-menu-item is-plain', dataset: { key, menuItem: '' }, onClick },
    h('span', { class: 'dw-menu-row' }, h('strong', { class: 'dw-grow' }, label), h('span', { class: 'dw-menu-value', 'aria-hidden': 'true' }, mark)),
  );
}

/** A toast that says when an order will be done. */
export function orderToast(ctx, ship, result) {
  const order = result?.order;
  if (!order) return;
  const text = `${ship.name}: ${lowerFirst(order.label)}`;
  ctx.toast(result.queued ? `${text} is queued, done about ${at(order.endsAt)}` : `${text}, done at ${at(order.endsAt)}`, 'order');
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

