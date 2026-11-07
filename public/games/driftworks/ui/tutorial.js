// The tutorial: a guide card for each of the first goals, saying what to do
// next and pointing at it, on the map (a gold ring) or in the interface (a
// glow on the button). This is the one place in the game that explains how
// to play; it can be skipped.

import { GOALS } from '../content/goals.js';
import { goodName } from '../content/goods.js';
import { HULLS, ORDER_SLOTS } from '../content/ships.js';
import { HOME_SYSTEM } from '../content/homeSystem.js';
import { allSystems, findStation, findSystem, systemOf } from '../content/galaxy.js';
import { cargoTotal } from '../systems/cargo.js';
import { knownStations, surveyable } from '../systems/explore.js';
import { tutorialGoal } from '../systems/goals.js';
import { findEntry, marketEntries } from '../systems/market.js';
import { canCopy, projectShip } from '../systems/orders.js';
import { isResearched } from '../systems/research.js';
import { shipSystem, travelTime } from '../systems/travel.js';
import { formatCredits } from '../../../shared/js/format.js';
import { h } from './dom.js';
import { at, tonnes } from './format.js';

const FIELD = 'carbon-drift';
const REFINERY = 'halcyon-refinery';
const SHIPYARD = 'halcyon-shipyard';

const mules = (state) => state.ships.filter((ship) => ship.hull === 'mule');
const isSelected = (ui, kind, id) => ui.view === 'system' && ui.selection?.kind === kind && ui.selection.id === id;
// The place the order menu shows orders for (a station picked in a system's menu counts).
const menuOn = (ui, id) => (ui.menu?.place ?? ui.menu?.target)?.id === id;
const key = (k) => `[data-key="${k}"]`;

// Queuing, copying and repeating are shortcuts, so the tutorial only
// mentions them as tips and never makes them a step.
// Mouse controls only matter with a mouse.
const hasMouse = () => Boolean(globalThis.matchMedia?.('(pointer: fine)').matches);
const MAP_TIP = 'Drag with the right mouse button to move the map, and scroll to zoom.';
const BOX_TIP = 'Drag a box around ships to select them together, then right-click a place to give them all the same order.';
const QUEUE_TIP = 'You can also give that order now: a busy ship queues it for when it is done.';

/** Steps that send the player to a research. */
function research(state, ui, id, name, why) {
  const active = state.research.active;
  if (active?.id === id) return { text: `${name} is done at ${at(active.endsAt)}. Research keeps going while the game is closed.` };
  if (active) return { text: `The lab is busy until ${at(active.endsAt)}. ${name} comes next.` };
  if (ui.view !== 'research') return { text: `${why} Open Research and start ${name}.`, selector: '[data-view="research"]' };
  return { text: `Start ${name}. Research keeps going while the game is closed.`, selector: key(`research-${id}`) };
}

/** Steps that send the player to the shipyard to buy a Mule. */
function buyMule(state, ui, why) {
  if (!isSelected(ui, 'station', SHIPYARD)) return { text: `${why} Click Halcyon Shipyard on the map.`, map: { kind: 'station', id: SHIPYARD } };
  return { text: 'Buy a Mule-class miner.', selector: key('buy-hull-mule') };
}

/** Steps that send a selected ship to mine a full hold at Carbon Drift. */
function mineSteps(ui, ship, lead, tip) {
  if (!isSelected(ui, 'ship', ship.id)) return { text: `${lead}Select ${ship.name}: click it on the map.`, map: { kind: 'ship', id: ship.id }, tip };
  if (menuOn(ui, FIELD)) return { text: 'Pick Mine a full hold. A Mule fills its 10 t hold in about a minute.', selector: key('menu-mine-'), tip };
  return { text: 'Right-click Carbon Drift (on a touch screen, press and hold it) and pick Mine a full hold.', map: { kind: 'field', id: FIELD }, tip };
}

