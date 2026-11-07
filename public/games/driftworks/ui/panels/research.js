// The research lab: what it is working on, what it could start next, and
// what is done.

import { HULLS, MODULES, ORDER_SLOTS } from '../../content/ships.js';
import { RESEARCH, findResearch, prerequisites } from '../../content/research.js';
import { formatCredits, formatDuration } from '../../../../shared/js/format.js';
import { LAB_SLOTS, freeLab, labCount, researchStatus, startResearch } from '../../systems/research.js';
import { bar, countdown, h } from '../dom.js';
import { button, chip, panelHead, sectionTitle } from '../components.js';
import { at } from '../format.js';

/** What a research does, in one line. */
export function researchEffect(research) {
  if (research.effect) return research.effect;
  const level = research.level;
  switch (research.line) {
    case 'hold': {
      const mule = MODULES.hold.levels[level];
      return `Cargo racks of ${mule} t on a Mule, ${mule * HULLS.kite.holdScale} t on a Kite. Fitted at the shipyard.`;
    }
    case 'laser':
      return `Mining lasers of ${MODULES.laser.levels[level]} t/min. Fitted at the shipyard.`;
    case 'engine': {
      const gain = Math.round((MODULES.engine.levels[level] / MODULES.engine.levels[level - 1] - 1) * 100);
      return `Engines ${gain}% faster. Fitted at the shipyard.`;
    }
    case 'queue':
      return `Every ship holds ${ORDER_SLOTS[level]} orders.`;
    default:
      return '';
  }
}

export function researchPanel(ctx) {
  const { state } = ctx;
  const labs = LAB_SLOTS.slice(0, labCount(state));
  const busy = !freeLab(state);
  const byStatus = (status) => RESEARCH.filter((r) => researchStatus(state, r) === status);
  const open = byStatus('open').sort((a, b) => a.cost - b.cost);
  const locked = byStatus('locked');
  const done = byStatus('done');

  const lab = labs.map((slot, i) => {
    const project = state.research[slot];
    const eyebrow = labs.length > 1 ? `Lab ${i + 1}` : 'In the lab';
    if (!project) return h('div', { class: 'dw-card is-gold', dataset: { key: `lab-${slot}` } }, h('span', { class: 'dw-eyebrow' }, eyebrow), h('strong', null, 'Nothing yet'));
    const research = findResearch(project.id);
    return h(
      'div',
      { class: 'dw-card is-aqua', dataset: { key: `lab-${slot}` } },
      h('span', { class: 'dw-eyebrow' }, eyebrow),
      h('div', { class: 'dw-card-head' }, h('strong', null, research.name), countdown(project.endsAt)),
      bar({ start: project.startedAt, end: project.endsAt }),
      h('p', { class: 'dw-note' }, `${researchEffect(research)} Done at ${at(project.endsAt)}.`),
    );
  });

  const openCards = open.map((research) => {
    const short = research.cost - state.credits;
    return h(
      'div',
      { class: 'dw-card dw-research' },
      h('div', { class: 'dw-card-head' }, h('strong', null, research.name), h('span', null, formatDuration(research.minutes * 60_000))),
      h('p', { class: 'dw-note' }, researchEffect(research)),
      button(busy ? `Lab busy · ${formatCredits(research.cost)}` : short > 0 ? `Need ${formatCredits(short)} more` : `Start for ${formatCredits(research.cost)}`, {
        variant: busy ? null : 'primary',
        disabled: busy || short > 0,
        key: `research-${research.id}`,
        onClick: () => ctx.act((s, now) => startResearch(s, research.id, now)),
      }),
    );
  });

  const lockedRows = locked.slice(0, 6).map((research) =>
    h(
      'li',
      { class: 'dw-research-row' },
      h('span', { class: 'dw-grow' }, h('strong', null, research.name), h('small', null, `After ${prerequisites(research).map((id) => findResearch(id).name).join(' and ')}`)),
      h('span', { class: 'dw-research-cost' }, formatCredits(research.cost)),
    ),
  );

  return [
    panelHead({ title: 'Research', subtitle: `${labs.length > 1 ? 'Two projects' : 'One project'} at a time, running while you are away`, onClose: ctx.close }),
    lab,
    open.length ? h('div', { class: 'dw-section' }, sectionTitle('Ready to start'), openCards) : null,
    lockedRows.length ? h('div', { class: 'dw-section' }, sectionTitle('Later'), h('ul', { class: 'dw-list' }, lockedRows)) : null,
    done.length
      ? h('div', { class: 'dw-section' }, sectionTitle('Done', `${done.length} / ${RESEARCH.length}`, { numeric: true }), h('div', { class: 'dw-chips' }, done.map((r) => chip(r.name, 'aqua'))))
      : null,
  ];
}
