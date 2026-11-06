// The interactive map: owns the canvas, the camera, when to draw, and
// pointer input. With a mouse: click to select (Shift adds or removes a
// ship), drag a box to select ships, right-click for the order menu, and
// right-drag (or middle-drag) to pan. On touch: tap to select, drag to pan,
// pinch to zoom, press and hold for the order menu. The wheel zooms.
//
// The map only draws when something changed: input, a camera glide, a game
// update (invalidate), or ships moving far enough to show. Ships crawl at a
// pixel or two a second, so when nothing else happens the map redraws a few
// times a second at most, instead of every frame.

import { HOME_SYSTEM } from '../content/homeSystem.js';
import { HULLS, MODULES } from '../content/ships.js';
import { shipPosition } from '../systems/travel.js';
import { createCamera, easePan, fitCamera, panBy, resetView, scaleOf, zoomAt } from './camera.js';
import { loadAssets } from './assets.js';
import { clearLabels } from './labels.js';
import { drawSystem, hitTest, renderBackground, shipsInBox } from './systemMap.js';

const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 480;
// Fastest a ship crosses the map, in map units per second (the best engines
// on the fastest hull, at the middle of an eased flight), and how fast
// docked ships circle.
const FLIGHT_SPEED = ((Math.max(...MODULES.engine.levels) * Math.max(...Object.values(HULLS).map((hull) => hull.speedScale))) / 60) * 1.5;
const DRIFT_SPEED = 0.6;
const IDLE_MIN_MS = 50;
const IDLE_MAX_MS = 1000;

/**
 * options:
 *   getState()               the game state to draw
 *   getSelection()           { kind, id } or null
 *   getMenuTarget()          { kind, id } the order menu is open for, or null
 *   getGuideTarget()         { kind, id } the tutorial points at, or null
 *   getSafeArea(w, h)        the free screen rect { x, y, width, height }
 *   onSelect(target, mods)   called with { kind, id } or null on a click;
 *                            mods.additive when Shift was held
 *   onBoxSelect(ids, mods)   the ship ids inside a dragged box (mouse)
 *   onContextMenu(target, p) right-click or long-press on { kind, id } (or
 *                            null); p is the viewport point { x, y }, with
 *                            `touch` set for a long-press
 */
