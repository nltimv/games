// The always-visible parts: top bar numbers and the "Underway" card.

import { formatCredits, formatNumber } from '../../../shared/js/format.js';
import { currentGoal } from '../systems/goals.js';
import { lowerFirst } from '../systems/orders.js';
import { bar, countdown, h } from './dom.js';
import { plural } from './format.js';

const MAX_RUNS = 3;
const MAX_IDLE_CHIPS = 2;

export function renderTopBar(els, state, previous) {
  const credits = Math.floor(state.credits);
  els.credits.textContent = formatNumber(credits);
  els.credits.closest('.dw-pill')?.setAttribute('title', formatCredits(credits));
  if (previous != null && credits > previous) {
    const pill = els.credits.closest('.dw-pill');
    pill.classList.remove('is-bumped');
    void pill.offsetWidth;
    pill.classList.add('is-bumped');
  }

  const busy = state.ships.filter((s) => s.order);
  els.fleetSummary.textContent = `${plural(state.ships.length, 'ship')} · ${busy.length} busy`;

  const next = [...busy].sort((a, b) => a.order.endsAt - b.order.endsAt)[0];
  els.nextChip.classList.toggle('is-idle', !next);
  if (next) {
    const verb = next.order.type === 'mine' ? 'back in' : 'arrives in';
    els.nextText.replaceChildren(`${next.name} ${verb} `, countdown(next.order.endsAt, { className: '' }));
  } else {
    els.nextText.textContent = state.ships.length === 1 ? `${state.ships[0].name} is waiting` : 'All ships are waiting';
  }
  return credits;
}

export function underwayCard(ctx) {
  const { state } = ctx;
  const busy = state.ships.filter((s) => s.order).sort((a, b) => a.order.endsAt - b.order.endsAt);
  const idle = state.ships.filter((s) => !s.order);
  const goal = currentGoal(state);

  const runs = busy.slice(0, MAX_RUNS).map((ship) =>
    h(
      'button',
      { type: 'button', class: 'dw-run', onClick: () => ctx.select('ship', ship.id), dataset: { key: `run-${ship.id}` } },
      h('span', { class: 'dw-run-line' }, h('span', null, `${ship.name}: ${lowerFirst(ship.order.label)}`), countdown(ship.order.endsAt)),
      bar({ start: ship.order.startedAt, end: ship.order.endsAt }),
    ),
  );

  const idleChips = idle.slice(0, MAX_IDLE_CHIPS).map((ship) =>
    h(
      'button',
      { type: 'button', class: 'dw-chip is-gold', onClick: () => ctx.select('ship', ship.id), dataset: { key: `idle-${ship.id}` } },
      `${ship.name} needs orders`,
    ),
  );
  const moreIdle = idle.length - idleChips.length;
  const moreBusy = busy.length - runs.length;

  return [
    h(
      'div',
      { class: 'dw-underway-head' },
      h('strong', null, 'Underway'),
      h('span', { class: 'dw-underway-sub' }, `${busy.length} running · ${idle.length} waiting`),
    ),
    runs.length ? runs : h('p', { class: 'dw-note' }, 'Nothing is running. Give a ship an order before you get back to work.'),
    moreBusy > 0 ? h('span', { class: 'dw-note' }, `+${moreBusy} more in Fleet`) : null,
    idleChips.length || goal
      ? h(
          'div',
          { class: 'dw-underway-foot' },
          idleChips,
          moreIdle > 0 ? h('span', { class: 'dw-note' }, `+${moreIdle} more`) : null,
          goal
            ? h(
                'button',
                { type: 'button', class: 'dw-goal-chip', onClick: () => ctx.setView('company'), dataset: { key: 'goal-chip' } },
                h('span', { class: 'dw-dot is-goal', 'aria-hidden': 'true' }),
                h('span', null, 'Goal: ', h('strong', null, goal.title), ` · +${formatCredits(goal.reward)}`),
              )
            : null,
        )
      : null,
  ];
}
