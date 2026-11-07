// Wires the session, the map and the panels together. UI-only state (which
// view is open, what is selected, a trade being planned, the order menu)
// lives here; game state lives in the session and only changes through
// session.act().

import { createMapView } from '../render/mapView.js';
import { HOME_SYSTEM } from '../content/homeSystem.js';
import { HULLS } from '../content/ships.js';
import { findFaction, findPlace, findSystem, systemOf } from '../content/galaxy.js';
import { galaxyPosition } from '../render/galaxyMap.js';
import { isSurveyed } from '../systems/explore.js';
import { skipGuide } from '../systems/goals.js';
import { isResearched } from '../systems/research.js';
import { findShip } from '../systems/fleet.js';
import { minedSoFar, orderPhase } from '../systems/orders.js';
import { canJump, shipPosition, shipSystem } from '../systems/travel.js';
import { renderInto, updateLive, h } from './dom.js';
import { renderTopBar, underwayCard } from './hud.js';
import { showAway, showSettings } from './modals.js';
import { menuKeydown, orderMenu, placeMenu } from './contextMenu.js';
import { stationPanel } from './panels/station.js';
import { fieldPanel } from './panels/field.js';
import { shipPanel } from './panels/ship.js';
import { companyPanel, fleetPanel, groupPanel } from './panels/lists.js';
import { researchPanel } from './panels/research.js';
import { galaxyPanel, gatePanel, systemPanel } from './panels/system.js';
import { currentGuide, guideCard, markGuided } from './tutorial.js';

