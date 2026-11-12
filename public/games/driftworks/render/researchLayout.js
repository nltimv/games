// Lays out the research tree for the wide Research view (ui/panels/researchTree.js).
// Nothing is placed by hand: the positions follow from content/research.js,
// so a new research shows up in the right place on its own.
//
// - Columns: the tree splits into acts, side by side. A research is in the
//   act of its latest prerequisite, one act on when that prerequisite ends an
//   act (`endsAct`). Inside an act, a research sits one column right of its
//   prerequisites in the same act. Researches that end their act sit in its
//   last column, at the border with the next.
// - Rows: each line (Cargo racks, Fleet licences, ...) keeps one row across
//   every act, so a line reads left to right. Single researches fill the free
//   cells closest to their prerequisites.
// - Researches that wait for a number of hazard shieldings (`shields`) hang
//   off one junction node, so the three shieldings do not each draw a line to
//   every one of them.
//
// Pure data in, numbers out: no DOM, so it runs in tests.

import { RESEARCH, SHIELDINGS, prerequisites } from '../content/research.js';

export const NODE_W = 184;
export const NODE_H = 56;
const COL_GAP = 40;
const ROW_GAP = 16;
const BAND_PAD = 28;
const BAND_GAP = 24;
export const BAND_HEAD = 46;
const COL_W = NODE_W + COL_GAP;
const ROW_H = NODE_H + ROW_GAP;

/** The junction node for "needs N hazard shieldings". */
export const SHIELDING_HUB = 'shieldings';

/**
 * The tree's nodes, edges and act bands, in px. `research` defaults to the
 * game's list; tests pass their own.
 */
export function layoutResearch(research = RESEARCH, shieldings = SHIELDINGS) {
  const byId = new Map(research.map((r) => [r.id, r]));
  const needsHub = shieldings.length > 0 && research.some((r) => r.shields);
  const deps = new Map();
  for (const r of research) {
    const list = prerequisitesIn(r, research).filter((id) => byId.has(id));
    if (r.shields && needsHub) list.push(SHIELDING_HUB);
    deps.set(r.id, list);
  }
  const ids = research.map((r) => r.id);
  if (needsHub) {
    ids.push(SHIELDING_HUB);
    deps.set(SHIELDING_HUB, shieldings.map((r) => r.id));
  }
  const endsAct = (id) => byId.get(id)?.endsAct ?? null;

  // Acts and columns, in dependency order.
  const order = topoOrder(ids, deps);
  const act = new Map();
  const col = new Map();
  for (const id of order) {
    let a = 1;
    for (const d of deps.get(id)) a = Math.max(a, act.get(d) + (endsAct(d) ? 1 : 0));
    act.set(id, a);
    let c = 0;
    for (const d of deps.get(id)) if (act.get(d) === a) c = Math.max(c, col.get(d) + 1);
    col.set(id, c);
  }
  const acts = [...new Set(act.values())].sort((a, b) => a - b);
  const lastCol = new Map(acts.map((a) => [a, Math.max(...ids.filter((id) => act.get(id) === a).map((id) => col.get(id)))]));
  for (const id of ids) if (endsAct(id)) col.set(id, lastCol.get(act.get(id)));

  // Rows: a row per line with more than one level, in the order lines first
  // appear; then single researches, closest to their prerequisites.
  const lineCount = new Map();
  for (const r of research) if (r.line) lineCount.set(r.line, (lineCount.get(r.line) ?? 0) + 1);
  const lines = [...new Set(research.filter((r) => lineCount.get(r.line) > 1).map((r) => r.line))];
  const row = new Map();
  const taken = new Set();
  const cell = (id, r) => `${act.get(id)}:${col.get(id)}:${r}`;
  for (const r of research) {
    if (!lines.includes(r.line)) continue;
    row.set(r.id, lines.indexOf(r.line));
    taken.add(cell(r.id, row.get(r.id)));
  }
  const singles = ids
    .filter((id) => !row.has(id))
    .sort((a, b) => act.get(a) - act.get(b) || col.get(a) - col.get(b) || ids.indexOf(a) - ids.indexOf(b));
  for (const id of singles) {
    const placed = deps.get(id).filter((d) => row.has(d));
    const target = placed.length ? placed.reduce((sum, d) => sum + row.get(d), 0) / placed.length : 0;
    let best = null;
    for (let r = 0; r <= ids.length; r++) {
      if (taken.has(cell(id, r))) continue;
      if (best == null || Math.abs(r - target) < Math.abs(best - target)) best = r;
      if (r > target && best != null) break;
    }
    row.set(id, best);
    taken.add(cell(id, best));
  }
  // Rows nobody uses (a line that only has levels elsewhere) close up.
  const usedRows = [...new Set(row.values())].sort((a, b) => a - b);
  const rowIndex = new Map(usedRows.map((r, i) => [r, i]));

  // Pixels.
  const bands = [];
  let x = 0;
  for (const a of acts) {
    const cols = lastCol.get(a) + 1;
    const width = BAND_PAD * 2 + cols * COL_W - COL_GAP;
    bands.push({ act: a, x, width });
    x += width + BAND_GAP;
  }
  const width = x - BAND_GAP;
  const height = BAND_HEAD + usedRows.length * ROW_H - ROW_GAP + BAND_PAD;
  for (const band of bands) band.height = height;
  const bandOf = new Map(bands.map((b) => [b.act, b]));

  const nodes = ids.map((id) => ({
    id,
    hub: id === SHIELDING_HUB,
    act: act.get(id),
    col: col.get(id),
    row: rowIndex.get(row.get(id)),
    x: bandOf.get(act.get(id)).x + BAND_PAD + col.get(id) * COL_W,
    y: BAND_HEAD + rowIndex.get(row.get(id)) * ROW_H,
    w: NODE_W,
    h: NODE_H,
  }));
  const edges = [];
  for (const id of ids) for (const d of deps.get(id)) edges.push({ from: d, to: id });
  return { nodes, edges, bands, width, height };
}

// prerequisites() reads the game's RESEARCH; a test's own list needs its own lookup.
function prerequisitesIn(r, research) {
  if (research === RESEARCH) return prerequisites(r);
  if (r.needs) return r.needs;
  if (r.line && r.level > 1) return research.filter((o) => o.line === r.line && o.level === r.level - 1).map((o) => o.id);
  return [];
}

function topoOrder(ids, deps) {
  const seen = new Set();
  const out = [];
  const visit = (id, path = new Set()) => {
    if (seen.has(id)) return;
    if (path.has(id)) throw new Error(`Research ${id} needs itself.`);
    path.add(id);
    for (const d of deps.get(id) ?? []) visit(d, path);
    path.delete(id);
    seen.add(id);
    out.push(id);
  };
  for (const id of ids) visit(id);
  return out;
}
