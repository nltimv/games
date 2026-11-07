// Map art. Every map object is an SVG (a file in ../assets, or made here for
// each star class), rasterised once per size into a small canvas, so drawing
// it is one drawImage call and it looks the same at every screen size. Sizes
// are bucketed in steps of about 19%, which keeps the cache small while
// zooming. Art can be tinted (stations take their faction's colour): the
// tint replaces the art's hue and keeps its light and shade.

import { STAR_CLASSES } from '../content/scenery.js';

const ASSET_DIR = new URL('../assets/', import.meta.url);

/** A star's disc and corona, in its class's colours. */
function starSvg({ body, glow }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><defs><radialGradient id="body" cx="0.38" cy="0.35" r="0.72"><stop offset="0" stop-color="${body[0]}"/><stop offset="0.35" stop-color="${body[1]}"/><stop offset="0.8" stop-color="${body[2]}"/><stop offset="1" stop-color="${body[3]}"/></radialGradient><radialGradient id="corona" cx="0.5" cy="0.5" r="0.5"><stop offset="0.8" stop-color="${glow[0]}" stop-opacity="0.6"/><stop offset="1" stop-color="${glow[1]}" stop-opacity="0"/></radialGradient></defs><circle cx="32" cy="32" r="32" fill="url(#corona)"/><circle cx="32" cy="32" r="26" fill="url(#body)"/></svg>`;
}

/** The wide soft light around a star. */
function glowSvg({ glow }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><defs><radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${glow[0]}" stop-opacity="0.5"/><stop offset="0.35" stop-color="${glow[1]}" stop-opacity="0.16"/><stop offset="1" stop-color="${glow[2]}" stop-opacity="0"/></radialGradient></defs><circle cx="32" cy="32" r="32" fill="url(#glow)"/></svg>`;
}

// name -> file (or svg markup), plus the largest raster size worth making
// (soft art such as glows looks the same scaled up, so it never needs a big
// raster).
export const ASSETS = {
  ...Object.fromEntries(
    Object.entries(STAR_CLASSES).flatMap(([id, star]) => [
      [`sun-${id}`, { svg: starSvg(star) }],
      [`sun-glow-${id}`, { svg: glowSvg(star), maxPx: 256 }],
    ]),
  ),
  'planet-rocky': { file: 'planet-rocky.svg' },
  'planet-ice': { file: 'planet-ice.svg' },
  'field-ferrite-ore': { file: 'field-ferrite.svg' },
  'field-carbon-ore': { file: 'field-carbon.svg' },
  'field-silicate-rock': { file: 'field-silicate.svg' },
  'field-ice': { file: 'field-ice.svg' },
  'field-titanium-ore': { file: 'field-titanium.svg' },
  'field-crystal-ore': { file: 'field-crystal.svg' },
  'station-refinery': { file: 'station-refinery.svg' },
  'station-foundry': { file: 'station-foundry.svg' },
  'station-tradingPost': { file: 'station-post.svg' },
  'station-shipyard': { file: 'station-shipyard.svg' },
  'station-factory': { file: 'station-factory.svg' },
  gate: { file: 'gate.svg' },
  'ship-miner': { file: 'ship-miner.svg' },
  'ship-hauler': { file: 'ship-hauler.svg' },
  'ship-scout': { file: 'ship-scout.svg' },
};

const MAX_PX = 1024;
const images = new Map();
const rasters = new Map();

/** The URL of an asset, for <img> tags in the panels. */
export function assetUrl(name) {
  const asset = ASSETS[name];
  if (!asset) return '';
  return asset.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svg)}` : new URL(asset.file, ASSET_DIR).href;
}

/** Loads every asset. Resolves when done; art that fails to load is skipped. */
export function loadAssets() {
  return Promise.all(
    Object.keys(ASSETS).map(async (name) => {
      const img = new Image();
      img.src = assetUrl(name);
      try {
        await img.decode();
        images.set(name, img);
      } catch {
        // The map draws a plain shape until (or unless) the art arrives.
      }
    }),
  );
}

const tintedUrls = new Map();

/** An asset's URL with a tint, for panel icons; untinted until the art has loaded. */
export function tintedUrl(name, tint) {
  if (!tint || !images.has(name)) return assetUrl(name);
  const key = `${name}:${tint}`;
  if (!tintedUrls.has(key)) tintedUrls.set(key, raster(name, 128, tint).toDataURL());
  return tintedUrls.get(key);
}

export function hasAsset(name) {
  return images.has(name);
}

/** Rounds a pixel size up to the next bucket: 2^(n/4). */
export function bucketSize(px) {
  return Math.max(4, Math.ceil(2 ** (Math.ceil(Math.log2(Math.max(1, px)) * 4) / 4)));
}

function raster(name, devicePx, tint = null) {
  const img = images.get(name);
  if (!img) return null;
  const cap = Math.min(MAX_PX, ASSETS[name].maxPx ?? MAX_PX);
  const px = Math.min(cap, bucketSize(devicePx));
  const key = `${name}@${px}${tint ? `:${tint}` : ''}`;
  let canvas = rasters.get(key);
  if (!canvas) {
    const aspect = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : 1;
    canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = Math.max(1, Math.round(px * aspect));
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (tint) {
      // Take the tint's hue and saturation, keep the art's lightness, then
      // cut back to the art's own shape.
      c.globalCompositeOperation = 'color';
      c.fillStyle = tint;
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    rasters.set(key, canvas);
  }
  return canvas;
}

/**
 * Draws asset `name` centred on (x, y), `width` CSS pixels wide (height
 * follows the art). `dpr` picks the raster size. Returns false when the art
 * is not loaded, so the caller can draw a fallback. `tint` recolours it.
 */
export function drawAsset(ctx, name, x, y, width, dpr, { rotate = 0, alpha = 1, tint = null } = {}) {
  const canvas = raster(name, width * dpr, tint);
  if (!canvas) return false;
  const height = (width * canvas.height) / canvas.width;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  if (rotate) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotate);
    ctx.drawImage(canvas, -width / 2, -height / 2, width, height);
    ctx.restore();
  } else {
    ctx.drawImage(canvas, x - width / 2, y - height / 2, width, height);
  }
  if (alpha !== 1) ctx.globalAlpha = 1;
  return true;
}