const TOAST_KINDS = new Set(['sale', 'goal', 'arrival', 'warning', 'purchase']);
const TOAST_MS = 4200;
const MAP_VIEWS = new Set(['system', 'galaxy']);
const isMapView = (view) => MAP_VIEWS.has(view);
const PLACE_KINDS = new Set(['station', 'field', 'gate']);

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
    systemSub: $('system-sub'),
  };

  const phoneQuery = matchMedia('(max-width: 760px)');
  // `map` is the map shown behind the panels ('system' or 'galaxy'),
  // `systemId` the system the System view shows and `marketGood` the good
  // whose prices the galaxy map shows (with Market charts).
  const ui = { view: 'system', map: 'system', systemId: HOME_SYSTEM.id, selection: null, miner: null, trade: null, overview: false, menu: null, guide: null, marketGood: null };
  let shownCredits = null;
  let panelKey = null;
  // While a slider is being dragged, panels and the menu wait to re-render,
  // so the drag is not cut short.
  let dragging = false;
  let renderHeld = false;
  let guideKey = null;
  let shownPhases = '';

  const isPhone = () => phoneQuery.matches;

  function panelVisible() {
    if (!isMapView(ui.view)) return true;
    if (ui.selection) return true;
    return !isPhone() || ui.overview;
  }

  // ---------- Navigation ----------

  /** Which map shows a selection: places show their system, a ship the map it is on. */
  function showFor(kind, id) {
    if (kind === 'system') return { view: 'galaxy', map: 'galaxy' };
    if (PLACE_KINDS.has(kind)) return { view: 'system', map: 'system', systemId: systemOf(id) ?? ui.systemId };
    if (kind === 'ship') {
      const ship = findShip(session.state, id);
      const where = ship ? shipSystem(ship, Date.now()) : null;
      // On the galaxy map (or coming back to it from a list), ships stay there.
      if (ui.view === 'galaxy' || (ui.map === 'galaxy' && !isMapView(ui.view))) return { view: 'galaxy', map: 'galaxy' };
      // Between systems, or in one nobody has surveyed yet: the galaxy map.
      if (!where || !isSurveyed(session.state, where)) return canJump(session.state) ? { view: 'galaxy', map: 'galaxy' } : { view: 'system', map: 'system' };
      return { view: 'system', map: 'system', systemId: where };
    }
    return { view: isMapView(ui.view) ? ui.view : ui.map, map: ui.map };
  }

  function select(kind, id, extra = {}) {
    // A place in an unsurveyed system shows as that system on the galaxy map.
    const home = PLACE_KINDS.has(kind) ? systemOf(id) : null;
    if (home && !isSurveyed(session.state, home)) return select('system', home, extra);
    // Picking a field right after a ship sends that ship (when it can mine).
    const miner = kind === 'field' && ui.selection?.kind === 'ship' ? { miner: ui.selection.id } : {};
    Object.assign(ui, { ...showFor(kind, id), selection: { kind, id }, overview: false, menu: null, ...miner, ...extra });
    if (kind !== 'station' || ui.trade?.stationId !== id) ui.trade = null;
    render();
    focusPanelIfNeeded();
    // On phones the sheet covers the lower half: slide the pick into view.
    if (isPhone()) {
      const point = mapPoint(kind, id);
      if (point) map.focusOn(point.x, point.y);
    }
  }

  /** Where a selection sits on the map shown now. */
  function mapPoint(kind, id) {
    const state = session.state;
    if (kind === 'system') {
      const system = findSystem(id);
      return system ? { x: system.gx, y: system.gy } : null;
    }
    if (kind === 'ship') {
      const ship = findShip(state, id);
      if (!ship) return null;
      const index = state.ships.indexOf(ship);
      return ui.map === 'galaxy' ? galaxyPosition(ship, Date.now(), index) : shipPosition(ship, Date.now(), index);
    }
    return findPlace(id);
  }

  /** Opens a system's map, keeping a ship selection so orders can follow. */
  function openSystem(id) {
    if (!isSurveyed(session.state, id)) return;
    const keep = ui.selection?.kind === 'ship' || ui.selection?.kind === 'ships' ? ui.selection : null;
    Object.assign(ui, { view: 'system', map: 'system', systemId: id, selection: keep, overview: false, menu: null, trade: null });
    render();
  }

  /**
   * Selects several ships at once (a box selection). One ship is a normal
   * selection, none clears it. With `additive`, ships already selected
   * stay selected.
   */
  function selectShips(ids, { additive = false } = {}) {
    const current = !additive ? [] : ui.selection?.kind === 'ships' ? ui.selection.ids : ui.selection?.kind === 'ship' ? [ui.selection.id] : [];
    const all = [...new Set([...current, ...ids])].filter((id) => findShip(session.state, id));
    if (!all.length) return additive ? undefined : close();
    if (all.length === 1) return select('ship', all[0]);
    const view = isMapView(ui.view) ? ui.view : ui.map;
    Object.assign(ui, { view, map: view, selection: { kind: 'ships', ids: all }, overview: false, menu: null, trade: null });
    render();
    focusPanelIfNeeded();
  }

  /** Your ships of one role in a system, from a galaxy badge's id ("system|role"). */
  function shipsAtBadge(badgeId) {
    const [systemId, role] = badgeId.split('|');
    const now = Date.now();
    return session.state.ships
      .filter((ship, index) => HULLS[ship.hull].role === role && galaxyPosition(ship, now, index)?.system === systemId)
      .map((ship) => ship.id);
  }

  /** Clicking a galaxy badge selects its ships; clicking it again opens their system. */
  function pickBadge(badgeId, mods) {
    const ids = shipsAtBadge(badgeId);
    const selected = ui.selection?.kind === 'ships' ? ui.selection.ids : ui.selection?.kind === 'ship' ? [ui.selection.id] : [];
    const systemId = badgeId.split('|')[0];
    if (!mods.additive && ids.length && ids.length === selected.length && ids.every((id) => selected.includes(id)) && isSurveyed(session.state, systemId)) return openSystem(systemId);
    return selectShips(ids, mods);
  }

  /** Shift-click: adds a ship to the selection, or takes it out. */
  function toggleShip(id) {
    const ids = ui.selection?.kind === 'ships' ? ui.selection.ids : ui.selection?.kind === 'ship' ? [ui.selection.id] : [];
    if (!ids.includes(id)) return selectShips([...ids, id]);
    const rest = ids.filter((other) => other !== id);
    return rest.length ? selectShips(rest) : close();
  }

  /** The ships selected now: one, several, or none. */
  function selectedShips() {
    if (!isMapView(ui.view)) return [];
    const ids = ui.selection?.kind === 'ships' ? ui.selection.ids : ui.selection?.kind === 'ship' ? [ui.selection.id] : [];
    return ids.map((id) => findShip(session.state, id)).filter(Boolean);
  }

  function close() {
    ui.selection = null;
    ui.trade = null;
    ui.overview = false;
    ui.menu = null;
    if (!isMapView(ui.view)) ui.view = ui.map;
    render();
    if (isPhone()) map.focusOn(0, 0);
  }

  function setView(view) {
    if (view === 'galaxy' && !canJump(session.state)) {
      toast('The galaxy map opens with the warp drive research.');
      return;
    }
    if (view === ui.view && isMapView(view)) {
      if (isPhone()) ui.overview = !ui.overview || Boolean(ui.selection);
      ui.selection = null;
    } else if (isMapView(view) && ui.selection && !['ship', 'ships'].includes(ui.selection.kind)) {
      // Ships stay selected across the two maps; places belong to one.
      ui.selection = null;
    }
    ui.view = view;
    if (isMapView(view)) ui.map = view;
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
    // A galaxy ship badge stands for its system.
    if (target.kind === 'ships-at') target = { kind: 'system', id: target.id.split('|')[0] };
    if (target.kind === 'ship') {
      select('ship', target.id);
      return;
    }
    const ships = selectedShips();
    if (!ships.length) return;
    const who = ships.length === 1 ? { shipId: ships[0].id } : { shipIds: ships.map((ship) => ship.id) };
    ui.menu = { target, x: point.x, y: point.y, touch: Boolean(point.touch), ...who };
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
      selectShips,
      close,
      setView,
      isPhone,
      openSystem,
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
    const overviewPanel = () => (ui.map === 'galaxy' ? galaxyPanel(ctx) : systemPanel(ctx, ui.systemId, { overview: true }));
    if (!sel) return overviewPanel(ctx);
    if (sel.kind === 'station') return stationPanel(ctx, sel.id);
    if (sel.kind === 'field') return fieldPanel(ctx, sel.id);
    if (sel.kind === 'ship') return findShip(session.state, sel.id) ? shipPanel(ctx, sel.id) : overviewPanel(ctx);
    if (sel.kind === 'ships') return groupPanel(ctx, sel.ids);
    if (sel.kind === 'gate') return gatePanel(ctx, sel.id);
    if (sel.kind === 'system') return systemPanel(ctx, sel.id);
    return overviewPanel(ctx);
  }

  function render() {
    if (dragging) {
      renderHeld = true;
      return;
    }
    // Only surveyed systems have a map.
    if (ui.map === 'system' && !isSurveyed(session.state, ui.systemId)) Object.assign(ui, { map: 'galaxy', view: ui.view === 'system' ? 'galaxy' : ui.view });
    const ctx = context();
    shownPhases = phaseKey(ctx.now);
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
    renderPlace();
    renderMenu(ctx);
    renderGuide();
    map.redraw();

    for (const btn of els.nav.querySelectorAll('button[data-view]')) {
      if (btn.dataset.view === ui.view) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  }

  // The top bar names the map shown, and the Galaxy tab unlocks with the
  // warp drive.
  function renderPlace() {
    const state = session.state;
    if (ui.map === 'galaxy') {
      els.systemName.textContent = 'Galaxy';
      const known = 1 + (state.surveyed ?? []).length;
      els.systemSub.textContent = `${known} ${known === 1 ? 'system' : 'systems'} surveyed`;
    } else {
      const system = findSystem(ui.systemId) ?? HOME_SYSTEM;
      els.systemName.textContent = `${system.name} system`;
      const where = system.id === HOME_SYSTEM.id ? 'home' : `${system.depth} ${system.depth === 1 ? 'lane' : 'lanes'} from home`;
      els.systemSub.textContent = `${findFaction(system.faction)?.name ?? ''} · ${isSurveyed(state, system.id) ? where : 'unsurveyed'}`;
    }
    const galaxyBtn = els.nav.querySelector('button[data-view="galaxy"]');
    const open = canJump(state);
    if (galaxyBtn && galaxyBtn.dataset.open !== String(open)) {
      galaxyBtn.dataset.open = String(open);
      galaxyBtn.toggleAttribute('aria-disabled', !open);
      galaxyBtn.title = open ? 'Galaxy map' : 'Opens with the warp drive research';
      galaxyBtn.querySelector('svg')?.toggleAttribute('hidden', open);
    }
  }

  // Which part of its order (flight or job) each ship is in, so the panels
  // re-render when a ship arrives and starts its job.
  // The selected ship's hold also fills while it mines.
  function phaseKey(now) {
    const phases = session.state.ships.map((ship) => (ship.order ? orderPhase(ship.order, now).end : 0)).join(',');
    const ship = ui.selection?.kind === 'ship' ? findShip(session.state, ui.selection.id) : null;
    return `${phases}|${ship ? minedSoFar(ship.order, now) : 0}`;
  }

  // ---------- Tutorial ----------

  function renderGuide() {
    const card = guideCard(ui.guide, {
      onSkip: () => {
        const act = ui.guide?.goal.act ?? 1;
        session.act((state) => skipGuide(state, act));
        toast(`${act > 1 ? 'Guide' : 'Tutorial'} skipped. Goals stay in the Company view.`);
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
      Object.assign(ui, { view: 'system', map: 'system', systemId: HOME_SYSTEM.id, selection: null, trade: null, miner: null, overview: false, menu: null });
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
    getScene: () => (ui.map === 'galaxy' ? { kind: 'galaxy' } : { kind: 'system', id: ui.systemId }),
    getSelection: () => (isMapView(ui.view) ? ui.selection : null),
    getMenuTarget: () => (ui.menu ? { ...ui.menu.target, shipId: ui.menu.shipId, shipIds: ui.menu.shipIds } : null),
    getGuideTarget: () => (isMapView(ui.view) || !isPhone() ? (ui.guide?.map ?? null) : null),
    getMarketGood: () => (isResearched(session.state, 'market-charts') ? ui.marketGood : null),
    onSelect(target, mods = {}) {
      const again = target && ui.selection?.kind === target.kind && ui.selection.id === target.id;
      if (target?.kind === 'ship' && mods.additive) toggleShip(target.id);
      else if (target?.kind === 'ships-at') pickBadge(target.id, mods);
      // A second click on a surveyed system opens its map.
      else if (again && target.kind === 'system' && isSurveyed(session.state, target.id)) openSystem(target.id);
      else if (target) select(target.kind, target.id);
      else if (ui.menu) closeMenu();
      else if (ui.selection) close();
    },
    onBoxSelect: (ids, mods) => selectShips(ids, mods),
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
    if (ui.selection || !isMapView(ui.view) || ui.overview) close();
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

  render();

  return {
    render,
    toast,
    map,
    showAwayIfNeeded,
    /** Called every second: refresh countdowns and timed bars. */
    updateLive(now) {
      // A ship that lands starts its job, with its own label and time.
      const phases = phaseKey(now);
      if (phases !== shownPhases && !renderHeld && !dragging) render();
      updateLive(doc.body, now);
      // Map labels count down too.
      map.redraw();
    },
  };
}
