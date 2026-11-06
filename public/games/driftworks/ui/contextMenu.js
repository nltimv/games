// The order menu: right-click (or press and hold) a field or station on the
// map, pick a ship, then pick what it should do there. It is the quick way
// to give orders; the panels offer the same orders with more detail, and are
// the way in for keyboard and screen-reader players.

import { goodName } from '../content/goods.js';
import { HULLS } from '../content/ships.js';
import { STATION_TYPES } from '../content/stations.js';
import { findField, findPlace, findStation } from '../content/homeSystem.js';
import { formatCredits } from '../../../shared/js/format.js';
import { orderOptions } from '../systems/advisor.js';
import { carryOut } from '../systems/commands.js';
import { findShip } from '../systems/fleet.js';
import { travelTime } from '../systems/travel.js';
import { h } from './dom.js';
import { fieldIcon, gateIcon, stationIcon, swatch } from './components.js';
import { at, plusCredits, tonnes, trip } from './format.js';

/** Ships that can do something at the target, closest first. */
export function menuCandidates(state, target, now) {
  return state.ships
    .map((ship) => ({ ship, options: orderOptions(state, ship, target, now) }))
    .filter((c) => c.options.length > 0)
    .sort((a, b) => travelTime(a.ship.hull, a.ship.at, target.id) - travelTime(b.ship.hull, b.ship.at, target.id));
}

/**
 * The ships offered in the menu and the one it shows orders for: the one
 * picked in the menu, else the selected ship, else the closest.
 */
export function menuChoice(state, ui, menu, now) {
  if (menu.target.kind !== 'field' && menu.target.kind !== 'station') return { candidates: [], chosen: null };
  const candidates = menuCandidates(state, menu.target, now);
  const preferred = [menu.shipId, ui.selection?.kind === 'ship' ? ui.selection.id : null];
  const chosen = preferred.map((id) => candidates.find((c) => c.ship.id === id)).find(Boolean) ?? candidates[0] ?? null;
  return { candidates, chosen };
}

function headIcon(target) {
  const wrap = (icon) => h('span', { class: 'dw-menu-icon', 'aria-hidden': 'true' }, icon);
  if (target.kind === 'field') return wrap(fieldIcon(findField(target.id).good, 34));
  if (target.kind === 'station') return wrap(stationIcon(findStation(target.id).type, { size: 34 }));
  if (target.kind === 'gate') return wrap(gateIcon());
  return null;
}

function heading(target, state) {
  if (target.kind === 'field') {
    const field = findField(target.id);
    return { title: field.name, subtitle: `Asteroid field · ${goodName(field.good).toLowerCase()}` };
  }
  if (target.kind === 'station') {
    const station = findStation(target.id);
    return { title: station.name, subtitle: STATION_TYPES[station.type].label };
  }
  if (target.kind === 'ship') {
    const ship = findShip(state, target.id);
    return { title: ship?.name ?? 'Ship', subtitle: ship ? HULLS[ship.hull].name : '' };
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

/** What to say when no ship can act on the target right now. */
function emptyNote(state, target) {
  if (target.kind === 'gate') return 'Gates open with warp drives in the next update.';
  const busy = state.ships.filter((s) => s.order).sort((a, b) => a.order.endsAt - b.order.endsAt);
  const wouldDo = (s) => (target.kind === 'field' ? HULLS[s.hull].role === 'miner' : true);
  const next = busy.find(wouldDo);
  if (target.kind === 'field' && !state.ships.some(wouldDo)) return 'Only mining ships can mine. Mules are sold at Halcyon Shipyard.';
  if (next) return `${next.name} is free again at ${at(next.order.endsAt)}.`;
  if (target.kind === 'field') return 'Your miners are full. Sell their cargo first.';
  return 'No ship has anything to do here right now.';
}

/** The menu's content. `ctx` is the app context; `menu` is ui.menu. */
export function orderMenu(ctx, menu) {
  const { state, now, ui } = ctx;
  const target = menu.target;
  const { title, subtitle } = heading(target, state);
  const parts = [
    h(
      'div',
      { class: 'dw-menu-head' },
      headIcon(target),
      h('span', { class: 'dw-grow' }, h('strong', { id: 'menu-title' }, title), h('small', null, subtitle)),
    ),
  ];

  if (target.kind === 'ship') {
    const ship = findShip(state, target.id);
    parts.push(
      h(
        'p',
        { class: 'dw-menu-note' },
        ship?.order ? `${ship.name} is busy until ${at(ship.order.endsAt)}.` : `Now right-click (or press and hold) a field or station to send ${ship?.name ?? 'it'} there.`,
      ),
    );
  } else {
    const { candidates, chosen } = menuChoice(state, ui, menu, now);

    if (candidates.length > 1) {
      parts.push(
        h(
          'div',
          { class: 'dw-seg dw-menu-ships', role: 'group', 'aria-label': 'Ship' },
          candidates.map(({ ship }) =>
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': String(ship.id === chosen.ship.id),
                dataset: { key: `menu-ship-${ship.id}`, menuItem: '' },
                onClick: () => ctx.update({ menu: { ...menu, shipId: ship.id } }),
              },
              ship.name,
            ),
          ),
        ),
      );
    } else if (chosen) {
      parts.push(h('p', { class: 'dw-menu-note' }, `${chosen.ship.name} at ${findStation(chosen.ship.at).name}`));
    }

    if (chosen) {
      parts.push(
        h(
          'div',
          { class: 'dw-menu-items', role: 'group', 'aria-label': `Orders for ${chosen.ship.name}` },
          chosen.options.map((option) => {
            const text = describe(option, now);
            return h(
              'button',
              {
                type: 'button',
                class: 'dw-menu-item',
                disabled: Boolean(option.disabled),
                dataset: { key: optionKey(option), menuItem: '' },
                onClick: () => run(ctx, chosen.ship.id, option),
              },
              h('span', { class: 'dw-menu-row' }, text.good ? swatch(text.good) : null, h('strong', { class: 'dw-grow' }, text.label), h('span', { class: 'dw-menu-value' }, text.value)),
              text.note ? h('small', null, text.note) : null,
            );
          }),
        ),
      );
    } else {
      parts.push(h('p', { class: 'dw-menu-note' }, emptyNote(state, target)));
    }
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
  // From the menu itself, Down goes to the first order, past the ships.
  if (e.key === 'ArrowDown' && index < 0) next = items.find((el) => el.classList.contains('dw-menu-item')) ?? items[0];
  else if (e.key === 'ArrowDown') next = items[(index + 1) % items.length];
  else if (e.key === 'ArrowUp') next = index <= 0 ? items.at(-1) : items[index - 1];
  else if (e.key === 'Home') next = items[0];
  else if (e.key === 'End') next = items.at(-1);
  if (!next) return false;
  e.preventDefault();
  next.focus();
  return true;
}

