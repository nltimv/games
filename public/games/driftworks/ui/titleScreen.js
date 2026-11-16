// The title screen behind the main menu: a slowly drifting starfield, a
// planet lit by a distant sun, a trading post and a few haulers
// working its lanes, and the game's logo.
//
// It is kept light for phones. The sky, sun, planet and lanes are painted
// once per screen size into one canvas. A second canvas draws only the
// moving parts (about two hundred star dots and a few sprites) at most 30
// times a second, and stops while the tab is hidden. With
// prefers-reduced-motion it paints one still frame instead.

import { createRng } from '../core/rng.js';
import { h, svgIcon } from './dom.js';

const ASSET_DIR = new URL('../assets/', import.meta.url);
const FRAME_MS = 1000 / 30;
const MAX_DPR = 2;

// ---------- Logo ----------

// The emblem: a trading-post hexagon with a hauler on an orbit around it.
// The hauler moves with SMIL so it follows the tilted orbit exactly, and it
// fades while it passes behind the hexagon.
const ORBIT = 'M8 50 A40 13 0 1 0 88 50 A40 13 0 1 0 8 50';
const EMBLEM = `<svg class="dw-logo-emblem" aria-hidden="true" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="dw-logo-halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0.3" stop-color="#2ec5c0" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#2ec5c0" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="dw-logo-hull" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f2fffd"/>
      <stop offset="0.5" stop-color="#7fe9de"/>
      <stop offset="1" stop-color="#1b9aa8"/>
    </linearGradient>
    <linearGradient id="dw-logo-gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.05"/>
    </linearGradient>
    <linearGradient id="dw-logo-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffaf0"/>
      <stop offset="0.5" stop-color="#ffe3a0"/>
      <stop offset="1" stop-color="#d79a2c"/>
    </linearGradient>
  </defs>
  <circle cx="48" cy="48" r="46" fill="url(#dw-logo-halo)"/>
  <g transform="rotate(-16 48 50)">
    <ellipse cx="48" cy="50" rx="40" ry="13" fill="none" stroke="#ffd36e" stroke-opacity="0.35" stroke-width="2"/>
  </g>
  <polygon points="72,48 60,68.8 36,68.8 24,48 36,27.2 60,27.2" fill="url(#dw-logo-hull)" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M25.8 45.4 L37 28.8 L59 28.8 L70.2 45.4 Q48 40 25.8 45.4 Z" fill="url(#dw-logo-gloss)"/>
  <path d="M48 38 L57.5 48.5 L48 59 L38.5 48.5 Z" fill="#03303d" fill-opacity="0.8"/>
  <circle cx="48" cy="48.5" r="3" fill="#6ff0d8"/>
  <g transform="rotate(-16 48 50)">
    <path d="M8 50 A40 13 0 0 0 88 50" fill="none" stroke="#ffd36e" stroke-width="2.4" stroke-linecap="round"/>
    <g>
      <circle r="5" fill="#ffd36e" fill-opacity="0.3"/>
      <path d="M-4.2 -3 L4.6 0 L-4.2 3 Z" fill="url(#dw-logo-gold)" stroke="#ffffff" stroke-width="0.7" stroke-linejoin="round"/>
      <animateMotion dur="14s" repeatCount="indefinite" rotate="auto" path="${ORBIT}"/>
      <animate attributeName="opacity" dur="14s" repeatCount="indefinite" values="1;1;0;0;1;1" keyTimes="0;0.6;0.65;0.85;0.9;1"/>
    </g>
  </g>
</svg>`;

const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The game's logo: emblem, name and a short line. The name is the dialog's title. */
export function titleLogo() {
  const emblem = svgIcon(EMBLEM);
  if (prefersReducedMotion()) {
    // Hold the hauler still at the front of its orbit.
    queueMicrotask(() => {
      emblem.pauseAnimations?.();
      emblem.setCurrentTime?.(3.5);
    });
  }
  return h(
    'div',
    { class: 'dw-logo' },
    emblem,
    h('h2', { id: 'modal-title', class: 'dw-logo-word' }, 'Driftworks'),
    h('p', { class: 'dw-logo-tag' }, 'Mine, trade and grow a fleet among the stars'),
  );
}

// ---------- Scene ----------

function loadImage(file) {
  const img = new Image();
  img.decoding = 'async';
  img.src = new URL(file, ASSET_DIR).href;
  return img;
}

