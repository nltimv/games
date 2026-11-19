# Usage data (analytics)

The hub and its games send anonymous usage events to the hub's own server.
They are stored in PostgreSQL and shown in Grafana. Nothing goes to a
third party. The player-facing explanation is [`/privacy`](../public/privacy.html).

```
Lobby, every game, Driftworks apps
  └─ public/shared/js/telemetry.js ── batched POST /api/events ──► server/telemetry.js ─► events table
                                                                                         ▲
                                                                       Grafana (read-only login)
```

## Privacy rules

These are what make the setup fit the Dutch analytics cookie exemption
(no consent banner) and GDPR's legitimate interest. Keep them when you
add events.

- **No personal data in events.** Never send save names, save codes, emails
  or any free text a player typed. The server keeps only the events and
  properties listed in [`server/telemetryEvents.js`](../server/telemetryEvents.js)
  and drops everything else.
- **Random ids only.** `install_id` is a random UUID per browser or app
  install (`games-telemetry-id` in localStorage). `session_id` is new after
  30 minutes without events. `save_id` is a random id per Driftworks save
  per device, kept apart from the save (`driftworks-usage-saves`), so it
  never travels with a cloud save and cannot be joined to one.
- **No IP addresses** or user agents are stored. The client sends coarse
  device facts instead (OS, browser, device type, screen rounded to 50 px,
  language, time zone).
- **Opt-out.** Players can turn it off on `/privacy` and in Driftworks'
  Settings. Turning it off sends one `analytics_off` event, deletes the
  install id and stops. Global Privacy Control and Do Not Track turn it off too.
- **Retention.** Rows older than `TELEMETRY_RETENTION_DAYS` (395 days, about
  13 months) are deleted daily.
- **EU hosting.** The privacy page says the data stays in the EU. Keep the
  database and its backups there.

## Turning it on

Server environment:

| Variable | Meaning |
| --- | --- |
| `TELEMETRY=true` | Accept events (needs `DATABASE_URL` or the `PG*` variables, like cloud saves) |
| `TELEMETRY_RETENTION_DAYS` | Days to keep events (default 395) |
| `TELEMETRY_READER_USER`, `TELEMETRY_READER_PASSWORD` | Create or update a login that may only `SELECT` from `events`, for Grafana |

Without `TELEMETRY` the server answers `/api/events` with 404, and each page
stops sending after its first try.

Helm:

```bash
helm upgrade --install games-hub helm/games-hub \
  --set postgresql.enabled=true \
  --set telemetry.enabled=true \
  --set grafana.enabled=true
# Grafana's admin password:
kubectl get secret games-hub-grafana -o jsonpath='{.data.password}' | base64 -d
kubectl port-forward svc/games-hub-grafana 3000:3000   # http://localhost:3000
```

Or expose it with `grafana.ingress.enabled` and `grafana.ingress.host`.
Grafana runs with its update checks, usage reporting and plugin downloads
turned off.

With an external database, the app's user may not be allowed to create
roles. Create the reader by hand once, and point
`telemetry.reader.existingSecret` at a Secret with its password:

```sql
CREATE ROLE games_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE games TO games_reader;
GRANT USAGE ON SCHEMA public TO games_reader;
GRANT SELECT ON events TO games_reader;
```

Locally, `docker compose up --build` turns usage data on as well; look at
the rows with `psql postgres://games:games@localhost:5432/games -c 'TABLE events'`.

## Dashboards

Built by [`scripts/dashboards.mjs`](../scripts/dashboards.mjs) into
`helm/games-hub/dashboards/*.json`. Edit the script, then run
`npm run dashboards`. A test fails when the JSON is out of date, and runs
every query against PostgreSQL in CI.

- **Games Hub: overview.** Players, new players, sessions, session length,
  players per day, platform, device type, OS, browser, language, time zone,
  screen size, games played, lobby clicks, referrers, small game rounds,
  weekly retention (day 1, 7, 30), time away between sessions, script errors,
  event volume and opt-outs.
- **Driftworks.** Goal funnel for new saves, where inactive saves stopped,
  reach and median time per goal (played minutes and real hours, to compare
  with the balance bots), tutorial skips, act lengths, versions, research,
  ships, contracts and missions, shortcut discovery (Copy orders, Repeat to
  fill), menus, saves and cloud prompts.

Both filter by platform (web, Android, iOS); Driftworks also by game version.

