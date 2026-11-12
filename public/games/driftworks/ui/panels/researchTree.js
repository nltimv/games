// The Research view on wide screens with a mouse: the whole tree at once,
// laid out by render/researchLayout.js. Phones and tablets keep the list
// (panels/research.js).
//
// The tree is plain DOM: nodes are buttons, the lines one SVG behind them.
// Dragging pans and the wheel zooms by moving one CSS transform, so nothing
// redraws while the view moves; the game re-renders the tree only when it
// changes. Pan and zoom live in `ui.tree`, which app.js clears whenever the
// Research view opens.

import { RESEARCH, SHIELDINGS, SHIELDING_COUNT_NAMES, findResearch, prerequisites } from '../../content/research.js';
import { formatCredits, formatDuration } from '../../../../shared/js/format.js';
import { layoutResearch, SHIELDING_HUB } from '../../render/researchLayout.js';
import { LAB_SLOTS, freeLab, isResearched, labCount, requirementText, researchCost, researchMinutes, researchStatus, shieldingsDone, startResearch } from '../../systems/research.js';
import { bar, countdown, h, svgIcon } from '../dom.js';
import { button, panelHead } from '../components.js';
import { at } from '../format.js';
import { researchEffect } from './research.js';

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 1.25;
// Room kept around the tree when it is fitted or panned to an edge.
const MARGIN = 24;
// A press that moves less than this is a click, not a drag.
const DRAG_PX = 4;

const STATUS_TEXT = { done: 'Done', active: 'In the lab', open: 'Available', locked: 'Locked' };
const FIT_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>';

let layout = null;
const treeLayout = () => (layout ??= layoutResearch());