export function createMapView(canvas, options) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const cam = createCamera();
  const extent = HOME_SYSTEM.extent;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let sky = null;
  let targets = [];
  let hover = null;
  let box = null;
  let running = false;
  let raf = 0;
  let idleTimer = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    sky = renderBackground(width, height, dpr);
    // Resizing clears the canvas: draw now so it never flashes empty.
    draw(true);
    invalidate();
  }

  /** Draws one frame. Returns true while the camera is still gliding. */
  function draw(snap = false) {
    if (!sky) return false;
    const fitting = fitCamera(cam, options.getSafeArea(width, height), extent, snap ? 1 : 0.2);
    const panning = easePan(cam, extent);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(sky, 0, 0, width, height);
    targets = drawSystem(ctx, cam, options.getState(), Date.now(), {
      selection: options.getSelection(),
      target: options.getMenuTarget?.() ?? null,
      guide: options.getGuideTarget?.() ?? null,
      hover,
      boxed: box ? shipsInBox(targets, box.a, box.b) : null,
      dpr,
    });
    if (box) drawBox(box);
    return fitting || panning;
  }

  function drawBox({ a, b }) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    ctx.fillStyle = 'rgba(143, 245, 228, 0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(143, 245, 228, 0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  /** Asks for a redraw on the next animation frame. */
  function invalidate() {
    if (!running || raf) return;
    clearTimeout(idleTimer);
    idleTimer = 0;
    raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    if (draw()) invalidate();
    else scheduleIdle();
  }

  // With nothing else going on, redraw when ships have moved about a pixel.
  function scheduleIdle() {
    clearTimeout(idleTimer);
    const state = options.getState();
    if (!state.ships.length) return;
    const now = Date.now();
    const flying = state.ships.some((ship, i) => ship.order && shipPosition(ship, now, i).moving);
    const pixelsPerSecond = (flying ? FLIGHT_SPEED : DRIFT_SPEED) * scaleOf(cam);
    const delay = Math.min(IDLE_MAX_MS, Math.max(IDLE_MIN_MS, 1000 / Math.max(0.001, pixelsPerSecond)));
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      invalidate();
    }, delay);
  }

  function start() {
    running = true;
    invalidate();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(idleTimer);
    idleTimer = 0;
  }

  // ---- Pointer input ----

  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let longPress = 0;
  let lastPointerType = 'mouse';

  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function cancelLongPress() {
    clearTimeout(longPress);
    longPress = 0;
  }

  // What a mouse button does when dragged: the left one draws a selection
  // box, the right and middle ones pan. A Mac Ctrl-click counts as right.
  function mouseButton(e) {
    if (e.button === 0 && e.ctrlKey) return 'right';
    return e.button === 0 ? 'left' : e.button === 2 ? 'right' : e.button === 1 ? 'middle' : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType;
    const mouse = e.pointerType === 'mouse';
    const which = mouse ? mouseButton(e) : 'touch';
    if (!which) return;
    if (mouse && pointers.size) return; // a second button while dragging
    if (which === 'middle') e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    cam.panTarget = null;
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    cancelLongPress();
    if (pointers.size === 1) {
      drag = { start: p, last: p, moved: false, handled: false, which, client: { x: e.clientX, y: e.clientY } };
      if (!mouse) {
        const client = { x: e.clientX, y: e.clientY, touch: true };
        longPress = setTimeout(() => {
          longPress = 0;
          if (!drag || drag.moved || pointers.size !== 1) return;
          const hit = hitTest(targets, drag.start.x, drag.start.y);
          if (!hit) return;
          drag.handled = true;
          options.onContextMenu?.(hit, client);
        }, LONG_PRESS_MS);
      }
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      drag = null;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = localPoint(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        const next = hitTest(targets, p.x, p.y);
        if (next?.kind !== hover?.kind || next?.id !== hover?.id) {
          hover = next;
          invalidate();
        }
        canvas.style.cursor = hover ? 'pointer' : 'default';
      }
      return;
    }
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0) zoomAt(cam, (a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinch.dist, extent);
      pinch.dist = dist;
      invalidate();
      return;
    }
    if (drag && !drag.handled) {
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > DRAG_THRESHOLD) {
        drag.moved = true;
        cancelLongPress();
        canvas.style.cursor = drag.which === 'left' ? 'crosshair' : 'grabbing';
      }
      if (drag.moved && drag.which === 'left') {
        box = { a: drag.start, b: p };
        invalidate();
      } else if (drag.moved) {
        panBy(cam, p.x - drag.last.x, p.y - drag.last.y, extent);
        invalidate();
      }
      drag.last = p;
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const wasDrag = drag;
    pointers.delete(e.pointerId);
    cancelLongPress();
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      drag = null;
      canvas.style.cursor = hover ? 'pointer' : 'default';
    }
    const finished = e.type === 'pointerup' && wasDrag && !wasDrag.handled && pointers.size === 0;
    const wasBox = box;
    box = null;
    if (wasBox) invalidate();
    if (!finished) return;
    const p = localPoint(e);
    const mods = { additive: e.shiftKey };
    if (wasDrag.which === 'left' && wasDrag.moved && wasBox) {
      options.onBoxSelect?.(shipsInBox(targets, wasBox.a, p), mods);
    } else if (wasDrag.which === 'right' && !wasDrag.moved) {
      options.onContextMenu?.(hitTest(targets, wasDrag.start.x, wasDrag.start.y), { x: e.clientX, y: e.clientY });
    } else if ((wasDrag.which === 'left' || wasDrag.which === 'touch') && !wasDrag.moved) {
      options.onSelect(hitTest(targets, p.x, p.y), mods);
    }
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    if (!pointers.size && hover) {
      hover = null;
      invalidate();
    }
  });

  // Mouse right-clicks open the menu on release (see endPointer), so a
  // right-drag can pan instead. Touch screens use the long-press above,
  // which also works where the browser sends no contextmenu (iOS). The
  // keyboard's menu key opens it for whatever is under the pointer.
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (lastPointerType !== 'mouse' || e.button === 2 || pointers.size) return;
    const p = localPoint(e);
    options.onContextMenu?.(hitTest(targets, p.x, p.y), { x: e.clientX, y: e.clientY });
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.panTarget = null;
      const p = localPoint(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(cam, p.x, p.y, Math.exp(-delta * 0.0015), extent);
      invalidate();
    },
    { passive: false },
  );

  canvas.addEventListener('keydown', (e) => {
    const step = 50;
    const keys = {
      ArrowLeft: () => panBy(cam, step, 0, extent),
      ArrowRight: () => panBy(cam, -step, 0, extent),
      ArrowUp: () => panBy(cam, 0, step, extent),
      ArrowDown: () => panBy(cam, 0, -step, extent),
      '+': () => zoomBy(1.25),
      '=': () => zoomBy(1.25),
      '-': () => zoomBy(0.8),
      0: () => resetView(cam),
      Escape: () => options.onSelect(null),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
    invalidate();
  });

  function zoomBy(factor) {
    zoomAt(cam, cam.cx, cam.cy, factor, extent);
    invalidate();
  }

  canvas.style.cursor = 'default';
  new ResizeObserver(resize).observe(canvas);
  resize();

  // Art and the web font arrive after the first frame; draw again then.
  loadAssets().then(invalidate);
  document.fonts?.ready.then(() => {
    clearLabels();
    invalidate();
  });
  document.fonts?.addEventListener?.('loadingdone', () => {
    clearLabels();
    invalidate();
  });

  return {
    start,
    stop,
    /** Redraws on the next frame (after a game or UI change). */
    redraw: invalidate,
    zoomIn: () => zoomBy(1.3),
    zoomOut: () => zoomBy(1 / 1.3),
    fit: () => {
      resetView(cam);
      invalidate();
    },
    /** Slides the view so world point (x, y) sits in the middle. */
    focusOn(x, y) {
      cam.panTarget = { x, y };
      invalidate();
    },
  };
}