/** Steps to accept the contract offered in Aurel. */
function acceptSteps(state, ui) {
  const offer = state.contracts.offers.find((o) => systemOf(o.stationId) === HOME_SYSTEM.id && o.expiresAt > state.now);
  if (!offer) return null;
  const station = findStation(offer.stationId);
  if (!isSelected(ui, 'station', station.id)) {
    return { text: `Brokerage is done. A gold ! on the map marks a station with a contract offer. Click ${station.name}.`, map: { kind: 'station', id: station.id } };
  }
  return {
    text: `Accept the contract. ${station.name} pays ${formatCredits(offer.reward)} once all ${tonnes(offer.qty, offer.good)} are delivered, within the time it gives.`,
    selector: key(`accept-${offer.id}`),
  };
}

/** Steps to fill a running contract: mine its ore, then deliver it. */
function deliverSteps(state, ui, contract) {
  const station = findStation(contract.stationId);
  const good = goodName(contract.good).toLowerCase();
  const delivering = state.ships.find((ship) => [ship.order?.spec, ...ship.queue].some((spec) => spec?.type === 'deliver' && spec.stationId === station.id));
  if (delivering) {
    return { text: `${delivering.name} delivers ${good} to ${station.name}. The contract pays when the last tonne arrives.`, map: { kind: 'ship', id: delivering.id } };
  }
  const carrier = state.ships.find((ship) => (projectShip(state, ship).cargo[contract.good] ?? 0) >= 1);
  if (carrier) {
    const tip = carrier.order ? QUEUE_TIP : undefined;
    if (menuOn(ui, station.id)) return { text: 'Pick Deliver. Delivered goods go to the contract and are not sold, so prices do not matter.', selector: key(`menu-deliver-${contract.good}`), tip };
    const aboard = (carrier.cargo[contract.good] ?? 0) >= 1 ? `${carrier.name} has ${good} aboard.` : `${carrier.name} is getting ${good}.`;
    if (!isSelected(ui, 'ship', carrier.id)) return { text: `${aboard} Select it to deliver.`, map: { kind: 'ship', id: carrier.id }, tip };
    return { text: `Right-click ${station.name} (on a touch screen, press and hold it) and pick Deliver.`, map: { kind: 'station', id: station.id }, tip };
  }
  const field = HOME_SYSTEM.fields.find((f) => f.good === contract.good);
  const miner = mules(state).find((ship) => !ship.order) ?? mules(state)[0];
  if (!field || !miner) return null;
  const lead = `The contract wants ${tonnes(contract.qty, contract.good)}. `;
  if (!isSelected(ui, 'ship', miner.id)) return { text: `${lead}Select ${miner.name}: click it on the map.`, map: { kind: 'ship', id: miner.id } };
  if (menuOn(ui, field.id)) return { text: 'Pick Mine a full hold.', selector: key('menu-mine-') };
  return { text: `${lead}Right-click ${field.name} and pick Mine a full hold.`, map: { kind: 'field', id: field.id } };
}