/** Rasterises an image once into a canvas `px` wide. */
function raster(img, px) {
  const scale = px / img.naturalWidth;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A soft round glow, used for the sun and for engine light. */
function glowSprite(px, stops) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, px, px);
  return canvas;
}

/** A fading engine trail pointing left, drawn behind a ship facing right. */
function trailSprite(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, width, 0);
  g.addColorStop(0, 'rgba(255, 211, 110, 0)');
  g.addColorStop(1, 'rgba(255, 231, 168, 0.55)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, 0);
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

/** Where things sit, in CSS pixels, for a w × h screen. */
function layout(w, hgt) {
  const portrait = hgt > w * 1.1;
  const min = Math.min(w, hgt);
  const sun = portrait ? { x: w * 0.2, y: hgt * 0.1 } : { x: w * 0.15, y: hgt * 0.2 };
  const planet = portrait ? { x: w * 0.92, y: hgt * 0.98, r: w * 0.52 } : { x: w * 0.86, y: hgt * 1.04, r: min * 0.42 };
  const station = portrait ? { x: w * 0.36, y: hgt * 0.93 } : { x: w * 0.83, y: hgt * 0.36 };
  const shipPx = Math.max(22, Math.min(36, min * 0.035));
  // Lanes are quadratic curves; inbound ones end at the station.
  const lanes = portrait
    ? [
        { from: { x: -40, y: hgt * 0.62 }, via: { x: w * 0.1, y: hgt * 0.9 }, to: station, inbound: true },
        { from: station, via: { x: w * 0.6, y: hgt * 0.8 }, to: { x: w + 40, y: hgt * 0.7 }, inbound: false },
        { from: { x: w + 40, y: hgt * 0.18 }, via: { x: w * 0.5, y: hgt * 0.02 }, to: { x: -40, y: hgt * 0.06 }, inbound: false },
      ]
    : [
        { from: { x: -40, y: hgt * 0.55 }, via: { x: w * 0.42, y: hgt * 0.02 }, to: station, inbound: true },
        { from: station, via: { x: w * 0.98, y: hgt * 0.2 }, to: { x: w + 40, y: hgt * 0.55 }, inbound: false },
        { from: { x: w * 0.6, y: hgt + 40 }, via: { x: w * 0.7, y: hgt * 0.62 }, to: station, inbound: true },
      ];
  return { portrait, min, sun, planet, station, lanes, shipPx, stationPx: Math.max(56, Math.min(110, min * 0.11)) };
}

function lanePoint(lane, t) {
  const u = 1 - t;
  const { from: a, via: b, to: c } = lane;
  return {
    x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    angle: Math.atan2(2 * u * (b.y - a.y) + 2 * t * (c.y - b.y), 2 * u * (b.x - a.x) + 2 * t * (c.x - b.x)),
  };
}

/** Paints everything that does not move: sky, nebulae, sun, planet, lanes. */
function paintSky(ctx, w, hgt, scene) {
  const { sun, planet, min } = scene;
  const base = ctx.createLinearGradient(0, 0, w, hgt);
  base.addColorStop(0, '#0b1d44');
  base.addColorStop(1, '#030817');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, hgt);

  const big = Math.max(w, hgt);
  const blob = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hgt);
  };
  blob(w * 0.28, hgt * 0.32, big * 0.62, 'rgba(21, 64, 122, 0.85)');
  blob(w * 0.78, hgt * 0.95, big * 0.55, 'rgba(15, 85, 96, 0.8)');
  blob(w * 0.9, hgt * 0.1, big * 0.4, 'rgba(110, 84, 190, 0.28)');
  blob(w * 0.05, hgt * 0.9, big * 0.35, 'rgba(46, 197, 192, 0.12)');

  // A faint dust band across the sky.
  ctx.save();
  ctx.translate(w / 2, hgt / 2);
  ctx.rotate(-0.42);
  ctx.scale(1, 0.18);
  blob(0, 0, big * 0.7, 'rgba(199, 184, 255, 0.07)');
  ctx.restore();

  // The sun.
  const sunR = Math.max(10, min * 0.022);
  blob(sun.x, sun.y, min * 0.55, 'rgba(255, 180, 94, 0.22)');
  blob(sun.x, sun.y, sunR * 6, 'rgba(255, 227, 163, 0.5)');
  const disc = ctx.createRadialGradient(sun.x - sunR * 0.3, sun.y - sunR * 0.3, 0, sun.x, sun.y, sunR);
  disc.addColorStop(0, '#ffffff');
  disc.addColorStop(0.4, '#fff1c2');
  disc.addColorStop(0.85, '#ffbd5c');
  disc.addColorStop(1, '#ff9b3a');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sunR, 0, Math.PI * 2);
  ctx.fill();

  // Trade lanes, dashed like routes on the map.
  ctx.save();
  ctx.setLineDash([3, 6]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  for (const lane of scene.lanes) {
    ctx.beginPath();
    ctx.moveTo(lane.from.x, lane.from.y);
    ctx.quadraticCurveTo(lane.via.x, lane.via.y, lane.to.x, lane.to.y);
    ctx.stroke();
  }
  ctx.restore();

  paintPlanet(ctx, planet, sun);
}

