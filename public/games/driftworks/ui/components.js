// Small building blocks shared by the panels.

import { GOODS } from '../content/goods.js';
import { HULLS } from '../content/ships.js';
import { h, svgIcon } from './dom.js';

export function swatch(good) {
  const look = GOODS[good]?.look ?? { shape: 'round', light: '#fff', mid: '#aaa', dark: '#555' };
  const background =
    look.shape === 'round'
      ? `radial-gradient(circle at 35% 30%, #ffffff 0, ${look.light} 22%, ${look.mid} 70%, ${look.dark} 100%)`
      : `linear-gradient(160deg, #ffffff 0, ${look.light} 30%, ${look.mid} 65%, ${look.dark} 100%)`;
  return h('span', { class: `dw-swatch${look.shape === 'round' ? '' : ' is-square'}`, style: { background }, 'aria-hidden': 'true' });
}

export function chip(text, variant, props = {}) {
  const tag = props.onClick ? 'button' : 'span';
  return h(tag, { class: `dw-chip${variant ? ` is-${variant}` : ''}`, type: tag === 'button' ? 'button' : null, ...props }, text);
}

/** A small caps heading; `numeric` keeps the right side's case ("43 t"). */
export function sectionTitle(left, right, { numeric = false } = {}) {
  return h('h3', { class: 'dw-section-title' }, h('span', null, left), right ? h('span', { class: numeric ? 'is-num' : null }, right) : null);
}

/**
 * A button. variant: 'primary' (glossy), 'danger', or default glass.
 * `key` keeps focus on it across re-renders.
 */
export function button(text, { variant, onClick, disabled, key, small, block, sub, title, label } = {}) {
  const classes = ['dw-btn', variant === 'primary' ? 'gloss' : variant === 'danger' ? 'is-danger' : 'glass-btn'];
  if (small) classes.push('is-small');
  if (block) classes.push('is-block');
  return h(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      onClick,
      disabled: Boolean(disabled),
      dataset: key ? { key } : undefined,
      title,
      'aria-label': label,
    },
    text,
    sub ? h('span', { class: 'dw-btn-sub' }, sub) : null,
  );
}

const CLOSE_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>';
const BACK_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>';

export function panelHead({ icon, title, subtitle, onClose, onBack }) {
  return h(
    'div',
    { class: 'dw-panel-head' },
    onBack
      ? h('button', { type: 'button', class: 'dw-round glass-btn', onClick: onBack, 'aria-label': 'Back', dataset: { key: 'panel-back' } }, svgIcon(BACK_ICON))
      : null,
    icon ? h('span', { class: 'dw-panel-icon', 'aria-hidden': 'true' }, icon) : null,
    h('div', { class: 'dw-panel-title' }, h('h2', { id: 'panel-title' }, title), subtitle ? h('span', null, subtitle) : null),
    onClose
      ? h('button', { type: 'button', class: 'dw-round glass-btn', onClick: onClose, 'aria-label': 'Close', dataset: { key: 'panel-close' } }, svgIcon(CLOSE_ICON))
      : null,
  );
}

let iconId = 0;

export function stationIcon(owned = false) {
  iconId += 1;
  const id = `hexfill-${iconId}`;
  const stops = owned ? ['#ffffff', '#ffe7a8', '#e0a12e'] : ['#e9fffb', '#7fe9de', '#1b9aa8'];
  return svgIcon(
    `<svg width="40" height="40" viewBox="0 0 44 44"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${stops[0]}"/><stop offset="0.5" stop-color="${stops[1]}"/><stop offset="1" stop-color="${stops[2]}"/></linearGradient></defs><polygon points="42,22 32,39.3 12,39.3 2,22 12,4.7 32,4.7" fill="url(#${id})" stroke="#fff" stroke-width="1.2"/></svg>`,
  );
}

export function fieldIcon(good) {
  const look = GOODS[good].look;
  iconId += 1;
  const id = `rock-${iconId}`;
  return svgIcon(
    `<svg width="40" height="40" viewBox="0 0 44 44"><defs><radialGradient id="${id}" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#fff"/><stop offset="0.3" stop-color="${look.light}"/><stop offset="1" stop-color="${look.dark}"/></radialGradient></defs><circle cx="20" cy="22" r="13" fill="url(#${id})"/><circle cx="35" cy="12" r="5" fill="url(#${id})"/><circle cx="36" cy="33" r="3.5" fill="url(#${id})"/></svg>`,
  );
}

export function gateIcon() {
  return svgIcon(
    '<svg width="40" height="40" viewBox="0 0 44 44" fill="none" stroke="rgba(180,215,255,0.8)" stroke-width="2"><ellipse cx="22" cy="22" rx="11" ry="16"/><rect x="16" y="21" width="12" height="9" rx="2"/><path d="M19 21v-3a3 3 0 0 1 6 0v3"/></svg>',
  );
}

export function shipGlyph(hullId) {
  const role = HULLS[hullId]?.role;
  const color = role === 'hauler' ? '#ffe6b0' : '#c9fff6';
  return h(
    'span',
    { class: `dw-ship-icon${role === 'hauler' ? ' is-hauler' : ''}`, 'aria-hidden': 'true' },
    svgIcon(`<svg width="18" height="18" viewBox="0 0 18 18"><path d="M16 9 3 15l3-6-3-6z" fill="${color}"/></svg>`),
  );
}

/** A "label ··· value" line for summaries. */
export function line(left, right, className) {
  return h('div', { class: `dw-line${className ? ` ${className}` : ''}` }, h('span', null, left), h('span', null, right));
}
