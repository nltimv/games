// Builds the app's web bundle in www/ from the website's own files, so the
// apps always ship the same game as the site:
//
//   www/index.html            public/games/driftworks/index.html, plus the app tags
//   www/app.css               web/app.css (safe areas, app-only tweaks)
//   www/games/driftworks/**   public/games/driftworks/**
//   www/shared/**             public/shared/**
//
// Capacitor serves www/ at the root of its local origin, so the absolute
// paths in the page (/games/driftworks/..., /shared/...) work unchanged.
//
// Environment:
//   DRIFTWORKS_API_URL  Games Hub server for cloud saves. Unset or empty: the
//                       live hub, https://games.nltimv.com. "none": the app
//                       keeps saves on the device only.
//   APP_PLATFORM        android | ios. Set by `cap sync` hooks below; defaults to "app".

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const repo = join(appDir, '..', '..');
const www = join(appDir, 'www');
const game = join(repo, 'public', 'games', 'driftworks');

const DEFAULT_API_URL = 'https://games.nltimv.com';
const apiSetting = (process.env.DRIFTWORKS_API_URL ?? '').trim() || DEFAULT_API_URL;
const apiUrl = apiSetting === 'none' ? '' : apiSetting.replace(/\/+$/, '');
if (apiUrl && !/^https:\/\/[^/\s"'<>]+$/.test(apiUrl)) {
  console.error(`DRIFTWORKS_API_URL must be an https:// origin with no path, got "${apiUrl}"`);
  process.exit(1);
}
const platform = (process.env.APP_PLATFORM ?? 'app').trim();
if (!/^[a-z]+$/.test(platform)) {
  console.error(`APP_PLATFORM must be a lowercase word, got "${platform}"`);
  process.exit(1);
}

await rm(www, { recursive: true, force: true });
await mkdir(join(www, 'games'), { recursive: true });
await cp(game, join(www, 'games', 'driftworks'), { recursive: true });
await cp(join(repo, 'public', 'shared'), join(www, 'shared'), { recursive: true });
await cp(join(appDir, 'web', 'app.css'), join(www, 'app.css'));

let html = await readFile(join(game, 'index.html'), 'utf8');
const tags = [`<meta name="games-app" content="${platform}" />`];
if (apiUrl) tags.push(`<meta name="games-api-base" content="${apiUrl}" />`);
html = html
  .replace(/<title>[^<]*<\/title>/, '<title>Driftworks</title>')
  .replace('</head>', `  ${tags.join('\n  ')}\n  <link rel="stylesheet" href="/app.css" />\n</head>`);
if (!html.includes('games-app')) {
  console.error('Could not add the app tags to index.html');
  process.exit(1);
}
await writeFile(join(www, 'index.html'), html);

console.log(`Built www/ for ${platform}${apiUrl ? ` with cloud saves at ${apiUrl}` : ' with saves on the device only'}`);
