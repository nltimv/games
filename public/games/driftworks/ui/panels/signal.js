// A signal in a deep system: unknown until a scout investigates it, then a
// derelict to salvage, a rich field or an ancient gate.

import { GOODS, TIER_NAMES, goodName } from '../../content/goods.js';
import { HULLS } from '../../content/ships.js';
import { findSignal, findSystem, systemOf } from '../../content/galaxy.js';
import { canCarry, holdNote } from '../../systems/cargo.js';
import { findShip } from '../../systems/fleet.js';
import { mapShips, onMap } from '../../systems/commanders.js';
import { freeSlots, giveOrder } from '../../systems/orders.js';
import { derelictLeft, isGateOpen, isInvestigated, signalTitle, workerAt } from '../../systems/signals.js';
import { isSurveyed } from '../../systems/explore.js';
import { h } from '../dom.js';
import { button, chip, panelHead, sectionTitle, signalIcon } from '../components.js';
import { orderToast } from '../contextMenu.js';
import { tonnes } from '../format.js';

/** One button per ship that could take the order, or a line on who already has it. */
function sendButtons(ctx, ships, type, signal, verb) {
  const { state } = ctx;
  const busy = workerAt(state, signal.id, type);
  if (busy) return h('p', { class: 'dw-note' }, onMap(busy) ? `${busy.name} is on its way.` : 'A fleet on a mission has it.');
  const ready = ships.filter((ship) => freeSlots(state, ship) > 0);
  if (!ready.length) return null;
  return h(
    'div',
    { class: 'dw-row-actions' },
    ready.map((ship) =>
      button(`${verb} with ${ship.name}`, {
        small: true,
        variant: 'primary',
        key: `${type}-${ship.id}`,
        onClick: () => {
          const result = ctx.act((s) => giveOrder(s, findShip(s, ship.id), { type, signalId: signal.id }));
          if (result?.ok) orderToast(ctx, ship, result);
        },
      }),
    ),
  );
}

export function signalPanel(ctx, signalId) {
  const { state } = ctx;
  const signal = findSignal(signalId);
  const system = findSystem(systemOf(signalId));
  if (!signal || !isSurveyed(state, system.id)) return [panelHead({ title: 'Signal', onClose: ctx.close })];
  const head = panelHead({ icon: signalIcon(state, signal), title: signalTitle(state, signal), subtitle: `Signal · ${system.name}`, onClose: ctx.close });

  if (!isInvestigated(state, signal)) {
    const scouts = mapShips(state).filter((ship) => HULLS[ship.hull].role === 'scout');
    return [head, h('p', { class: 'dw-note' }, 'Something out past the planets answers the scanners.'), sendButtons(ctx, scouts, 'investigate', signal, 'Investigate')];
  }

  if (signal.kind === 'derelict') {
    const left = derelictLeft(state, signal);
    const good = GOODS[signal.good];
    const haulers = mapShips(state).filter((ship) => HULLS[ship.hull].role === 'hauler');
    const able = haulers.filter((ship) => canCarry(ship, signal.good));
    return [
      head,
      h('div', { class: 'dw-chips' }, chip(left > 0 ? tonnes(left, signal.good) : 'Empty', left > 0 ? 'gold' : null), chip(`Tier ${good.tier} · ${TIER_NAMES[good.tier].toLowerCase()}`)),
      left > 0
        ? h(
            'div',
            { class: 'dw-section' },
            sectionTitle(`Salvage ${goodName(signal.good).toLowerCase()}`),
            haulers.length && !able.length ? h('p', { class: 'dw-note' }, holdNote(signal.good, haulers[0])) : null,
            sendButtons(ctx, able, 'salvage', signal, 'Salvage'),
          )
        : h('p', { class: 'dw-note' }, 'Your haulers took everything aboard.'),
    ];
  }

  if (signal.kind === 'rich') {
    return [head, button(`Show ${signal.field.name}`, { key: 'show-field', block: true, variant: 'primary', onClick: () => ctx.select('field', signal.field.id) })];
  }

  const far = findSystem(signal.to);
  return [
    head,
    h('p', { class: 'dw-note' }, isGateOpen(state, signal) ? `Open, to ${far.name}. Nobody charges for the jump.` : `Closed. The far end, in ${far.name}, has not been investigated.`),
    button(isSurveyed(state, far.id) ? `Open the ${far.name} map` : `Show ${far.name} on the galaxy map`, {
      key: 'ancient-far',
      block: true,
      onClick: () => (isSurveyed(state, far.id) ? ctx.openSystem(far.id) : ctx.select('system', far.id)),
    }),
  ];
}
