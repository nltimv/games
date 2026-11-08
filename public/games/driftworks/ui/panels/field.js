// An asteroid field: what it holds, who buys it, and sending miners there.

import { GOODS } from '../../content/goods.js';
import { HULLS } from '../../content/ships.js';
import { findField } from '../../content/galaxy.js';
import { findShip } from '../../systems/fleet.js';
import { mapShips } from '../../systems/commanders.js';
import { freeSlots, giveOrder, orderPhase } from '../../systems/orders.js';
import { buyersOf } from '../../systems/advisor.js';
import { countdown, h } from '../dom.js';
import { chip, fieldIcon, panelHead, sectionTitle, swatch } from '../components.js';
import { amountSlider } from '../amount.js';
import { orderToast } from '../contextMenu.js';
import { formatPrice } from '../format.js';

export function richnessLabel(richness) {
  if (richness >= 3) return 'Very rich';
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
  const { state, ui } = ctx;
  const miners = mapShips(state).filter((s) => HULLS[s.hull].role === 'miner');
  // Idle miners first, then busy ones that still have room for an order.
  const ready = [...miners.filter((s) => !s.order), ...miners.filter((s) => s.order && freeSlots(state, s) > 0)];
  const full = miners.filter((s) => s.order && freeSlots(state, s) <= 0);
  const chosen = ready.find((s) => s.id === ui.miner) ?? ready[0] ?? null;

  const parts = [sectionTitle('Send a miner')];
  if (!miners.length) return h('div', { class: 'dw-section' }, parts, h('p', { class: 'dw-note' }, 'You have no mining ship.'));

  if (ready.length > 1) {
    parts.push(
      h(
        'div',
        { class: 'dw-seg is-wrap', role: 'group', 'aria-label': 'Miner' },
        ready.map((ship) =>
          h('button', { type: 'button', 'aria-pressed': String(ship.id === chosen.id), dataset: { key: `pick-${ship.id}` }, onClick: () => ctx.update({ miner: ship.id }) }, ship.name),
        ),
      ),
    );
  }

  if (chosen) {
    const saved = ui.fieldAmount?.shipId === chosen.id && ui.fieldAmount?.fieldId === field.id ? ui.fieldAmount.amount : null;
    parts.push(
      amountSlider(ctx, {
        shipId: chosen.id,
        fieldId: field.id,
        amount: saved,
        key: `field-amount-${chosen.id}`,
        onChange: (amount) => {
          ui.fieldAmount = { shipId: chosen.id, fieldId: field.id, amount };
        },
        onConfirm: (amount) => {
          const result = ctx.act((s) => giveOrder(s, findShip(s, chosen.id), { type: 'mine', fieldId: field.id, amount }));
          if (result?.ok) {
            ui.fieldAmount = null;
            orderToast(ctx, chosen, result);
          }
        },
      }),
    );
  }

  for (const ship of full) {
    parts.push(
      h(
        'button',
        { type: 'button', class: 'dw-ship-row', onClick: () => ctx.select('ship', ship.id), dataset: { key: `busy-${ship.id}` } },
        h('span', { class: 'dw-grow' }, h('strong', null, ship.name), h('small', null, `${orderPhase(ship.order, ctx.now).label} · orders full`)),
        countdown(orderPhase(ship.order, ctx.now).end),
      ),
    );
  }
  return h('div', { class: 'dw-section' }, parts);
}
