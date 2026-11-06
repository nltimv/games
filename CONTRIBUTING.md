# Contributing

Thanks for adding to the Games Hub. A few conventions keep the repo easy to
work in as games get bigger.

## Layout

- `public/games/<id>/` holds everything for one game. The lobby finds it
  through its entry in `src/games.json`.
- `public/shared/` holds code and styles more than one game uses. Move
  something here only once a second game needs it.
  - `css/site.css` is the hub theme used by the lobby and the small games.
  - `css/glass.css` has the frosted glass tokens and classes for full-screen
    games. Everything in it is opt-in through classes.
  - `js/storage.js` wraps `localStorage` so a blocked or full storage never
    throws, and prefixes keys with the game id.
  - `js/format.js` formats numbers, credits and durations.
- `test/` holds `node:test` suites (`*.test.mjs`) and balance simulations.

## Small games and big games

A small game can stay a single classic `game.js` script, like Snake or
Minesweeper.

A bigger game should be split into ES modules loaded with
`<script type="module">`. Driftworks is the example:

| Folder | What goes there | May import from |
| --- | --- | --- |
| `content/` | Data: goods, ships, stations, systems, goals | nothing |
| `core/` | State shape, clock, saves, the session | content, systems |
| `systems/` | Game rules as plain functions on the state | content, core helpers |
| `render/` | Canvas drawing and the camera | content, systems |
| `ui/` | DOM panels, dialogs, wiring | everything above |

Rules of thumb:

- Keep game rules free of DOM access, so they run in Node and can be tested.
- Keep all saved state as plain JSON. Version the save, and add a migration
  in `core/save.js` when its shape changes, so players never lose progress.
- Change state only through the session (`session.act()` in Driftworks),
  which advances the clock, checks goals and saves in one place.

`public/package.json` sets `"type": "module"` so Node treats the browser
modules as ES modules in tests. The browser ignores it.

## Storage keys

Every `localStorage` key starts with the game id: `snake-best`,
`driftworks-save`. Use `createStore('<id>')` from `shared/js/storage.js`.

## Checks

Run these before opening a pull request. CI runs the first two.

```bash
npm run lint
npm test
npm run balance   # when changing Driftworks numbers
```

## Versions

Bump `version` in `package.json` to publish a new image, and bump
`version` and `appVersion` in `helm/games-hub/Chart.yaml` together with it.
