// A station: its market (or ships for sale), the ships docked there, and
// ships elsewhere that could come over.

import { stationTint } from '../../content/scenery.js';
import { STATION_TYPES } from '../../content/stations.js';
import { HOLD_CLASS_NAMES, HULLS, MODULES } from '../../content/ships.js';
import { goodName } from '../../content/goods.js';
import { findFaction, findPlace, findStation, systemOf } from '../../content/galaxy.js';
import { formatCredits } from '../../../../shared/js/format.js';
import { HOUR } from '../../core/time.js';
import { buyCargo, canCarry, cargoTotal, holdNote, sellCargo } from '../../systems/cargo.js';
import { CONTRACT_RULES, acceptContract, activeAt, boardOpen, contractFor, deliverCargo, offersAt, stillNeeded } from '../../systems/contracts.js';
import { buyShip, findShip, hullLock, hullsForSale, shipPrice } from '../../systems/fleet.js';
import { mapShips } from '../../systems/commanders.js';
import { marketEntries, marketView } from '../../systems/market.js';
import { knownAt, seenAt } from '../../systems/knowledge.js';
import { holdClassOf, holdOf, maxTierOf } from '../../systems/modules.js';
import { giveOrder, orderRefit, refitAll, refitOffer } from '../../systems/orders.js';
import { bestModules } from '../../systems/research.js';
import { canJump, plotCourse } from '../../systems/travel.js';
import { standingLevel } from '../../systems/standing.js';
import { bestTradeQty, buyersOf, maxPurchase, saleHere, tradePlan } from '../../systems/advisor.js';
import { bar, countdown, h } from '../dom.js';
import { button, chip, contractMark, line, panelHead, sectionTitle, shipGlyph, stationIcon, swatch } from '../components.js';
import { orderToast } from '../contextMenu.js';
import { ago, formatPrice, minusCredits, plural, plusCredits, routeText, signedCredits, tonnes, trip } from '../format.js';
import { hireSection } from './commander.js';

const isHauler = (ship) => HULLS[ship.hull].role === 'hauler';
const isMiner = (ship) => HULLS[ship.hull].role === 'miner';

export function stationPanel(ctx, stationId) {
  const { state } = ctx;
  const station = findStation(stationId);
  const type = STATION_TYPES[station.type];
  const docked = mapShips(state).filter((s) => !s.order && s.at === stationId);
  const incoming = mapShips(state).filter((s) => s.order?.target === stationId);

  return [
    panelHead({ icon: stationIcon(station.type, { tint: stationTint(station) }), title: station.name, subtitle: type.description, onClose: ctx.close }),
    h(
      'div',
      { class: 'dw-chips' },
      factionChip(state, station),
      chip(type.label),
      seenChip(ctx, station),
      docked.length ? chip(`${plural(docked.length, 'ship')} docked`, 'aqua') : null,
      incoming.length ? chip(`${incoming.length} on the way`) : null,
    ),
    // Ships come first: selling what just arrived is the usual reason to
    // open a station.
    dockedSection(ctx, station, docked),
    contractsSection(ctx, station),
    station.type === 'shipyard' ? [refitSection(ctx, station), shipyardSection(ctx, station), hireSection(ctx, station)] : marketSection(ctx, station, docked),
    elsewhereSection(ctx, station),
  ];
}

/** The station's faction, with your standing once standing counts (act 2). */
function factionChip(state, station) {
  const name = findFaction(station.faction)?.name ?? 'Unclaimed';
  if (!canJump(state)) return chip(name);
  return chip(`${name} · ${standingLevel(state, station.faction).name}`);
}

// ---------- Market ----------

/** Where no ship is, the prices are the ones last seen: how old they are. */
function seenChip(ctx, station) {
  if (station.type === 'shipyard') return null;
  const seen = seenAt(ctx.state, systemOf(station.id), ctx.now);
  return seen == null ? null : chip(`Prices seen ${ago(ctx.now - seen)}`);
}