const GUIDES = {
  'first-sale'(state, ui) {
    const mule = state.ships[0];
    if (!mule) return null;
    if (mule.order?.spec.type === 'sell') return { text: `${mule.name} flies its ore to Halcyon Refinery and sells it there.`, map: { kind: 'ship', id: mule.id } };
    if (mule.queue.some((spec) => spec.type === 'sell')) return { text: `${mule.name} sells its ore at Halcyon Refinery once its hold is full.`, map: { kind: 'ship', id: mule.id } };
    const cargo = projectShip(state, mule).cargo;
    if (!cargoTotal({ cargo })) return mineSteps(ui, mule, '', hasMouse() ? MAP_TIP : undefined);

    // Ore is on board or on its way: sell it at the refinery.
    const goods = Object.keys(cargo).filter((good) => cargo[good] > 0);
    const sale = goods.length === 1 ? `Sell ${goodName(goods[0]).toLowerCase()}` : 'Sell all cargo';
    const mining = mule.order?.spec.type === 'mine';
    const lead = mining ? `${mule.name} is filling its hold. When it is done, ` : `${mule.name}'s hold is full. `;
    const tip = mining ? QUEUE_TIP : undefined;
    if (menuOn(ui, REFINERY)) return { text: `Pick ${sale}.`, selector: key('menu-sell-'), tip };
    if (!isSelected(ui, 'ship', mule.id)) return { text: `${lead}${mining ? 'select' : 'Select'} it to sell the ore.`, map: { kind: 'ship', id: mule.id }, tip };
    return { text: `${lead}${mining ? 'right-click' : 'Right-click'} Halcyon Refinery and pick ${sale}.`, map: { kind: 'station', id: REFINERY }, tip };
  },
  'first-research'(state, ui) {
    return research(state, ui, 'hold-1', 'Cargo racks I', 'Bigger holds mean longer trips and fewer orders.');
  },
  'second-mule'(state, ui) {
    const fleet = mules(state);
    if (fleet.length < 2) return buyMule(state, ui, `A second Mule costs ${formatCredits(150)}.`);
    const idle = fleet.find((ship) => !ship.order && !ship.plan.length);
    if (!idle) return null;
    const from = fleet.find((ship) => canCopy(state, ship, idle));
    const tip = from ? `Copy orders from ${from.name}, in ${idle.name}'s panel, gives it the same orders in one click.` : undefined;
    return mineSteps(ui, idle, 'It waits next to the shipyard. ', tip);
  },
  'first-contract'(state, ui) {
    if (!isResearched(state, 'brokerage')) return research(state, ui, 'brokerage', 'Brokerage', 'Contracts pay a fixed price for ore you already mine.');
    const contract = state.contracts.active.find((c) => c.deadline > state.now);
    if (!contract) return acceptSteps(state, ui);
    return deliverSteps(state, ui, contract);
  },
  'third-mule'(state, ui) {
    return { ...buyMule(state, ui, 'A third Mule pays for itself in about an hour.'), tip: hasMouse() ? BOX_TIP : undefined };
  },
  'first-refit'(state, ui) {
    if (!isSelected(ui, 'station', SHIPYARD)) {
      return { text: 'New ships come with Cargo racks I. Older ships get them with a refit: click Halcyon Shipyard.', map: { kind: 'station', id: SHIPYARD } };
    }
    return { text: 'Refit a ship. It flies to the shipyard when its current orders are done, and its hold grows from 10 t to 25 t.', selector: '[data-key^="refit-"]' };
  },
  'queue-research'(state, ui) {
    return {
      ...research(state, ui, 'queue-1', 'Order queue I', 'Longer queues keep ships busy while you work.'),
      tip: `With it, every ship holds ${ORDER_SLOTS[1]} orders. In a ship's panel, Run again gives it its last orders again, and Repeat to fill repeats them until its orders are full.`,
    };
  },
};

// ---------- Act 2 ----------

const isScout = (ship) => HULLS[ship.hull].role === 'scout';
const isHauler = (ship) => HULLS[ship.hull].role === 'hauler';
const inGalaxy = (ui) => ui.view === 'galaxy';
const OPEN_GALAXY = { text: 'Open the Galaxy map.', selector: '[data-view="galaxy"]' };

/** Selects a ship from the galaxy map: click its system, then pick it under Your ships here. */
function pickOnGalaxy(state, ui, ship, lead) {
  const where = shipSystem(ship, state.now);
  if (ui.selection?.kind === 'system' && ui.selection.id === where) return { text: `${lead}Pick ${ship.name} under Your ships here.`, selector: key(`fleet-${ship.id}`) };
  return { text: `${lead}Select ${ship.name}: click ${findSystem(where)?.name ?? 'its system'}, then pick ${ship.name} in its panel.`, map: where ? { kind: 'system', id: where } : null };
}

/** The unsurveyed system a scout reaches first. */
function nextSurvey(state, scout) {
  let best = null;
  for (const system of allSystems()) {
    if (!surveyable(state, system.id)) continue;
    const time = travelTime(state, scout, scout.at, system.gates[0]?.id, { surveyTarget: system.id });
    if (time < (best?.time ?? Infinity)) best = { id: system.id, time };
  }
  return best ? findSystem(best.id) : null;
}

