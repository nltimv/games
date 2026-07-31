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
    for (const game of games) {
      grid.appendChild(renderCard(game));
    }
  } catch (err) {
    console.error('Failed to load games', err);
    grid.innerHTML = '<p class="error">Could not load games. Please try again later.</p>';
  }
})();

function renderCard(game) {
  const card = document.createElement('a');
  card.className = 'game-card';
  card.href = game.path;

  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.src = game.thumbnail || '';
  thumb.alt = `${game.title} thumbnail`;
  thumb.loading = 'lazy';

  const title = document.createElement('h2');
  title.textContent = game.title;

  const desc = document.createElement('p');
  desc.textContent = game.description;

  card.appendChild(thumb);
  card.appendChild(title);
  card.appendChild(desc);

  if (game.controls) {
    const controls = document.createElement('span');
    controls.className = 'controls';
    controls.textContent = `Controls: ${game.controls}`;
    card.appendChild(controls);
  }

  return card;
}
