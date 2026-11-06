// Map art. Every map object is an SVG file in ../assets, rasterised once per
// size into a small canvas, so drawing it is one drawImage call and it looks
// the same at every screen size. Sizes are bucketed in steps of about 19%,
// which keeps the cache small while zooming.

const ASSET_DIR = new URL('../assets/', import.meta.url);

// name -> file, plus the largest raster size worth making (soft art such as
// glows looks the same scaled up, so it never needs a big raster).
export const ASSETS = {
  sun: { file: 'sun.svg' },
  'sun-glow': { file: 'sun-glow.svg', maxPx: 256 },
  'planet-rocky': { file: 'planet-rocky.svg' },
  'planet-ice': { file: 'planet-ice.svg' },
  'field-ferrite-ore': { file: 'field-ferrite.svg' },
  'field-carbon-ore': { file: 'field-carbon.svg' },
  'field-silicate-rock': { file: 'field-silicate.svg' },
  'field-ice': { file: 'field-ice.svg' },
  'station-refinery': { file: 'station-refinery.svg' },
  'station-foundry': { file: 'station-foundry.svg' },
  'station-tradingPost': { file: 'station-post.svg' },
  'station-shipyard': { file: 'station-shipyard.svg' },
  gate: { file: 'gate.svg' },
  'ship-miner': { file: 'ship-miner.svg' },
  'ship-hauler': { file: 'ship-hauler.svg' },
};

const MAX_PX = 1024;
const images = new Map();
const rasters = new Map();

/** The URL of an asset, for <img> tags in the panels. */
export function assetUrl(name) {
  const asset = ASSETS[name];
  return asset ? new URL(asset.file, ASSET_DIR).href : '';
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

export function hasAsset(name) {
  return images.has(name);
}

/** Rounds a pixel size up to the next bucket: 2^(n/4). */
export function bucketSize(px) {
  return Math.max(4, Math.ceil(2 ** (Math.ceil(Math.log2(Math.max(1, px)) * 4) / 4)));
}

function raster(name, devicePx) {
  const img = images.get(name);
  if (!img) return null;
  const cap = Math.min(MAX_PX, ASSETS[name].maxPx ?? MAX_PX);
  const px = Math.min(cap, bucketSize(devicePx));
  const key = `${name}@${px}`;
  let canvas = rasters.get(key);
  if (!canvas) {
    const aspect = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : 1;
    canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = Math.max(1, Math.round(px * aspect));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    rasters.set(key, canvas);
  }
  return canvas;
}

/**
 * Draws asset `name` centred on (x, y), `width` CSS pixels wide (height
 * follows the art). `dpr` picks the raster size. Returns false when the art
 * is not loaded, so the caller can draw a fallback.
 */
export function drawAsset(ctx, name, x, y, width, dpr, { rotate = 0, alpha = 1 } = {}) {
  const canvas = raster(name, width * dpr);
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
