// One ship: what it is doing, its orders, what it carries, its modules, and
// new orders for it.

import { HULLS, HOLD_CLASS_NAMES, MODULES } from '../../content/ships.js';
import { goodName } from '../../content/goods.js';
import { allSystems, findPlace, findStation, findSystem, systemOf } from '../../content/galaxy.js';
import { formatCredits } from '../../../../shared/js/format.js';
import { cargoTotal } from '../../systems/cargo.js';
import { contractForSale } from '../../systems/contracts.js';
import { sellAllHere } from '../../systems/commands.js';
import { findShip } from '../../systems/fleet.js';
import { holdOf, laserOf, linesFor, speedOf } from '../../systems/modules.js';
import {
  cancelOrder,
  canCopy,
  cargoNow,
  canRepeat,
  canRunAgain,
  clearQueue,
  copyOrders,
  freeSlots,
  giveOrder,
  lowerFirst,
  orderPhase,
  orderRefit,
  orderTimes,
  projectShip,
  refitOffer,
  repeatToFill,
  roomForRounds,
  runAgain,
  specLabel,
} from '../../systems/orders.js';
import { bestModules, orderSlots } from '../../systems/research.js';
import { minePreview, saleValue } from '../../systems/advisor.js';
import { findEntry } from '../../systems/market.js';
import { knownStations, surveyable } from '../../systems/explore.js';
import { plotCourse } from '../../systems/travel.js';
import { bar, countdown, h } from '../dom.js';
import { button, chip, contractTag, panelHead, sectionTitle, shipGlyph, swatch } from '../components.js';
import { orderToast } from '../contextMenu.js';
import { at, plusCredits, routeText, span, timing, tonnes } from '../format.js';
import { richnessLabel } from './field.js';

export function shipPanel(ctx, shipId) {
  const { state } = ctx;
  const ship = findShip(state, shipId);
  if (!ship) return null;
  const hull = HULLS[ship.hull];
  // A mining ship's hold fills as it mines.
  const cargo = cargoNow(ship, ctx.now);
  const total = cargoTotal({ cargo });
  const hold = holdOf(ship);

  return [
    panelHead({ icon: shipGlyph(ship.hull), title: ship.name, subtitle: hull.name, onClose: ctx.close }),
    statusCard(ctx, ship),
    ordersSection(ctx, ship),
    h(
      'div',
      { class: 'dw-section' },
      sectionTitle('Hold', `${tonnes(total)} / ${tonnes(hold)}`, { numeric: true }),
      bar({ fraction: total / hold, variant: hull.role === 'hauler' ? 'gold' : null }),
      total > 0
        ? h('div', { class: 'dw-chips' }, Object.keys(cargo).map((g) => chip([swatch(g), tonnes(cargo[g], g)])))
        : h('p', { class: 'dw-note' }, 'Empty.'),
    ),
    newOrders(ctx, ship),
    modulesSection(ctx, ship),
  ];
}

function cancel(ctx, ship) {
  const result = ctx.act((s) => cancelOrder(s, findShip(s, ship.id), s.now));
  if (!result?.ok) return;
  if (result.flying) ctx.toast(`${ship.name} stops when it gets there`, 'order');
  else if (result.mined > 0) ctx.toast(`${ship.name} stopped with ${tonnes(result.mined)} mined`, 'order');
  else ctx.toast(`${ship.name}'s order is cancelled`, 'order');
}

function placeName(id) {
  return findPlace(id)?.name ?? 'space';
}

