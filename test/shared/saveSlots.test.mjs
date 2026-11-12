import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../../public/shared/js/storage.js';
import { cleanName, createSaveSlots } from '../../public/shared/js/saveSlots.js';

function setup() {
  const storage = createMemoryStorage();
  let clock = 1000;
  const slots = createSaveSlots({ game: 'game', storage, now: () => clock });
  return { storage, slots, tick: (ms = 1000) => (clock += ms) };
}

test('names are trimmed, single spaced and capped', () => {
  assert.equal(cleanName('  Aurel   Mining  '), 'Aurel Mining');
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName('x'.repeat(60)).length, 40);
});

test('saves are listed most recently played first, each under its own keys', () => {
  const { slots, storage, tick } = setup();
  const a = slots.create('First', { data: { credits: 1 } });
  tick();
  const b = slots.create('Second');
  assert.deepEqual(slots.list().map((s) => s.name), ['Second', 'First']);
  tick();
  slots.touch(a.id);
  assert.equal(slots.latest().id, a.id);
  assert.equal(storage.getItem(`game-slot-${a.id}`), '{"credits":1}');
  assert.deepEqual(slots.data(a.id), { credits: 1 });
  assert.equal(slots.data(b.id), null);
  assert.equal(slots.saveKey(a.id), `game-${slots.saveName(a.id)}`);
});

test('a taken name gets a number', () => {
  const { slots } = setup();
  assert.equal(slots.freeName('Company'), 'Company');
  slots.create('Company');
  slots.create('company 2');
  assert.equal(slots.freeName('Company'), 'Company 3');
  assert.equal(slots.create('').name, 'Company 3');
});

test('renaming marks a cloud save for its next push', () => {
  const { slots } = setup();
  const local = slots.create('Local');
  const synced = slots.create('Synced', { meta: { code: '1234567890123456', revision: 4, dirty: false } });
  assert.equal(slots.rename(synced.id, '  New name ').name, 'New name');
  assert.equal(slots.get(synced.id).name, 'New name');
  assert.equal(slots.meta(synced.id).dirty, true);
  assert.equal(slots.meta(synced.id).revision, 4);
  slots.rename(local.id, 'Still local');
  assert.equal(slots.meta(local.id).dirty, false);
  assert.equal(slots.rename(local.id, '   '), null);
  assert.equal(slots.get(local.id).name, 'Still local');
});

test('a save is found by its code, however it is typed', () => {
  const { slots } = setup();
  const s = slots.create('Synced', { meta: { code: '1234567890123456' } });
  assert.equal(slots.findByCode('1234 5678 9012 3456').id, s.id);
  assert.equal(slots.findByCode('0000 0000 0000 0000'), null);
  assert.equal(slots.findByCode(''), null);
});

test('removing a save clears its data and bookkeeping', () => {
  const { slots, storage } = setup();
  const s = slots.create('Gone', { data: { credits: 1 }, meta: { code: '1234567890123456' } });
  slots.remove(s.id);
  assert.deepEqual(slots.list(), []);
  assert.equal(storage.getItem(slots.saveKey(s.id)), null);
  assert.equal(storage.getItem(slots.metaKey(s.id)), null);
});

test('the save of earlier versions becomes a named save once, with a notice', () => {
  const { slots, storage } = setup();
  assert.equal(slots.adoptLegacy('game-save', 'My company'), null);
  storage.setItem('game-save', '{"credits":42}');
  const slot = slots.adoptLegacy('game-save', 'My company');
  assert.equal(slot.name, 'My company');
  assert.deepEqual(slots.data(slot.id), { credits: 42 });
  assert.equal(storage.getItem('game-save'), null, 'the old key is gone');
  assert.equal(slots.latest().id, slot.id);
  assert.equal(slots.meta(slot.id).code, null, 'it gets its code when it is loaded');
  assert.equal(slots.legacyNotice, true);
  slots.dismissLegacyNotice();
  assert.equal(slots.legacyNotice, false);
  assert.equal(slots.adoptLegacy('game-save', 'My company'), null);
  assert.equal(slots.list().length, 1);
});
