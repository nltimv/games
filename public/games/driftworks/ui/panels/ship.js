// One ship: what it is doing, what it carries, and where it can go.

import { HULLS, HOLD_CLASS_NAMES } from '../../content/ships.js';
import { goodName } from '../../content/goods.js';
import { HOME_SYSTEM, findStation } from '../../content/homeSystem.js';
import { cargoTotal, sellCargo } from '../../systems/cargo.js';
import { findShip } from '../../systems/fleet.js';
import { giveOrder } from '../../systems/orders.js';
import { travelTime } from '../../systems/travel.js';
import { deliveryOptions, saleHere } from '../../systems/advisor.js';
import { bar, countdown, h } from '../dom.js';
import { button, chip, panelHead, sectionTitle, shipGlyph, swatch } from '../components.js';
import { at, plusCredits, tonnes, trip } from '../format.js';
import { richnessLabel } from './field.js';

export function shipPanel(ctx, shipId) {
  const { state } = ctx;
  const ship = findShip(state, shipId);
  if (!ship) return null;
  const hull = HULLS[ship.hull];
  const total = cargoTotal(ship);

  return [
    panelHead({ icon: shipGlyph(ship.hull), title: ship.name, subtitle: hull.name, onClose: ctx.close }),
    statusCard(ctx, ship),
    h(
      'div',
      { class: 'dw-section' },
      sectionTitle('Hold', `${tonnes(total)} / ${tonnes(hull.hold)}`, { numeric: true }),
      bar({ fraction: total / hull.hold, variant: hull.role === 'hauler' ? 'gold' : null }),
      total > 0
        ? h('div', { class: 'dw-chips' }, Object.keys(ship.cargo).map((g) => chip([swatch(g), tonnes(ship.cargo[g], g)])))
        : h('p', { class: 'dw-note' }, 'Empty.'),
    ),
    ship.order ? null : idleActions(ctx, ship),
    h(
      'dl',
      { class: 'dw-specs' },
      spec('Speed', `${hull.speed} u/min`),
      hull.miningRate ? spec('Mining', `${hull.miningRate} t/min`) : null,
      spec('Hold type', HOLD_CLASS_NAMES[hull.holdClass]),
    ),
  ];
}

function spec(term, value) {
  return h('div', null, h('dt', null, `${term}:`), h('dd', null, value));
}

function statusCard(ctx, ship) {
  if (ship.order) {
    const order = ship.order;
    const verb = order.type === 'mine' ? 'Back' : 'Arrives';
    return h(
      'div',
      { class: 'dw-card is-aqua' },
      h('div', { class: 'dw-card-head' }, h('strong', null, order.label), countdown(order.endsAt)),
      bar({ start: order.startedAt, end: order.endsAt }),
      h('p', { class: 'dw-note' }, `${verb} at ${at(order.endsAt)}. Orders cannot be cancelled once given.`),
    );
  }
  const station = findStation(ship.at);
  return h(
    'div',
    { class: 'dw-card is-gold' },
    h('div', { class: 'dw-card-head' }, h('strong', null, `Docked at ${station.name}`), h('span', null, 'Waiting for orders')),
    h('div', { class: 'dw-row-actions' }, button(`Open ${station.name}`, { small: true, key: 'open-station', onClick: () => ctx.select('station', station.id) })),
  );
}

function idleActions(ctx, ship) {
  const { state, now } = ctx;
  const hull = HULLS[ship.hull];
  const sections = [];

  // Cargo: sell here or deliver elsewhere.
  for (const good of Object.keys(ship.cargo).filter((g) => ship.cargo[g] > 0)) {
    const sale = saleHere(state, ship, good, now);
    const options = deliveryOptions(state, ship, good, ship.cargo[good], now);
    sections.push(
      h(
        'div',
        { class: 'dw-section' },
        sectionTitle(`Sell ${goodName(good).toLowerCase()}`),
        sale && sale.qty > 0
          ? button(`Sell ${tonnes(sale.qty, good)} here`, {
              variant: 'primary',
              block: true,
              sub: plusCredits(sale.total),
              key: `sell-here-${good}`,
              onClick: () => ctx.act((s) => sellCargo(s, findShip(s, ship.id), good)),
            })
          : null,
        options.length
          ? h(
              'div',
              { class: 'dw-choices', role: 'group', 'aria-label': `Deliver ${goodName(good).toLowerCase()}` },
              options.map((o) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'dw-choice',
                    disabled: o.sale.qty <= 0,
                    dataset: { key: `deliver-${good}-${o.stationId}` },
                    onClick: () => ctx.act((s) => giveOrder(s, findShip(s, ship.id), { type: 'move', stationId: o.stationId, sell: good })),
                  },
                  h('span', { class: 'dw-choice-row' }, h('strong', null, `Deliver to ${findStation(o.stationId).name}`), h('strong', { class: 'is-good' }, `about ${plusCredits(o.sale.total)}`)),
                  h('span', null, `${trip(o.travel)} away · sells on arrival`),
                ),
              ),
            )
          : null,
        !sale && !options.length ? h('p', { class: 'dw-note' }, `Nobody in ${HOME_SYSTEM.name} buys ${goodName(good).toLowerCase()} yet.`) : null,
      ),
    );
  }

  // Miners: pick a field.
  if (hull.role === 'miner') {
    sections.push(
      h(
        'div',
        { class: 'dw-section' },
        sectionTitle('Send mining'),
        h(
          'div',
          { class: 'dw-choices is-grid' },
          HOME_SYSTEM.fields.map((field) =>
            h(
              'button',
              { type: 'button', class: 'dw-choice', dataset: { key: `field-${field.id}` }, onClick: () => ctx.select('field', field.id, { miner: ship.id }) },
              h('strong', null, field.name),
              h('span', null, `${goodName(field.good)} · ${richnessLabel(field.richness).toLowerCase()}`),
            ),
          ),
        ),
      ),
    );
  }

  if (hull.role === 'hauler') {
    sections.push(
      h('p', { class: 'dw-note' }, `To trade, open the station ${ship.name} is docked at and pick Buy next to a good.`),
    );
  }

  // Fly somewhere without cargo business.
  const destinations = HOME_SYSTEM.stations.filter((s) => s.id !== ship.at);
  sections.push(
    h(
      'div',
      { class: 'dw-section' },
      sectionTitle('Fly to'),
      h(
        'div',
        { class: 'dw-choices is-grid' },
        destinations.map((station) =>
          h(
            'button',
            {
              type: 'button',
              class: 'dw-choice',
              dataset: { key: `fly-${station.id}` },
              onClick: () => ctx.act((s) => giveOrder(s, findShip(s, ship.id), { type: 'move', stationId: station.id })),
            },
            h('strong', null, station.name),
            h('span', null, trip(travelTime(ship.hull, ship.at, station.id))),
          ),
        ),
      ),
    ),
  );

  return sections;
}
