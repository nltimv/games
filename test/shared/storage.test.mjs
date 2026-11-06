import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage, createStore } from '../../public/shared/js/storage.js';

test('keys are prefixed with the game id', () => {
  const storage = createMemoryStorage();
  const store = createStore('snake', storage);
  store.setJSON('best', { score: 12 });
  assert.equal(storage.getItem('snake-best'), '{"score":12}');
  assert.deepEqual(store.getJSON('best'), { score: 12 });
});

test('broken or missing storage falls back instead of throwing', () => {
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  const store = createStore('x', throwing);
  assert.equal(store.getRaw('a', 'fallback'), 'fallback');
  assert.equal(store.setRaw('a', '1'), false);
  assert.equal(store.remove('a'), false);
  assert.equal(createStore('x', null).getJSON('a', 7), 7);
});

test('bad JSON reads as the fallback', () => {
  const storage = createMemoryStorage();
  storage.setItem('x-a', '{oops');
  assert.equal(createStore('x', storage).getJSON('a', 'fallback'), 'fallback');
});
