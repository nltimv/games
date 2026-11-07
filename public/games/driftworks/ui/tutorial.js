// The tutorial: a guide card for each of the first goals, saying what to do
// next and pointing at it, on the map (a gold ring) or in the interface (a
// glow on the button). This is the one place in the game that explains how
// to play; it can be skipped.

import { GOALS } from '../content/goals.js';
import { goodName } from '../content/goods.js';
import { ORDER_SLOTS } from '../content/ships.js';
import { cargoTotal } from '../systems/cargo.js';
import { tutorialGoal } from '../systems/goals.js';
import { canCopy, projectShip } from '../systems/orders.js';
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
    if (!isResearched(state, 'brokerage')) return research(state, ui, 'brokerage', 'Brokerage', 'Contracts pay more for the ore you already mine.');
    if (ui.view !== 'company') return { text: 'Brokerage is done. Open Company to see the contract board.', selector: '[data-view="company"]' };
    return { text: 'Accept a contract. Sales of that good at that station pay 50% more until it is filled.', selector: '[data-key^="accept-"]' };
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

/** The current guide step: { goal, step, of, text, tip, map, selector }, or null. */
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
    guide.tip ? h('p', { class: 'dw-guide-tip' }, h('strong', null, 'Tip: '), guide.tip) : null,
  ];
}

/** Puts the glow on the element the guide points at. */
export function markGuided(root, guide) {
  for (const el of root.querySelectorAll('.is-guided')) el.classList.remove('is-guided');
  if (!guide?.selector) return;
  root.querySelector(`${guide.selector}:not(:disabled)`)?.classList.add('is-guided');
}