/** A station in another surveyed system that buys something sold where `ship` is. */
function farBuyer(state, ship) {
  const here = systemOf(ship.at);
  const sold = marketEntries(ship.at).filter((e) => e.side === 'sells').map((e) => e.good);
  const carried = Object.keys(ship.cargo).filter((g) => ship.cargo[g] > 0);
  const wanted = carried.length ? carried : sold;
  return knownStations(state).find((station) => systemOf(station.id) !== here && wanted.some((g) => findEntry(station.id, g)?.side === 'buys')) ?? null;
}

Object.assign(GUIDES, {
  'first-scout'(state, ui) {
    if (!isResearched(state, 'scout-licence')) return research(state, ui, 'scout-licence', 'Scout licence', 'The warp drive opens the gates, but only scouts can enter systems nobody has surveyed.');
    if (!isSelected(ui, 'station', SHIPYARD)) return { text: 'Shipyards sell Lark-class scouts now. Click Halcyon Shipyard on the map.', map: { kind: 'station', id: SHIPYARD } };
    return { text: 'Buy a Lark-class scout. It is fast and carries no cargo.', selector: key('buy-hull-lark') };
  },
  'first-survey'(state, ui) {
    const scouts = state.ships.filter(isScout);
    const busy = scouts.find((ship) => ship.order?.spec.type === 'survey');
    if (busy) {
      const target = findSystem(busy.order.spec.systemId);
      return { text: `${busy.name} flies through the gates to ${target.name} and surveys it for a few minutes. Once a system is surveyed, any ship can fly there.`, map: inGalaxy(ui) ? { kind: 'ship', id: busy.id } : null };
    }
    const scout = scouts[0];
    if (!scout?.at) return null;
    if (!inGalaxy(ui)) return { ...OPEN_GALAXY, text: 'Open the Galaxy map. Each node is a system, and the lines between them are warp lanes.' };
    if (!(ui.selection?.kind === 'ship' && ui.selection.id === scout.id)) return pickOnGalaxy(state, ui, scout, 'Systems marked ? are unsurveyed. ');
    const target = nextSurvey(state, scout);
    if (!target) return null;
    if (ui.menu?.target.kind === 'system') return { text: `Pick Survey. ${scout.name} pays the jump fee at the gate.`, selector: '[data-key^="menu-survey"]' };
    return {
      text: `Right-click ${target.name} (on a touch screen, press and hold it) and pick Survey.`,
      map: { kind: 'system', id: target.id },
      tip: 'A system\'s panel has a Survey button for each scout too.',
    };
  },
  'far-sale'(state, ui) {
    for (const ship of state.ships) {
      const sale = [ship.order?.spec, ...ship.queue].find((spec) => spec?.type === 'sell' && systemOf(spec.stationId) !== HOME_SYSTEM.id);
      if (sale) {
        const where = findSystem(systemOf(sale.stationId));
        return { text: `${ship.name} jumps to ${where.name} and sells there. Each faction pays more for some goods: the Galaxy panel lists them.` };
      }
    }
    const hauler = state.ships.find((ship) => isHauler(ship) && ship.at && !ship.order) ?? state.ships.find((ship) => isHauler(ship) && ship.at);
    if (!hauler) return null;
    const buyer = farBuyer(state, hauler);
    if (!buyer) return null;
    const system = findSystem(systemOf(buyer.id));
    const selected = (ui.selection?.kind === 'ship' && ui.selection.id === hauler.id) || (ui.selection?.kind === 'ships' && ui.selection.ids.includes(hauler.id));
    if (!selected) {
      if (inGalaxy(ui)) return pickOnGalaxy(state, ui, hauler, '');
      return { text: `Select ${hauler.name}: click it on the map.`, map: ui.systemId === systemOf(hauler.at) ? { kind: 'ship', id: hauler.id } : null, selector: ui.systemId === systemOf(hauler.at) ? null : '[data-view="galaxy"]' };
    }
    // First something to sell: bought where the hauler is.
    const cargo = projectShip(state, hauler).cargo;
    const carries = Object.keys(cargo).some((good) => cargo[good] >= 1 && findEntry(buyer.id, good)?.side === 'buys');
    if (!carries) {
      const station = findStation(hauler.at);
      const home = findSystem(systemOf(station.id));
      if (menuOn(ui, station.id)) return { text: `Pick a Buy order. Its note says where the goods sell best.`, selector: '[data-key^="menu-buy-"]' };
      if (inGalaxy(ui)) {
        if (ui.menu?.target.kind === 'system' && ui.menu.target.id === home.id) return { text: `Pick ${station.name}.`, selector: key(`menu-place-${station.id}`) };
        return { text: `First something to sell. Right-click ${home.name} and pick ${station.name}, where ${hauler.name} is.`, map: { kind: 'system', id: home.id } };
      }
      if (ui.systemId !== home.id) return OPEN_GALAXY;
      return { text: `First something to sell. Right-click ${station.name}, where ${hauler.name} is, and pick a Buy order.`, map: { kind: 'station', id: station.id } };
    }
    if (menuOn(ui, buyer.id)) return { text: `Pick Sell. ${hauler.name} jumps to ${system.name} and sells there. The menu shows the jumps and fees on the way.`, selector: '[data-key^="menu-sell-"]' };
    if (ui.view === 'system' && ui.systemId === system.id) return { text: `Right-click ${buyer.name} and pick Sell.`, map: { kind: 'station', id: buyer.id } };
    if (!inGalaxy(ui)) return OPEN_GALAXY;
    if (ui.menu?.target.kind === 'system' && ui.menu.target.id === system.id) return { text: `Pick ${buyer.name}.`, selector: key(`menu-place-${buyer.id}`) };
    return { text: `${system.name} is surveyed. Right-click it and pick ${buyer.name} to sell there.`, map: { kind: 'system', id: system.id } };
  },
});