function statusCard(ctx, ship) {
  if (ship.order) {
    // The flight and the job are shown one after the other, each with its
    // own time.
    const order = ship.order;
    const phase = orderPhase(order, ctx.now);
    const { work } = orderTimes(order);
    const after = work > 0 ? `Then ${lowerFirst(order.label)} for ${span(work)}.` : 'Done when it arrives.';
    // A plain flight cannot be cancelled: there is nowhere to stop.
    const cancellable = !(phase.flying && order.type === 'fly');
    return h(
      'div',
      { class: 'dw-card is-aqua' },
      h('div', { class: 'dw-card-head' }, h('strong', null, phase.label), countdown(phase.end)),
      bar({ start: phase.start, end: phase.end }),
      h(
        'div',
        { class: 'dw-card-foot' },
        h('p', { class: 'dw-note dw-grow' }, phase.flying ? after : `Done at ${at(phase.end)}.`),
        cancellable ? button('Cancel order', { small: true, key: 'cancel-order', onClick: () => cancel(ctx, ship) }) : null,
      ),
    );
  }
  const station = findStation(ship.at);
  return h(
    'div',
    { class: 'dw-card is-gold' },
    h('div', { class: 'dw-card-head' }, h('strong', null, station ? `Docked at ${station.name}` : `Waiting at ${placeName(ship.at)}`), h('span', null, 'Waiting for orders')),
    station && station.type !== 'shipyard'
      ? h('div', { class: 'dw-row-actions' }, button(`Open ${station.name}`, { small: true, key: 'open-station', onClick: () => ctx.select('station', station.id) }))
      : null,
  );
}

// ---------- Orders ----------

function ordersSection(ctx, ship) {
  const { state } = ctx;
  const slots = orderSlots(state);
  const used = (ship.order ? 1 : 0) + ship.queue.length;
  const items = [];
  if (ship.order) items.push(h('li', { class: 'is-current' }, h('span', { class: 'dw-queue-mark', 'aria-hidden': 'true' }, '▶'), h('span', { class: 'dw-grow' }, specLabel(ship.order.spec))));
  ship.queue.forEach((spec, i) => items.push(h('li', null, h('span', { class: 'dw-queue-mark', 'aria-hidden': 'true' }, String(i + 2)), h('span', { class: 'dw-grow' }, specLabel(spec)))));

  const actions = [];
  const rounds = roomForRounds(state, ship);
  if (canRunAgain(state, ship)) {
    actions.push(button('Run again', { variant: 'primary', small: true, key: 'run-again', onClick: () => report(ctx, ship, ctx.act((s) => runAgain(s, findShip(s, ship.id)))) }));
  }
  if (canRepeat(state, ship)) {
    actions.push(
      button(`Repeat to fill`, {
        small: true,
        key: 'repeat-fill',
        sub: `${rounds} more ${rounds === 1 ? 'round' : 'rounds'}`,
        onClick: () => report(ctx, ship, ctx.act((s) => repeatToFill(s, findShip(s, ship.id)))),
      }),
    );
  }
  if (ship.queue.length) {
    actions.push(button('Clear queue', { small: true, key: 'clear-queue', onClick: () => ctx.act((s) => clearQueue(s, findShip(s, ship.id))) }));
  }

  // Copy another ship's orders onto this one.
  const sources = ship.order || ship.plan.length ? [] : state.ships.filter((other) => canCopy(state, other, ship));
  const copy = sources.length
    ? h(
        'div',
        { class: 'dw-choices', role: 'group', 'aria-label': 'Copy orders from' },
        sources.slice(0, 4).map((other) =>
          h(
            'button',
            {
              type: 'button',
              class: 'dw-choice',
              dataset: { key: `copy-${other.id}` },
              onClick: () => report(ctx, ship, ctx.act((s) => copyOrders(s, findShip(s, ship.id), findShip(s, other.id)))),
            },
            h('strong', null, `Copy orders from ${other.name}`),
            h('span', null, other.plan.map(specLabel).join(' → ')),
          ),
        ),
      )
    : null;

  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('Orders', `${used} / ${slots}`, { numeric: true }),
    items.length ? h('ol', { class: 'dw-queue' }, items) : h('p', { class: 'dw-note' }, ship.plan.length ? `Last time: ${ship.plan.map(specLabel).join(' → ')}.` : 'No orders.'),
    actions.length ? h('div', { class: 'dw-row-actions' }, actions) : null,
    copy,
  );
}

