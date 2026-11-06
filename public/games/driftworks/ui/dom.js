// Tiny DOM helpers: h() builds elements, and "live" elements update their
// countdowns and progress bars every second without a full re-render.

import { formatDuration } from '../../../shared/js/format.js';

/**
 * h('button', { class: 'x', onClick: fn, 'aria-label': 'Close' }, 'text', child)
 * Props that are null, undefined or false are skipped; `true` sets an empty
 * attribute. Children may be strings, nodes, arrays, or null.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

/** Parses static, trusted SVG markup (icons) into an element. */
export function svgIcon(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

/** A countdown that ticks down to `until` (ms). */
export function countdown(until, { prefix = '', className = 'dw-time' } = {}) {
  return h('span', { class: className, dataset: { until: String(until), prefix } }, prefix + formatDuration(until - Date.now()));
}

/** A progress bar from `start` to `end` (ms), or a fixed fraction. */
export function bar({ start, end, fraction, variant, small } = {}) {
  const fill = h('span', { class: 'dw-bar-fill' });
  const classes = ['dw-bar', variant ? `is-${variant}` : '', small ? 'is-small' : ''].filter(Boolean).join(' ');
  const el = h('span', { class: classes, role: 'presentation' }, fill);
  if (start != null && end != null) {
    el.dataset.start = String(start);
    el.dataset.end = String(end);
    fill.style.width = `${progress(start, end, Date.now()) * 100}%`;
  } else {
    fill.style.width = `${Math.max(0, Math.min(1, fraction ?? 0)) * 100}%`;
  }
  return el;
}

function progress(start, end, now) {
  if (end <= start) return 1;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

/** Refreshes every countdown and timed bar under `root`. */
export function updateLive(root, now = Date.now()) {
  for (const el of root.querySelectorAll('[data-until]')) {
    const text = (el.dataset.prefix ?? '') + formatDuration(Number(el.dataset.until) - now);
    if (el.textContent !== text) el.textContent = text;
  }
  for (const el of root.querySelectorAll('.dw-bar[data-start]')) {
    const fill = el.firstElementChild;
    const width = `${progress(Number(el.dataset.start), Number(el.dataset.end), now) * 100}%`;
    if (fill.style.width !== width) fill.style.width = width;
  }
}

/**
 * Replaces `root`'s children, keeping keyboard focus on the element with the
 * same data-key (and the scroll position), so a refresh never steals focus.
 */
export function renderInto(root, children) {
  const active = document.activeElement;
  const key = active && root.contains(active) ? active.dataset.key : null;
  const scroll = root.scrollTop;
  root.replaceChildren(...[children].flat(Infinity).filter(Boolean));
  root.scrollTop = scroll;
  if (key) root.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