export function researchTreePanel(ctx) {
  const { state, ui } = ctx;
  const tree = treeLayout();
  ui.tree ??= { x: null, y: null, k: 1, selected: null };
  const view = ui.tree;
  const statusOf = (id) => (id === SHIELDING_HUB ? hubStatus(state) : researchStatus(state, findResearch(id)));
  // Pick the first thing to start, or the one in the lab, so the details show something useful.
  if (!view.selected) view.selected = firstPick(state);

  const lineState = (edge) => {
    const from = statusOf(edge.from);
    const to = statusOf(edge.to);
    if (from === 'done' && (to === 'done' || to === 'active')) return 'done';
    if (from === 'done' && to === 'open') return 'open';
    return 'locked';
  };
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const paths = tree.edges.map((edge) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', edgePath(tree, byId, edge));
    path.setAttribute('class', `dw-tree-line is-${lineState(edge)}`);
    return path;
  });
  // Lines into the selected research stand out.
  const selectedNeeds = new Set(view.selected ? tree.edges.filter((e) => e.to === view.selected).map((e) => e.from) : []);
  paths.forEach((path, i) => {
    const edge = tree.edges[i];
    if (edge.to === view.selected || (edge.to === SHIELDING_HUB && selectedNeeds.has(SHIELDING_HUB))) path.classList.add('is-picked');
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'dw-tree-lines');
  svg.setAttribute('width', tree.width);
  svg.setAttribute('height', tree.height);
  svg.setAttribute('aria-hidden', 'true');
  // Locked lines first, so lit ones draw on top.
  const rank = { locked: 0, open: 1, done: 2 };
  svg.append(...paths.sort((p, q) => rank[stateOf(p)] - rank[stateOf(q)] || p.classList.contains('is-picked') - q.classList.contains('is-picked')));

  const bands = tree.bands.map((band) => {
    const ids = tree.nodes.filter((n) => n.act === band.act && !n.hub).map((n) => n.id);
    const done = ids.filter((id) => isResearched(state, id)).length;
    return h(
      'div',
      { class: 'dw-tree-band', style: { left: `${band.x}px`, width: `${band.width}px`, height: `${band.height}px` } },
      h('span', { class: 'dw-tree-band-name' }, `Act ${band.act}`),
      h('span', { class: 'dw-tree-band-count' }, `${done} / ${ids.length}`),
    );
  });

  const nodes = tree.nodes.map((n) => (n.hub ? hubNode(state, n, view, ctx) : researchNode(state, n, view, ctx)));

  const placed = view.x == null ? {} : { transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` };
  const canvas = h('div', { class: 'dw-tree-canvas', style: { width: `${tree.width}px`, height: `${tree.height}px`, ...placed } }, bands, svg, nodes);
  const viewport = h(
    'div',
    {
      class: 'dw-tree-viewport',
      tabindex: '-1',
      'aria-label': 'Research tree. Drag to pan, scroll to zoom.',
    },
    canvas,
  );
  wirePanZoom(viewport, view);

  const zoom = h(
    'div',
    { class: 'dw-tree-zoom' },
    h('button', { type: 'button', class: 'dw-round glass-btn', 'aria-label': 'Zoom in', title: 'Zoom in', dataset: { key: 'tree-in' }, onClick: () => zoomBy(view, ZOOM_STEP) }, '+'),
    h('button', { type: 'button', class: 'dw-round glass-btn', 'aria-label': 'Zoom out', title: 'Zoom out', dataset: { key: 'tree-out' }, onClick: () => zoomBy(view, 1 / ZOOM_STEP) }, '−'),
    h('button', { type: 'button', class: 'dw-round glass-btn', 'aria-label': 'Show the whole tree', title: 'Show the whole tree', dataset: { key: 'tree-fit' }, onClick: () => fit(view) }, svgIcon(FIT_ICON)),
  );

  const legend = h(
    'div',
    { class: 'dw-tree-legend', 'aria-hidden': 'true' },
    ['done', 'active', 'open', 'locked'].map((status) => h('span', { class: `is-${status}` }, h('i'), STATUS_TEXT[status])),
  );

  const done = RESEARCH.filter((r) => isResearched(state, r.id)).length;
  // Fit and place the view once the panel is in the page and has a size.
  requestAnimationFrame(() => placeView(view));

  return [
    h(
      'div',
      { class: 'dw-tree-head' },
      panelHead({ title: 'Research', subtitle: `${done} of ${RESEARCH.length} done · ${labCount(state) > 1 ? 'two projects' : 'one project'} at a time`, onClose: ctx.close }),
      h('div', { class: 'dw-tree-labs' }, labCards(state)),
    ),
    h('div', { class: 'dw-tree-stage' }, h('div', { class: 'dw-tree-map' }, viewport, zoom, legend), details(ctx, view)),
  ];
}

// A research that leads to three or more in one column (the warp drive) gets
// one trunk just before that column, with a branch into each; three or more
// leading into one (the shieldings) share a trunk just after their column.
// Everything else is a soft curve.
const FAN = 3;
const TRUNK = 18;
const BEND = 8;

function edgePath(tree, byId, edge) {
  const a = byId.get(edge.from);
  const b = byId.get(edge.to);
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  const fanOut = tree.edges.filter((e) => e.from === edge.from && byId.get(e.to).x === b.x).length >= FAN;
  const fanIn = tree.edges.filter((e) => e.to === edge.to && byId.get(e.from).x === a.x).length >= FAN;
  if ((fanOut || fanIn) && Math.abs(y2 - y1) > BEND * 2) {
    const tx = fanOut ? x2 - TRUNK : x1 + TRUNK;
    const dir = y2 > y1 ? 1 : -1;
    return `M${x1} ${y1} H${tx - BEND} Q${tx} ${y1} ${tx} ${y1 + dir * BEND} V${y2 - dir * BEND} Q${tx} ${y2} ${tx + BEND} ${y2} H${x2}`;
  }
  const bend = Math.max(24, (x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
}

function stateOf(path) {
  return path.getAttribute('class').match(/is-(done|open|locked)/)[1];
}

function hubStatus(state) {
  const count = shieldingsDone(state);
  if (count >= SHIELDINGS.length) return 'done';
  return count > 0 ? 'open' : 'locked';
}

function firstPick(state) {
  const running = LAB_SLOTS.map((slot) => state.research[slot]).find(Boolean);
  if (running) return running.id;
  const open = RESEARCH.filter((r) => researchStatus(state, r) === 'open').sort((a, b) => researchCost(state, a) - researchCost(state, b));
  return open[0]?.id ?? null;
}

function labCards(state) {
  return LAB_SLOTS.slice(0, labCount(state)).map((slot, i) => {
    const project = state.research[slot];
    const name = labCount(state) > 1 ? `Lab ${i + 1}` : 'Lab';
    if (!project) return h('div', { class: 'dw-tree-lab is-idle', dataset: { key: `lab-${slot}` } }, h('span', { class: 'dw-eyebrow' }, name), h('strong', null, 'Nothing yet'));
    const research = findResearch(project.id);
    return h(
      'div',
      { class: 'dw-tree-lab', dataset: { key: `lab-${slot}` } },
      h('span', { class: 'dw-eyebrow' }, name),
      h('div', { class: 'dw-card-head' }, h('strong', null, research.name), countdown(project.endsAt)),
      bar({ start: project.startedAt, end: project.endsAt }),
    );
  });
}

function researchNode(state, n, view, ctx) {
  const research = findResearch(n.id);
  const status = researchStatus(state, research);
  const cost = researchCost(state, research);
  const time = formatDuration(researchMinutes(state, research) * 60_000);
  const project = LAB_SLOTS.map((slot) => state.research[slot]).find((p) => p?.id === n.id);
  const foot =
    status === 'done'
      ? h('small', null, 'Done')
      : status === 'active'
        ? h('small', null, 'In the lab · ', countdown(project.endsAt))
        : h('small', null, `${formatCredits(cost)} · ${time}`);
  return h(
    'button',
    {
      type: 'button',
      class: `dw-tree-node is-${status}${view.selected === n.id ? ' is-picked' : ''}`,
      style: { left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${n.h}px` },
      dataset: { key: `node-${n.id}`, node: n.id },
      'aria-pressed': String(view.selected === n.id),
      'aria-label': `${research.name}, ${STATUS_TEXT[status]}${status === 'open' || status === 'locked' ? `, ${formatCredits(cost)}, ${time}` : ''}`,
      onClick: () => pick(ctx, view, n.id),
      onFocus: () => showNode(view, n),
    },
    h('span', { class: 'dw-tree-dot', 'aria-hidden': 'true' }),
    h('strong', null, research.name),
    foot,
    status === 'active' ? bar({ start: project.startedAt, end: project.endsAt, small: true }) : null,
  );
}