/** The current guide step: { goal, step, of, text, tip, map, selector }, or null. */
export function currentGuide(state, ui) {
  const goal = tutorialGoal(state);
  if (!goal) return null;
  const tutorial = GOALS.filter((g) => g.tutorial && (g.act ?? 1) === (goal.act ?? 1));
  const guide = GUIDES[goal.id]?.(state, ui);
  if (!guide) return null;
  return { goal, step: tutorial.indexOf(goal) + 1, of: tutorial.length, ...guide };
}

/** The guide card. `onSkip` hides the tutorial for good. */
export function guideCard(guide, { onSkip }) {
  if (!guide) return null;
  return [
    h(
      'div',
      { class: 'dw-guide-head' },
      h('span', { class: 'dw-eyebrow' }, `${(guide.goal.act ?? 1) > 1 ? 'Guide' : 'Tutorial'} · ${guide.step} of ${guide.of}`),
      h('button', { type: 'button', class: 'dw-link', onClick: onSkip, dataset: { key: 'guide-skip' } }, (guide.goal.act ?? 1) > 1 ? 'Skip guide' : 'Skip tutorial'),
    ),
    h('div', { class: 'dw-card-head' }, h('strong', null, guide.goal.title), h('span', { class: 'dw-goal-reward' }, `+${formatCredits(guide.goal.reward)}`)),
    h('p', { class: 'dw-guide-text' }, guide.text),
    guide.tip ? h('p', { class: 'dw-guide-tip' }, h('strong', null, 'Tip: '), guide.tip) : null,
  ];
}

/** Puts the glow on the element the guide points at. */
export function markGuided(root, guide) {
  for (const el of root.querySelectorAll('.is-guided')) el.classList.remove('is-guided');
  if (!guide?.selector) return;
  root.querySelector(`${guide.selector}:not(:disabled)`)?.classList.add('is-guided');
}
