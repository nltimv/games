// A station: its market (or ships for sale), the ships docked there, and
// ships elsewhere that could come over.

import { FACTIONS, STATION_TYPES } from '../../content/stations.js';
import { HULLS, HOLD_CLASS_MAX_TIER } from '../../content/ships.js';
import { GOODS, goodName } from '../../content/goods.js';
import { HOME_SYSTEM, findStation } from '../../content/homeSystem.js';
import { formatCredits } from '../../../../shared/js/format.js';
import { buyCargo, cargoTotal, sellCargo } from '../../systems/cargo.js';
import { buyShip, findShip, hullPrice, hullsForSale } from '../../systems/fleet.js';
import { marketEntries, marketView } from '../../systems/market.js';
import { giveOrder } from '../../systems/orders.js';
import { travelTime } from '../../systems/travel.js';
import { bestTradeQty, buyersOf, maxPurchase, saleHere, tradePlan } from '../../systems/advisor.js';
import { bar, h } from '../dom.js';
import { button, chip, line, panelHead, sectionTitle, shipGlyph, stationIcon, swatch } from '../components.js';
import { formatPrice, minusCredits, plural, plusCredits, tonnes, trip } from '../format.js';

const isHauler = (ship) => HULLS[ship.hull].role === 'hauler';
const isMiner = (ship) => HULLS[ship.hull].role === 'miner';

export function stationPanel(ctx, stationId) {
  const { state } = ctx;
  const station = findStation(stationId);
  const type = STATION_TYPES[station.type];
  const docked = state.ships.filter((s) => !s.order && s.at === stationId);
  const incoming = state.ships.filter((s) => s.order?.target === stationId);

  return [
    panelHead({ icon: stationIcon(), title: station.name, subtitle: type.description, onClose: ctx.close }),
    h(
      'div',
      { class: 'dw-chips' },
      chip(FACTIONS[station.faction].name),
      chip(type.label),
      docked.length ? chip(`${plural(docked.length, 'ship')} docked`, 'aqua') : null,
      incoming.length ? chip(`${incoming.length} on the way`) : null,
    ),
    // Ships come first: selling what just arrived is the usual reason to
    // open a station.
    dockedSection(ctx, station, docked),
    station.type === 'shipyard' ? shipyardSection(ctx, station) : marketSection(ctx, station, docked),
    elsewhereSection(ctx, station),
  ];
}

// ---------- Market ----------

