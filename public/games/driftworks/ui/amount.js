// The mining amount slider, shared by the order menu and the field panel.
// Dragging updates its numbers in place; the app holds re-renders while a
// slider is being dragged (see app.js), so the drag is never cut short.

import { formatCredits } from '../../../shared/js/format.js';
import { findShip } from '../systems/fleet.js';
import { minePreview } from '../systems/advisor.js';
import { isBusy } from '../systems/orders.js';
import { h } from './dom.js';
import { timing, tonnes } from './format.js';

function readout(preview, queued) {
  if (!preview.ok) return preview.error;
  return `about ${formatCredits(preview.value)} · ${timing({ ...preview, queued }, 'mining')}`;
}

/**
 * ctx: the app context. `amount` starts the slider; `onChange(amount)` keeps
 * it in UI state; `onConfirm(amount)` gives the order. Returns the elements.
 */
export function amountSlider(ctx, { shipId, fieldId, amount, onChange, onConfirm, key }) {
  const ship = findShip(ctx.state, shipId);
  const full = minePreview(ctx.state, ship, fieldId, null, ctx.now);
  const max = Math.max(1, full.max);
  let value = Math.max(1, Math.min(max, Math.round(amount ?? max)));
  const id = `${key}-range`;

  const label = h('label', { class: 'dw-amount-label', for: id }, h('span', null, 'Amount'), h('strong', null, tonnes(value)));
  const note = h('p', { class: 'dw-note dw-amount-note' }, readout(minePreview(ctx.state, ship, fieldId, value, ctx.now), isBusy(ctx.state, findShip(ctx.state, shipId))));
  const go = h(
    'button',
    { type: 'button', class: 'dw-btn gloss is-block', dataset: { key: `${key}-go`, menuItem: '' }, disabled: !full.ok, onClick: () => onConfirm(value) },
    `Mine ${tonnes(value)}`,
  );
  const range = h('input', {
    id,
    type: 'range',
    class: 'dw-range',
    min: '1',
    max: String(max),
    step: '1',
    value: String(value),
    disabled: !full.ok,
    'aria-valuetext': tonnes(value),
    dataset: { key: id, menuItem: '' },
    onInput: (e) => {
      value = Number(e.target.value);
      const preview = minePreview(ctx.state, findShip(ctx.state, shipId), fieldId, value, Date.now());
      label.lastChild.textContent = tonnes(value);
      note.textContent = readout(preview, isBusy(ctx.state, findShip(ctx.state, shipId)));
      go.textContent = `Mine ${tonnes(value)}`;
      e.target.setAttribute('aria-valuetext', tonnes(value));
      onChange?.(value);
    },
  });
  const scale = h('div', { class: 'dw-amount-scale', 'aria-hidden': 'true' }, h('span', null, '1 t'), h('span', null, `${tonnes(max)} free`));
  return [h('div', { class: 'dw-amount' }, label, range, scale), note, go];
}