## Events

Common fields on every row: `at`, `game` (`hub`, `driftworks`, `snake`,
`minesweeper`, `pipelines`), `name`, `install_id`, `session_id`, `save_id`
(Driftworks), `version` (Driftworks' `GAME_VERSION`), `platform` (`web`,
`android`, `ios`), `props`.

### Every page

| Event | When | Props |
| --- | --- | --- |
| `session_start` | First event, or first after 30 minutes without one | `away_min` (bucketed) or `first` |
| `app_open` | A page loads | `page`, `first_open`, `os`, `browser`, `device`, `screen`, `touch`, `lang`, `tz`, `referrer` (other site's host, `internal` or `direct`) |
| `session_heartbeat` | Every 5 minutes while on screen | |
| `js_error` | First 3 script errors on a page | `message` (digits stripped), `source` |
| `analytics_off` | The player turned usage data off | |

### Lobby and small games

| Event | Props |
| --- | --- |
| `game_card_clicked` | `target` (game id) |
| `game_started` | `mode` (Minesweeper difficulty), `level` (Pipelines) |
| `game_ended` | `result` (`won`, `lost`, `perfect`), `length_s`, `score`, `mode`, `level` |

### Driftworks

Progress events come from [`core/usage.js`](../public/games/driftworks/core/usage.js),
which compares the company before and after every change, so the game rules
hold no usage code.

| Event | Props |
| --- | --- |
| `save_created` | `kind` (`new`, `from_code`, `adopted_legacy`), `saves_on_device` |
| `save_opened` | `kind` (`new`, `continue`, `resumed`), `act`, `goal_index` |
| `save_started_over` | `reason` |
| `goal_completed` | `goal_id`, `goal_index`, `act`, `tutorial`, `played_min`, `age_h`, `credits` (2 significant figures), `ships` |
| `act_completed` | `act`, `played_min`, `age_h` |
| `tutorial_skipped` | `goal_id`, `goal_index`, `act`, `played_min` |
| `progress_snapshot` | On leaving: `act`, `goal_index` (next goal), `played_min`, `age_h`, `credits`, `ships`, `research_done`, `systems_known`, `contracts`, `missions`, `copies`, `repeats` |
| `research_started`, `research_completed` | `research_id`, `played_min` |
| `ship_built`, `ship_salvaged` | `hull`, `fleet_size` |
| `contract_accepted`, `contract_completed` | `played_min` |
| `mission_started`, `commander_hired`, `derelict_salvaged` | running count |
| `system_surveyed` | `count` at 1, 2, 5, 10, 25, 50, 100, 150, 200 |
| `menu_view` | `view`, `from` (`main`, `game`) |
| `whats_new_viewed` | `auto` |
| `away_report_shown` | `away_min`, `log_entries` |
| `settings_changed` | `setting`, `value` |
| `cloud_code_prompt` | `choice` (`email_added`, `skipped`) |
| `cloud_conflict` | `choice` (`device`, `cloud`, `later`) |
| `cloud_sync_failed` | `state` |

`played_min` is time with the save on screen on this device; `age_h` is
real time since the company was founded.

## Adding an event

1. Add it, with its props and their types, to `server/telemetryEvents.js`.
   The server drops events it does not know.
2. Call `track(name, props)` from `public/shared/js/telemetry.js` (ES
   modules) or `window.gamesTelemetry?.track(name, props)` (classic scripts).
   It does nothing when usage data is off and never throws.
3. If it is something players would not expect, add it to `/privacy`.
4. Add a panel in `scripts/dashboards.mjs` and run `npm run dashboards`.

## App stores

Answers for the store forms, which match what the apps send:

- **Google Play, Data safety:** collected, not shared. "App activity: App
  interactions" and "App info and performance: Crash logs, Diagnostics".
  Purpose: Analytics. Not linked to the user's identity. Optional (the
  player can turn it off). Encrypted in transit. Deletion: the player turns
  it off; data is deleted after 13 months.
- **App Store, App Privacy:** "Usage Data: Product Interaction" and
  "Diagnostics: Crash Data, Other Diagnostic Data", used for Analytics, not
  linked to the user, not used for tracking. No App Tracking Transparency
  prompt is needed: nothing is shared with other companies or linked across
  apps.
- Privacy policy URL for both: `https://games.nltimv.com/privacy`.
