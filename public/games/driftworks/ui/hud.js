// The always-visible parts: top bar numbers and the "Underway" card.

import { formatCredits, formatNumber } from '../../../shared/js/format.js';
import { findPlace, findSystem, systemOf } from '../content/galaxy.js';
import { currentGoal } from '../systems/goals.js';
import { orderPhase, shipStatus } from '../systems/orders.js';
import { shipGlyph } from './components.js';
import { bar, countdown, h, svgIcon } from './dom.js';
import { plural } from './format.js';

// What each ship is doing, as a small line icon (16 px, drawn in currentColor).
const ACTIVITY_ICONS = {
  mine: '<path d="M2.8 13.2l6.8-6.8"/><path d="M4.6 3.4Q12.6 2.4 12.6 11.4Q11.2 6 4.6 3.4z" fill="currentColor"/>',
  sell: '<circle cx="6.5" cy="10" r="3.8"/><path d="M12.2 9.5V3M10 5.2l2.2-2.2 2.2 2.2"/>',
  buy: '<path d="M1.8 3h2.1l1.5 6.8h6.9l1.5-4.9H4.5"/><circle cx="6.4" cy="12.8" r="1"/><circle cx="11.6" cy="12.8" r="1"/>',
  deliver: '<path d="M2.5 5.4L8 2.7l5.5 2.7v5.4L8 13.5l-5.5-2.7z"/><path d="M2.5 5.4L8 8.1l5.5-2.7M8 8.1v5.4"/>',
  fly: '<path d="M2.5 8h10M9 4.5L12.5 8 9 11.5"/>',
  jump: '<path d="M2.5 4l4 4-4 4M8.5 4l4 4-4 4"/>',
  survey: '<path d="M2.5 8a5.5 5.5 0 1 0 5.5-5.5"/><path d="M8 8l3.6-3.6"/><circle cx="8" cy="8" r="1.1"/>',
  refit: '<path d="M10.6 2.6a3 3 0 0 0-3.1 4.1l-4.6 4.6a1.3 1.3 0 0 0 1.8 1.8l4.6-4.6a3 3 0 0 0 4.1-3.1l-1.9 1.9-1.6-.3-.3-1.6z"/>',
  wait: '<path d="M6 4.5v7M10 4.5v7"/>',
};

function activityIcon(kind) {
  const paths = ACTIVITY_ICONS[kind] ?? ACTIVITY_ICONS.fly;
  return h(
    'span',
    { class: `dw-act is-${kind}`, 'aria-hidden': 'true' },
    svgIcon(`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`),
  );
}

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
    els.nextText.replaceChildren(`${next.name} done in `, countdown(next.order.endsAt, { className: '' }));
  } else {
    els.nextText.textContent = state.ships.length === 1 ? `${state.ships[0].name} is waiting` : 'All ships are waiting';
  }
  return credits;
}

// One short row per ship: waiting ships first, then the ones that finish
// soonest. The icon says what the job is, the place where it happens ("to …"
// while the ship is still on its way), and the bar and time count down the
// whole order.
export function underwayCard(ctx) {
  const { state, now } = ctx;
  const busy = state.ships.filter((s) => s.order).sort((a, b) => a.order.endsAt - b.order.endsAt);
  const idle = state.ships.filter((s) => !s.order);
  const goal = currentGoal(state);
  const rows = [...idle, ...busy].map((ship) => runRow(ctx, ship, now));

  return [
    h(
      'div',
      { class: 'dw-underway-head' },
      h('strong', null, 'Underway'),
      h('span', { class: 'dw-underway-sub' }, `${busy.length} running · ${idle.length} waiting`),
    ),
    h('div', { class: 'dw-runs' }, rows),
    goal
      ? h(
          'div',
          { class: 'dw-underway-foot' },
          h(
            'button',
            { type: 'button', class: 'dw-goal-chip', onClick: () => ctx.setView('company'), dataset: { key: 'goal-chip' } },
            h('span', { class: 'dw-dot is-goal', 'aria-hidden': 'true' }),
            h('span', null, 'Goal: ', h('strong', null, goal.title), goal.reward ? ` · +${formatCredits(goal.reward)}` : ''),
          ),
        )
      : null,
  ];
}

function runRow(ctx, ship, now) {
  const status = shipStatus(ship, now);
  const props = { type: 'button', onClick: () => ctx.select('ship', ship.id), dataset: { key: `run-${ship.id}` }, title: status, 'aria-label': `${ship.name}: ${status}` };
  if (!ship.order) {
    return h(
      'button',
      { ...props, class: 'dw-run is-idle' },
      shipGlyph(ship.hull, { small: true }),
      h('span', { class: 'dw-run-name' }, ship.name),
      activityIcon('wait'),
      h('span', { class: 'dw-run-where' }, findPlace(ship.at)?.name ?? 'In space'),
      h('span', { class: 'dw-run-time' }, 'Waiting'),
    );
  }
  const { order } = ship;
  const phase = orderPhase(order, now);
  const jumpTo = phase.jumping ? findSystem(systemOf(order.legs.find((l) => now < l.end)?.to ?? order.target)) : null;
  const target = order.type === 'survey' ? findSystem(order.steps.at(-1)?.system)?.name : findPlace(order.target)?.name;
  const where = jumpTo ? jumpTo.name : `${phase.flying && order.type !== 'fly' ? 'to ' : ''}${target ?? '?'}`;
  return h(
    'button',
    { ...props, class: 'dw-run' },
    shipGlyph(ship.hull, { small: true }),
    h('span', { class: 'dw-run-name' }, ship.name),
    activityIcon(jumpTo ? 'jump' : order.type),
    h('span', { class: 'dw-run-where' }, where, ship.queue.length ? h('span', { class: 'dw-run-more' }, ` +${ship.queue.length}`) : null),
    countdown(order.endsAt, { className: 'dw-run-time' }),
    bar({ start: order.startedAt, end: order.endsAt }),
  );
}
