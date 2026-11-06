// The interactive map: owns the canvas, the camera, the frame loop and
// pointer input (drag to pan, wheel or pinch to zoom, click to select).

import { HOME_SYSTEM } from '../content/homeSystem.js';
import { createCamera, easePan, fitCamera, panBy, resetView, zoomAt } from './camera.js';
import { drawSystem, hitTest, renderBackground } from './systemMap.js';

const FRAME_MS = 1000 / 30;
const DRAG_THRESHOLD = 6;

/**
 * options:
 *   getState()        the game state to draw
 *   getSelection()    { kind, id } or null
 *   getSafeArea(w, h) the free screen rect { x, y, width, height }
 *   onSelect(target)  called with { kind, id } or null on a click
 */
export function createMapView(canvas, options) {
  const ctx = canvas.getContext('2d');
  const cam = createCamera();
  const extent = HOME_SYSTEM.extent;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let sky = null;
  let targets = [];
  let hover = null;
  let raf = 0;
  let lastFrame = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    sky = renderBackground(width, height, dpr);
    draw(true);
  }

  function draw(snap = false) {
    if (!sky) return;
    fitCamera(cam, options.getSafeArea(width, height), extent, snap ? 1 : 0.2);
    easePan(cam, extent);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(sky, 0, 0, width, height);
    targets = drawSystem(ctx, cam, options.getState(), Date.now(), {
      selection: options.getSelection(),
      hover,
    });
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - lastFrame < FRAME_MS - 2) return;
    lastFrame = t;
    draw();
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // ---- Pointer input ----

  const pointers = new Map();
  let drag = null;
  let pinch = null;

  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    cam.panTarget = null;
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) drag = { start: p, last: p, moved: false };
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
        hover = hitTest(targets, p.x, p.y);
        canvas.style.cursor = hover ? 'pointer' : 'grab';
      }
      return;
    }
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0) zoomAt(cam, (a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinch.dist, extent);
      pinch.dist = dist;
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > DRAG_THRESHOLD) {
        drag.moved = true;
        canvas.style.cursor = 'grabbing';
      }
      if (drag.moved) panBy(cam, p.x - drag.last.x, p.y - drag.last.y, extent);
      drag.last = p;
    }
  });

  function endPointer(e) {
    const wasDrag = drag;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      drag = null;
      canvas.style.cursor = hover ? 'pointer' : 'grab';
    }
    if (e.type === 'pointerup' && wasDrag && !wasDrag.moved && pointers.size === 0) {
      const p = localPoint(e);
      options.onSelect(hitTest(targets, p.x, p.y));
    }
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    if (!pointers.size) hover = null;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.panTarget = null;
      const p = localPoint(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(cam, p.x, p.y, Math.exp(-delta * 0.0015), extent);
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
  });

  function zoomBy(factor) {
    zoomAt(cam, cam.cx, cam.cy, factor, extent);
  }

  canvas.style.cursor = 'grab';
  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    start,
    stop,
    redraw: () => draw(),
    zoomIn: () => zoomBy(1.3),
    zoomOut: () => zoomBy(1 / 1.3),
    fit: () => resetView(cam),
    /** Slides the view so world point (x, y) sits in the middle. */
    focusOn(x, y) {
      cam.panTarget = { x, y };
    },
  };
}
