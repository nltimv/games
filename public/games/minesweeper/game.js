// DOM-grid Minesweeper. No external dependencies.
(function () {
  'use strict';

  const DIFFICULTIES = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 },
  };
  const DIFFICULTY_KEY = 'minesweeper-difficulty';
  const LONG_PRESS_MS = 450;
  const MAX_TIME = 999;

  const bestKey = (name) => `minesweeper-best-${name}`;

  const board = document.getElementById('board');
  const minesLeftEl = document.getElementById('mines-left');
  const timerEl = document.getElementById('timer');
  const bestEl = document.getElementById('best');
  const faceBtn = document.getElementById('reset-btn');
  const overlay = document.getElementById('overlay');
  const overlayMessage = document.getElementById('overlay-message');
  const startBtn = document.getElementById('start-btn');
  const flagToggle = document.getElementById('flag-toggle');
  const difficultyBtns = document.querySelectorAll('.ms-difficulty button');

  let difficulty = DIFFICULTIES[localStorage.getItem(DIFFICULTY_KEY)]
    ? localStorage.getItem(DIFFICULTY_KEY)
    : 'beginner';
  let rows;
  let cols;
  let mineCount;
  let cells = []; // flat array of { mine, revealed, flagged, adjacent, el }
  let minesPlaced = false;
  let running = false;
  let finished = false;
  let flagsUsed = 0;
  let revealedCount = 0;
  let elapsed = 0;
  let timerHandle = null;
  let flagMode = false;
  let focusIndex = 0;
  let longPressHandle = null;
  let longPressFired = false;

  const idx = (r, c) => r * cols + c;

  // Yields the up-to-8 neighbours of a cell, skipping anything off the board.
  function neighbours(index) {
    const r = Math.floor(index / cols);
    const c = index % cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        out.push(idx(nr, nc));
      }
    }
    return out;
  }

  function buildBoard() {
    const config = DIFFICULTIES[difficulty];
    rows = config.rows;
    cols = config.cols;
    mineCount = config.mines;

    minesPlaced = false;
    running = false;
    finished = false;
    flagsUsed = 0;
    revealedCount = 0;
    focusIndex = 0;
    stopTimer();
    elapsed = 0;

    board.style.setProperty('--cols', cols);
    board.textContent = '';
    cells = [];

    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'cell';
        el.dataset.index = String(idx(r, c));
        el.tabIndex = -1;
        frag.appendChild(el);
        cells.push({ mine: false, revealed: false, flagged: false, adjacent: 0, el });
      }
    }
    if (cells.length) cells[0].el.tabIndex = 0;
    board.appendChild(frag);

    cells.forEach((_, i) => paintCell(i));
    updateMinesLeft();
    timerEl.textContent = '0';
    faceBtn.textContent = '🙂';
    // The board is live from the first click, so the overlay only ever appears
    // on a win or a loss.
    hideOverlay();
    renderBest();
  }

  // Mines are placed only after the first reveal, and never on the clicked
  // cell or its neighbours, so the opening click always cascades.
  function placeMines(safeIndex) {
    const forbidden = new Set([safeIndex, ...neighbours(safeIndex)]);
    // Fall back to protecting just the clicked cell if the board is too dense
    // for a full safe pocket (none of the presets hit this).
    const pool = [];
    for (let i = 0; i < cells.length; i += 1) {
      if (!forbidden.has(i)) pool.push(i);
    }
    const candidates = pool.length >= mineCount
      ? pool
      : cells.map((_, i) => i).filter((i) => i !== safeIndex);

    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    candidates.slice(0, mineCount).forEach((i) => {
      cells[i].mine = true;
    });

    cells.forEach((cell, i) => {
      cell.adjacent = cell.mine ? 0 : neighbours(i).filter((n) => cells[n].mine).length;
    });
    minesPlaced = true;
  }

  function paintCell(i) {
    const cell = cells[i];
    const el = cell.el;
    const r = Math.floor(i / cols) + 1;
    const c = (i % cols) + 1;
    const position = `Row ${r}, column ${c}`;

    el.className = 'cell';
    el.textContent = '';
    el.removeAttribute('aria-pressed');

    if (cell.revealed) {
      el.classList.add('revealed');
      if (cell.mine) {
        el.classList.add('mine');
        el.textContent = '💣';
        el.setAttribute('aria-label', `${position}, mine`);
      } else if (cell.adjacent > 0) {
        el.classList.add(`n${cell.adjacent}`);
        el.textContent = String(cell.adjacent);
        el.setAttribute('aria-label', `${position}, ${cell.adjacent} adjacent mines`);
      } else {
        el.setAttribute('aria-label', `${position}, empty`);
      }
    } else if (cell.flagged) {
      el.classList.add('flagged');
      el.textContent = '🚩';
      el.setAttribute('aria-pressed', 'true');
      el.setAttribute('aria-label', `${position}, flagged`);
    } else {
      el.setAttribute('aria-pressed', 'false');
      el.setAttribute('aria-label', `${position}, hidden`);
    }
  }

  function updateMinesLeft() {
    minesLeftEl.textContent = String(mineCount - flagsUsed);
  }

  function renderBest() {
    const best = Number(localStorage.getItem(bestKey(difficulty)) || 0);
    bestEl.textContent = best > 0 ? `${best}s` : '--';
  }

  function startTimer() {
    stopTimer();
    timerHandle = setInterval(() => {
      elapsed = Math.min(elapsed + 1, MAX_TIME);
      timerEl.textContent = String(elapsed);
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle !== null) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function showOverlay(message, buttonLabel) {
    overlayMessage.textContent = message;
    startBtn.textContent = buttonLabel;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function beginRun(firstIndex) {
    placeMines(firstIndex);
    running = true;
    elapsed = 0;
    timerEl.textContent = '0';
    startTimer();
  }

  function reveal(index) {
    const cell = cells[index];
    if (cell.revealed || cell.flagged) return;

    if (cell.mine) {
      cell.revealed = true;
      gameOver(index);
      return;
    }

    // Iterative flood fill - Expert boards cascade too deep for recursion.
    const stack = [index];
    const seen = new Set(stack);
    while (stack.length) {
      const current = stack.pop();
      const target = cells[current];
      if (target.revealed || target.flagged || target.mine) continue;
      target.revealed = true;
      revealedCount += 1;
      paintCell(current);
      if (target.adjacent === 0) {
        neighbours(current).forEach((n) => {
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        });
      }
    }

    checkWin();
  }

  // Clicking a satisfied number clears its unflagged neighbours. Wrong flags
  // make this lose the game, which is the expected behaviour.
  function chord(index) {
    const cell = cells[index];
    if (!cell.revealed || cell.adjacent === 0) return;
    const around = neighbours(index);
    const flagged = around.filter((n) => cells[n].flagged).length;
    if (flagged !== cell.adjacent) return;
    around.forEach((n) => {
      if (!finished && !cells[n].flagged && !cells[n].revealed) reveal(n);
    });
  }

  function toggleFlag(index) {
    const cell = cells[index];
    if (cell.revealed) return;
    if (!cell.flagged && flagsUsed >= mineCount) return;
    cell.flagged = !cell.flagged;
    flagsUsed += cell.flagged ? 1 : -1;
    paintCell(index);
    updateMinesLeft();
  }

  function gameOver(explodedIndex) {
    running = false;
    finished = true;
    stopTimer();
    faceBtn.textContent = '😵';

    cells.forEach((cell, i) => {
      if (cell.mine && !cell.flagged) cell.revealed = true;
      paintCell(i);
      if (!cell.mine && cell.flagged) cell.el.classList.add('wrong-flag');
    });
    cells[explodedIndex].el.classList.add('exploded');

    showOverlay('Boom! You hit a mine.', 'Try again');
  }

  function checkWin() {
    if (revealedCount !== cells.length - mineCount) return;

    running = false;
    finished = true;
    stopTimer();
    faceBtn.textContent = '😎';

    cells.forEach((cell, i) => {
      if (cell.mine && !cell.flagged) {
        cell.flagged = true;
        flagsUsed += 1;
        paintCell(i);
      }
    });
    updateMinesLeft();

    const best = Number(localStorage.getItem(bestKey(difficulty)) || 0);
    // 0 is the "no record yet" sentinel, so a sub-second clear still scores 1.
    const time = Math.max(1, elapsed);
    const isRecord = best === 0 || time < best;
    if (isRecord) {
      localStorage.setItem(bestKey(difficulty), String(time));
      renderBest();
    }

    showOverlay(
      isRecord ? `Cleared in ${time}s - new best!` : `Cleared in ${time}s`,
      'Play again'
    );
  }

  function cellIndexFrom(target) {
    const el = target.closest('.cell');
    if (!el || !board.contains(el)) return -1;
    return Number(el.dataset.index);
  }

  function primaryAction(index) {
    if (finished) return;
    if (flagMode) {
      toggleFlag(index);
      return;
    }
    if (cells[index].flagged) return;
    if (!minesPlaced) beginRun(index);
    if (cells[index].revealed) chord(index);
    else reveal(index);
  }

  function moveFocus(delta) {
    const next = focusIndex + delta;
    if (next < 0 || next >= cells.length) return;
    // Guard horizontal moves against wrapping onto the neighbouring row.
    if (Math.abs(delta) === 1 && Math.floor(next / cols) !== Math.floor(focusIndex / cols)) return;
    cells[focusIndex].el.tabIndex = -1;
    focusIndex = next;
    cells[focusIndex].el.tabIndex = 0;
    cells[focusIndex].el.focus();
  }

  board.addEventListener('click', (e) => {
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    const index = cellIndexFrom(e.target);
    if (index < 0) return;
    primaryAction(index);
  });

  board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const index = cellIndexFrom(e.target);
    if (index < 0 || finished) return;
    toggleFlag(index);
  });

  board.addEventListener('focusin', (e) => {
    const index = cellIndexFrom(e.target);
    if (index < 0) return;
    cells[focusIndex].el.tabIndex = -1;
    focusIndex = index;
    cells[focusIndex].el.tabIndex = 0;
  });

  board.addEventListener('keydown', (e) => {
    const index = cellIndexFrom(e.target);
    if (index < 0) return;
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveFocus(-cols); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(cols); break;
      case 'ArrowLeft': e.preventDefault(); moveFocus(-1); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(1); break;
      case 'f':
      case 'F':
        e.preventDefault();
        if (!finished) toggleFlag(index);
        break;
      default: break;
    }
  });

  // Long-press is the touch stand-in for right-click.
  board.addEventListener('touchstart', (e) => {
    const index = cellIndexFrom(e.target);
    if (index < 0) return;
    longPressFired = false;
    longPressHandle = setTimeout(() => {
      longPressHandle = null;
      longPressFired = true;
      if (!finished) toggleFlag(index);
    }, LONG_PRESS_MS);
  }, { passive: true });

  ['touchend', 'touchmove', 'touchcancel'].forEach((type) => {
    board.addEventListener(type, () => {
      if (longPressHandle !== null) {
        clearTimeout(longPressHandle);
        longPressHandle = null;
      }
    }, { passive: true });
  });

  startBtn.addEventListener('click', buildBoard);
  faceBtn.addEventListener('click', buildBoard);

  flagToggle.addEventListener('click', () => {
    flagMode = !flagMode;
    flagToggle.setAttribute('aria-pressed', String(flagMode));
    flagToggle.textContent = `🚩 Flag mode: ${flagMode ? 'on' : 'off'}`;
  });

  difficultyBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      difficulty = btn.dataset.difficulty;
      localStorage.setItem(DIFFICULTY_KEY, difficulty);
      difficultyBtns.forEach((other) => {
        other.setAttribute('aria-pressed', String(other === btn));
      });
      buildBoard();
    });
  });

  difficultyBtns.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.difficulty === difficulty));
  });

  buildBoard();
})();