function marketSection(ctx, station, docked) {
  const { state, now, ui } = ctx;
  const haulers = docked.filter(isHauler);
  const trade = ui.trade?.stationId === station.id ? ui.trade : null;
  const hauler = haulers.find((s) => s.id === trade?.shipId) ?? haulers[0] ?? null;
  const known = knownAt(state, station.id, now);
  const views = marketEntries(station.id).map((e) => marketView(state, station.id, e.good, known));
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
  const title = h('div', { class: 'dw-card-head' }, h('strong', null, `Trade for ${hauler.name}`), h('span', null, `hold ${tonnes(cargoTotal(hauler))} / ${tonnes(holdOf(hauler))}`));
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

  if (!canCarry(hauler, good)) {
    return h('div', { class: 'dw-card is-aqua' }, title, pickShip, h('p', { class: 'dw-note is-warn' }, `${holdNote(good)} ${hauler.name} has a ${HOLD_CLASS_NAMES[holdClassOf(hauler)].toLowerCase()}.`));
  }

  const maxQty = maxPurchase(state, hauler, good, now);
  if (maxQty <= 0) {
    const reason = cargoTotal(hauler) >= holdOf(hauler) ? `${hauler.name}'s hold is full.` : 'Not enough credits or stock for even a tonne.';
    return h('div', { class: 'dw-card is-aqua' }, title, pickShip, h('p', { class: 'dw-note is-warn' }, reason));
  }

  const buyers = buyersOf(state, good, now).filter(({ station: s }) => s.id !== station.id && tradePlan(state, hauler, good, 1, s.id, now).reachable);
  if (!buyers.length) {
    return h('div', { class: 'dw-card is-aqua' }, title, pickShip, h('p', { class: 'dw-note' }, `Nobody else you know of buys ${goodName(good).toLowerCase()} yet.`));
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
        h('span', { class: 'dw-choice-row' }, h('strong', null, dest.name), h('strong', { class: p.profit > 0 ? 'is-good' : '' }, signedCredits(p.profit))),
        h('span', null, `${p.jumps ? routeText({ jumps: p.jumps, time: p.travel, fees: p.fees }) : `${trip(p.travel)} away`} · sells for about ${formatCredits(p.sell.total)}`),
      );
    }),
  );

  // One order at a time: selling is the next one, given at the buyer.
  const buy = () => {
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
    plan.fees ? line(`Jump fees · ${plural(plan.jumps, 'jump')}`, minusCredits(plan.fees)) : null,
    line('Expected profit', signedCredits(plan.profit), `is-total${plan.profit < 0 ? ' is-loss' : ''}`),
    plan.profit <= 0 ? h('p', { class: 'dw-note is-warn' }, 'Prices here and there are too close right now. They drift back over a few hours.') : null,
    h(
      'div',
      { class: 'dw-row-actions' },
      button(`Buy ${tonnes(plan.qty, good)}`, { variant: 'primary', onClick: buy, key: 'trade-buy', sub: minusCredits(plan.buy.total) }),
    ),
  );
}

// ---------- Shipyard ----------

