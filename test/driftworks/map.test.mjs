import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitTest, shipsInBox } from '../../public/games/driftworks/render/systemMap.js';

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