function report(ctx, ship, result) {
  if (result?.ok && result.given) ctx.toast(`${ship.name} has ${result.given} new ${result.given === 1 ? 'order' : 'orders'}`, 'order');
}

// ---------- New orders ----------

function newOrders(ctx, ship) {
  const { state, now } = ctx;
  const hull = HULLS[ship.hull];
  const view = projectShip(state, ship);
  const free = freeSlots(state, ship);
  const queued = Boolean(ship.order);
  if (queued && free <= 0) return null;
  const sections = [];
  const give = (spec) => {
    const result = ctx.act((s) => giveOrder(s, findShip(s, ship.id), spec));
    if (result?.ok) orderToast(ctx, ship, result);
  };

  const homeSystem = systemOf(view.at);
  // Sell what it carries (or will carry once its orders are done): every
  // buyer in this system, and the best few elsewhere that a route reaches.
  const aboard = Object.keys(view.cargo).filter((g) => view.cargo[g] > 0);
  if (aboard.length) {
    const near = [];
    const far = [];
    for (const station of knownStations(state)) {
      const goods = aboard.filter((g) => findEntry(station.id, g)?.side === 'buys');
      if (!goods.length) continue;
      const local = systemOf(station.id) === homeSystem;
      const course = local ? null : plotCourse(state, view, view.at, station.id);
      if (course && !course.ok) continue;
      const total = goods.reduce((sum, g) => sum + saleValue(state, station.id, g, view.cargo[g], now).total, 0);
      const here = !queued && ship.at === station.id;
      (local ? near : far).push({ station, goods, total, here, course, contract: contractForSale(state, station.id, goods, now) });
    }
    near.sort((a, b) => b.total - a.total);
    far.sort((a, b) => b.total - (b.course?.fees ?? 0) - (a.total - (a.course?.fees ?? 0)));
    const rows = [...near, ...far.slice(0, 3)];
    sections.push(
      h(
        'div',
        { class: 'dw-section' },
        sectionTitle(queued ? 'Then sell' : 'Sell'),
        rows.length
          ? h(
              'div',
              { class: 'dw-choices', role: 'group', 'aria-label': 'Sell' },
              rows.map((row) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'dw-choice',
                    dataset: { key: `sell-${row.station.id}` },
                    onClick: () => (row.here ? ctx.act((s) => sellAllHere(s, findShip(s, ship.id), row.goods)) : give({ type: 'sell', stationId: row.station.id })),
                  },
                  h(
                    'span',
                    { class: 'dw-choice-row' },
                    h('strong', null, row.here ? 'Sell here' : `Sell at ${row.station.name}`, contractTag(row.contract)),
                    h('strong', { class: 'is-good' }, `${row.here ? '' : 'about '}${plusCredits(row.total)}`),
                  ),
                  h('span', null, [row.goods.map((g) => goodName(g).toLowerCase()).join(', '), row.course ? ` · ${routeText(row.course)}` : ''].join('')),
                ),
              ),
            )
          : h('p', { class: 'dw-note' }, 'Nobody you know of buys this yet.'),
      ),
    );
  }

  if (hull.role === 'miner' && holdOf(view) - cargoTotal(view) >= 1) {
    sections.push(
      h(
        'div',
        { class: 'dw-section' },
        sectionTitle(queued ? 'Then mine a full hold' : 'Mine a full hold'),
        h(
          'div',
          { class: 'dw-choices is-grid' },
          (findSystem(homeSystem)?.fields ?? []).map((field) => {
            const preview = minePreview(state, ship, field.id, null, now);
            return h(
              'button',
              {
                type: 'button',
                class: 'dw-choice',
                disabled: !preview.ok,
                dataset: { key: `mine-${field.id}` },
                onClick: () => give({ type: 'mine', fieldId: field.id, amount: null }),
              },
              h('strong', null, field.name),
              h('span', null, `${goodName(field.good)} · ${richnessLabel(field.richness).toLowerCase()}`),
              h('span', null, preview.ok ? `${tonnes(preview.amount)} · about ${formatCredits(preview.value)}` : 'Hold full'),
              preview.ok ? h('span', null, timing({ flight: preview.flight, work: preview.work }, 'mining')) : null,
            );
          }),
        ),
      ),
    );
  }

  if (hull.role === 'scout') {
    const targets = allSystems()
      .filter((system) => surveyable(state, system.id))
      .map((system) => ({ system, course: plotCourse(state, view, view.at, system.gates[0]?.id, { surveyTarget: system.id }) }))
      .filter((t) => t.course.ok)
      .sort((a, b) => a.course.time - b.course.time)
      .slice(0, 4);
    sections.push(
      h(
        'div',
        { class: 'dw-section' },
        sectionTitle(queued ? 'Then survey' : 'Survey'),
        targets.length
          ? h(
              'div',
              { class: 'dw-choices is-grid' },
              targets.map(({ system, course }) =>
                h(
                  'button',
                  { type: 'button', class: 'dw-choice', dataset: { key: `survey-${system.id}` }, onClick: () => give({ type: 'survey', systemId: system.id }) },
                  h('strong', null, system.name),
                  h('span', null, routeText(course)),
                ),
              ),
            )
          : h('p', { class: 'dw-note' }, 'Every system in reach is surveyed.'),
      ),
    );
  }

  const destinations = (findSystem(homeSystem)?.stations ?? []).filter((s) => s.id !== view.at);
  if (destinations.length) sections.push(
    h(
      'div',
      { class: 'dw-section' },
      sectionTitle(queued ? 'Then fly to' : 'Fly to'),
      h(
        'div',
        { class: 'dw-choices is-grid' },
        destinations.map((station) =>
          h(
            'button',
            { type: 'button', class: 'dw-choice', dataset: { key: `fly-${station.id}` }, onClick: () => give({ type: 'fly', stationId: station.id }) },
            h('strong', null, station.name),
            h('span', null, station.short),
          ),
        ),
      ),
    ),
  );
  return sections;
}

