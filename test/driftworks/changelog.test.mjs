import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGELOG, GAME_VERSION, compareVersions, unseenChanges } from '../../public/games/driftworks/content/changelog.js';
import { MIGRATIONS, deserialize, serialize } from '../../public/games/driftworks/core/save.js';
import { researchStatus } from '../../public/games/driftworks/systems/research.js';
import { findResearch } from '../../public/games/driftworks/content/research.js';
import { buildLock } from '../../public/games/driftworks/systems/shipyard.js';
import { newGame } from './helpers.mjs';

test('the game version leads the changelog and versions compare by number', () => {
  assert.equal(CHANGELOG[0].version, GAME_VERSION);
  assert.ok(compareVersions('0.10.0', '0.9.3') > 0);
  assert.ok(compareVersions('0.5.0', '0.5.1') < 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  for (const entry of CHANGELOG) assert.ok(entry.changes.length && entry.changes.every((line) => typeof line === 'string' && line.length));
});

test("a new company has nothing new to read; an old save sees What's new once", () => {
  const state = newGame();
  assert.equal(state.seenVersion, GAME_VERSION);
  assert.deepEqual(unseenChanges(state.seenVersion), []);
  assert.deepEqual(unseenChanges(null), CHANGELOG);
  assert.deepEqual(unseenChanges('0.0.1').map((e) => e.version), CHANGELOG.map((e) => e.version));
});

test('scouts come with the warp drive, and the Scout licence is gone', () => {
  const state = newGame({ credits: 1e7 });
  assert.ok(!findResearch('scout-licence'));
  assert.match(buildLock(state, 'lark', 'halcyon-shipyard'), /Warp drive/);
  state.research.done.push('warp-drive');
  assert.equal(buildLock(state, 'lark', 'halcyon-shipyard'), null);
  assert.equal(researchStatus(state, findResearch('scanners')), 'open');
});

test('a version 6 save drops the Scout licence: done keeps its scouts, one in the lab is refunded', () => {
  const v6 = (research) => {
    const save = JSON.parse(serialize(newGame()));
    delete save.seenVersion;
    return { ...save, version: 6, credits: 1000, research };
  };
  const done = deserialize(v6({ done: ['warp-drive', 'scout-licence'], active: null, second: null }));
  assert.deepEqual(done.research.done, ['warp-drive']);
  assert.equal(done.credits, 1000);
  assert.equal(done.seenVersion, null);
  assert.equal(buildLock(done, 'lark', 'halcyon-shipyard'), null);
  const running = deserialize(v6({ done: ['warp-drive'], active: { id: 'scout-licence', startedAt: 0, endsAt: 1 }, second: { id: 'jump-1', startedAt: 0, endsAt: 1 } }));
  assert.equal(running.research.active, null);
  assert.equal(running.research.second.id, 'jump-1');
  assert.equal(running.credits, 51000);
  assert.match(running.log.at(-1).text, /refunded/);
  assert.ok(MIGRATIONS[6]);
});
