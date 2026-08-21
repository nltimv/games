// Pipelines: connect matching dots until every cell is covered.
// Levels are generated procedurally and deterministically from the level
// number, so level N is always the same puzzle.
(function () {
  'use strict';

  // Boards run from 5x5 up to 12x12 and the size is part of the level, so
  // everything that depends on the geometry is rebuilt per puzzle instead of
  // being baked in as a constant.
  const MIN_SIZE = 5;
  const MAX_SIZE = 12;
  const SIZE_SPAN = MAX_SIZE - MIN_SIZE + 1;
  const MAX_CELLS = MAX_SIZE * MAX_SIZE;

  let size = MIN_SIZE;
  let cellCount = size * size;

  const LEVEL_KEY = 'pipelines-level';
  const SOLVED_KEY = 'pipelines-solved';

  // Sixteen hues that stay distinguishable against the hub's --bg (#0b0d14).
  // A level uses the first `colors` of them, so the order runs most-separated
  // first: a 5x5 gets the six the game shipped with, and only the biggest
  // boards reach the entries that need a second look to tell apart.
  const PALETTE = [
    '#ff4d4d',
    '#4dd0a4',
    '#4d9dff',
    '#ffd54d',
    '#c47dff',
    '#ff9d4d',
    '#ff6fb5',
    '#3fe0e0',
    '#a8e34d',
    '#e8edf5',
    '#d9a066',
    '#7fd6ff',
    '#ff5ce0',
    '#2fa89b',
    '#6f6bff',
    '#8fa4c8',
  ];
  const COLOR_NAMES = [
    'red',
    'green',
    'blue',
    'yellow',
    'purple',
    'orange',
    'pink',
    'cyan',
    'lime',
    'white',
    'tan',
    'sky',
    'magenta',
    'teal',
    'indigo',
    'slate',
  ];
  const MAX_COLORS = PALETTE.length;

  // ---------------------------------------------------------------- geometry

  // Flat adjacency table: NEIGHBOURS[cell * 4 + i] for i < NEIGHBOUR_COUNT[cell].
  // Both are allocated for the biggest board and refilled on every size change,
  // so no generation-time allocation happens per level.
  const NEIGHBOURS = new Int32Array(MAX_CELLS * 4).fill(-1);
  const NEIGHBOUR_COUNT = new Int32Array(MAX_CELLS);

  function setSize(next) {
    size = next;
    cellCount = next * next;
    NEIGHBOURS.fill(-1);
    for (let cell = 0; cell < cellCount; cell += 1) {
      const row = (cell / size) | 0;
      const col = cell % size;
      let n = 0;
      if (row > 0) NEIGHBOURS[cell * 4 + n++] = cell - size;
      if (row < size - 1) NEIGHBOURS[cell * 4 + n++] = cell + size;
      if (col > 0) NEIGHBOURS[cell * 4 + n++] = cell - 1;
      if (col < size - 1) NEIGHBOURS[cell * 4 + n++] = cell + 1;
      NEIGHBOUR_COUNT[cell] = n;
    }
  }

  setSize(MIN_SIZE);

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

  // A puzzle is built by carving one Hamiltonian path over every cell into
  // contiguous segments, which makes full coverage true by construction.
  const hamPath = new Int32Array(MAX_CELLS);
  const hamPos = new Int32Array(MAX_CELLS);

  function initPath() {
    // Boustrophedon order (row 0 left to right, row 1 right to left, ...) is a
    // valid Hamiltonian path, so the chain always starts from a legal state.
    let i = 0;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const c = row % 2 === 0 ? col : size - 1 - col;
        hamPath[i] = row * size + c;
        i += 1;
      }
    }
    for (let k = 0; k < cellCount; k += 1) hamPos[hamPath[k]] = k;
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
  // case, unlike a DFS search which on an odd-sided grid also has to respect
  // the bipartite parity of the endpoints.
  function backbite(rnd, steps) {
    for (let s = 0; s < steps; s += 1) {
      if (rnd() < 0.5) reversePrefix(cellCount); // let the far end move too
      const head = hamPath[0];
      const pick = (rnd() * NEIGHBOUR_COUNT[head]) | 0;
      const u = NEIGHBOURS[head * 4 + pick];
      const j = hamPos[u];
      if (j < 2) continue; // u is already hamPath[1]; the move is a no-op
      reversePrefix(j);
    }
  }

  // ----------------------------------------------------------------- cutting

  // Where the chain gets cut decides the whole character of the puzzle. The
  // thing to avoid is a pipe running alongside itself: two cells of one pipe
  // side by side without being consecutive means the player can cut the corner
  // between them, so the pair has a second, shorter route and the puzzle stops
  // being forced. Random cuts produce these constantly on anything past a 5x5,
  // so rather than generating and rejecting, the cut is *chosen* to minimise
  // them: a small dynamic program over the chain finds the split into exactly
  // `count` pieces of length [minLen, maxLen] with the fewest such touches.
  //
  // dpCost[j][e] is the best total for splitting the first e chain cells into
  // j pipes, and dpFrom[j][e] remembers where the last piece started so the
  // segments can be read back.
  const segCost = new Float64Array(MAX_CELLS * (MAX_CELLS + 1));
  // Which cells the piece being measured covers. Stamped with a counter that
  // only ever goes up, so a piece never picks up marks left by an earlier one
  // -- stamping with the start index would collide on the very next chain.
  const segSeen = new Float64Array(MAX_CELLS);
  let segStamp = 0;
  const dpCost = [];
  const dpFrom = [];
  for (let j = 0; j <= MAX_COLORS; j += 1) {
    dpCost.push(new Float64Array(MAX_CELLS + 1));
    dpFrom.push(new Int32Array(MAX_CELLS + 1));
  }
  const UNREACHABLE = Infinity;

  function cutChain(count, minLen, maxLen, rnd) {
    const stride = maxLen + 1;
    // Touches inside one piece, counted as it grows: a cell that already has
    // two neighbours in the piece adds one touch on top of its predecessor.
    for (let start = 0; start < cellCount; start += 1) {
      let touches = 0;
      segStamp += 1;
      const limit = Math.min(maxLen, cellCount - start);
      for (let len = 1; len <= limit; len += 1) {
        const cell = hamPath[start + len - 1];
        const base = cell * 4;
        let seen = 0;
        for (let i = 0; i < NEIGHBOUR_COUNT[cell]; i += 1) {
          if (segSeen[NEIGHBOURS[base + i]] === segStamp) seen += 1;
        }
        if (len > 1) touches += seen - 1;
        segSeen[cell] = segStamp;
        // The jitter is small enough that the sum over all the pieces stays
        // below one touch, so it only ever breaks ties -- which it must, or
        // every level of a given size would be cut the same way.
        segCost[start * stride + len] =
          len < minLen ? UNREACHABLE : touches + rnd() * (0.5 / count);
      }
      for (let len = limit + 1; len <= maxLen; len += 1) {
        segCost[start * stride + len] = UNREACHABLE;
      }
    }

    for (let end = 0; end <= cellCount; end += 1) dpCost[0][end] = UNREACHABLE;
    dpCost[0][0] = 0;
    for (let j = 1; j <= count; j += 1) {
      for (let end = 0; end <= cellCount; end += 1) {
        let best = UNREACHABLE;
        let bestStart = -1;
        for (let len = minLen; len <= maxLen && len <= end; len += 1) {
          const start = end - len;
          const total = dpCost[j - 1][start] + segCost[start * stride + len];
          if (total < best) {
            best = total;
            bestStart = start;
          }
        }
        dpCost[j][end] = best;
        dpFrom[j][end] = bestStart;
      }
    }
    if (dpCost[count][cellCount] === UNREACHABLE) return null;

    const segments = [];
    let end = cellCount;
    for (let j = count; j >= 1; j -= 1) {
      const start = dpFrom[j][end];
      const seg = [];
      for (let k = start; k < end; k += 1) seg.push(hamPath[k]);
      segments.push(seg);
      end = start;
    }
    segments.reverse();
    // The jitter sums to less than 1, so flooring recovers the real count.
    return { segments: segments, touches: Math.floor(dpCost[count][cellCount]) };
  }

  // ------------------------------------------------------------------ solver

  // Exhaustive DFS that counts routings, capped at 2 -- all we need to know is
  // whether the puzzle has no, exactly one, or several solutions. It runs in
  // one of two modes:
  //
  //  * Strict (solverFull false) counts every routing that connects all pairs,
  //    *including* ones that leave cells empty. That is the property real Flow
  //    puzzles have: there is no way to join every pair except the one that
  //    also fills the board, so a player can never strand a gap.
  //  * Full (solverFull true) counts only routings that also cover every cell.
  //    Winning already demands full coverage, so a single full-coverage
  //    routing still means a single goal state; it just no longer rules out
  //    connect-everything-but-leave-a-gap dead ends. Big boards fall back on
  //    this bar because strict candidates get vanishingly rare as the grid
  //    grows -- see generate().
  //
  // Both modes prune on reachability: a colour that can no longer reach its
  // partner through free cells kills the branch. Full mode adds the coverage
  // prunes, which are only sound when every cell has to be used. On a 5x5 the
  // pruning costs more than plain search saves, but from 7x7 up the search is
  // hopeless without it.
  const solverBoard = new Int8Array(MAX_CELLS);
  const compId = new Int32Array(MAX_CELLS); // free-cell region per cell, -1 if taken
  const compStack = new Int32Array(MAX_CELLS);
  const compTouched = new Uint8Array(MAX_CELLS);
  const cellLive = new Uint8Array(MAX_CELLS);
  let solverEndA = null;
  let solverEndB = null;
  let solverColors = 0;
  let solverCount = 0;
  let solverFull = false;
  let solverFree = 0;
  let solverSteps = 0;
  let solverBudget = 0;
  let solverAborted = false;
  let compCount = 0;

  function labelFree() {
    compCount = 0;
    for (let i = 0; i < cellCount; i += 1) compId[i] = solverBoard[i] === -1 ? -2 : -1;
    for (let start = 0; start < cellCount; start += 1) {
      if (compId[start] !== -2) continue;
      const id = compCount;
      compCount += 1;
      compId[start] = id;
      compStack[0] = start;
      let top = 1;
      while (top > 0) {
        top -= 1;
        const cell = compStack[top];
        const base = cell * 4;
        for (let i = 0; i < NEIGHBOUR_COUNT[cell]; i += 1) {
          const next = NEIGHBOURS[base + i];
          if (compId[next] !== -2) continue;
          compId[next] = id;
          compStack[top] = next;
          top += 1;
        }
      }
    }
  }

  // Can a and b still be joined, using only cells that are free right now?
  // Endpoints are occupied by their own dots, so the link has to go through a
  // free region touching both -- or the two cells are already adjacent.
  function linked(a, b) {
    const baseA = a * 4;
    const baseB = b * 4;
    for (let i = 0; i < NEIGHBOUR_COUNT[a]; i += 1) {
      const viaA = NEIGHBOURS[baseA + i];
      if (viaA === b) return true;
      const id = compId[viaA];
      if (id < 0) continue;
      for (let k = 0; k < NEIGHBOUR_COUNT[b]; k += 1) {
        if (compId[NEIGHBOURS[baseB + k]] === id) return true;
      }
    }
    return false;
  }

  // Mark a cell a pipe can still grow from, and the free regions it can reach.
  function markLive(cell) {
    cellLive[cell] = 1;
    const base = cell * 4;
    for (let i = 0; i < NEIGHBOUR_COUNT[cell]; i += 1) {
      const id = compId[NEIGHBOURS[base + i]];
      if (id >= 0) compTouched[id] = 1;
    }
  }

  function blocked(color, head) {
    labelFree();
    if (!linked(head, solverEndB[color])) return true;
    for (let c = color + 1; c < solverColors; c += 1) {
      if (!linked(solverEndA[c], solverEndB[c])) return true;
    }
    if (!solverFull) return false;

    for (let i = 0; i < compCount; i += 1) compTouched[i] = 0;
    markLive(head);
    markLive(solverEndB[color]);
    for (let c = color + 1; c < solverColors; c += 1) {
      markLive(solverEndA[c]);
      markLive(solverEndB[c]);
    }

    // Only the head being drawn and the dots still to be joined can lead into
    // free cells, so a region none of them touches can never be covered.
    let dead = false;
    for (let i = 0; i < compCount; i += 1) {
      if (!compTouched[i]) { dead = true; break; }
    }
    // A covered cell is entered once and left once, so it needs two neighbours
    // a pipe can still arrive from or continue into.
    if (!dead) {
      for (let cell = 0; cell < cellCount; cell += 1) {
        if (compId[cell] < 0) continue;
        const base = cell * 4;
        let ways = 0;
        for (let i = 0; i < NEIGHBOUR_COUNT[cell]; i += 1) {
          const next = NEIGHBOURS[base + i];
          if (compId[next] >= 0 || cellLive[next]) ways += 1;
        }
        if (ways < 2) { dead = true; break; }
      }
    }

    cellLive[head] = 0;
    cellLive[solverEndB[color]] = 0;
    for (let c = color + 1; c < solverColors; c += 1) {
      cellLive[solverEndA[c]] = 0;
      cellLive[solverEndB[c]] = 0;
    }
    return dead;
  }

  function solverExtend(color, head) {
    solverSteps += 1;
    if (solverSteps > solverBudget) {
      solverAborted = true;
      return;
    }
    const base = head * 4;
    const target = solverEndB[color];
    for (let i = 0; i < NEIGHBOUR_COUNT[head]; i += 1) {
      const next = NEIGHBOURS[base + i];
      if (next === target) {
        // Every dot cell is pre-coloured, so this is the only way into an
        // endpoint: no path can ever run *through* a dot, its own or another's.
        if (color + 1 === solverColors) {
          if (!solverFull || solverFree === 0) solverCount += 1;
        } else {
          solverExtend(color + 1, solverEndA[color + 1]);
        }
      } else if (solverBoard[next] === -1) {
        solverBoard[next] = color;
        solverFree -= 1;
        if (!blocked(color, next)) solverExtend(color, next);
        solverFree += 1;
        solverBoard[next] = -1;
      }
      // The cap has to bail out at every level, not just the top: rejected
      // candidates can otherwise enumerate dozens of solutions for nothing.
      if (solverCount >= 2 || solverAborted) return;
    }
  }

  // Returns the number of solutions found, capped at 2. A search that runs out
  // of budget sets solverAborted and its count means nothing -- the caller
  // treats that candidate as unverified rather than as unique.
  function countSolutions(endA, endB, requireFull, budget) {
    solverEndA = endA;
    solverEndB = endB;
    solverColors = endA.length;
    solverFull = requireFull === true;
    solverBudget = budget === undefined ? Infinity : budget;
    solverSteps = 0;
    solverAborted = false;
    solverBoard.fill(-1);
    solverFree = cellCount - solverColors * 2;
    for (let c = 0; c < solverColors; c += 1) {
      solverBoard[endA[c]] = c;
      solverBoard[endB[c]] = c;
    }
    solverCount = 0;
    if (!blocked(0, endA[0])) solverExtend(0, endA[0]);
    return solverCount;
  }

  // -------------------------------------------------------------- generation

  // Golden-ratio (R1) low-discrepancy sequence. Successive levels land far
  // apart in the range and every value comes up about equally often over any
  // stretch of play -- which plain hashing does not give you, since random
  // draws clump and four 12x12 boards in a row would be perfectly likely.
  const PHI_INV = 0.6180339887498949;
  const SIZE_PHASE = 0.44; // chosen so level 1 opens on a 5x5
  // Pipe count walks its own sequence, on a different irrational step. Sharing
  // the step and merely offsetting the phase would hold the two sequences a
  // fixed distance apart forever, which amounts to deriving the pipe count from
  // the board size: every 9x9 would come out with the same pipes.
  const ROOT2_FRAC = 0.41421356237309515;
  const PIPES_PHASE = 0.17;

  function quasi(level, phase, step) {
    return (phase + level * (step === undefined ? PHI_INV : step)) % 1;
  }

  function sizeForLevel(level) {
    const quasiSize = MIN_SIZE + Math.floor(quasi(level, SIZE_PHASE) * SIZE_SPAN);
    // Ease the first levels in rather than opening the game on a 12x12 wall.
    // Only levels 1-7 are capped, so the sequence is untouched from there on.
    return Math.min(quasiSize, MIN_SIZE + level - 1, MAX_SIZE);
  }

  // How long the pipes are is what really sets the difficulty: few long pipes
  // on a big board are the hard, open-ended levels, many short ones are the
  // tidy quick ones. Sweeping the target across each board's own range, rather
  // than fixing a count per size, is what gives two boards of a size
  // completely different characters.
  const SHORTEST_PIPE = 5.5; // any shorter and it is join-the-dots
  const LONGEST_PIPE = 1.15; // as a multiple of the board's side

  function pipeRange(boardSize) {
    const cells = boardSize * boardSize;
    return {
      sparse: clampPipes(Math.round(cells / (boardSize * LONGEST_PIPE)), cells),
      dense: clampPipes(Math.round(cells / SHORTEST_PIPE), cells),
    };
  }

  function pipesForLevel(level, boardSize) {
    const range = pipeRange(boardSize);
    const span = range.dense - range.sparse;
    return range.sparse + Math.round(quasi(level, PIPES_PHASE, ROOT2_FRAC) * span);
  }

  // Sparse boards are the ones worth wanting and the ones hardest to pin down
  // to a single solution, so a level asks for its target first and only trades
  // pipe length for a guarantee if that target will not verify.
  function pipeLadder(level, boardSize) {
    const range = pipeRange(boardSize);
    const ladder = [];
    for (let colors = pipesForLevel(level, boardSize); colors <= range.dense; colors += 1) {
      ladder.push(colors);
    }
    return ladder.length ? ladder : [range.dense];
  }

  function clampPipes(count, cells) {
    if (count < 4) return 4;
    if (count > MAX_COLORS) return MAX_COLORS;
    // Every pipe needs two dots and at least one cell between them.
    if (count * 3 > cells) return Math.floor(cells / 3);
    return count;
  }

  // Bounds either side of the average, loose enough to leave the cut room to
  // dodge touches but tight enough that no colour gets half the board
  // (unforced) or a three-cell stub next to a monster.
  function boundsFor(cells, colors) {
    const average = cells / colors;
    return {
      minLen: Math.max(3, Math.round(average * 0.5)),
      maxLen: Math.max(6, Math.round(average * 2.2)),
    };
  }

  function difficultyFor(level) {
    const boardSize = sizeForLevel(level);
    const colors = pipesForLevel(level, boardSize);
    const bounds = boundsFor(boardSize * boardSize, colors);
    return { size: boardSize, colors: colors, minLen: bounds.minLen, maxLen: bounds.maxLen };
  }

  // Preferring the sparsest board that still verifies: a board that could not
  // be pinned to one solution is worth less than a slightly denser one that
  // could, but among equals the longer pipes win.
  function betterFallback(candidate, incumbent) {
    if (!incumbent) return true;
    if (candidate.touches !== incumbent.touches) return candidate.touches < incumbent.touches;
    return candidate.colors < incumbent.colors;
  }

  // A board is a pure function of (size, colours, seed), which is the whole
  // point: the offline builder searches this seed space for boards with a
  // single solution, and the browser rebuilds the winning seed bit for bit
  // instead of repeating the search.
  //
  // Which makes this constant load-bearing: bump it whenever a change would
  // make (size, colours, seed) describe a different board -- the chain mixing,
  // the climb, the cut, the colour shuffle. Tables built by another version
  // are ignored rather than trusted, since their promise of a single solution
  // was made about boards this code no longer builds.
  const GENERATOR_VERSION = 1;
  function seedFor(level, colors, attempt) {
    return mix32(mix32(level * 0x9e3779b1 + colors) + attempt);
  }

  // Hill-climb the chain itself. A pipe that runs alongside itself can always
  // be short-cut, so touch-free cuts are the ones worth verifying -- and on a
  // big board a *random* chain essentially never admits one, however well the
  // cut is chosen. Perturbing a good chain a little and keeping what does not
  // get worse finds them in milliseconds where resampling never does.
  const CLIMB_STEPS = 3;
  // Give up on a chain that has stopped improving. A sparse board often cannot
  // be cut touch-free at all, and grinding out the full iteration budget on
  // one that is stuck costs more than starting again from another seed.
  const CLIMB_PATIENCE = 150;

  function climbCut(colors, minLen, maxLen, rnd, iterations) {
    let best = cutChain(colors, minLen, maxLen, rnd);
    if (best && best.touches === 0) return best;
    let sinceGain = 0;
    for (let i = 0; i < iterations; i += 1) {
      backbite(rnd, CLIMB_STEPS);
      const cut = cutChain(colors, minLen, maxLen, rnd);
      if (!cut) continue;
      if (best && cut.touches < best.touches) sinceGain = 0;
      else if (++sinceGain > CLIMB_PATIENCE) break;
      if (!best || cut.touches <= best.touches) {
        best = cut;
        if (best.touches === 0) break;
      } else {
        // Wander on from here rather than restarting: the chain that produced
        // the best cut so far is not recoverable, but its neighbourhood is
        // where the next good one lives.
        backbite(rnd, CLIMB_STEPS);
      }
    }
    return best;
  }

  const CLIMB_ITERATIONS = 600;

  function buildBoard(boardSize, colors, seed) {
    setSize(boardSize);
    const bounds = boundsFor(cellCount, colors);
    const rnd = mulberry32(seed);
    initPath();
    backbite(rnd, cellCount * 12);
    const cut = climbCut(colors, bounds.minLen, bounds.maxLen, rnd, CLIMB_ITERATIONS);
    if (!cut) return null;

    // Shuffle which palette colour each piece gets, otherwise the chain order
    // shows up as "red always sits next to orange".
    const order = [];
    for (let i = 0; i < cut.segments.length; i += 1) order.push(i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = (rnd() * (i + 1)) | 0;
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    const solution = order.map((i) => cut.segments[i]);
    return {
      size: boardSize,
      colors: colors,
      seed: seed,
      touches: cut.touches,
      verified: false,
      endA: solution.map((seg) => seg[0]),
      endB: solution.map((seg) => seg[seg.length - 1]),
      solution: solution,
    };
  }

  // Verifying a level means counting its solutions, and that is affordable up
  // to 11x11 now that the climb hands the counter well-formed boards. A 12x12
  // is another matter: the counter regularly cannot decide one inside any
  // budget a browser can spare, so those levels fall back on the cut alone --
  // unless a pre-built seed says otherwise, which is what the offline builder
  // is for.
  function budgetFor(boardSize) {
    if (boardSize <= 8) return { attempts: 120, verify: true };
    if (boardSize <= 9) return { attempts: 48, verify: true };
    if (boardSize <= 10) return { attempts: 24, verify: true };
    if (boardSize <= 11) return { attempts: 14, verify: true };
    return { attempts: 6, verify: false };
  }

  // A search that runs this deep is either a pathological candidate or a slow
  // way of learning what the next candidate would tell us cheaply.
  const SEARCH_BUDGET = 200000;

  // `recipe` is a pre-verified {size, colors, seed} from the seed table; with
  // one there is nothing to search for, which is why a 12x12 can ship with a
  // guarantee the browser could never establish on its own.
  function generate(level, recipe) {
    if (recipe) {
      const board = buildBoard(recipe.size, recipe.colors, recipe.seed);
      if (board) {
        board.level = level;
        board.verified = recipe.verified === true;
        board.fromTable = true;
        return board;
      }
      // Unreachable unless the table disagrees with this build of the
      // generator; searching locally is better than failing to start a level.
    }

    const boardSize = sizeForLevel(level);
    const budget = budgetFor(boardSize);
    // Without verification there is nothing to trade pipe length *for*, and a
    // sparse board that cannot be checked is the one most likely to hide a
    // shortcut -- so the unverifiable sizes play their well-formed dense end
    // here. Their sparse levels are what the pre-built seed table is for.
    const ladder = budget.verify ? pipeLadder(level, boardSize) : [pipeRange(boardSize).dense];
    const perRung = Math.max(3, Math.round(budget.attempts / ladder.length));

    let fallback = null;
    for (let rung = 0; rung < ladder.length; rung += 1) {
      const colors = ladder[rung];
      for (let attempt = 0; attempt < perRung; attempt += 1) {
        const board = buildBoard(boardSize, colors, seedFor(level, colors, attempt));
        if (!board) continue;
        board.level = level;
        // Only touch-free boards are worth the counter's time: every board
        // that verified in testing was one, and a board with a shortcut in it
        // is exactly the kind the counter takes longest to give up on.
        if (budget.verify && board.touches === 0) {
          const found = countSolutions(board.endA, board.endB, true, SEARCH_BUDGET);
          if (found === 1 && !solverAborted) {
            board.verified = true;
            return board;
          }
        }
        // Whatever the search says, the best-formed candidate wins the
        // fallback: the segments are a full-coverage solution by construction,
        // so every candidate is completable.
        if (betterFallback(board, fallback)) fallback = board;
        if (!budget.verify && fallback.touches === 0) return fallback;
      }
    }
    return fallback;
  }

  // ------------------------------------------------------------ player state

  // Two hints is plenty on a 5x5; a 12x12 has more than twice the pipes.
  function hintsFor(boardSize) {
    return Math.max(2, Math.round(boardSize / 3));
  }

  let puzzle = null;
  // Board-sized state is allocated once for the largest board; only the first
  // cellCount entries are live on any given level.
  let dotColor = new Int8Array(MAX_CELLS); // colour at dot cells, -1 elsewhere
  let owner = new Int8Array(MAX_CELLS); // colour of the drawn pipe, -1 if bare
  // While a pipe is being dragged it may pass over cells belonging to other
  // colours without destroying them; displaced[cell] remembers who held the
  // cell so backing off restores it, and the real cut is applied on release.
  let displaced = new Int8Array(MAX_CELLS);
  let paths = []; // ordered cells per colour; [] until the player starts one
  let activeColor = -1;
  let lastMovedColor = -1;
  let moves = 0;
  let hintsLeft = hintsFor(size);
  let undoStack = [];
  let solved = false;
  let level = 1;
  let totalSolved = 0;

  // Loading is asynchronous only because the seed table might be: the recipe
  // for the next level is usually already prefetched, in which case this runs
  // to completion in one microtask and the board never blinks.
  let loadToken = 0;

  function loadPuzzle(nextLevel) {
    const token = (loadToken += 1);
    const known = cachedRecipe(nextLevel);
    if (known === undefined) showOverlay('Loading level ' + nextLevel + '\u2026', false);
    return recipeFor(nextLevel).then((recipe) => {
      if (token !== loadToken) return; // a later load already took over
      startLevel(nextLevel, recipe);
      prefetchFrom(nextLevel + 1);
    });
  }

  function startLevel(nextLevel, recipe) {
    level = nextLevel;
    // generate() sets the geometry for the level, so the board frame and the
    // key grid have to be resized before anything is drawn against it.
    puzzle = generate(level, recipe);
    applyBoardSize();
    rebuildKeys();
    resize();
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
    hintsLeft = hintsFor(size);
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
    for (let guard = 0; guard < cellCount; guard += 1) {
      const p = paths[activeColor];
      const head = p[p.length - 1];
      if (head === cell) break;
      const dRow = ((cell / size) | 0) - ((head / size) | 0);
      const dCol = (cell % size) - (head % size);
      // head !== cell here, so the larger delta is always non-zero.
      const next =
        Math.abs(dCol) >= Math.abs(dRow)
          ? head + Math.sign(dCol)
          : head + Math.sign(dRow) * size;
      if (!tryStep(activeColor, next)) break;
    }
    refresh();
  }

  function filledCells() {
    let n = 0;
    for (let i = 0; i < cellCount; i += 1) if (owner[i] >= 0) n += 1;
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
    if (filledCells() !== cellCount) return;
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
      // The offline seed builder (tools/build-seeds.js) runs this exact code,
      // so a board it verifies is the board the browser will rebuild.
      module.exports = {
        generate: generate,
        buildBoard: buildBoard,
        countSolutions: countSolutions,
        seedFor: seedFor,
        difficultyFor: difficultyFor,
        sizeForLevel: sizeForLevel,
        pipesForLevel: pipesForLevel,
        pipeRange: pipeRange,
        pipeLadder: pipeLadder,
        clampPipes: clampPipes,
        wasAborted: function () { return solverAborted; },
        generatorVersion: GENERATOR_VERSION,
        limits: {
          minSize: MIN_SIZE,
          maxSize: MAX_SIZE,
          maxColors: MAX_COLORS,
          longestPipe: LONGEST_PIPE,
          shortestPipe: SHORTEST_PIPE,
        },
      };
    }
    return;
  }

  const boardWrap = document.getElementById('board-wrap');
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const keyLayer = document.getElementById('keys');
  const levelEl = document.getElementById('level');
  const movesEl = document.getElementById('moves');
  const flowsEl = document.getElementById('flows');
  const fillEl = document.getElementById('fill');
  const sizeEl = document.getElementById('size');
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

  // Bigger boards get a bigger frame, so a 12x12 cell stays roughly a
  // fingertip rather than shrinking to a quarter of a 5x5 one.
  function applyBoardSize() {
    // The 70vh term matters on laptops: a 12x12 frame is otherwise tall
    // enough to push the controls below the fold.
    boardWrap.style.width = 'min(92vw, 70vh, ' + (330 + size * 20) + 'px)';
  }

  // The invisible key grid is per-cell, so it is rebuilt whenever the board
  // size changes. Buttons are reused where the counts overlap: recreating all
  // of them would drop keyboard focus on every level change.
  function rebuildKeys() {
    while (keys.length > cellCount) keyLayer.removeChild(keys.pop());
    for (let cell = keys.length; cell < cellCount; cell += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.cell = String(cell);
      keyLayer.appendChild(btn);
      keys.push(btn);
    }
    keyLayer.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
    keyLayer.style.gridTemplateRows = 'repeat(' + size + ', 1fr)';
    focusIndex = 0;
    for (let cell = 0; cell < keys.length; cell += 1) {
      keys[cell].tabIndex = cell === 0 ? 0 : -1;
    }
  }

  function showOverlay(message, withButton) {
    overlayMessage.textContent = message;
    startBtn.hidden = withButton === false;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  // -------------------------------------------------------------- seed table

  // Levels can be pre-built: tools/build-seeds.js searches the seed space
  // offline for boards with exactly one solution and records the winner, and
  // the server hands them out from /api/pipelines/seeds. Since a board is a
  // pure function of (size, colours, seed), rebuilding one here is exact.
  //
  // None of this is required. No server, no table, an old table that stops
  // short of this level, a flaky connection -- each just means the generator
  // searches for itself, which is what it did before the table existed.
  const SEED_ENDPOINT = '/api/pipelines/seeds';
  const PREFETCH = 24; // levels per request; a session is then a few requests
  const FETCH_TIMEOUT = 2500;

  const recipeCache = new Map(); // level -> recipe, or null for "not in the table"
  let tableTotal = -1; // -1 until a response says otherwise
  let tableOffline = typeof fetch !== 'function';
  let fetchedThrough = 0; // highest level a completed window covered
  let inFlight = null;

  function cachedRecipe(level) {
    return recipeCache.get(level);
  }

  function rememberWindow(from, count, payload) {
    // A table built by a different generator describes different boards, and
    // its verification says nothing about the ones this code would build --
    // so it is not a table worth reading.
    if (payload && payload.generator !== GENERATOR_VERSION) {
      tableOffline = true;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Pipelines: ignoring seed table built by generator v' + payload.generator +
          ' (this build is v' + GENERATOR_VERSION + '); generating levels locally.');
      }
      return;
    }
    const levels = (payload && payload.levels) || [];
    for (const record of levels) {
      if (record && Number.isInteger(record.level)) recipeCache.set(record.level, record);
    }
    // Levels the response skipped are not in the table, and saying so stops
    // the same gap being asked for again on every visit.
    for (let level = from; level < from + count; level += 1) {
      if (!recipeCache.has(level)) recipeCache.set(level, null);
    }
    if (payload && Number.isInteger(payload.total)) tableTotal = payload.total;
    if (from + count - 1 > fetchedThrough) fetchedThrough = from + count - 1;
  }

  function fetchWindow(from, count) {
    if (tableOffline) return Promise.resolve();
    // One request at a time: the prefetch and a load that overtakes it would
    // otherwise ask for overlapping windows.
    if (inFlight) return inFlight;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller && controller.abort(), FETCH_TIMEOUT);
    const request = fetch(SEED_ENDPOINT + '?from=' + from + '&count=' + count, {
      signal: controller ? controller.signal : undefined,
      headers: { accept: 'application/json' },
    })
      .then((response) => {
        if (response.status === 503) {
          // The server is up but has no table; there is nothing to come back
          // for this session.
          tableOffline = true;
          return null;
        }
        if (!response.ok) throw new Error('seed request failed: ' + response.status);
        return response.json();
      })
      .then((payload) => {
        if (payload) rememberWindow(from, count, payload);
      })
      .catch(() => {
        // Offline, no such route (the game is on static hosting), a timeout --
        // all the same answer: generate locally from here on.
        tableOffline = true;
      })
      .then(() => {
        clearTimeout(timer);
        inFlight = null;
      });
    inFlight = request;
    return request;
  }

  function recipeFor(level) {
    const known = cachedRecipe(level);
    if (known !== undefined) return Promise.resolve(known);
    if (tableOffline || (tableTotal >= 0 && level > tableTotal)) return Promise.resolve(null);
    return fetchWindow(level, PREFETCH).then(() => cachedRecipe(level) || null);
  }

  // Warms the levels just ahead so "Next level" does not wait on the network.
  // Only once the cached run is nearly used up, so playing through a session
  // costs a request per window rather than one per level.
  const LOOKAHEAD = 8;

  function prefetchFrom(level) {
    if (tableOffline || inFlight) return;
    if (level + LOOKAHEAD <= fetchedThrough) return;
    if (tableTotal >= 0 && fetchedThrough >= tableTotal) return;
    fetchWindow(Math.max(level, fetchedThrough + 1), PREFETCH);
  }

  // ---------------------------------------------------------------- rendering

  function centreX(cell) {
    return (cell % size) * cellSize + cellSize / 2;
  }

  function centreY(cell) {
    return ((cell / size) | 0) * cellSize + cellSize / 2;
  }

  function draw() {
    if (!puzzle || !cellSize) return;
    ctx.clearRect(0, 0, cssSize, cssSize);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < size; i += 1) {
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
    const row = ((cell / size) | 0) + 1;
    const col = (cell % size) + 1;
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
    fillEl.textContent = Math.round((filledCells() / cellCount) * 100) + '%';
    sizeEl.textContent = size + '\u00d7' + size;
    for (let cell = 0; cell < cellCount; cell += 1) {
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
    cellSize = cssSize / size;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  // ------------------------------------------------------------------- input

  function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * size);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * size);
    if (row < 0 || row >= size || col < 0 || col >= size) return -1;
    return row * size + col;
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

  // Computed rather than tabulated: the row stride changes with the board.
  function arrowDelta(key) {
    if (key === 'ArrowUp') return -size;
    if (key === 'ArrowDown') return size;
    if (key === 'ArrowLeft') return -1;
    if (key === 'ArrowRight') return 1;
    return undefined;
  }

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

    const delta = arrowDelta(event.key);
    if (delta === undefined) return;
    const next = cell + delta;
    // Guard the horizontal wrap that a flat index would otherwise allow.
    if (next < 0 || next >= cellCount) return;
    if (Math.abs(delta) === 1 && ((next / size) | 0) !== ((cell / size) | 0)) return;
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
    startBtn.disabled = true;
    loadPuzzle(level + 1).then(() => {
      startBtn.disabled = false;
      focusCell(0, false);
    });
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
  loadPuzzle(readInt(LEVEL_KEY, 1, 1)).then(resize);

  // Handy from the browser console, and used by the generator test harness.
  window.pipelinesDebug = {
    generate: generate,
    buildBoard: buildBoard,
    countSolutions: countSolutions,
    difficultyFor: difficultyFor,
    sizeForLevel: sizeForLevel,
    recipeCache: recipeCache,
  };
})();