function marketSection(ctx, station, docked) {
  const { state, now, ui } = ctx;
  const haulers = docked.filter(isHauler);
  const trade = ui.trade?.stationId === station.id ? ui.trade : null;
  const hauler = haulers.find((s) => s.id === trade?.shipId) ?? haulers[0] ?? null;
  const views = marketEntries(station.id).map((e) => marketView(state, station.id, e.good, now));
  const buys = views.filter((v) => v.side === 'buys');
  const sells = views.filter((v) => v.side === 'sells');

  const buyRows = buys.map((v) =>
    h(
      'div',
      { class: 'dw-market-row' },
      swatch(v.good),
      h('span', { class: 'dw-name' }, goodName(v.good)),
      h('span', { class: 'dw-price' }, formatPrice(v.price)),
      bar({ fraction: 1 - v.fill, small: true }),
      trendMark(v.pressure),
    ),
  );

  const sellRows = sells.map((v) => {
    const active = trade?.good === v.good && hauler;
    return h(
      'div',
      { class: 'dw-market-row' },
      swatch(v.good),
      h('span', { class: 'dw-name' }, goodName(v.good)),
      h('span', { class: 'dw-price' }, formatPrice(v.price)),
      h('span', { class: 'dw-stock' }, tonnes(v.stock)),
      hauler
        ? h(
            'button',
            {
              type: 'button',
              class: `dw-btn is-small ${active ? 'gloss' : 'glass-btn'}`,
              'aria-pressed': active ? 'true' : 'false',
              dataset: { key: `buy-${v.good}` },
              'aria-label': `Plan a trade: buy ${goodName(v.good).toLowerCase()}`,
              onClick: () => {
                ctx.update({ trade: active ? null : { stationId: station.id, shipId: hauler.id, good: v.good } });
                if (!active) requestAnimationFrame(() => document.querySelector('[data-trade-card]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
              },
            },
            'Buy',
          )
        : null,
    );
  });

  const lowest = buys.reduce((min, v) => (v.pressure < (min?.pressure ?? 0) ? v : min), null);
  const notes = [];
  if (lowest && lowest.pressure < -0.08) {
    notes.push(h('p', { class: 'dw-note' }, `${goodName(lowest.good)} pays less after recent sales. It recovers over the next few hours.`));
  }
  if (!hauler && sells.length) {
    const anyHauler = state.ships.some(isHauler);
    notes.push(
      h(
        'p',
        { class: 'dw-note' },
        anyHauler ? 'Dock a hauler here to buy these goods.' : 'Buying goods needs a hauler. Kite haulers are sold at Halcyon Shipyard.',
      ),
    );
  }

  return h(
    'div',
    { class: 'dw-section' },
    buys.length ? [sectionTitle('Buys', 'Price · demand'), buyRows] : null,
    sells.length ? [sectionTitle('Sells', 'Price · stock'), sellRows] : null,
    notes,
    trade && hauler ? tradeCard(ctx, station, hauler, trade, haulers) : null,
  );
}

function trendMark(pressure) {
  if (pressure > 0.06) return h('span', { class: 'dw-trend is-up', title: 'Pays more than usual', 'aria-label': 'Pays more than usual' }, '↑');
  if (pressure < -0.06) return h('span', { class: 'dw-trend is-down', title: 'Pays less than usual', 'aria-label': 'Pays less than usual' }, '↓');
  return h('span', { class: 'dw-trend', 'aria-hidden': 'true' }, '·');
}

function tradeCard(ctx, station, hauler, trade, haulers) {
  const { state, now } = ctx;
  const good = trade.good;
  const title = h('div', { class: 'dw-card-head' }, h('strong', null, `Trade for ${hauler.name}`), h('span', null, `hold ${tonnes(cargoTotal(hauler))} / ${tonnes(HULLS[hauler.hull].hold)}`));
  const pickShip =
    haulers.length > 1
      ? h(
          'div',
          { class: 'dw-seg', role: 'group', 'aria-label': 'Hauler' },
          haulers.map((s) =>
            h('button', { type: 'button', 'aria-pressed': String(s.id === hauler.id), dataset: { key: `trade-ship-${s.id}` }, onClick: () => ctx.update({ trade: { ...trade, shipId: s.id, qty: null } }) }, s.name),
          ),
        )
      : null;

  if (GOODS[good].tier > HOLD_CLASS_MAX_TIER[HULLS[hauler.hull].holdClass]) {
    return h('div', { class: 'dw-card is-aqua' }, title, pickShip, h('p', { class: 'dw-note is-warn' }, `${goodName(good)} needs a better hold than ${hauler.name} has.`));
  }

  const maxQty = maxPurchase(state, hauler, good, now);
  if (maxQty <= 0) {
    const reason = cargoTotal(hauler) >= HULLS[hauler.hull].hold ? `${hauler.name}'s hold is full.` : 'Not enough credits or stock for even a tonne.';
    return h('div', { class: 'dw-card is-aqua' }, title, pickShip, h('p', { class: 'dw-note is-warn' }, reason));
  }

  const buyers = buyersOf(state, good, now).filter(({ station: s }) => s.id !== station.id);
  if (!buyers.length) {
    return h('div', { class: 'dw-card is-aqua' }, title, pickShip, h('p', { class: 'dw-note' }, `Nobody else in ${HOME_SYSTEM.name} buys ${goodName(good).toLowerCase()} yet.`));
  }

  // Default destination: the best profit at the best quantity.
  const options = buyers.map(({ station: dest }) => {
    const best = bestTradeQty(state, hauler, good, dest.id, maxQty, now);
    return { dest, best };
  });
  const chosen = options.find((o) => o.dest.id === trade.dest) ?? [...options].sort((a, b) => b.best.profit - a.best.profit)[0];
  const best = chosen.best.qty > 0 ? chosen.best.qty : Math.min(maxQty, 10);
  const half = Math.max(1, Math.floor(maxQty / 2));
  const presets = [
    { id: 'best', label: 'Best', qty: best },
    { id: 'half', label: 'Half', qty: half },
    { id: 'full', label: 'Full', qty: maxQty },
  ].filter((p, i, all) => all.findIndex((o) => o.qty === p.qty) === i);
  const preset = presets.find((p) => p.id === trade.preset) ?? presets[0];
  const qty = preset.qty;
  const plan = tradePlan(state, hauler, good, qty, chosen.dest.id, now);

  const destChoices = h(
    'div',
    { class: 'dw-choices', role: 'group', 'aria-label': 'Sell at' },
    options.map(({ dest }) => {
      const p = tradePlan(state, hauler, good, qty, dest.id, now);
      return h(
        'button',
        {
          type: 'button',
          class: 'dw-choice',
          'aria-pressed': String(dest.id === chosen.dest.id),
          dataset: { key: `trade-dest-${dest.id}` },
          onClick: () => ctx.update({ trade: { ...trade, dest: dest.id } }),
        },
        h('span', { class: 'dw-choice-row' }, h('strong', null, dest.name), h('strong', { class: p.profit > 0 ? 'is-good' : '' }, profitText(p.profit))),
        h('span', null, `${trip(p.travel)} away · sells for about ${formatCredits(p.sell.total)}`),
      );
    }),
  );

  const send = () => {
    const result = ctx.act((s) => {
      const ship = findShip(s, hauler.id);
      const bought = buyCargo(s, ship, good, qty);
      if (!bought.ok) return bought;
      return giveOrder(s, ship, { type: 'move', stationId: chosen.dest.id, sell: good });
    });
    if (result?.ok) ctx.update({ trade: null });
  };
  const buyOnly = () => {
    const result = ctx.act((s) => buyCargo(s, findShip(s, hauler.id), good, qty));
    if (result?.ok) ctx.update({ trade: null });
  };

  return h(
    'div',
    { class: 'dw-card is-aqua', role: 'group', 'aria-label': `Trade for ${hauler.name}`, 'data-trade-card': true },
    title,
    pickShip,
    h(
      'div',
      { class: 'dw-seg', role: 'group', 'aria-label': 'Amount' },
      presets.map((p) =>
        h('button', { type: 'button', 'aria-pressed': String(p.id === preset.id), dataset: { key: `trade-qty-${p.id}` }, onClick: () => ctx.update({ trade: { ...trade, preset: p.id } }) }, `${p.label} · ${tonnes(p.qty)}`),
      ),
    ),
    destChoices,
    line(`Buy ${tonnes(plan.qty, good)} here`, minusCredits(plan.buy.total)),
    line(`Sell at ${chosen.dest.name}`, `about ${plusCredits(plan.sell.total)}`),
    line('Expected profit', profitText(plan.profit), `is-total${plan.profit < 0 ? ' is-loss' : ''}`),
    plan.profit <= 0 ? h('p', { class: 'dw-note is-warn' }, 'Prices here and there are too close right now. They drift back over a few hours.') : null,
    h(
      'div',
      { class: 'dw-row-actions' },
      button(`Buy and send ${hauler.name}`, { variant: 'primary', onClick: send, key: 'trade-send' }),
      button('Buy only', { onClick: buyOnly, key: 'trade-buy-only' }),
    ),
  );
}

function profitText(value) {
  const rounded = Math.round(value);
  return rounded >= 0 ? plusCredits(rounded) : minusCredits(-rounded);
}

// ---------- Shipyard ----------

function shipyardSection(ctx, station) {
  const { state } = ctx;
  const cards = hullsForSale(station.id).map((hullId) => {
    const hull = HULLS[hullId];
    const price = hullPrice(state, hullId);
    const short = price - state.credits;
    const owned = state.ships.filter((s) => s.hull === hullId).length;
    return h(
      'div',
      { class: 'dw-card dw-hull' },
      h('div', { class: 'dw-card-head' }, h('strong', null, hull.name), h('span', null, formatCredits(price))),
      h('p', { class: 'dw-note' }, hull.blurb),
      h(
        'dl',
        { class: 'dw-specs' },
        spec('Hold', tonnes(hull.hold)),
        spec('Speed', `${hull.speed} u/min`),
        hull.miningRate ? spec('Mining', `${hull.miningRate} t/min`) : null,
        spec('Carries', `tiers 1–${HOLD_CLASS_MAX_TIER[hull.holdClass]}`),
      ),
      owned ? h('p', { class: 'dw-note' }, `Includes a licence fee for the ${owned === 1 ? 'one' : owned} you own.`) : null,
      button(short > 0 ? `Need ${formatCredits(short)} more` : `Buy for ${formatCredits(price)}`, {
        variant: 'primary',
        disabled: short > 0,
        key: `buy-hull-${hullId}`,
        onClick: () => ctx.act((s) => buyShip(s, hullId, station.id)),
      }),
    );
  });
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('Ships for sale'),
    cards,
    h('p', { class: 'dw-note' }, 'New ships start docked here. The Halcyon licence fee grows with each ship of a type you own. Refits and bigger hulls arrive with research.'),
  );
}

function spec(term, value) {
  return h('div', null, h('dt', null, `${term}:`), h('dd', null, value));
}

// ---------- Ships docked here ----------

function dockedSection(ctx, station, docked) {
  if (!docked.length) return null;
  return h('div', { class: 'dw-section' }, sectionTitle('Docked here'), docked.map((ship) => dockedCard(ctx, station, ship)));
}

function dockedCard(ctx, station, ship) {
  const { state, now } = ctx;
  const hull = HULLS[ship.hull];
  const goods = Object.keys(ship.cargo).filter((g) => ship.cargo[g] > 0);
  const actions = [];

  for (const good of goods) {
    const sale = saleHere(state, ship, good, now);
    if (sale && sale.qty > 0) {
      actions.push(
        button(`Sell ${tonnes(sale.qty, good)}`, {
          variant: 'primary',
          sub: plusCredits(sale.total),
          key: `sell-${ship.id}-${good}`,
          onClick: () => ctx.act((s) => sellCargo(s, findShip(s, ship.id), good)),
        }),
      );
    } else {
      actions.push(
        button(`Deliver ${goodName(good).toLowerCase()} elsewhere`, {
          key: `deliver-${ship.id}-${good}`,
          onClick: () => ctx.select('ship', ship.id),
        }),
      );
    }
  }

  let hint = null;
  if (isMiner(ship)) {
    actions.push(button('Send mining', { key: `mine-${ship.id}`, onClick: () => ctx.select('ship', ship.id) }));
  } else if (isHauler(ship) && !goods.length && station.type !== 'shipyard') {
    hint = h('p', { class: 'dw-note' }, 'Pick Buy next to a good below to plan a trade.');
  } else if (isHauler(ship) && station.type === 'shipyard') {
    hint = h('p', { class: 'dw-note' }, 'Fly to the refinery to start trading.');
  }

  return h(
    'div',
    { class: 'dw-card' },
    h(
      'button',
      { type: 'button', class: 'dw-ship-row is-plain', onClick: () => ctx.select('ship', ship.id), dataset: { key: `docked-${ship.id}` } },
      shipGlyph(ship.hull),
      h('span', { class: 'dw-grow' }, h('strong', null, ship.name), h('small', null, `${hull.name} · hold ${tonnes(cargoTotal(ship))} / ${tonnes(hull.hold)}`)),
    ),
    goods.length ? h('div', { class: 'dw-chips' }, goods.map((g) => chip([swatch(g), tonnes(ship.cargo[g], g)]))) : null,
    hint,
    actions.length ? h('div', { class: 'dw-row-actions' }, actions) : null,
  );
}

// ---------- Ships elsewhere ----------

function elsewhereSection(ctx, station) {
  const { state, now } = ctx;
  const idle = state.ships.filter((s) => !s.order && s.at && s.at !== station.id);
  if (!idle.length || station.type === 'shipyard') return null;

  const rows = idle.map((ship) => {
    const time = travelTime(ship.hull, ship.at, station.id);
    const sellable = Object.keys(ship.cargo).find((g) => ship.cargo[g] > 0 && marketView(state, station.id, g, now)?.side === 'buys');
    const action = sellable
      ? button(`Deliver ${tonnes(ship.cargo[sellable], sellable)}`, {
          small: true,
          variant: 'primary',
          key: `bring-${ship.id}`,
          sub: trip(time),
          onClick: () => ctx.act((s) => giveOrder(s, findShip(s, ship.id), { type: 'move', stationId: station.id, sell: sellable })),
        })
      : button(`Fly here`, {
          small: true,
          key: `bring-${ship.id}`,
          sub: trip(time),
          onClick: () => ctx.act((s) => giveOrder(s, findShip(s, ship.id), { type: 'move', stationId: station.id })),
        });
    return h(
      'li',
      { class: 'dw-ship-row' },
      shipGlyph(ship.hull),
      h('span', { class: 'dw-grow' }, h('strong', null, ship.name), h('small', null, `At ${findStation(ship.at).name}`)),
      action,
    );
  });
  return h('div', { class: 'dw-section' }, sectionTitle('Send a ship here'), h('ul', { class: 'dw-list' }, rows));
}