function hubNode(state, n, view, ctx) {
  const count = shieldingsDone(state);
  const status = hubStatus(state);
  return h(
    'button',
    {
      type: 'button',
      class: `dw-tree-node is-hub is-${status}${view.selected === n.id ? ' is-picked' : ''}`,
      style: { left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${n.h}px` },
      dataset: { key: `node-${n.id}`, node: n.id },
      'aria-pressed': String(view.selected === n.id),
      'aria-label': `Hazard shieldings, ${count} of ${SHIELDINGS.length} done`,
      onClick: () => pick(ctx, view, n.id),
      onFocus: () => showNode(view, n),
    },
    h('span', { class: 'dw-tree-dot', 'aria-hidden': 'true' }),
    h('strong', null, 'Hazard shieldings'),
    h('small', null, `${count} of ${SHIELDINGS.length} done`),
  );
}

function pick(ctx, view, id) {
  if (view.dragged) return;
  view.selected = id;
  ctx.update({});
}

/** The card for the picked research: what it does, what it needs, and Start. */
function details(ctx, view) {
  const { state } = ctx;
  if (!view.selected) return null;
  if (view.selected === SHIELDING_HUB) {
    const counts = [...new Set(RESEARCH.filter((r) => r.shields).map((r) => r.shields))].sort();
    const users = counts.map((count) => {
      const names = RESEARCH.filter((r) => r.shields === count).map((r) => r.name);
      return `${names.join(', ')} ${names.length > 1 ? 'need' : 'needs'} ${SHIELDING_COUNT_NAMES[count]}`;
    });
    return h(
      'div',
      { class: 'dw-tree-details' },
      h('span', { class: 'dw-eyebrow' }, `${shieldingsDone(state)} of ${SHIELDINGS.length} done`),
      h('strong', { class: 'dw-tree-details-name' }, 'Hazard shieldings'),
      h('p', { class: 'dw-note' }, `Counts the hazard shieldings done: ${SHIELDINGS.map((r) => r.name).join(', ')}. Each one costs more than the last.`),
      h('p', { class: 'dw-note' }, `${users.join('; ')}.`),
    );
  }
  const research = findResearch(view.selected);
  if (!research) return null;
  const status = researchStatus(state, research);
  const cost = researchCost(state, research);
  const minutes = researchMinutes(state, research);
  const missing = prerequisites(research).filter((id) => !isResearched(state, id)).map((id) => findResearch(id).name);
  const shieldsShort = research.shields ? Math.max(0, research.shields - shieldingsDone(state)) : 0;
  const project = LAB_SLOTS.map((slot) => state.research[slot]).find((p) => p?.id === research.id);
  const busy = !freeLab(state);
  const short = cost - state.credits;

  let action = null;
  if (status === 'open') {
    action = button(busy ? `Lab busy · ${formatCredits(cost)}` : short > 0 ? `Need ${formatCredits(short)} more` : `Start for ${formatCredits(cost)}`, {
      variant: busy ? null : 'primary',
      disabled: busy || short > 0,
      block: true,
      key: `research-${research.id}`,
      onClick: () => ctx.act((s, now) => startResearch(s, research.id, now)),
    });
  }
  const needs = [];
  if (status === 'locked') {
    if (missing.length) needs.push(`Needs ${missing.join(' and ')}.`);
    if (shieldsShort) needs.push(`Needs ${shieldsShort === 1 && research.shields === 1 ? 'a hazard shielding' : `${research.shields} hazard shieldings (${shieldingsDone(state)} done)`}.`);
    if (!needs.length) needs.push(`Needs ${requirementText(research)}.`);
  }
  return h(
    'div',
    { class: `dw-tree-details is-${status}` },
    h('span', { class: 'dw-eyebrow' }, STATUS_TEXT[status]),
    h('strong', { class: 'dw-tree-details-name' }, research.name),
    h('p', { class: 'dw-note' }, researchEffect(research, state)),
    needs.length ? h('p', { class: 'dw-tree-needs' }, needs.join(' ')) : null,
    status === 'active'
      ? [h('div', { class: 'dw-card-head' }, h('span', null, `Done at ${at(project.endsAt)}`), countdown(project.endsAt)), bar({ start: project.startedAt, end: project.endsAt })]
      : status === 'done'
        ? null
        : h('dl', { class: 'dw-tree-facts' }, h('dt', null, 'Cost'), h('dd', null, formatCredits(cost)), h('dt', null, 'Time'), h('dd', null, formatDuration(minutes * 60_000))),
    action,
  );
}

// ---------- Pan and zoom ----------

function viewportOf() {
  return document.querySelector('.dw-tree-viewport');
}

function apply(view) {
  const canvas = viewportOf()?.firstElementChild;
  if (canvas) canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
}

/** Keeps part of the tree on screen whatever the pan. */
function clamp(view) {
  const vp = viewportOf();
  if (!vp) return;
  const { width: tw, height: th } = treeLayout();
  const w = vp.clientWidth;
  const hgt = vp.clientHeight;
  const sw = tw * view.k;
  const sh = th * view.k;
  // A tree smaller than the view stays centred on that axis.
  view.x = sw + MARGIN * 2 <= w ? (w - sw) / 2 : Math.min(MARGIN, Math.max(w - sw - MARGIN, view.x));
  view.y = sh + MARGIN * 2 <= hgt ? (hgt - sh) / 2 : Math.min(MARGIN, Math.max(hgt - sh - MARGIN, view.y));
}

function zoomAt(view, factor, px, py) {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
  view.x = px - ((px - view.x) * k) / view.k;
  view.y = py - ((py - view.y) * k) / view.k;
  view.k = k;
  clamp(view);
  apply(view);
}

function zoomBy(view, factor) {
  const vp = viewportOf();
  if (vp) zoomAt(view, factor, vp.clientWidth / 2, vp.clientHeight / 2);
}

function fit(view) {
  const vp = viewportOf();
  if (!vp) return;
  const { width, height } = treeLayout();
  view.k = Math.min(1, Math.max(MIN_ZOOM, Math.min((vp.clientWidth - MARGIN * 2) / width, (vp.clientHeight - MARGIN * 2) / height)));
  clamp(view);
  apply(view);
}

/**
 * The first time the view shows: as large as fits the height (up to full
 * size), scrolled so the picked research (what is next) is in view.
 */
function placeView(view) {
  const vp = viewportOf();
  if (!vp || !vp.clientWidth) return;
  if (view.x == null) {
    const { height, nodes, bands } = treeLayout();
    view.k = Math.min(1, Math.max(0.7, (vp.clientHeight - MARGIN * 2) / height));
    const focus = nodes.find((n) => n.id === view.selected);
    // The start of the picked node's act when that still shows the node;
    // else the node a third of the way in, so what follows it shows.
    const band = focus && bands.find((b) => b.act === focus.act);
    const fromBand = band ? MARGIN - band.x * view.k : MARGIN;
    const fits = focus && fromBand + (focus.x + focus.w) * view.k <= vp.clientWidth - MARGIN;
    view.x = !focus || fits ? fromBand : vp.clientWidth / 3 - (focus.x + focus.w / 2) * view.k;
    view.y = focus ? vp.clientHeight / 2 - (focus.y + focus.h / 2) * view.k : MARGIN;
  }
  clamp(view);
  apply(view);
}

/** Pans just enough to show a node that keyboard focus moved to. */
function showNode(view, n) {
  const vp = viewportOf();
  if (!vp || view.x == null) return;
  // Focus inside a scaled box may scroll the viewport itself; undo that.
  vp.scrollLeft = 0;
  vp.scrollTop = 0;
  const left = view.x + n.x * view.k;
  const top = view.y + n.y * view.k;
  const right = left + n.w * view.k;
  const bottom = top + n.h * view.k;
  if (left < MARGIN) view.x += MARGIN - left;
  else if (right > vp.clientWidth - MARGIN) view.x -= right - (vp.clientWidth - MARGIN);
  if (top < MARGIN) view.y += MARGIN - top;
  else if (bottom > vp.clientHeight - MARGIN) view.y -= bottom - (vp.clientHeight - MARGIN);
  clamp(view);
  apply(view);
}

function wirePanZoom(viewport, view) {
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      // Trackpad pinches arrive as ctrl+wheel with small deltas; mice as big steps.
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(view, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false },
  );
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    view.dragged = false;
    // Listeners on the window keep a drag going if the game re-renders the tree under it.
    const move = (ev) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!view.dragged && Math.hypot(dx, dy) < DRAG_PX) return;
      if (!view.dragged) viewportOf()?.classList.add('is-panning');
      view.dragged = true;
      view.x = start.vx + dx;
      view.y = start.vy + dy;
      clamp(view);
      apply(view);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      viewportOf()?.classList.remove('is-panning');
      // The click that ends a drag picks nothing; clear the flag after it.
      setTimeout(() => (view.dragged = false), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
