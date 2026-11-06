// An asteroid field: what it holds, who buys it, and sending miners there.

import { GOODS, goodName } from '../../content/goods.js';
import { HULLS } from '../../content/ships.js';
import { findField, findStation } from '../../content/homeSystem.js';
import { formatCredits } from '../../../../shared/js/format.js';
import { cargoTotal } from '../../systems/cargo.js';
import { findShip } from '../../systems/fleet.js';
import { giveOrder } from '../../systems/orders.js';
import { buyersOf, tripPreviews } from '../../systems/advisor.js';
import { countdown, h } from '../dom.js';
import { chip, fieldIcon, panelHead, sectionTitle, swatch } from '../components.js';
import { at, formatPrice, tonnes } from '../format.js';

export function richnessLabel(richness) {
  if (richness >= 1.15) return 'Rich';
  if (richness >= 0.95) return 'Average';
  return 'Sparse';
}

export function fieldPanel(ctx, fieldId) {
  const { state, now } = ctx;
  const field = findField(fieldId);
  const good = GOODS[field.good];

  const buyers = buyersOf(state, field.good, now);
  const buyerRows = buyers.map(({ station, view }) =>
    h(
      'button',
      { type: 'button', class: 'dw-market-row dw-ship-row', onClick: () => ctx.select('station', station.id), dataset: { key: `buyer-${station.id}` } },
      swatch(field.good),
      h('span', { class: 'dw-name' }, station.name),
      h('span', { class: 'dw-price' }, formatPrice(view.price)),
    ),
  );

  return [
    panelHead({ icon: fieldIcon(field.good), title: field.name, subtitle: `Asteroid field · ${good.name.toLowerCase()}`, onClose: ctx.close }),
    h('div', { class: 'dw-chips' }, chip(`${richnessLabel(field.richness)} field`, field.richness >= 1.15 ? 'aqua' : null), chip('Tier 1 · raw ore')),
    minersSection(ctx, field),
    h('div', { class: 'dw-section' }, sectionTitle(`Who buys ${good.name.toLowerCase()}`, 'Price now'), buyerRows),
  ];
}

function minersSection(ctx, field) {
  const { state, now, ui } = ctx;
  const miners = state.ships.filter((s) => HULLS[s.hull].role === 'miner');
  const idle = miners.filter((s) => !s.order && s.at);
  const busy = miners.filter((s) => s.order);
  const chosen = idle.find((s) => s.id === ui.miner) ?? idle[0] ?? null;

  const parts = [sectionTitle('Send a miner')];

  if (idle.length > 1) {
    parts.push(
      h(
        'div',
        { class: 'dw-seg', role: 'group', 'aria-label': 'Miner' },
        idle.map((ship) =>
          h('button', { type: 'button', 'aria-pressed': String(ship.id === chosen.id), dataset: { key: `pick-${ship.id}` }, onClick: () => ctx.update({ miner: ship.id }) }, ship.name),
        ),
      ),
    );
  }

  if (chosen) {
    const hold = HULLS[chosen.hull].hold;
    const carried = cargoTotal(chosen);
    const trips = tripPreviews(state, chosen, field.id, now);
    parts.push(
      h(
        'div',
        { class: 'dw-choices is-grid', role: 'group', 'aria-label': `Trip length for ${chosen.name}` },
        trips.map((t) =>
          h(
            'button',
            {
              type: 'button',
              class: 'dw-choice',
              disabled: t.amount <= 0,
              dataset: { key: `trip-${t.minutes}` },
              onClick: () => ctx.act((s) => giveOrder(s, findShip(s, chosen.id), { type: 'mine', fieldId: field.id, minutes: t.minutes })),
            },
            h('strong', null, `${t.minutes} min`),
            h('span', null, `${tonnes(t.amount)} · about ${formatCredits(t.value)}`),
            h('span', null, `back at ${at(t.endsAt)}`),
          ),
        ),
      ),
      h(
        'p',
        { class: 'dw-note' },
        `${chosen.name} leaves from ${findStation(chosen.at).name} and brings the ${goodName(field.good).toLowerCase()} back there. Longer trips mine a little more per minute, so match the trip to your next work block.`,
      ),
    );
    if (carried > 0) {
      parts.push(h('p', { class: 'dw-note is-warn' }, `${chosen.name} already carries ${tonnes(carried)}, so only ${tonnes(hold - carried)} of hold is free.`));
    }
  } else if (!busy.length) {
    parts.push(h('p', { class: 'dw-note' }, 'You have no mining ship. Mules are sold at Halcyon Shipyard.'));
  }

  for (const ship of busy) {
    parts.push(
      h(
        'button',
        { type: 'button', class: 'dw-ship-row', onClick: () => ctx.select('ship', ship.id), dataset: { key: `busy-${ship.id}` } },
        h('span', { class: 'dw-grow' }, h('strong', null, ship.name), h('small', null, ship.order.label)),
        countdown(ship.order.endsAt),
      ),
    );
  }
  return h('div', { class: 'dw-section' }, parts);
}