// ---------- Modules ----------

function modulesSection(ctx, ship) {
  const { state } = ctx;
  const best = bestModules(state);
  const hull = HULLS[ship.hull];
  const rows = linesFor(ship.hull).map((line) => {
    const level = ship.modules[line];
    const value = (lvl) => moduleValue(ship, line, lvl);
    const newer = best[line] > level ? h('span', { class: 'dw-module-new' }, `newest ${value(best[line])}`) : null;
    return h('div', null, h('dt', null, `${MODULES[line].name}:`), h('dd', null, value(level), newer));
  });
  const offer = refitOffer(state, ship);
  const short = offer ? offer.cost - state.credits : 0;
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('Modules'),
    h('dl', { class: 'dw-specs is-stacked' }, rows, h('div', null, h('dt', null, 'Hold type:'), h('dd', null, HOLD_CLASS_NAMES[hull.holdClass]))),
    offer
      ? button(short > 0 ? `Refit · need ${formatCredits(short)} more` : `Refit at the shipyard`, {
          block: true,
          disabled: short > 0 || freeSlots(state, ship) <= 0,
          sub: short > 0 ? null : `−${formatCredits(offer.cost)}`,
          key: 'refit',
          onClick: () => {
            const result = ctx.act((s) => orderRefit(s, findShip(s, ship.id)));
            if (result?.ok) orderToast(ctx, ship, result);
          },
        })
      : null,
  );
}

function moduleValue(ship, line, level) {
  const probe = { ...ship, modules: { ...ship.modules, [line]: level } };
  if (line === 'hold') return tonnes(holdOf(probe));
  if (line === 'laser') return `${laserOf(probe)} t/min`;
  return `${Math.round(speedOf(probe))} u/min`;
}