function paintPlanet(ctx, { x, y, r }, sun) {
  const toSun = Math.atan2(sun.y - y, sun.x - x);
  const lx = Math.cos(toSun);
  const ly = Math.sin(toSun);
  const tilt = 0.28; // of the cloud bands
  // Atmosphere glow.
  const air = ctx.createRadialGradient(x, y, r * 0.96, x, y, r * 1.18);
  air.addColorStop(0, 'rgba(111, 240, 216, 0.35)');
  air.addColorStop(1, 'rgba(111, 240, 216, 0)');
  ctx.fillStyle = air;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const body = ctx.createRadialGradient(x + lx * r * 0.7, y + ly * r * 0.7, r * 0.05, x + lx * r * 0.3, y + ly * r * 0.3, r * 1.35);
  body.addColorStop(0, '#d2fbff');
  body.addColorStop(0.22, '#6cc9d4');
  body.addColorStop(0.5, '#2c719c');
  body.addColorStop(0.8, '#14325c');
  body.addColorStop(1, '#081430');
  ctx.fillStyle = body;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // Cloud bands.
  ctx.translate(x, y);
  ctx.rotate(tilt);
  const rng = createRng(7);
  for (let i = 0; i < 14; i += 1) {
    const by = (rng() * 2 - 1) * r;
    ctx.fillStyle = `rgba(${rng() < 0.5 ? '214, 248, 255' : '20, 60, 110'}, ${0.04 + rng() * 0.06})`;
    ctx.beginPath();
    ctx.ellipse(0, by, r * 1.1, r * (0.012 + rng() * 0.05), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.rotate(-tilt);
  // Night side.
  const night = ctx.createRadialGradient(-lx * r * 0.9, -ly * r * 0.9, r * 0.2, -lx * r * 0.6, -ly * r * 0.6, r * 1.5);
  night.addColorStop(0, 'rgba(2, 6, 20, 0.85)');
  night.addColorStop(1, 'rgba(2, 6, 20, 0)');
  ctx.fillStyle = night;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();

  // Lit rim.
  ctx.beginPath();
  ctx.arc(x, y, r - 1, toSun - 1.1, toSun + 1.1);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(233, 255, 251, 0.55)';
  ctx.stroke();
}

function makeStars(w, hgt) {
  const rng = createRng(20261116);
  const count = Math.min(320, Math.round((w * hgt) / 4200));
  return Array.from({ length: count }, () => {
    const depth = rng() < 0.6 ? 0.25 : rng() < 0.75 ? 0.55 : 1;
    const tint = rng();
    return {
      x: rng() * w,
      y: rng() * hgt,
      depth,
      size: depth === 1 ? 1.4 + rng() * 0.8 : depth * 1.6 + rng() * 0.5,
      alpha: 0.35 + rng() * 0.55,
      twinkle: rng() < 0.35 ? 0.6 + rng() * 1.6 : 0,
      phase: rng() * Math.PI * 2,
      color: tint < 0.12 ? '255, 224, 170' : tint < 0.3 ? '190, 230, 255' : '255, 255, 255',
    };
  });
}

/**
 * Covers the page with the animated title scene. Returns { stop }, which
 * removes it.
 */
export function startTitleScreen() {
  const sky = h('canvas', { class: 'dw-title-sky' });
  const live = h('canvas', { class: 'dw-title-live' });
  const root = h('div', { class: 'dw-title', 'aria-hidden': 'true' }, sky, live);
  document.body.append(root);

  const images = {
    hauler: loadImage('ship-hauler.svg'),
    miner: loadImage('ship-miner.svg'),
    station: loadImage('station-post.svg'),
  };
  const sprites = {};
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

  let w = 0;
  let hgt = 0;
  let dpr = 1;
  let scene = null;
  let stars = [];
  let frame = 0;
  let last = 0;
  let stopped = false;
  const started = performance.now();

  // Ships: which lane, how long a run takes, and where in it they start.
  const ships = [
    { lane: 0, kind: 'hauler', period: 64, offset: 0.15 },
    { lane: 1, kind: 'hauler', period: 52, offset: 0.55 },
    { lane: 2, kind: 'miner', period: 58, offset: 0.4 },
    { lane: 0, kind: 'miner', period: 64, offset: 0.68 },
  ];

  function makeSprites() {
    if (!scene) return;
    const px = Math.round(scene.shipPx * dpr);
    for (const kind of ['hauler', 'miner']) {
      if (images[kind].complete && images[kind].naturalWidth) sprites[kind] = raster(images[kind], px * 1.6);
    }
    if (images.station.complete && images.station.naturalWidth) sprites.station = raster(images.station, Math.round(scene.stationPx * dpr));
    sprites.trail = trailSprite(Math.round(scene.shipPx * 2.4 * dpr), Math.round(scene.shipPx * 0.34 * dpr));
    sprites.dock = glowSprite(Math.round(scene.stationPx * 2.2 * dpr), [
      [0, 'rgba(111, 240, 216, 0.28)'],
      [1, 'rgba(111, 240, 216, 0)'],
    ]);
  }

  function resize() {
    w = window.innerWidth;
    hgt = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    for (const canvas of [sky, live]) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    scene = layout(w, hgt);
    const ctx = sky.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintSky(ctx, w, hgt, scene);
    stars = makeStars(w, hgt);
    makeSprites();
    draw(performance.now());
  }

  function drawSprite(ctx, sprite, x, y, angle, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(sprite, -sprite.width / dpr / 2, -sprite.height / dpr / 2, sprite.width / dpr, sprite.height / dpr);
    ctx.restore();
  }

  function draw(now) {
    const ctx = live.getContext('2d');
    // Reduced motion paints a still moment some way in, so the ships are under way.
    const t = (motion?.matches ? 20_000 : now - started) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);

    // Stars drift left, nearer ones faster, and stay behind the planet.
    const { planet } = scene;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, hgt);
    ctx.arc(planet.x, planet.y, planet.r, 0, Math.PI * 2);
    ctx.clip('evenodd');
    for (const star of stars) {
      let x = (star.x - t * 6 * star.depth) % w;
      if (x < 0) x += w;
      const y = (star.y + t * 1.2 * star.depth) % hgt;
      const glint = star.twinkle ? 0.65 + 0.35 * Math.sin(t * star.twinkle + star.phase) : 1;
      ctx.fillStyle = `rgba(${star.color}, ${star.alpha * glint})`;
      const s = star.size;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.restore();

    const { station } = scene;
    if (sprites.dock) drawSprite(ctx, sprites.dock, station.x, station.y, 0, 0.6 + 0.4 * Math.sin(t * 0.8));
    if (sprites.station) drawSprite(ctx, sprites.station, station.x, station.y, t * 0.06);

    for (const ship of ships) {
      const sprite = sprites[ship.kind];
      if (!sprite) continue;
      const lane = scene.lanes[ship.lane];
      const p = (t / ship.period + ship.offset) % 1;
      const at = lanePoint(lane, p);
      // Fade in and out where ships dock or leave the screen.
      const edge = Math.min(p, 1 - p);
      const alpha = Math.min(1, edge / 0.08);
      const back = scene.shipPx * 1.4;
      drawSprite(ctx, sprites.trail, at.x - Math.cos(at.angle) * back, at.y - Math.sin(at.angle) * back, at.angle, alpha * 0.8);
      drawSprite(ctx, sprite, at.x, at.y, at.angle, alpha);
    }
  }

  function tick(now) {
    frame = 0;
    if (stopped) return;
    if (now - last >= FRAME_MS - 2) {
      last = now;
      draw(now);
    }
    schedule();
  }

  function schedule() {
    if (stopped || frame || document.hidden || motion?.matches) return;
    frame = requestAnimationFrame(tick);
  }

  function onImage() {
    makeSprites();
    draw(performance.now());
  }

  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else schedule();
  }

  function onMotion() {
    draw(performance.now());
    schedule();
  }

  for (const img of Object.values(images)) img.addEventListener('load', onImage);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  motion?.addEventListener?.('change', onMotion);
  resize();
  schedule();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      motion?.removeEventListener?.('change', onMotion);
      root.remove();
    },
  };
}
