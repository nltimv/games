// Fetches the game registry and renders a card per game on the lobby page.
(async function loadGames() {
  const grid = document.getElementById('game-grid');

  try {
    const res = await fetch('/api/games');
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const games = await res.json();

    if (!Array.isArray(games) || games.length === 0) {
      grid.innerHTML = '<p class="error">No games available yet. Check back soon!</p>';
      return;
    }

    grid.innerHTML = '';
    games.forEach((game, index) => {
      grid.appendChild(renderCard(game, index));
    });
    grid.appendChild(renderComingSoon(games.length));
  } catch (err) {
    console.error('Failed to load games', err);
    grid.innerHTML = '<p class="error">Could not load games. Please try again later.</p>';
  }
})();

function renderCard(game, index) {
  const card = document.createElement('a');
  card.className = 'game-card';
  card.href = game.path;
  card.style.setProperty('--delay', `${Math.min(index, 8) * 70}ms`);

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'thumb-wrap';

  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.src = game.thumbnail || '';
  thumb.alt = `${game.title} thumbnail`;
  thumb.loading = 'lazy';
  thumbWrap.appendChild(thumb);

  const playBadge = document.createElement('div');
  playBadge.className = 'play-badge';
  playBadge.innerHTML = '<span>▶</span>';
  thumbWrap.appendChild(playBadge);

  const head = document.createElement('div');
  head.className = 'card-head';

  const title = document.createElement('h2');
  title.textContent = game.title;
  head.appendChild(title);

  if (game.genre) {
    const genre = document.createElement('span');
    genre.className = 'genre';
    genre.textContent = game.genre;
    head.appendChild(genre);
  }

  const desc = document.createElement('p');
  desc.textContent = game.description;

  card.appendChild(thumbWrap);
  card.appendChild(head);
  card.appendChild(desc);

  if (game.controls) {
    const controls = document.createElement('span');
    controls.className = 'controls';
    controls.textContent = `⌨️ ${game.controls}`;
    card.appendChild(controls);
  }

  return card;
}

function renderComingSoon(index) {
  const tile = document.createElement('div');
  tile.className = 'coming-soon';
  tile.style.setProperty('--delay', `${Math.min(index, 8) * 70}ms`);
  tile.innerHTML =
    '<span class="icon">🛠️</span>' +
    '<strong>More games coming soon</strong>' +
    '<span class="hint">Got an idea? Contributions welcome.</span>';
  return tile;
}
