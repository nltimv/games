// Simple canvas-based Snake game. No external dependencies.
(function () {
  'use strict';

  const GRID_SIZE = 20; // number of cells per side
  const TICK_MS = 120; // game speed
  const STORAGE_KEY = 'snake-best-score';

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const overlayMessage = document.getElementById('overlay-message');
  const startBtn = document.getElementById('start-btn');

  let cellSize = canvas.width / GRID_SIZE;
  let snake;
  let direction;
  let nextDirection;
  let food;
  let score;
  let best = Number(localStorage.getItem(STORAGE_KEY) || 0);
  let loopHandle = null;
  let running = false;

  bestEl.textContent = best;

  function resetState() {
    const mid = Math.floor(GRID_SIZE / 2);
    snake = [
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
      { x: mid - 3, y: mid },
    ];
    direction = { x: 1, y: 0 };
    nextDirection = direction;
    score = 0;
    scoreEl.textContent = score;
    placeFood();
  }

  function placeFood() {
    let candidate;
    do {
      candidate = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
    } while (snake.some((s) => s.x === candidate.x && s.y === candidate.y));
    food = candidate;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Food
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(food.x * cellSize, food.y * cellSize, cellSize, cellSize);

    // Snake
    snake.forEach((segment, i) => {
      ctx.fillStyle = i === 0 ? '#4dd0a4' : '#35a884';
      ctx.fillRect(
        segment.x * cellSize + 1,
        segment.y * cellSize + 1,
        cellSize - 2,
        cellSize - 2
      );
    });
  }

  function step() {
    direction = nextDirection;
    const head = {
      x: snake[0].x + direction.x,
      y: snake[0].y + direction.y,
    };

    const hitsWall =
      head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE;
    const hitsSelf = snake.some((s) => s.x === head.x && s.y === head.y);

    if (hitsWall || hitsSelf) {
      gameOver();
      return;
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      score += 10;
      scoreEl.textContent = score;
      placeFood();
    } else {
      snake.pop();
    }

    draw();
  }

  function gameOver() {
    stop();
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem(STORAGE_KEY, String(best));
    }
    overlayMessage.textContent = `Game over! Score: ${score}`;
    startBtn.textContent = 'Play again';
    overlay.classList.remove('hidden');
  }

  function start() {
    resetState();
    overlay.classList.add('hidden');
    running = true;
    draw();
    if (loopHandle) clearInterval(loopHandle);
    loopHandle = setInterval(step, TICK_MS);
  }

  function stop() {
    running = false;
    if (loopHandle) {
      clearInterval(loopHandle);
      loopHandle = null;
    }
  }

  function setDirection(dx, dy) {
    // Prevent the snake from reversing directly into itself.
    if (snake.length > 1 && direction.x === -dx && direction.y === -dy) return;
    nextDirection = { x: dx, y: dy };
  }

  const KEY_MAP = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    w: [0, -1],
    s: [0, 1],
    a: [-1, 0],
    d: [1, 0],
  };

  document.addEventListener('keydown', (e) => {
    const mapped = KEY_MAP[e.key];
    if (!mapped) return;
    e.preventDefault();
    if (!running) {
      start();
    }
    setDirection(mapped[0], mapped[1]);
  });

  document.querySelectorAll('.touch-controls button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dirMap = {
        up: [0, -1],
        down: [0, 1],
        left: [-1, 0],
        right: [1, 0],
      };
      const mapped = dirMap[btn.dataset.dir];
      if (!running) start();
      setDirection(mapped[0], mapped[1]);
    });
  });

  startBtn.addEventListener('click', start);

  // Basic swipe support for touch devices.
  let touchStart = null;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  });
  canvas.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      setDirection(dx > 0 ? 1 : -1, 0);
    } else {
      setDirection(0, dy > 0 ? 1 : -1);
    }
    if (!running) start();
    touchStart = null;
  });

  resetState();
  draw();
})();
