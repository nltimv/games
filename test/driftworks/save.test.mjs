import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStore, deserialize, exportSave, importSave, serialize } from '../../public/games/driftworks/core/save.js';
import { SAVE_VERSION } from '../../public/games/driftworks/core/state.js';
import { createMemoryStorage } from '../../public/shared/js/storage.js';
import { giveOrder } from '../../public/games/driftworks/systems/orders.js';
import { newGame, firstShip } from './helpers.mjs';

test('a save survives a round trip', () => {
  const state = newGame();
  giveOrder(state, firstShip(state), { type: 'mine', fieldId: 'rime', minutes: 15 });
  assert.deepEqual(deserialize(serialize(state)), state);
});

test('the save store reads back what it wrote, under the game prefix', () => {
  const storage = createMemoryStorage();
  const saves = createSaveStore(storage);
  assert.equal(saves.load(), null);
  const state = newGame();
  assert.ok(saves.save(state));
  assert.ok(storage.getItem('driftworks-save'));
  assert.deepEqual(saves.load(), state);
  saves.clear();
  assert.equal(saves.load(), null);
});

test('backup codes round trip, even with non-ASCII text in the log', () => {
  const state = newGame();
  state.log.push({ at: state.now, text: 'Bought 10 t iron: −160 cr', kind: 'trade' });
  const code = exportSave(state);
  assert.match(code, /^[A-Za-z0-9+/=]+$/);
  assert.deepEqual(importSave(`  ${code}\n`), state);
});

test('junk, wrong shapes and future versions are refused', () => {
  assert.equal(importSave('not a save'), null);
  assert.equal(deserialize('{"hello":1}'), null);
  assert.equal(deserialize('[]'), null);
  const future = { ...newGame(), version: SAVE_VERSION + 1 };
  assert.equal(deserialize(JSON.stringify(future)), null);
});
