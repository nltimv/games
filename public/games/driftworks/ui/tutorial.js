// The tutorial: a guide card for each of the first goals, saying what to do
// next and pointing at it, on the map (a gold ring) or in the interface (a
// glow on the button). This is the one place in the game that explains how
// to play; it can be skipped.

import { GOALS } from '../content/goals.js';
import { tutorialGoal } from '../systems/goals.js';
import { isResearched } from '../systems/research.js';
import { formatCredits } from '../../../shared/js/format.js';
import { h } from './dom.js';
import { at } from './format.js';

const FIELD = 'carbon-drift';
const REFINERY = 'halcyon-refinery';
const SHIPYARD = 'halcyon-shipyard';

const mules = (state) => state.ships.filter((ship) => ship.hull === 'mule');
const isSelected = (ui, kind, id) => ui.view === 'system' && ui.selection?.kind === kind && ui.selection.id === id;
const menuOn = (ui, id) => ui.menu?.target.id === id;
const key = (k) => `[data-key="${k}"]`;

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

/** Steps that get a new ship going with another ship's orders. */
function copyTo(state, ui, ship, from) {
  if (!isSelected(ui, 'ship', ship.id)) return { text: `Select ${ship.name}. It waits next to the shipyard.`, map: { kind: 'ship', id: ship.id } };
  return { text: `Press Copy orders from ${from.name}: ${ship.name} flies the same route.`, selector: key(`copy-${from.id}`) };
}

const GUIDES = {
  'first-orders'(state, ui) {
    const mule = state.ships[0];
    if (!mule) return null;
    const mined = mule.plan.some((spec) => spec.type === 'mine');
    if (!mined) {
      if (menuOn(ui, FIELD)) return { text: 'Pick Mine a full hold. A Mule fills its 10 t hold in about a minute.', selector: key('menu-mine-') };
      if (!isSelected(ui, 'ship', mule.id)) return { text: `Select ${mule.name}: click it on the map, next to Halcyon Refinery.`, map: { kind: 'ship', id: mule.id } };
      return { text: 'Right-click Carbon Drift (on a touch screen, press and hold it) and pick Mine a full hold.', map: { kind: 'field', id: FIELD } };
    }
    if (menuOn(ui, REFINERY)) return { text: `Pick Sell carbon ore. ${mule.name} sells as soon as its hold is full.`, selector: key('menu-sell-') };
    if (!isSelected(ui, 'ship', mule.id)) return { text: `Select ${mule.name} again to queue its next order.`, map: { kind: 'ship', id: mule.id } };
    return { text: 'Now queue the sale: right-click Halcyon Refinery and pick Sell carbon ore. Ships work through their orders on their own.', map: { kind: 'station', id: REFINERY } };
  },
  'first-research'(state, ui) {
    return research(state, ui, 'hold-1', 'Cargo racks I', 'Bigger holds mean longer trips and fewer orders.');
  },
  'second-mule'(state, ui) {
    const fleet = mules(state);
    if (fleet.length < 2) return buyMule(state, ui, `A second Mule costs ${formatCredits(150)}.`);
    const idle = fleet.find((ship) => !ship.plan.length);
    const from = fleet.find((ship) => ship.plan.length);
    if (!idle || !from) return null;
    return copyTo(state, ui, idle, from);
  },
  'first-sale'(state) {
    const mule = state.ships[0];
    return { text: `${mule.name} sells its ore at Halcyon Refinery once its hold is full.`, map: { kind: 'ship', id: mule.id } };
  },
  'first-contract'(state, ui) {
    if (!isResearched(state, 'brokerage')) return research(state, ui, 'brokerage', 'Brokerage', 'Contracts pay more for the ore you already mine.');
    if (ui.view !== 'company') return { text: 'Brokerage is done. Open Company to see the contract board.', selector: '[data-view="company"]' };
    return { text: 'Accept a contract. Sales of that good at that station pay 50% more until it is filled.', selector: '[data-key^="accept-"]' };
  },
  'third-mule'(state, ui) {
    const fleet = mules(state);
    if (fleet.length < 3) return buyMule(state, ui, 'A third Mule pays for itself in about an hour.');
    const idle = fleet.find((ship) => !ship.plan.length && !ship.order);
    const from = fleet.find((ship) => ship.plan.length);
    return idle && from ? copyTo(state, ui, idle, from) : null;
  },
  'first-refit'(state, ui) {
    if (!isSelected(ui, 'station', SHIPYARD)) {
      return { text: 'New ships come with Cargo racks I. Older ships get them with a refit: click Halcyon Shipyard.', map: { kind: 'station', id: SHIPYARD } };
    }
    return { text: 'Refit a ship. It flies to the shipyard when its current orders are done, and its hold grows from 10 t to 25 t.', selector: '[data-key^="refit-"]' };
  },
  'fill-queue'(state, ui) {
    if (!isResearched(state, 'queue-1')) return research(state, ui, 'queue-1', 'Order queue I', 'Longer queues keep ships busy while you work.');
    const ship = mules(state).find((s) => s.plan.length);
    if (!ship) return { text: 'Give a Mule some orders, then repeat them.' };
    if (!isSelected(ui, 'ship', ship.id)) return { text: `Every ship now holds 4 orders. Select ${ship.name}.`, map: { kind: 'ship', id: ship.id } };
    return { text: 'Press Repeat to fill: the ship repeats its route until its orders are full. Run again repeats them later.', selector: key('repeat-fill') };
  },
};

/** The current guide step: { goal, step, of, text, map, selector }, or null. */
export function currentGuide(state, ui) {
  const goal = tutorialGoal(state);
  if (!goal) return null;
  const tutorial = GOALS.filter((g) => g.tutorial);
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
      h('span', { class: 'dw-eyebrow' }, `Tutorial · ${guide.step} of ${guide.of}`),
      h('button', { type: 'button', class: 'dw-link', onClick: onSkip, dataset: { key: 'guide-skip' } }, 'Skip tutorial'),
    ),
    h('div', { class: 'dw-card-head' }, h('strong', null, guide.goal.title), h('span', { class: 'dw-goal-reward' }, `+${formatCredits(guide.goal.reward)}`)),
    h('p', { class: 'dw-guide-text' }, guide.text),
  ];
}

/** Puts the glow on the element the guide points at. */
export function markGuided(root, guide) {
  for (const el of root.querySelectorAll('.is-guided')) el.classList.remove('is-guided');
  if (!guide?.selector) return;
  root.querySelector(`${guide.selector}:not(:disabled)`)?.classList.add('is-guided');
}
