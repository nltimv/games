// Wires the session, the map and the panels together. UI-only state (which
// view is open, what is selected, a trade being planned, the order menu)
// lives here; game state lives in the session and only changes through
// session.act().

import { createMapView } from '../render/mapView.js';
import { HOME_SYSTEM, findPlace } from '../content/homeSystem.js';
import { findShip } from '../systems/fleet.js';
import { shipPosition } from '../systems/travel.js';
import { renderInto, updateLive, h } from './dom.js';
import { renderTopBar, underwayCard } from './hud.js';
import { showAway, showSettings } from './modals.js';
import { menuKeydown, orderMenu, placeMenu } from './contextMenu.js';
import { stationPanel } from './panels/station.js';
import { fieldPanel } from './panels/field.js';
import { shipPanel } from './panels/ship.js';
import { companyPanel, fleetPanel, gatePanel, overviewPanel } from './panels/lists.js';
import { researchPanel } from './panels/research.js';
import { currentGuide, guideCard, markGuided } from './tutorial.js';

const TOAST_KINDS = new Set(['sale', 'goal', 'arrival', 'warning', 'purchase']);
const TOAST_MS = 4200;
const LOCKED_VIEWS = {
  galaxy: 'The galaxy map arrives with the warp drive in the next update.',
};

export function createApp(session, doc = document) {
  const $ = (id) => doc.getElementById(id);
  const els = {
    app: $('app'),
    map: $('map'),
    top: doc.querySelector('.dw-top'),
    panel: $('panel'),
    underway: $('underway'),
    guide: $('guide'),
    nav: $('nav'),
    dock: doc.querySelector('.dw-dock'),
    credits: $('credits'),
    fleetSummary: $('fleet-summary'),
    nextChip: $('next-chip'),
    nextText: $('next-text'),
    toasts: $('toasts'),
    modal: $('modal'),
    menu: $('menu'),
    systemName: $('system-name'),
  };

  const phoneQuery = matchMedia('(max-width: 760px)');
  const ui = { view: 'system', selection: null, miner: null, trade: null, overview: false, menu: null, guide: null };
  let shownCredits = null;
  let panelKey = null;
  // While a slider is being dragged, panels and the menu wait to re-render,
  // so the drag is not cut short.
  let dragging = false;
  let renderHeld = false;
  let guideKey = null;

  const isPhone = () => phoneQuery.matches;

  function panelVisible() {
    if (ui.view !== 'system') return true;
    if (ui.selection) return true;
    return !isPhone() || ui.overview;
  }

  // ---------- Navigation ----------

  function select(kind, id, extra = {}) {
    // Picking a field right after a ship sends that ship (when it can mine).
    const miner = kind === 'field' && ui.selection?.kind === 'ship' ? { miner: ui.selection.id } : {};
    Object.assign(ui, { view: 'system', selection: { kind, id }, overview: false, menu: null, ...miner, ...extra });
    if (kind !== 'station' || ui.trade?.stationId !== id) ui.trade = null;
    render();
    focusPanelIfNeeded();
    // On phones the sheet covers the lower half: slide the pick into view.
    if (isPhone()) {
      const ship = kind === 'ship' ? findShip(session.state, id) : null;
      const point = ship ? shipPosition(ship, Date.now(), session.state.ships.indexOf(ship)) : findPlace(id);
      if (point) map.focusOn(point.x, point.y);
    }
  }

  function close() {
    ui.selection = null;
    ui.trade = null;
    ui.overview = false;
    ui.menu = null;
    if (ui.view !== 'system') ui.view = 'system';
    render();
    if (isPhone()) map.focusOn(0, 0);
  }

  function setView(view) {
    if (LOCKED_VIEWS[view]) {
      toast(LOCKED_VIEWS[view]);
      return;
    }
    if (view === 'system' && ui.view === 'system' && isPhone()) {
      ui.overview = !ui.overview || Boolean(ui.selection);
      ui.selection = null;
    } else if (view === 'system' && ui.view === 'system') {
      ui.selection = null;
    }
    ui.view = view;
    ui.trade = null;
    ui.menu = null;
    render();
  }

  // ---------- Order menu ----------

  // The menu gives orders to the selected ship: pick a ship first, then
  // right-click (or press and hold) the place to send it.
  function openMenu(target, point) {
    if (ui.menu) closeMenu({ refocus: false });
    if (!target) return;
    if (target.kind === 'ship') {
      select('ship', target.id);
      return;
    }
    const ship = ui.view === 'system' && ui.selection?.kind === 'ship' ? findShip(session.state, ui.selection.id) : null;
    if (!ship) return;
    ui.menu = { target, x: point.x, y: point.y, touch: Boolean(point.touch), shipId: ship.id };
    render();
    // Mouse users can arrow through it; on touch, focus only gets in the way.
    if (!ui.menu.touch) els.menu.focus({ preventScroll: true });
  }

  function closeMenu({ refocus = true } = {}) {
    if (!ui.menu) return;
    const hadFocus = els.menu.contains(doc.activeElement);
    ui.menu = null;
    render();
    if (hadFocus && refocus) els.map.focus({ preventScroll: true });
  }

  function renderMenu(ctx) {
    if (!ui.menu) {
      if (!els.menu.hidden) {
        els.menu.hidden = true;
        els.menu.replaceChildren();
      }
      return;
    }
    renderInto(els.menu, orderMenu(ctx, ui.menu));
    els.menu.hidden = false;
    placeMenu(els.menu, ui.menu);
  }

  let focusAfterRender = false;
  function focusPanelIfNeeded() {
    if (focusAfterRender) return;
    focusAfterRender = true;
    queueMicrotask(() => {
      focusAfterRender = false;
      const active = doc.activeElement;
      if (!active || active === doc.body || !active.isConnected) {
        const title = els.panel.querySelector('#panel-title');
        if (title && !els.panel.hidden) {
          title.setAttribute('tabindex', '-1');
          title.focus({ preventScroll: true });
        }
      }
    });
  }

  // ---------- Rendering ----------

  function context() {
    return {
      state: session.state,
      now: Date.now(),
      ui,
      select,
      close,
      setView,
      isPhone,
      openSettings,
      toast,
      closeMenu,
      update(patch) {
        Object.assign(ui, patch);
        render();
      },
      act(fn) {
        const hadFocusInPanel = els.panel.contains(doc.activeElement);
        const result = session.act(fn);
        if (hadFocusInPanel) focusPanelIfNeeded();
        return result;
      },
    };
  }

  function panelContent(ctx) {
    if (ui.view === 'fleet') return fleetPanel(ctx);
    if (ui.view === 'company') return companyPanel(ctx);
    if (ui.view === 'research') return researchPanel(ctx);
    const sel = ui.selection;
    if (!sel) return overviewPanel(ctx);
    if (sel.kind === 'station') return stationPanel(ctx, sel.id);
    if (sel.kind === 'field') return fieldPanel(ctx, sel.id);
    if (sel.kind === 'ship') return findShip(session.state, sel.id) ? shipPanel(ctx, sel.id) : overviewPanel(ctx);
    if (sel.kind === 'gate') return gatePanel(ctx, sel.id);
    return overviewPanel(ctx);
  }

  function render() {
    if (dragging) {
      renderHeld = true;
      return;
    }
    const ctx = context();
    shownCredits = renderTopBar(els, session.state, shownCredits);
    ui.guide = currentGuide(session.state, ui);

    const visible = panelVisible();
    els.panel.hidden = !visible;
    els.app.classList.toggle('is-panel-closed', !visible);
    if (visible) {
      renderInto(els.panel, panelContent(ctx));
      // A different thing in the panel starts at the top.
      const key = `${ui.view}:${ui.selection?.kind}:${ui.selection?.id}`;
      if (key !== panelKey) els.panel.scrollTop = 0;
      panelKey = key;
    }
    renderInto(els.underway, underwayCard(ctx));
    renderMenu(ctx);
    renderGuide();
    map.redraw();

    for (const btn of els.nav.querySelectorAll('button[data-view]')) {
      if (btn.dataset.view === ui.view) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  }

  // ---------- Tutorial ----------

  function renderGuide() {
    const card = guideCard(ui.guide, {
      onSkip: () => {
        session.act((state) => {
          state.tutorial.skipped = true;
        });
        toast('Tutorial skipped. Goals stay in the Company view.');
      },
    });
    els.guide.hidden = !card;
    els.app.classList.toggle('has-guide', Boolean(card));
    // Only new text is re-rendered, so screen readers hear each step once.
    const key = ui.guide ? `${ui.guide.goal.id}|${ui.guide.text}|${ui.guide.tip ?? ''}` : null;
    if (card && key !== guideKey) renderInto(els.guide, card);
    guideKey = key;
    if (card) els.app.style.setProperty('--dw-guide-h', `${els.guide.offsetHeight}px`);
    markGuided(doc.body, ui.guide);
  }

  // ---------- Toasts ----------

  function toast(text, kind = 'info') {
    const el = h('div', { class: 'dw-toast glass' }, h('span', { class: `dw-dot is-${kind}`, 'aria-hidden': 'true' }), h('span', null, text));
    els.toasts.append(el);
    while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 320);
    }, TOAST_MS);
  }

  session.subscribe((change) => {
    if (change.result && change.result.ok === false && change.result.error) toast(change.result.error, 'warning');
    for (const entry of change.log.filter((e) => TOAST_KINDS.has(e.kind)).slice(-3)) toast(entry.text, entry.kind);
    if (change.source === 'load') {
      Object.assign(ui, { view: 'system', selection: null, trade: null, miner: null, overview: false, menu: null });
      shownCredits = null;
    }
    render();
  });

  // ---------- Dialogs ----------

  function openSettings() {
    showSettings(els.modal, session, { onToast: toast });
  }

  function showAwayIfNeeded(since, now) {
    if (els.modal.open) return false;
    if (now - since < 3 * 60 * 1000) return false;
    return showAway(els.modal, session.state, since, now);
  }

  // ---------- Map ----------

  const map = createMapView(els.map, {
    getState: () => session.state,
    getSelection: () => (ui.view === 'system' ? ui.selection : null),
    getMenuTarget: () => (ui.menu ? { ...ui.menu.target, shipId: ui.menu.shipId } : null),
    getGuideTarget: () => (ui.view === 'system' || !isPhone() ? (ui.guide?.map ?? null) : null),
    onSelect(target) {
      if (target) select(target.kind, target.id);
      else if (ui.menu) closeMenu();
      else if (ui.selection) close();
    },
    onContextMenu: openMenu,
    getSafeArea(width, height) {
      const gap = 12;
      let top = els.top.getBoundingClientRect().bottom + gap;
      if (isPhone()) {
        // On phones the tutorial card spans the width: keep the map below it.
        if (!els.guide.hidden) top = els.guide.getBoundingClientRect().bottom + gap;
        // Scale by width so the map keeps its size when the sheet opens;
        // the free area above the sheet (or the dock) sets the center.
        const cover = els.panel.hidden ? els.dock : els.panel;
        const bottom = Math.min(height, cover.getBoundingClientRect().top) - gap;
        return { x: gap, y: top, width: width - gap * 2, height: Math.max(80, bottom - top), fitSize: width - gap * 2 };
      }
      let right = width - gap;
      const bottom = els.nav.getBoundingClientRect().top - gap;
      if (!els.panel.hidden) right = els.panel.getBoundingClientRect().left - gap;
      const left = 64;
      return { x: left, y: top, width: Math.max(80, right - left), height: Math.max(80, bottom - top) };
    },
  });

  // ---------- Wiring ----------

  els.nav.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) setView(btn.dataset.view);
  });
  doc.getElementById('settings-btn').addEventListener('click', openSettings);
  doc.querySelector('.dw-zoom').addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.zoom;
    if (action === 'in') map.zoomIn();
    if (action === 'out') map.zoomOut();
    if (action === 'fit') map.fit();
  });
  // Any press outside the menu closes it. A press on the map only closes it,
  // like a desktop menu, so it does not also select or drag.
  doc.addEventListener(
    'pointerdown',
    (e) => {
      if (!ui.menu || els.menu.contains(e.target)) return;
      closeMenu({ refocus: false });
      if (e.target === els.map) e.stopPropagation();
    },
    true,
  );
  els.map.addEventListener('wheel', () => closeMenu({ refocus: false }), { passive: true });
  window.addEventListener('resize', () => closeMenu({ refocus: false }));
  els.menu.addEventListener('keydown', (e) => {
    if (menuKeydown(e, els.menu)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    }
  });
  // Tabbing out of the menu closes it. (Presses on the map are handled
  // above; touch can move focus to the map without meaning to leave.)
  els.menu.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to && to !== els.map && !els.menu.contains(to)) closeMenu({ refocus: false });
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || els.modal.open) return;
    if (ui.menu) {
      closeMenu();
      return;
    }
    if (e.target.closest?.('textarea, input')) return;
    if (ui.selection || ui.view !== 'system' || ui.overview) close();
  });
  phoneQuery.addEventListener('change', render);
  doc.addEventListener('pointerdown', (e) => {
    if (e.target.matches?.('input[type="range"]')) dragging = true;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (renderHeld) {
      renderHeld = false;
      render();
    }
  };
  doc.addEventListener('pointerup', endDrag);
  doc.addEventListener('pointercancel', endDrag);
  els.systemName.textContent = `${HOME_SYSTEM.name} system`;

  render();

  return {
    render,
    toast,
    map,
    showAwayIfNeeded,
    /** Called every second: refresh countdowns and timed bars. */
    updateLive(now) {
      updateLive(doc.body, now);
      // Map labels count down too.
      map.redraw();
    },
  };
}
