// Renders the app icons and splash screens from assets/*.svg into the
// Android and iOS projects. Run it after changing the artwork:
//
//   node scripts/render-assets.cjs
//
// Needs Playwright with Chromium (npx playwright install chromium) and is
// not part of the CI build: the PNGs it writes are committed. The App
// Store refuses icons with an alpha channel, so flatten the opaque ones
// afterwards, e.g. with Pillow:
//
//   python3 -c "import sys;from PIL import Image;[Image.open(f).convert('RGB').save(f) for f in sys.argv[1:]]" \
//     ios/App/App/Assets.xcassets/*/*.png android/app/src/main/res/mipmap-*/ic_launcher.png \
//     android/app/src/main/res/drawable*/splash.png

const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const app = path.join(__dirname, '..');
const res = path.join(app, 'android', 'app', 'src', 'main', 'res');
const xc = path.join(app, 'ios', 'App', 'App', 'Assets.xcassets');
const read = (name) => fs.readFileSync(path.join(app, 'assets', name), 'utf8');
const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

const BACKDROP = '#040a1d';
const background = read('background.svg');
const foreground = read('foreground.svg');
// The full icon (iOS, older Android): artwork on the backdrop, a little
// larger than in the adaptive icon, which Android masks to 66%.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${inner(background)}<g transform="translate(512 512) scale(1.25) translate(-512 -512)">${inner(foreground)}</g></svg>`;
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><clipPath id="r"><circle cx="512" cy="512" r="512"/></clipPath><g clip-path="url(#r)">${inner(icon)}</g></svg>`;
const splash = (w, h) => {
  const size = Math.min(w, h) * 0.55;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${BACKDROP}"/><svg x="${(w - size) / 2}" y="${(h - size) / 2}" width="${size}" height="${size}" viewBox="0 0 1024 1024">${inner(foreground)}</svg></svg>`;
};

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const SPLASH = { mdpi: [480, 320], hdpi: [800, 480], xhdpi: [1280, 720], xxhdpi: [1600, 960], xxxhdpi: [1920, 1280] };

const jobs = [];
for (const [d, k] of Object.entries(DENSITIES)) {
  jobs.push({ svg: icon, w: 48 * k, h: 48 * k, out: path.join(res, `mipmap-${d}`, 'ic_launcher.png') });
  jobs.push({ svg: round, w: 48 * k, h: 48 * k, out: path.join(res, `mipmap-${d}`, 'ic_launcher_round.png'), alpha: true });
  jobs.push({ svg: foreground, w: 108 * k, h: 108 * k, out: path.join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'), alpha: true });
  const [lw, lh] = SPLASH[d];
  jobs.push({ svg: splash(lw, lh), w: lw, h: lh, out: path.join(res, `drawable-land-${d}`, 'splash.png') });
  jobs.push({ svg: splash(lh, lw), w: lh, h: lw, out: path.join(res, `drawable-port-${d}`, 'splash.png') });
}
jobs.push({ svg: splash(480, 320), w: 480, h: 320, out: path.join(res, 'drawable', 'splash.png') });
jobs.push({ svg: icon, w: 1024, h: 1024, out: path.join(xc, 'AppIcon.appiconset', 'AppIcon-512@2x.png') });
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  jobs.push({ svg: splash(2732, 2732), w: 2732, h: 2732, out: path.join(xc, 'Splash.imageset', name) });
}

(async () => {
  const browser = await chromium.launch();
  for (const job of jobs) {
    const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
    const svg = job.svg.replace('<svg ', `<svg width="${job.w}" height="${job.h}" `);
    await page.setContent(`<html><body style="margin:0;background:${job.alpha ? 'transparent' : BACKDROP}">${svg}</body></html>`);
    await page.screenshot({ path: job.out, omitBackground: Boolean(job.alpha), clip: { x: 0, y: 0, width: job.w, height: job.h } });
    await page.close();
    console.log(path.relative(app, job.out));
  }
  await browser.close();
})();
