// Wires the session, the map and the panels together. UI-only state (which
// view is open, what is selected, a trade being planned) lives here; game
// state lives in the session and only changes through session.act().

import { createMapView } from '../render/mapView.js';
import { HOME_SYSTEM, findPlace } from '../content/homeSystem.js';
import { findShip } from '../systems/fleet.js';
import { shipPosition } from '../systems/travel.js';
import { renderInto, updateLive, h } from './dom.js';
import { renderTopBar, underwayCard } from './hud.js';
import { showAway, showSettings } from './modals.js';
import { stationPanel } from './panels/station.js';
import { fieldPanel } from './panels/field.js';
import { shipPanel } from './panels/ship.js';
import { companyPanel, fleetPanel, gatePanel, overviewPanel } from './panels/lists.js';

const TOAST_KINDS = new Set(['sale', 'goal', 'arrival', 'warning', 'purchase']);
const TOAST_MS = 4200;
const LOCKED_VIEWS = {
  galaxy: 'The galaxy map arrives with warp drives in the next update.',
  research: 'Research arrives in the next update.',
};

export function createApp(session, doc = document) {
  const $ = (id) => doc.getElementById(id);
  const els = {
    app: $('app'),
    map: $('map'),
    top: doc.querySelector('.dw-top'),
    panel: $('panel'),
    underway: $('underway'),
    nav: $('nav'),
    dock: doc.querySelector('.dw-dock'),
    credits: $('credits'),
    fleetSummary: $('fleet-summary'),
    nextChip: $('next-chip'),
    nextText: $('next-text'),
    toasts: $('toasts'),
    modal: $('modal'),
    systemName: $('system-name'),
  };

  const phoneQuery = matchMedia('(max-width: 760px)');
  const ui = { view: 'system', selection: null, miner: null, trade: null, overview: false };
  let shownCredits = null;
  let panelKey = null;

  const isPhone = () => phoneQuery.matches;

  function panelVisible() {
    if (ui.view !== 'system') return true;
    if (ui.selection) return true;
    return !isPhone() || ui.overview;
  }

  // ---------- Navigation ----------

  function select(kind, id, extra = {}) {
    Object.assign(ui, { view: 'system', selection: { kind, id }, overview: false, ...extra });
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
    render();
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
    const sel = ui.selection;
    if (!sel) return overviewPanel(ctx);
    if (sel.kind === 'station') return stationPanel(ctx, sel.id);
    if (sel.kind === 'field') return fieldPanel(ctx, sel.id);
    if (sel.kind === 'ship') return findShip(session.state, sel.id) ? shipPanel(ctx, sel.id) : overviewPanel(ctx);
    if (sel.kind === 'gate') return gatePanel(ctx, sel.id);
    return overviewPanel(ctx);
  }

  function render() {
    const ctx = context();
    shownCredits = renderTopBar(els, session.state, shownCredits);

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

    for (const btn of els.nav.querySelectorAll('button[data-view]')) {
      if (btn.dataset.view === ui.view) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
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
      Object.assign(ui, { view: 'system', selection: null, trade: null, miner: null, overview: false });
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
    onSelect: (target) => (target ? select(target.kind, target.id) : ui.selection ? close() : null),
    getSafeArea(width, height) {
      const gap = 12;
      const top = els.top.getBoundingClientRect().bottom + gap;
      if (isPhone()) {
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
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || els.modal.open) return;
    if (e.target.closest?.('textarea, input')) return;
    if (ui.selection || ui.view !== 'system' || ui.overview) close();
  });
  phoneQuery.addEventListener('change', render);
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
    },
  };
}
