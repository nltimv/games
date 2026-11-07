// The map camera: turns world units into screen pixels.
//
// The base view fits the system into the free part of the screen (the safe
// area between the panels). The player's pan and zoom sit on top of that.
// The base eases toward its target so opening a panel slides the map
// instead of making it jump.

export const MIN_ZOOM = 0.7;
export const MAX_ZOOM = 4;

export function createCamera() {
  return {
    zoom: 1,
    panX: 0,
    panY: 0,
    base: 0,
    cx: 0,
    cy: 0,
    // Where the view is easing its pan to, when it focuses on something.
    panTarget: null,
  };
}

// Room left around the system for the labels drawn under the outer gates.
const LABEL_MARGIN = 30;

/**
 * Sets the base view so a circle of `extent` fits inside `safe`. On phones
 * `safe.fitSize` keeps the scale steady while a sheet covers part of the
 * screen; the view just moves up.
 */
export function fitCamera(cam, safe, extent, ease = 1) {
  const room = (safe.fitSize ?? Math.min(safe.width, safe.height)) - LABEL_MARGIN * 2;
  const target = {
    base: Math.max(0.05, Math.max(room, 60) / (2 * extent)),
    cx: safe.x + safe.width / 2,
    cy: safe.y + safe.height / 2,
  };
  if (!cam.base || ease >= 1) {
    Object.assign(cam, target);
    return false;
  }
  let moving = false;
  for (const key of ['base', 'cx', 'cy']) {
    const diff = target[key] - cam[key];
    const done = key === 'base' ? Math.abs(diff) < 1e-4 : Math.abs(diff) < 0.3;
    if (done) cam[key] = target[key];
    else {
      cam[key] += diff * ease;
      moving = true;
    }
  }
  return moving;
}

export function scaleOf(cam) {
  return cam.base * cam.zoom;
}

export function toScreen(cam, x, y) {
  const s = scaleOf(cam);
  return { x: cam.cx + (x - cam.panX) * s, y: cam.cy + (y - cam.panY) * s };
}

export function toWorld(cam, sx, sy) {
  const s = scaleOf(cam);
  return { x: (sx - cam.cx) / s + cam.panX, y: (sy - cam.cy) / s + cam.panY };
}

function clampPan(cam, extent) {
  const limit = extent * 0.9;
  cam.panX = Math.max(-limit, Math.min(limit, cam.panX));
  cam.panY = Math.max(-limit, Math.min(limit, cam.panY));
}

/** Zooms by `factor`, keeping the world point under (sx, sy) in place. */
export function zoomAt(cam, sx, sy, factor, extent) {
  const before = toWorld(cam, sx, sy);
  cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
  const after = toWorld(cam, sx, sy);
  cam.panX += before.x - after.x;
  cam.panY += before.y - after.y;
  clampPan(cam, extent);
}

export function panBy(cam, dx, dy, extent) {
  const s = scaleOf(cam);
  cam.panX -= dx / s;
  cam.panY -= dy / s;
  clampPan(cam, extent);
}

export function resetView(cam) {
  cam.zoom = 1;
  cam.panX = 0;
  cam.panY = 0;
  cam.panTarget = null;
}

/** Eases the pan toward cam.panTarget. Returns true while moving. */
export function easePan(cam, extent, ease = 0.2) {
  const target = cam.panTarget;
  if (!target) return false;
  const dx = target.x - cam.panX;
  const dy = target.y - cam.panY;
  if (Math.hypot(dx, dy) < 0.5) {
    cam.panTarget = null;
    return false;
  }
  cam.panX += dx * ease;
  cam.panY += dy * ease;
  clampPan(cam, extent);
  return true;
}