function shipyardSection(ctx, station) {
  const { state } = ctx;
  const price = shipPrice(state);
  const short = price - state.credits;
  const best = bestModules(state);
  const cards = hullsForSale(state, station.id).map((hullId) => {
    const hull = HULLS[hullId];
    const lock = hullLock(state, hullId, station.id);
    const probe = { hull: hullId, modules: best };
    const holds = hull.holdScale > 0;
    return h(
      'div',
      { class: `dw-card dw-hull${lock ? ' is-locked' : ''}` },
      h('div', { class: 'dw-card-head' }, h('strong', null, hull.name), h('span', null, lock ? 'Locked' : formatCredits(price))),
      h('p', { class: 'dw-note' }, hull.blurb),
      h(
        'dl',
        { class: 'dw-specs' },
        holds ? spec('Hold', tonnes(holdOf(probe))) : null,
        spec('Speed', `${Math.round(MODULES.engine.levels[best.engine] * hull.speedScale)} u/min`),
        hull.role === 'miner' ? spec('Mining', `${MODULES.laser.levels[best.laser]} t/min`) : null,
        holds ? spec('Carries', `tiers 1–${maxTierOf(probe)}`) : null,
      ),
      lock
        ? h('p', { class: 'dw-note' }, lock)
        : button(short > 0 ? `Need ${formatCredits(short)} more` : `Buy for ${formatCredits(price)}`, {
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
    sectionTitle('Ships for sale', `ship ${state.ships.length + 1}`),
    cards,
  );
}

function refitSection(ctx, station) {
  const { state } = ctx;
  const behind = mapShips(state).map((ship) => ({ ship, offer: refitOffer(state, ship) })).filter((r) => r.offer);
  if (!behind.length) return null;
  const total = behind.reduce((sum, r) => sum + r.offer.cost, 0);
  const rows = behind.map(({ ship, offer }) =>
    h(
      'li',
      { class: 'dw-ship-row' },
      shipGlyph(ship.hull),
      h('span', { class: 'dw-grow' }, h('strong', null, ship.name), h('small', null, refitChanges(ship, offer.modules))),
      button(formatCredits(offer.cost), {
        small: true,
        key: `refit-${ship.id}`,
        disabled: state.credits < offer.cost,
        label: `Refit ${ship.name} for ${formatCredits(offer.cost)}`,
        onClick: () => {
          const result = ctx.act((s) => orderRefit(s, findShip(s, ship.id), station.id));
          if (result?.ok) orderToast(ctx, ship, result);
        },
      }),
    ),
  );
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('Refits', `${behind.length} behind`),
    h('ul', { class: 'dw-list' }, rows),
    behind.length > 1
      ? button(`Refit all for ${formatCredits(total)}`, {
          variant: 'primary',
          block: true,
          key: 'refit-all',
          disabled: state.credits < behind[0].offer.cost,
          onClick: () => {
            const result = ctx.act((s) => refitAll(s, station.id));
            if (result?.ok) ctx.toast(`${plural(result.count, 'ship')} booked for a refit: −${formatCredits(result.cost)}`, 'purchase');
          },
        })
      : null,
  );
}

/** "Hold 10 t → 25 t" for what a refit changes on a ship. */
function refitChanges(ship, modules) {
  const parts = [];
  for (const [line, level] of Object.entries(modules)) {
    if (level <= (ship.modules[line] ?? 0)) continue;
    const before = { ...ship, modules: { ...ship.modules } };
    const after = { ...ship, modules: { ...ship.modules, [line]: level } };
    if (line === 'hold') parts.push(`hold ${tonnes(holdOf(before))} → ${tonnes(holdOf(after))}`);
    if (line === 'laser') parts.push(`laser ${MODULES.laser.levels[ship.modules.laser]} → ${MODULES.laser.levels[level]} t/min`);
    if (line === 'engine') parts.push(`engines +${Math.round((MODULES.engine.levels[level] / MODULES.engine.levels[ship.modules.engine] - 1) * 100)}%`);
    if (line === 'seal') parts.push(HOLD_CLASS_NAMES[MODULES.seal.levels[level]].toLowerCase());
  }
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------- Contracts ----------

/** Contracts running here, and offers waiting to be accepted. */
function contractsSection(ctx, station) {
  const { state, now } = ctx;
  if (!boardOpen(state)) return null;
  const running = activeAt(state, station.id, now);
  const offers = offersAt(state, station.id, now);
  if (!running.length && !offers.length) return null;
  const held = state.contracts.active.length;
  const full = held >= CONTRACT_RULES.maxActive;
  const head = (contract, isRunning, right) =>
    h('div', { class: 'dw-card-head' }, h('strong', { class: 'dw-card-title' }, contractMark(isRunning), swatch(contract.good), tonnes(contract.qty, contract.good)), right);
  const runningCards = running.map((c) =>
    h(
      'div',
      { class: 'dw-card is-aqua', dataset: { key: `contract-${c.id}` } },
      head(c, true, countdown(c.deadline)),
      bar({ fraction: c.delivered / c.qty }),
      h('span', { class: 'dw-note' }, `${tonnes(c.delivered)} of ${tonnes(c.qty)} delivered · pays ${formatCredits(c.reward)}`),
    ),
  );
  const offerCards = offers.map((offer) =>
    h(
      'div',
      { class: 'dw-card is-gold' },
      head(offer, false, h('strong', { class: 'is-good' }, formatCredits(offer.reward))),
      h('span', { class: 'dw-note' }, `${trip(offer.hours * HOUR)} to deliver · `, countdown(offer.expiresAt, { prefix: 'offer ends in ' })),
      button(full ? `You hold ${CONTRACT_RULES.maxActive} contracts` : 'Accept', {
        variant: full ? null : 'primary',
        disabled: full,
        key: `accept-${offer.id}`,
        onClick: () => ctx.act((s, t) => acceptContract(s, offer.id, t)),
      }),
    ),
  );
  return h('div', { class: 'dw-section' }, sectionTitle('Contracts', `${held} / ${CONTRACT_RULES.maxActive} held`, { numeric: true }), runningCards, offerCards);
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
    const contract = contractFor(state, station.id, good, now);
    if (contract) {
      const qty = Math.min(Math.floor(ship.cargo[good]), stillNeeded(contract));
      actions.push(
        button([contractMark(true), `Deliver ${tonnes(qty, good)}`], {
          variant: 'primary',
          sub: qty >= stillNeeded(contract) ? plusCredits(contract.reward) : `${tonnes(contract.delivered + qty)} of ${tonnes(contract.qty)}`,
          key: `deliver-${ship.id}-${good}`,
          onClick: () => ctx.act((s) => deliverCargo(s, findShip(s, ship.id), good)),
        }),
      );
    }
    const sale = saleHere(state, ship, good, now);
    if (sale && sale.qty > 0) {
      actions.push(
        button(`Sell ${tonnes(sale.qty, good)}`, {
          variant: contract ? null : 'primary',
          sub: plusCredits(sale.total),
          key: `sell-${ship.id}-${good}`,
          onClick: () => ctx.act((s) => sellCargo(s, findShip(s, ship.id), good)),
        }),
      );
    } else if (!contract) {
      actions.push(
        button(`Sell ${goodName(good).toLowerCase()} elsewhere`, {
          key: `elsewhere-${ship.id}-${good}`,
          onClick: () => ctx.select('ship', ship.id),
        }),
      );
    }
  }

  if (isMiner(ship)) {
    actions.push(button('Send mining', { key: `mine-${ship.id}`, onClick: () => ctx.select('ship', ship.id) }));
  }

  return h(
    'div',
    { class: 'dw-card' },
    h(
      'button',
      { type: 'button', class: 'dw-ship-row is-plain', onClick: () => ctx.select('ship', ship.id), dataset: { key: `docked-${ship.id}` } },
      shipGlyph(ship.hull),
      h('span', { class: 'dw-grow' }, h('strong', null, ship.name), h('small', null, `${hull.name} · hold ${tonnes(cargoTotal(ship))} / ${tonnes(holdOf(ship))}`)),
    ),
    goods.length ? h('div', { class: 'dw-chips' }, goods.map((g) => chip([swatch(g), tonnes(ship.cargo[g], g)]))) : null,
    actions.length ? h('div', { class: 'dw-row-actions' }, actions) : null,
  );
}

// ---------- Ships elsewhere ----------

function elsewhereSection(ctx, station) {
  const { state, now } = ctx;
  const idle = mapShips(state).filter((s) => !s.order && s.at && s.at !== station.id);
  if (!idle.length || station.type === 'shipyard') return null;

  const rows = idle.map((ship) => {
    const send = (spec) => {
      const result = ctx.act((s) => giveOrder(s, findShip(s, ship.id), spec));
      if (result?.ok) orderToast(ctx, ship, result);
    };
    // Only ships with a known route here.
    const course = plotCourse(state, ship, ship.at, station.id);
    if (!course.ok) return null;
    const wanted = Object.keys(ship.cargo).find((g) => ship.cargo[g] >= 1 && contractFor(state, station.id, g, now));
    const sellable = Object.keys(ship.cargo).find((g) => ship.cargo[g] > 0 && marketView(state, station.id, g, now)?.side === 'buys');
    const action = wanted
      ? button([contractMark(true), `Deliver ${tonnes(Math.min(ship.cargo[wanted], stillNeeded(contractFor(state, station.id, wanted, now))), wanted)}`], {
          small: true,
          variant: 'primary',
          key: `bring-${ship.id}`,
          sub: routeText(course),
          onClick: () => send({ type: 'deliver', stationId: station.id, good: wanted }),
        })
      : sellable
      ? button(`Sell ${tonnes(ship.cargo[sellable], sellable)}`, {
          small: true,
          variant: 'primary',
          key: `bring-${ship.id}`,
          sub: routeText(course),
          onClick: () => send({ type: 'sell', stationId: station.id, good: sellable }),
        })
      : button(`Fly here`, {
          small: true,
          key: `bring-${ship.id}`,
          sub: routeText(course),
          onClick: () => send({ type: 'fly', stationId: station.id }),
        });
    return h(
      'li',
      { class: 'dw-ship-row' },
      shipGlyph(ship.hull),
      h('span', { class: 'dw-grow' }, h('strong', null, ship.name), h('small', null, `At ${findPlace(ship.at)?.name ?? 'its post'}`)),
      action,
    );
  });
  if (!rows.some(Boolean)) return null;
  return h('div', { class: 'dw-section' }, sectionTitle('Send a ship here'), h('ul', { class: 'dw-list' }, rows));
}
