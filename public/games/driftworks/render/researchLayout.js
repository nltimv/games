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
//   every act, so a line reads left to right. Single researches start in the
//   free cells closest to their prerequisites.
// - Researches that wait for a number of hazard shieldings (`shields`) hang
//   off one junction node, so the three shieldings do not each draw a line to
//   every one of them. A line that another path already implies is left out.
// - Single researches then move between free rows while that makes fewer
//   lines cross or run behind nodes (untangle()). Where one research leads to
//   several in one column, the view draws one trunk with branches.
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
  // A line that another path already implies is left out: Fleet command III
  // waits for the shieldings through Fleet command I and II too.
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (deps.get(from) ?? []).some((d) => reaches(d, to, seen));
  };
  for (const id of ids) {
    const list = deps.get(id);
    deps.set(id, list.filter((d) => !list.some((other) => other !== d && reaches(other, d))));
  }

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
  untangle(ids, deps, singles, row, (id) => acts.indexOf(act.get(id)), col, lastCol, acts);
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

/**
 * Moves single researches between the free rows of their column (or swaps
 * two) while that makes the tree cleaner: fewer lines crossing, fewer lines
 * running behind a node, shorter lines and fewer rows. A plain hill climb:
 * the tree is small, and the same data always gives the same tree.
 */
function untangle(ids, deps, singles, row, actIndex, col, lastCol, acts) {
  // A column position across the whole tree; the gap between acts counts as one more column.
  const offset = [];
  let sum = 0;
  for (const a of acts) {
    offset.push(sum);
    sum += lastCol.get(a) + 2;
  }
  const gx = new Map(ids.map((id) => [id, offset[actIndex(id)] + col.get(id)]));
  const edges = [];
  for (const id of ids) for (const d of deps.get(id)) edges.push([d, id]);
  const movable = new Set(singles);

  const cost = () => {
    const at = new Set(ids.map((id) => `${gx.get(id)}:${row.get(id)}`));
    const segs = edges.map(([a, b]) => ({ a, b, x1: gx.get(a) + 0.8, y1: row.get(a), x2: gx.get(b), y2: row.get(b) }));
    // Lines are drawn as S-curves, flat at both ends: smoothstep is close.
    const yAt = (s, x) => {
      const u = Math.min(1, Math.max(0, (x - s.x1) / (s.x2 - s.x1)));
      return s.y1 + (s.y2 - s.y1) * u * u * (3 - 2 * u);
    };
    let crossings = 0;
    let behind = 0;
    let length = 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      // A slanted line over several columns reads worse than a short one.
      length += Math.abs(s.y2 - s.y1) * (s.x2 - s.x1 > 1.5 ? 1.5 : 1);
      // Lines that run behind a node in a column they skip.
      for (let c = Math.ceil(s.x1); c < s.x2; c++) {
        const y = yAt(s, c + 0.4);
        if (Math.abs(y - Math.round(y)) < 0.5 && at.has(`${c}:${Math.round(y)}`)) behind++;
      }
      for (let j = i + 1; j < segs.length; j++) {
        const t = segs[j];
        if (s.a === t.a || s.b === t.b || s.a === t.b || s.b === t.a) continue;
        const lo = Math.max(s.x1, t.x1);
        const hi = Math.min(s.x2, t.x2);
        if (hi - lo <= 0) continue;
        if ((yAt(s, lo) - yAt(t, lo)) * (yAt(s, hi) - yAt(t, hi)) < 0) crossings++;
      }
    }
    const rows = Math.max(...ids.map((id) => row.get(id)));
    return crossings * 6 + behind * 8 + length + rows * 3;
  };

  // First, sweeps that sort each column's singles by where their neighbours
  // are (the usual barycentre pass), so the climb starts near a good tree.
  const neighbours = new Map(ids.map((id) => [id, []]));
  for (const [a, b] of edges) {
    neighbours.get(a).push(b);
    neighbours.get(b).push(a);
  }
  const columns = [...new Set(singles.map((id) => gx.get(id)))].sort((a, b) => a - b);
  const fixedRows = (c) => new Set(ids.filter((id) => gx.get(id) === c && !movable.has(id)).map((id) => row.get(id)));
  for (let sweep = 0; sweep < 6; sweep++) {
    const order = sweep % 2 ? [...columns].reverse() : columns;
    for (const c of order) {
      const here = singles.filter((id) => gx.get(id) === c);
      const bary = new Map(here.map((id) => {
        const ns = neighbours.get(id);
        return [id, ns.length ? ns.reduce((s, n) => s + row.get(n), 0) / ns.length : row.get(id)];
      }));
      here.sort((a, b) => bary.get(a) - bary.get(b) || row.get(a) - row.get(b));
      const fixed = fixedRows(c);
      const free = [];
      for (let r = 0; free.length < here.length + 3; r++) if (!fixed.has(r)) free.push(r);
      // Order-keeping match of the sorted singles to free rows, closest overall.
      const n = here.length;
      const m = free.length;
      const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
      for (let j = 0; j <= m; j++) dp[0][j] = 0;
      for (let i = 1; i <= n; i++) {
        for (let j = i; j <= m; j++) dp[i][j] = Math.min(dp[i][j - 1], dp[i - 1][j - 1] + Math.abs(bary.get(here[i - 1]) - free[j - 1]));
      }
      for (let i = n, j = m; i > 0; j--) {
        if (dp[i][j] === dp[i][j - 1] && j > i) continue;
        row.set(here[i - 1], free[j - 1]);
        i--;
      }
    }
  }

  let best = cost();
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (const id of singles) {
      const maxRow = Math.max(...ids.map((o) => row.get(o))) + 1;
      for (let r = 0; r <= maxRow; r++) {
        const from = row.get(id);
        if (r === from) continue;
        const other = ids.find((o) => o !== id && gx.get(o) === gx.get(id) && row.get(o) === r);
        if (other && !movable.has(other)) continue;
        row.set(id, r);
        if (other) row.set(other, from);
        const next = cost();
        if (next < best) {
          best = next;
          improved = true;
        } else {
          row.set(id, from);
          if (other) row.set(other, r);
        }
      }
    }
    if (!improved) break;
  }
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
