// Pipelines: connect matching dots until every cell is covered.
// Levels are generated procedurally and deterministically from the level
// number, so level N is always the same puzzle.
(function () {
  'use strict';

  const SIZE = 5;
  const CELL_COUNT = SIZE * SIZE;
  // Under the "no partial solution" filter only about 1% of 4-colour
  // candidates qualify (4% at 5 colours, 12% at 6), so the budget has to be
  // generous. At a 1% accept rate the chance of exhausting 5000 tries is
  // e^-50, i.e. it never happens in practice.
  const MAX_ATTEMPTS = 5000;
  const LEVEL_KEY = 'pipelines-level';
  const SOLVED_KEY = 'pipelines-solved';

  // Six hues that stay distinguishable against the hub's --bg (#0b0d14).
  const PALETTE = [
    '#ff4d4d',
    '#4dd0a4',
    '#4d9dff',
    '#ffd54d',
    '#c47dff',
    '#ff9d4d',
  ];
  const COLOR_NAMES = ['red', 'green', 'blue', 'yellow', 'purple', 'orange'];

  // ---------------------------------------------------------------- geometry

  // Flat adjacency table: NEIGHBOURS[cell * 4 + i] for i < NEIGHBOUR_COUNT[cell].
  const NEIGHBOURS = new Int32Array(CELL_COUNT * 4).fill(-1);
  const NEIGHBOUR_COUNT = new Int32Array(CELL_COUNT);

  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const row = (cell / SIZE) | 0;
    const col = cell % SIZE;
    let n = 0;
    if (row > 0) NEIGHBOURS[cell * 4 + n++] = cell - SIZE;
    if (row < SIZE - 1) NEIGHBOURS[cell * 4 + n++] = cell + SIZE;
    if (col > 0) NEIGHBOURS[cell * 4 + n++] = cell - 1;
    if (col < SIZE - 1) NEIGHBOURS[cell * 4 + n++] = cell + 1;
    NEIGHBOUR_COUNT[cell] = n;
  }

  function areAdjacent(a, b) {
    for (let i = 0; i < NEIGHBOUR_COUNT[a]; i += 1) {
      if (NEIGHBOURS[a * 4 + i] === b) return true;
    }
    return false;
  }

  // --------------------------------------------------------------------- rng

  function mix32(n) {
    let h = n | 0;
    h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --------------------------------------------------- hamiltonian path chain

  // A puzzle is built by carving one Hamiltonian path over all 25 cells into
  // contiguous segments, which makes full coverage true by construction.
  const hamPath = new Int32Array(CELL_COUNT);
  const hamPos = new Int32Array(CELL_COUNT);

  function initPath() {
    // Boustrophedon order (row 0 left to right, row 1 right to left, ...) is a
    // valid Hamiltonian path, so the chain always starts from a legal state.
    let i = 0;
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        const c = row % 2 === 0 ? col : SIZE - 1 - col;
        hamPath[i] = row * SIZE + c;
        i += 1;
      }
    }
    for (let k = 0; k < CELL_COUNT; k += 1) hamPos[hamPath[k]] = k;
  }

  function reversePrefix(end) {
    let lo = 0;
    let hi = end - 1;
    while (lo < hi) {
      const tmp = hamPath[lo];
      hamPath[lo] = hamPath[hi];
      hamPath[hi] = tmp;
      hamPos[hamPath[lo]] = lo;
      hamPos[hamPath[hi]] = hi;
      lo += 1;
      hi -= 1;
    }
    if (lo === hi) hamPos[hamPath[lo]] = lo;
  }

  // The "backbite" move: pick a neighbour u of the head, then reverse the
  // prefix ending just before u. The head lands next to u, so the result is
  // always another valid Hamiltonian path -- no backtracking and no failure
  // case, unlike a DFS search which on a 5x5 grid also has to respect the
  // bipartite parity of the endpoints.
  function backbite(rnd, steps) {
    for (let s = 0; s < steps; s += 1) {
      if (rnd() < 0.5) reversePrefix(CELL_COUNT); // let the far end move too
      const head = hamPath[0];
      const pick = (rnd() * NEIGHBOUR_COUNT[head]) | 0;
      const u = NEIGHBOURS[head * 4 + pick];
      const j = hamPos[u];
      if (j < 2) continue; // u is already hamPath[1]; the move is a no-op
      reversePrefix(j);
    }
  }

  // ----------------------------------------------------------------- cutting

  // Uniform composition of CELL_COUNT into `count` parts of at least `minLen`.
  // Choosing distinct dividers out of the slack keeps long segments reasonably
  // likely; splitting the slack per-part instead would equalise the lengths.
  function cutLengths(count, minLen, rnd) {
    const poolSize = CELL_COUNT - count * minLen + count - 1;
    const pool = [];
    for (let i = 0; i < poolSize; i += 1) pool.push(i + 1);
    for (let i = 0; i < count - 1; i += 1) {
      const j = i + ((rnd() * (poolSize - i)) | 0);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    const cuts = pool.slice(0, count - 1).sort((a, b) => a - b);

    const lens = [];
    let prev = 0;
    for (let i = 0; i < count - 1; i += 1) {
      lens.push(minLen + (cuts[i] - prev - 1));
      prev = cuts[i];
    }
    lens.push(minLen + (poolSize - prev));
    return lens;
  }

  function cutSegments(lens) {
    const segments = [];
    let offset = 0;
    for (let i = 0; i < lens.length; i += 1) {
      const seg = [];
      for (let k = 0; k < lens[i]; k += 1) seg.push(hamPath[offset + k]);
      segments.push(seg);
      offset += lens[i];
    }
    return segments;
  }

  // ------------------------------------------------------------------ solver

  // Exhaustive DFS that counts routings, capped at 2 -- all we need to know is
  // whether the puzzle has no, exactly one, or several solutions.
  //
  // Every routing that connects all pairs counts, *including* ones that leave
  // cells empty. That is the property real Flow puzzles have: there is no way
  // to join every pair except the one that also fills the board, so a player
  // can never strand a gap. Counting only full-coverage routings would let
  // through puzzles solvable at, say, 92% fill, which reads as a broken level.
  //
  // Pruning (dead-end degree and stranded-region checks) is correct but
  // measurably slower than plain search at only 25 cells; add it if the grid
  // ever grows.
  const solverBoard = new Int8Array(CELL_COUNT);
  let solverEndA = null;
  let solverEndB = null;
  let solverColors = 0;
  let solverCount = 0;

  function solverExtend(color, head) {
    const base = head * 4;
    const target = solverEndB[color];
    for (let i = 0; i < NEIGHBOUR_COUNT[head]; i += 1) {
      const next = NEIGHBOURS[base + i];
      if (next === target) {
        // Every dot cell is pre-coloured, so this is the only way into an
        // endpoint: no path can ever run *through* a dot, its own or another's.
        if (color + 1 === solverColors) {
          solverCount += 1;
        } else {
          solverExtend(color + 1, solverEndA[color + 1]);
        }
      } else if (solverBoard[next] === -1) {
        solverBoard[next] = color;
        solverExtend(color, next);
        solverBoard[next] = -1;
      }
      // The cap has to bail out at every level, not just the top: rejected
      // candidates can otherwise enumerate dozens of solutions for nothing.
      if (solverCount >= 2) return;
    }
  }

  function countSolutions(endA, endB) {
    solverEndA = endA;
    solverEndB = endB;
    solverColors = endA.length;
    solverBoard.fill(-1);
    for (let c = 0; c < solverColors; c += 1) {
      solverBoard[endA[c]] = c;
      solverBoard[endB[c]] = c;
    }
    solverCount = 0;
    solverExtend(0, endA[0]);
    return solverCount;
  }

  // -------------------------------------------------------------- generation

  function difficultyFor(level) {
    if (level <= 3) return { colors: 6, minLen: 3 };
    if (level <= 9) return { colors: 5, minLen: 4 };
    // Counter-intuitively, fewer colours is harder: with full coverage forced,
    // fewer colours means longer paths and more routing freedom. So mix the
    // 4-colour boards in as the spikes rather than ramping down past them.
    return { colors: level % 3 === 0 ? 4 : 5, minLen: 4 };
  }

  function generate(level) {
    const rnd = mulberry32(mix32(level));
    const difficulty = difficultyFor(level);
    initPath();
    backbite(rnd, 300);

    let fallback = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      backbite(rnd, 60);
      const segments = cutSegments(cutLengths(difficulty.colors, difficulty.minLen, rnd));
      // Shuffle which palette colour each segment gets, otherwise the chain
      // order shows up as "red always sits next to orange".
      const order = [];
      for (let i = 0; i < segments.length; i += 1) order.push(i);
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = (rnd() * (i + 1)) | 0;
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
      }
      const solution = order.map((i) => segments[i]);

      const endA = solution.map((seg) => seg[0]);
      const endB = solution.map((seg) => seg[seg.length - 1]);
      const found = countSolutions(endA, endB);
      const puzzle = { level: level, colors: difficulty.colors, endA: endA, endB: endB, solution: solution };
      if (found === 1) return puzzle;
      if (!fallback) fallback = puzzle;
    }
    // Unreachable in practice (see MAX_ATTEMPTS). The segments are a valid
    // full-coverage solution by construction, so even this path yields a
    // level that can be completed -- just not one that forces full coverage.
    return fallback;
  }

  // ------------------------------------------------------------ player state

  const HINTS_PER_LEVEL = 2;

  let puzzle = null;
  let dotColor = new Int8Array(CELL_COUNT); // colour at dot cells, -1 elsewhere
  let owner = new Int8Array(CELL_COUNT); // colour of the drawn pipe, -1 if bare
  // While a pipe is being dragged it may pass over cells belonging to other
  // colours without destroying them; displaced[cell] remembers who held the
  // cell so backing off restores it, and the real cut is applied on release.
  let displaced = new Int8Array(CELL_COUNT);
  let paths = []; // ordered cells per colour; [] until the player starts one
  let activeColor = -1;
  let lastMovedColor = -1;
  let moves = 0;
  let hintsLeft = HINTS_PER_LEVEL;
  let undoStack = [];
  let solved = false;
  let level = 1;
  let totalSolved = 0;

  function loadPuzzle(nextLevel) {
    level = nextLevel;
    puzzle = generate(level);
    dotColor.fill(-1);
    for (let c = 0; c < puzzle.endA.length; c += 1) {
      dotColor[puzzle.endA[c]] = c;
      dotColor[puzzle.endB[c]] = c;
    }
    resetPaths();
    writeStorage(LEVEL_KEY, String(level));
  }

  function resetPaths() {
    owner.fill(-1);
    displaced.fill(-1);
    paths = puzzle.endA.map(() => []);
    activeColor = -1;
    lastMovedColor = -1;
    moves = 0;
    hintsLeft = HINTS_PER_LEVEL;
    undoStack = [];
    solved = false;
    hideOverlay();
    refresh();
  }

  function otherEnd(color, cell) {
    return puzzle.endA[color] === cell ? puzzle.endB[color] : puzzle.endA[color];
  }

  function isComplete(color) {
    const p = paths[color];
    if (p.length < 2) return false;
    if (p[p.length - 1] !== otherEnd(color, p[0])) return false;
    // A pipe an in-flight drag is currently crossing still owns its array but
    // not all its cells; it only counts as connected while it is intact.
    for (let i = 0; i < p.length; i += 1) if (owner[p[i]] !== color) return false;
    return true;
  }

  // Give a cell back to whoever the active drag borrowed it from.
  function releaseCell(cell) {
    owner[cell] = displaced[cell];
    displaced[cell] = -1;
  }

  function claimCell(cell, color) {
    if (owner[cell] >= 0 && owner[cell] !== color) displaced[cell] = owner[cell];
    owner[cell] = color;
  }

  function truncate(color, keep) {
    const p = paths[color];
    for (let i = keep; i < p.length; i += 1) {
      if (owner[p[i]] === color) releaseCell(p[i]);
    }
    p.length = keep;
  }

  // ------------------------------------------------------------------- undo

  function pushUndo() {
    // useHint() pushes before spending, so the snapshot always holds the
    // pre-hint budget and undoing a hint hands it back.
    undoStack.push({
      paths: paths.map((p) => p.slice()),
      moves: moves,
      lastMovedColor: lastMovedColor,
      hintsLeft: hintsLeft,
    });
    if (undoStack.length > 64) undoStack.shift();
  }

  function undo() {
    if (solved || !undoStack.length) return;
    const state = undoStack.pop();
    paths = state.paths.map((p) => p.slice());
    moves = state.moves;
    lastMovedColor = state.lastMovedColor;
    hintsLeft = state.hintsLeft;
    activeColor = -1;
    owner.fill(-1);
    displaced.fill(-1);
    for (let c = 0; c < paths.length; c += 1) {
      for (let i = 0; i < paths[c].length; i += 1) owner[paths[c][i]] = c;
    }
    refresh();
  }

  // Starting to work on a pipe. Re-grabbing the pipe you just drew continues
  // the same move rather than counting a new one, so nudging a pipe into
  // shape does not inflate the counter -- and undo steps back over the whole
  // sequence of touches as one unit.
  function startMove(color) {
    if (color === lastMovedColor) return;
    pushUndo();
    moves += 1;
    lastMovedColor = color;
  }

  function beginAt(cell) {
    if (solved) return false;
    // Settle any gesture still open (e.g. a pipe picked up with the keyboard
    // and then grabbed with the pointer) so deferred cuts never leak across.
    if (activeColor >= 0) commitGesture();
    const dot = dotColor[cell];
    if (dot >= 0) {
      startMove(dot);
      // Grabbing a dot always restarts that colour from scratch.
      truncate(dot, 0);
      paths[dot].push(cell);
      claimCell(cell, dot);
      activeColor = dot;
      return true;
    }
    if (owner[cell] >= 0) {
      const color = owner[cell];
      startMove(color);
      truncate(color, paths[color].indexOf(cell) + 1);
      activeColor = color;
      return true;
    }
    return false;
  }

  // Apply the cuts that were deferred while the pipe was being dragged.
  function commitGesture() {
    if (activeColor < 0) return;
    displaced.fill(-1);
    for (let c = 0; c < paths.length; c += 1) {
      if (c === activeColor) continue;
      const p = paths[c];
      for (let i = 0; i < p.length; i += 1) {
        if (owner[p[i]] === c) continue;
        // The active pipe took this cell, so cut here and free the rest.
        for (let k = i; k < p.length; k += 1) {
          if (owner[p[k]] === c) owner[p[k]] = -1;
        }
        p.length = i;
        break;
      }
    }
    activeColor = -1;
  }

  // ------------------------------------------------------------------- hint

  function matchesSolution(color) {
    const p = paths[color];
    const seg = puzzle.solution[color];
    if (p.length !== seg.length) return false;
    let forward = true;
    let backward = true;
    for (let i = 0; i < seg.length; i += 1) {
      if (p[i] !== seg[i]) forward = false;
      if (p[i] !== seg[seg.length - 1 - i]) backward = false;
    }
    return forward || backward;
  }

  function useHint() {
    if (solved || hintsLeft <= 0) return;
    let target = -1;
    for (let c = 0; c < paths.length; c += 1) {
      if (!matchesSolution(c)) { target = c; break; }
    }
    if (target < 0) return;

    commitGesture();
    // A hint is always its own move and its own undo step, whatever the
    // player happened to be touching beforehand.
    pushUndo();
    moves += 1;

    const seg = puzzle.solution[target];
    truncate(target, 0);
    for (let i = 0; i < seg.length; i += 1) {
      const holder = owner[seg[i]];
      if (holder >= 0 && holder !== target) {
        truncate(holder, Math.max(0, paths[holder].indexOf(seg[i])));
      }
    }
    paths[target] = seg.slice();
    for (let i = 0; i < seg.length; i += 1) owner[seg[i]] = target;

    hintsLeft -= 1;
    lastMovedColor = -1; // the next touch is always a new move
    refresh();
  }

  // One orthogonal step of the active pipe. Returns true when the head moved.
  function tryStep(color, next) {
    const p = paths[color];
    const head = p[p.length - 1];
    if (!areAdjacent(head, next)) return false;

    // Dragging back the way you came retracts, even on a finished pipe.
    if (p.length >= 2 && p[p.length - 2] === next) {
      releaseCell(head);
      p.pop();
      return true;
    }
    if (p[p.length - 1] === otherEnd(color, p[0]) && p.length >= 2) return false;

    const dot = dotColor[next];
    if (dot >= 0) {
      if (dot !== color) return false; // another colour's dot is a wall
      if (next === p[0]) return false; // our own start dot: would close a loop
      p.push(next);
      claimCell(next, color);
      return true;
    }

    const selfIndex = p.indexOf(next);
    if (selfIndex >= 0) {
      // Crossing our own pipe cuts it back to the crossing point.
      truncate(color, selfIndex + 1);
      return true;
    }

    // Crossing another colour is allowed to pass straight over it. The pipe
    // underneath stays whole until the pointer is released (commitGesture),
    // so brushing across a finished pipe mid-drag no longer destroys it.
    p.push(next);
    claimCell(next, color);
    return true;
  }

  // Pointer moves can skip cells on a fast drag, so walk toward the target one
  // orthogonal step at a time rather than dropping the input.
  function stepToward(cell) {
    if (activeColor < 0) return;
    for (let guard = 0; guard < CELL_COUNT; guard += 1) {
      const p = paths[activeColor];
      const head = p[p.length - 1];
      if (head === cell) break;
      const dRow = ((cell / SIZE) | 0) - ((head / SIZE) | 0);
      const dCol = (cell % SIZE) - (head % SIZE);
      // head !== cell here, so the larger delta is always non-zero.
      const next =
        Math.abs(dCol) >= Math.abs(dRow)
          ? head + Math.sign(dCol)
          : head + Math.sign(dRow) * SIZE;
      if (!tryStep(activeColor, next)) break;
    }
    refresh();
  }

  function filledCells() {
    let n = 0;
    for (let i = 0; i < CELL_COUNT; i += 1) if (owner[i] >= 0) n += 1;
    return n;
  }

  function connectedCount() {
    let n = 0;
    for (let c = 0; c < paths.length; c += 1) if (isComplete(c)) n += 1;
    return n;
  }

  // The win condition is a rule, not a comparison against the stored solution:
  // a level that exhausted the generator's budget has more than one solution.
  function checkWin() {
    if (solved) return;
    if (connectedCount() !== paths.length) return;
    if (filledCells() !== CELL_COUNT) return;
    solved = true;
    totalSolved += 1;
    writeStorage(SOLVED_KEY, String(totalSolved));
    showOverlay(
      'Level ' + level + ' solved in ' + moves + ' move' + (moves === 1 ? '' : 's') +
        '. ' + totalSolved + ' cleared in total.'
    );
  }

  // ------------------------------------------------------------------ storage

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null; // private mode and blocked storage should not break the game
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* ignore */
    }
  }

  function readInt(key, fallback, min) {
    const parsed = Number.parseInt(readStorage(key) || '', 10);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
  }

  // ------------------------------------------------------------------ dom/ui

  if (typeof document === 'undefined') {
    // Loaded outside a browser (the generator test harness); skip the UI.
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { generate: generate, countSolutions: countSolutions, difficultyFor: difficultyFor, SIZE: SIZE };
    }
    return;
  }

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const keyLayer = document.getElementById('keys');
  const levelEl = document.getElementById('level');
  const movesEl = document.getElementById('moves');
  const flowsEl = document.getElementById('flows');
  const fillEl = document.getElementById('fill');
  const overlay = document.getElementById('overlay');
  const overlayMessage = document.getElementById('overlay-message');
  const startBtn = document.getElementById('start-btn');
  const resetBtn = document.getElementById('reset-btn');
  const hintBtn = document.getElementById('hint-btn');
  const undoBtn = document.getElementById('undo-btn');

  let cssSize = 0;
  let cellSize = 0;
  let focusIndex = 0;

  const keys = [];
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.cell = String(cell);
    btn.tabIndex = cell === 0 ? 0 : -1;
    keyLayer.appendChild(btn);
    keys.push(btn);
  }

  function showOverlay(message) {
    overlayMessage.textContent = message;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  // ---------------------------------------------------------------- rendering

  function centreX(cell) {
    return (cell % SIZE) * cellSize + cellSize / 2;
  }

  function centreY(cell) {
    return ((cell / SIZE) | 0) * cellSize + cellSize / 2;
  }

  function draw() {
    if (!puzzle || !cellSize) return;
    ctx.clearRect(0, 0, cssSize, cssSize);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < SIZE; i += 1) {
      const at = Math.round(i * cellSize) + 0.5;
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at, cssSize);
      ctx.moveTo(0, at);
      ctx.lineTo(cssSize, at);
      ctx.stroke();
    }

    // Pipes are polylines through cell centres. Filling whole cells instead
    // would turn the legal diagonal self-contact into a staircase blob, and
    // keeping the stroke well under the cell size lets two parallel runs of
    // the same colour stay readable as two separate pipes.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = cellSize * 0.34;
    // The dragged pipe draws last so it rides over anything it is crossing --
    // the pipe underneath is still whole until the pointer is released.
    for (let c = 0; c < paths.length; c += 1) if (c !== activeColor) drawPipe(c);
    if (activeColor >= 0) drawPipe(activeColor);
    ctx.globalAlpha = 1;

    for (let c = 0; c < paths.length; c += 1) {
      ctx.fillStyle = PALETTE[c];
      drawDot(puzzle.endA[c]);
      drawDot(puzzle.endB[c]);
    }

    if (activeColor >= 0) {
      const p = paths[activeColor];
      const head = p[p.length - 1];
      ctx.strokeStyle = '#eef0f5';
      ctx.lineWidth = Math.max(1.5, cellSize * 0.05);
      ctx.beginPath();
      ctx.arc(centreX(head), centreY(head), cellSize * 0.28, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPipe(color) {
    const p = paths[color];
    if (p.length < 2) return;
    ctx.strokeStyle = PALETTE[color];
    ctx.globalAlpha = isComplete(color) ? 1 : 0.75;
    ctx.beginPath();
    ctx.moveTo(centreX(p[0]), centreY(p[0]));
    for (let i = 1; i < p.length; i += 1) ctx.lineTo(centreX(p[i]), centreY(p[i]));
    ctx.stroke();
  }

  function drawDot(cell) {
    ctx.beginPath();
    ctx.arc(centreX(cell), centreY(cell), cellSize * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  function describe(cell) {
    const row = ((cell / SIZE) | 0) + 1;
    const col = (cell % SIZE) + 1;
    let what = 'empty';
    if (dotColor[cell] >= 0) {
      what = COLOR_NAMES[dotColor[cell]] + ' dot';
      if (owner[cell] >= 0 && isComplete(dotColor[cell])) what += ', connected';
    } else if (owner[cell] >= 0) {
      what = COLOR_NAMES[owner[cell]] + ' pipe';
    }
    return 'Row ' + row + ', column ' + col + ', ' + what;
  }

  function refresh() {
    draw();
    levelEl.textContent = String(level);
    movesEl.textContent = String(moves);
    flowsEl.textContent = connectedCount() + '/' + paths.length;
    fillEl.textContent = Math.round((filledCells() / CELL_COUNT) * 100) + '%';
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      keys[cell].setAttribute('aria-label', describe(cell));
    }
    hintBtn.textContent = 'Hint (' + hintsLeft + ')';
    hintBtn.disabled = solved || hintsLeft === 0;
    undoBtn.disabled = solved || undoStack.length === 0;
    checkWin();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    cssSize = rect.width;
    cellSize = cssSize / SIZE;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  // ------------------------------------------------------------------- input

  function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * SIZE);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * SIZE);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return -1;
    return row * SIZE + col;
  }

  canvas.addEventListener('pointerdown', (event) => {
    const cell = cellFromEvent(event);
    if (cell < 0) return;
    event.preventDefault();
    if (beginAt(cell)) {
      canvas.setPointerCapture(event.pointerId);
      focusCell(cell, false);
      refresh();
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (activeColor < 0) return;
    const cell = cellFromEvent(event);
    if (cell < 0) return;
    event.preventDefault();
    stepToward(cell);
  });

  function endPointer(event) {
    if (activeColor < 0) return;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    commitGesture();
    refresh();
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // --------------------------------------------------------------- keyboard

  function focusCell(cell, moveFocus) {
    keys[focusIndex].tabIndex = -1;
    focusIndex = cell;
    keys[focusIndex].tabIndex = 0;
    if (moveFocus !== false) keys[focusIndex].focus();
  }

  const ARROWS = {
    ArrowUp: -SIZE,
    ArrowDown: SIZE,
    ArrowLeft: -1,
    ArrowRight: 1,
  };

  keyLayer.addEventListener('keydown', (event) => {
    const cell = Number(event.target.dataset.cell);
    if (!Number.isInteger(cell)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeColor >= 0) {
        commitGesture();
      } else {
        beginAt(cell);
      }
      refresh();
      return;
    }

    if (event.key === 'Escape') {
      if (activeColor < 0) return;
      event.preventDefault();
      commitGesture();
      refresh();
      return;
    }

    const delta = ARROWS[event.key];
    if (delta === undefined) return;
    const next = cell + delta;
    // Guard the horizontal wrap that a flat index would otherwise allow.
    if (next < 0 || next >= CELL_COUNT) return;
    if (Math.abs(delta) === 1 && ((next / SIZE) | 0) !== ((cell / SIZE) | 0)) return;
    event.preventDefault();

    if (activeColor >= 0) {
      // A successful step always leaves the head on `next`, whether it
      // extended, retracted or cut a pipe back.
      if (tryStep(activeColor, next)) {
        // Finishing a pipe drops it, so keyboard play commits its pending
        // cuts (and can win) without needing a separate Enter press.
        if (isComplete(activeColor)) commitGesture();
        focusCell(next);
        refresh();
      }
      return;
    }
    focusCell(next);
  });

  // ------------------------------------------------------------------- boot

  startBtn.addEventListener('click', () => {
    loadPuzzle(level + 1);
    focusCell(0, false);
  });

  hintBtn.addEventListener('click', useHint);
  undoBtn.addEventListener('click', undo);

  resetBtn.addEventListener('click', () => {
    resetPaths();
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }

  totalSolved = readInt(SOLVED_KEY, 0, 0);
  loadPuzzle(readInt(LEVEL_KEY, 1, 1));
  resize();

  // Handy from the browser console, and used by the generator test harness.
  window.pipelinesDebug = {
    generate: generate,
    countSolutions: countSolutions,
    difficultyFor: difficultyFor,
    SIZE: SIZE,
  };
})();
