import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitsAt, hitTest, pickNext, shipsInBox } from '../../public/games/driftworks/render/systemMap.js';
import { flock, flockName } from '../../public/games/driftworks/render/flocks.js';

const station = { kind: 'station', id: 'halcyon-refinery', x: 100, y: 100, r: 21 };
const docked = { kind: 'ship', id: 'ship-1', x: 128, y: 100, r: 14 };

test('a ship docked next to its station is easy to click, and so is the station', () => {
  const targets = [station, docked];
  assert.deepEqual(hitTest(targets, 126, 101), { kind: 'ship', id: 'ship-1' });
  assert.deepEqual(hitTest(targets, 117, 100), { kind: 'ship', id: 'ship-1' }, 'between the two, the ship is closer');
  assert.deepEqual(hitTest(targets, 103, 98), { kind: 'station', id: 'halcyon-refinery' });
  assert.equal(hitTest(targets, 300, 300), null);
});

test('a box picks the ships inside it, whichever way it is dragged', () => {
  const targets = [station, docked, { kind: 'ship', id: 'ship-2', x: 400, y: 40, r: 14 }];
  assert.deepEqual(shipsInBox(targets, { x: 90, y: 90 }, { x: 140, y: 110 }), ['ship-1']);
  assert.deepEqual(shipsInBox(targets, { x: 500, y: 0 }, { x: 0, y: 200 }), ['ship-1', 'ship-2']);
  assert.deepEqual(shipsInBox(targets, { x: 0, y: 0 }, { x: 10, y: 10 }), []);
});

test('ships flying close together form one flock; far ones stay apart', () => {
  const at = (id, x, y) => ({ ship: { id, name: id }, p: { x, y } });
  const groups = flock([at('a', 100, 100), at('b', 110, 104), at('c', 300, 100), at('d', 104, 96)], 24);
  assert.deepEqual(groups.map((g) => g.members.map((m) => m.ship.id)), [['a', 'b', 'd'], ['c']]);
  assert.ok(Math.abs(groups[0].x - 104.67) < 0.01);
  assert.equal(flockName(groups[0].members), '3 ships');
  assert.equal(flockName(groups[0].members.slice(0, 2)), 'a, b');
});

test('a flock is clicked as one, and its ships are still box-selected one by one', () => {
  const targets = [
    { kind: 'flock', id: 'a', ids: ['a', 'b'], x: 100, y: 100, r: 16 },
    { kind: 'ship', id: 'a', x: 100, y: 100, r: 0, ring: 12 },
    { kind: 'ship', id: 'b', x: 100, y: 100, r: 0, ring: 12 },
    { kind: 'station', id: 's', x: 200, y: 100, r: 20 },
  ];
  assert.deepEqual(hitTest(targets, 104, 102), { kind: 'flock', id: 'a', ids: ['a', 'b'] });
  assert.deepEqual(hitTest(targets, 100, 100), { kind: 'flock', id: 'a', ids: ['a', 'b'] });
  assert.deepEqual(hitTest(targets, 205, 100), { kind: 'station', id: 's' });
  assert.deepEqual(shipsInBox(targets, { x: 80, y: 80 }, { x: 120, y: 120 }), ['a', 'b']);
});

test('clicking again where things overlap picks the one behind, then the first again', () => {
  const targets = [station, docked];
  const hits = hitsAt(targets, 117, 100);
  assert.deepEqual(hits, [
    { kind: 'ship', id: 'ship-1' },
    { kind: 'station', id: 'halcyon-refinery' },
  ]);
  assert.deepEqual(pickNext(hits, null), { kind: 'ship', id: 'ship-1' });
  assert.deepEqual(pickNext(hits, { kind: 'ship', id: 'ship-1' }), { kind: 'station', id: 'halcyon-refinery' });
  assert.deepEqual(pickNext(hits, { kind: 'station', id: 'halcyon-refinery' }), { kind: 'ship', id: 'ship-1' });
  assert.deepEqual(pickNext(hits, { kind: 'field', id: 'elsewhere' }), { kind: 'ship', id: 'ship-1' }, 'something else selected: the top one');
  assert.deepEqual(pickNext(hitsAt(targets, 103, 98), { kind: 'station', id: 'halcyon-refinery' }), { kind: 'station', id: 'halcyon-refinery' }, 'nothing behind: the same one');
});

test('a flock of selected ships passing a system gives way to the system, and a second click there opens it', () => {
  const targets = [
    { kind: 'system', id: 'dace', x: 100, y: 100, r: 16 },
    { kind: 'flock', id: 'a', ids: ['a', 'b'], x: 104, y: 100, r: 14 },
  ];
  const hits = hitsAt(targets, 103, 100);
  assert.deepEqual(hits.map((hit) => hit.kind), ['flock', 'system']);
  assert.deepEqual(pickNext(hits, { kind: 'ships', ids: ['b', 'a'] }), { kind: 'system', id: 'dace' });
  assert.deepEqual(pickNext(hits, { kind: 'system', id: 'dace' }), { kind: 'system', id: 'dace' });
});
