import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESEARCH, prerequisites } from '../../public/games/driftworks/content/research.js';
import { layoutResearch, SHIELDING_HUB } from '../../public/games/driftworks/render/researchLayout.js';

const byId = (layout) => new Map(layout.nodes.map((n) => [n.id, n]));

test('every research gets a place in the tree, and no two overlap', () => {
  const layout = layoutResearch();
  const nodes = byId(layout);
  for (const r of RESEARCH) assert.ok(nodes.has(r.id), `${r.id} is placed`);
  const cells = new Set(layout.nodes.map((n) => `${n.x},${n.y}`));
  assert.equal(cells.size, layout.nodes.length);
  for (const n of layout.nodes) {
    assert.ok(n.x >= 0 && n.x + n.w <= layout.width, `${n.id} fits across`);
    assert.ok(n.y >= 0 && n.y + n.h <= layout.height, `${n.id} fits down`);
  }
});

test('prerequisites sit to the left, and lines read along one row', () => {
  const layout = layoutResearch();
  const nodes = byId(layout);
  for (const r of RESEARCH) for (const id of prerequisites(r)) assert.ok(nodes.get(id).x < nodes.get(r.id).x, `${id} is left of ${r.id}`);
  for (const line of ['hold', 'licence', 'queue', 'laser']) {
    const rows = new Set(RESEARCH.filter((r) => r.line === line).map((r) => nodes.get(r.id).y));
    assert.equal(rows.size, 1, `${line} stays in one row`);
  }
});

test('the tree splits into acts at the warp drive and the hazard shieldings', () => {
  const nodes = byId(layoutResearch());
  assert.equal(nodes.get('hold-5').act, 1);
  assert.equal(nodes.get('warp-drive').act, 1);
  assert.equal(nodes.get('market-charts').act, 2);
  assert.equal(nodes.get('shield-ion').act, 2);
  assert.equal(nodes.get(SHIELDING_HUB).act, 3);
  assert.equal(nodes.get('fleet-1').act, 3);
  assert.equal(nodes.get('station-blueprints').act, 3);
  // The act enders sit at the border with the next act.
  const lastAct1 = Math.max(...[...nodes.values()].filter((n) => n.act === 1).map((n) => n.col));
  assert.equal(nodes.get('warp-drive').col, lastAct1);
});

test('a new research finds its own place', () => {
  const research = [
    { id: 'a-1', name: 'A I', line: 'a', level: 1 },
    { id: 'a-2', name: 'A II', line: 'a', level: 2 },
    { id: 'gate', name: 'Gate', needs: ['a-2'], endsAct: 1 },
    { id: 'late', name: 'Late', needs: ['gate'] },
    { id: 'late-2', name: 'Late II', needs: ['late', 'a-2'] },
  ];
  const layout = layoutResearch(research, []);
  const nodes = byId(layout);
  assert.equal(layout.bands.length, 2);
  assert.equal(nodes.get('late').act, 2);
  assert.equal(nodes.get('late-2').col, nodes.get('late').col + 1);
  assert.equal(nodes.get('a-1').y, nodes.get('a-2').y);
});

test('lines another path implies are left out, and fans sit next to each other', () => {
  const layout = layoutResearch();
  const nodes = byId(layout);
  const has = (from, to) => layout.edges.some((e) => e.from === from && e.to === to);
  assert.ok(has(SHIELDING_HUB, 'fleet-1'));
  assert.ok(!has(SHIELDING_HUB, 'fleet-3'), 'Fleet command III waits for the shieldings through Fleet command I');
  assert.ok(has('fleet-2', 'fleet-3'));
  // Lane charts and Jump drive I both lead to every shielding: they sit side by side, the shieldings next to them.
  assert.equal(Math.abs(nodes.get('lane-charts').row - nodes.get('jump-1').row), 1);
  const rows = ['shield-debris', 'shield-ion', 'shield-radiation'].map((id) => nodes.get(id).row).sort((a, b) => a - b);
  assert.equal(rows[2] - rows[0], 2);
});
