# Games Hub

A small web application that hosts random, self-contained browser games.
Games are listed on a lobby page and can be added without changing any
server code — just drop a new folder under `public/games/<id>/` and add an
entry to [`src/games.json`](src/games.json).

## Games

| Game | Genre | Notes |
| --- | --- | --- |
| **Snake** | Arcade | Arrow keys / WASD / swipe |
| **Minesweeper** | Puzzle | Click to reveal, right-click or long-press to flag |
| **Pipelines** | Puzzle | Connect matching dots with pipes |
| **Driftworks** (Early Access) | Idle trading | A space trading company for short breaks: mine, trade across a galaxy of systems and grow a fleet between work sessions. Built from ES modules with tests; see [`public/games/driftworks/`](public/games/driftworks/) |

## Project layout

```
.
├── server.js                 # Express server: static hosting + /api/games + /healthz
├── server/                   # Cloud saves: accounts, sessions, saves API, SQL migrations
├── src/games.json            # Game registry (id, title, description, path, thumbnail)
├── public/
│   ├── index.html            # Lobby page
│   ├── js/app.js             # Fetches /api/games and renders game cards
│   ├── shared/               # Code and styles any game can use
│   │   ├── css/site.css      # The hub's theme (lobby and small games)
│   │   ├── css/glass.css     # Frosted glass building blocks for full-screen games
│   │   └── js/               # ES modules: storage.js (safe localStorage), format.js
│   └── games/<id>/           # One folder per game
├── test/                     # node:test suites (shared code, Driftworks) and balance sims
├── eslint.config.mjs
├── Dockerfile                # Multi-stage, non-root, healthchecked image
├── docker-compose.yml        # Local test setup: app + PostgreSQL + Mailpit
├── helm/games-hub/           # Helm chart for Kubernetes deployment
└── .github/workflows/        # CI: lint and test, then build & publish image + Helm chart
```

Small games are a single self-contained `game.js`. Bigger games, like
Driftworks, are split into ES modules (`core/`, `content/`, `systems/`,
`render/`, `ui/`) that load natively in the browser, so there is still no
build step. See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions.

## Adding a new game

1. Create `public/games/<your-game>/` with an `index.html` (and any assets it
   needs). Keep games self-contained — no build step required. Link
   `/shared/css/site.css` for the hub look, and import from
   `/shared/js/` if you write the game as ES modules.
2. Add an entry to `src/games.json`:
   ```json
   {
     "id": "your-game",
     "title": "Your Game",
     "description": "One line describing the game.",
     "path": "/games/your-game/",
     "thumbnail": "/games/your-game/thumbnail.svg",
     "genre": "Puzzle",
     "controls": "Describe controls here"
   }
   ```
   Add `"status": "Early Access"` (or any short label) to show a badge on
   the game's card while it is still being built.
3. Restart the server (or just refresh, in dev mode) — the lobby picks up the
   new entry automatically.

## Local development

Requires Node.js 20+.

```bash
npm install
npm start          # http://localhost:3000
# or, for auto-restart on file changes:
npm run dev

npm run lint       # ESLint over the server, games, shared code and tests
npm test           # node:test suites in test/ (needs Node 22 for the glob)
npm run balance    # Driftworks pacing simulation, e.g. npm run balance -- all 6
```

## Docker

Build and run the container locally:

```bash
docker build -t games-hub .
docker run --rm -p 3000:3000 games-hub
```

The image runs as a non-root user, supports a read-only root filesystem, and
exposes a `/healthz` endpoint used by the built-in `HEALTHCHECK`.

## Deploying with Helm

A chart is provided at [`helm/games-hub`](helm/games-hub), and is also
published as an OCI artifact to GHCR on every release tag (see
[CI/CD](#cicd) below).

```bash
helm lint helm/games-hub
helm template games-hub helm/games-hub | less   # preview rendered manifests

# Install from the local chart source:
helm upgrade --install games-hub helm/games-hub \
  --set image.repository=ghcr.io/<owner>/<repo> \
  --set image.tag=<version>

# ...or install directly from the published OCI chart:
helm upgrade --install games-hub oci://ghcr.io/<owner>/helm/games-hub \
  --version <chart-version>
```

Key values (see [`values.yaml`](helm/games-hub/values.yaml) for the full list):

| Value                | Default                    | Description                          |
| --------------------- | --------------------------- | ------------------------------------ |
| `image.repository`    | `ghcr.io/OWNER/games-hub`   | Container image to deploy            |
| `image.tag`           | chart `appVersion`           | Image tag override — set this to a published version, e.g. `1.0.0` |
| `image.digest`        | `""`                         | Optional digest pin (`sha256:...`), appended as `repository:tag@digest` |
| `service.port`        | `3000`                      | Service & container port             |
| `ingress.enabled`      | `false`                      | Enable an Ingress resource            |
| `autoscaling.enabled` | `false`                      | Enable a HorizontalPodAutoscaler      |
| `resources`           | `50m/64Mi` req, `250m/128Mi` limit | Pod resource requests/limits   |

> **Versioned tags vs. mutable tags:** the image is published with
> immutable version tags (`1.0.0`, `1.0`, `1`) derived from the release's
> `vX.Y.Z` git tag — set `image.tag` to one
> of these for a reproducible deploy; no `image.digest` pin is needed since
> the tag itself never changes content. `image.digest` is still useful if
> you deploy with a mutable tag such as `latest`: with
> `imagePullPolicy: IfNotPresent` (the chart default), Kubernetes only
> checks whether an image already exists locally under that
> `repository:tag` string — it does **not** compare against the registry —
> so a node that already cached an older build of `latest` will keep
> serving it forever, even after the tag is updated. Pinning `image.digest`
> makes that case immutable and guarantees a fresh pull when the digest
> changes.

## Cloud saves

Players can keep their saves on the server and continue on any device.
Cloud saves are off unless the server is started with `CLOUD_SAVES=true`;
without them the hub needs no database and games save in the browser only.

- **Accounts without personal data.** Signing up gives the player a random
  16-digit account number to log in with. An email for recovery is
  optional. Both are stored only as keyed hashes (HMAC-SHA256 with a server
  secret, the *pepper*), so the database alone reveals neither.
- **Saves.** Driftworks keeps playing from the browser's save, works
  offline, and pushes it to the cloud every 30 seconds and when the tab is
  hidden. When this device and the cloud both have progress the other
  lacks, the player picks which save to keep; the other is kept on the
  device and can be loaded later. Nothing is overwritten silently.
- **Recovery.** Linking an email sends a confirmation there; right after
  sign up it also contains the account number (the server checks the number
  belongs to the account before mailing it). Skipping the email asks once
  more, since a lost number cannot be recovered without one.
  With mail configured, a player can enter their email and
  receive a new number; the old number stops working. Without mail the
  option is hidden.
- **Server.** PostgreSQL, schema migrations applied on start
  ([`server/migrations/`](server/migrations)), rate limits on sign up, log
  in and recovery, and a save size limit. Logs never contain numbers,
  emails, tokens or IP addresses.

### The pepper: back it up

Account numbers and emails can only be checked with the pepper. **If the
pepper is lost or changed, every player is locked out** and every recovery
email stops matching; there is no way to rotate it. The chart generates one
on first install, keeps it on upgrades and does not delete it on
`helm uninstall`. Back it up next to your database backups (the secret is named `<release fullname>-pepper`, `games-hub-pepper` for a release called `games-hub`):

```bash
kubectl get secret games-hub-pepper -o jsonpath='{.data.pepper}' > pepper.b64
```

If you render the chart without a cluster connection (`helm template`,
Argo CD, Flux), Helm cannot see the existing secret and would make a new
pepper on every render. Create the secret yourself and set
`cloudSaves.pepper.existingSecret` instead:

```bash
kubectl create secret generic games-hub-pepper --from-literal=pepper="$(openssl rand -base64 48)"
```

### Database: bundled or your own

**Bundled PostgreSQL** (a single-replica StatefulSet with the official
`postgres` image and a persistent volume; the password is generated):

```bash
helm upgrade --install games-hub oci://ghcr.io/<owner>/helm/games-hub --version <version> \
  --set cloudSaves.enabled=true \
  --set postgresql.enabled=true
```

**Your own PostgreSQL server** (create the database and user first, and a
Secret with the password):

```bash
kubectl create secret generic games-hub-db --from-literal=password='<password>'
helm upgrade --install games-hub oci://ghcr.io/<owner>/helm/games-hub --version <version> \
  --set cloudSaves.enabled=true \
  --set externalDatabase.host=postgres.example.internal \
  --set externalDatabase.database=games \
  --set externalDatabase.username=games \
  --set externalDatabase.existingSecret=games-hub-db \
  --set externalDatabase.sslMode=require
```

**Mail for recovery** (optional; a Secret with `username` and `password`
for the SMTP login):

```bash
  --set mail.enabled=true \
  --set mail.host=smtp.example.com \
  --set mail.port=587 \
  --set mail.from='Games Hub <noreply@example.com>' \
  --set mail.existingSecret=games-hub-smtp
```

Cloud saves need **one replica**: rate limits are kept in memory, so the
chart refuses to render with `replicaCount` above 1 or autoscaling on.

| Value | Default | Description |
| --- | --- | --- |
| `cloudSaves.enabled` | `false` | Turn on accounts and cloud saves |
| `cloudSaves.pepper.existingSecret` | `""` | Secret with the pepper (generated when empty) |
| `cloudSaves.maxSaveBytes` | `1048576` | Largest save accepted |
| `cloudSaves.trustProxy` | `"1"` | Proxy hops in front of the app (`"false"` for none) |
| `postgresql.enabled` | `false` | Deploy the bundled PostgreSQL |
| `postgresql.persistence.size` | `1Gi` | Its volume size |
| `externalDatabase.host` | `""` | Your PostgreSQL server, when not bundled |
| `externalDatabase.existingSecret` | `""` | Secret with its password (required) |
| `externalDatabase.sslMode` | `disable` | `disable`, `require` or `verify-full` |
| `mail.enabled` | `false` | Send recovery mail (recovery is hidden otherwise) |

### Running it locally

[`docker-compose.yml`](docker-compose.yml) starts the app with cloud saves,
a PostgreSQL database and [Mailpit](https://mailpit.axllent.org/), which
catches recovery mail:

```bash
docker compose up --build
# Games:   http://localhost:3000
# Mailbox: http://localhost:8025
docker compose down -v   # stop and wipe the test database
```

To work on the server with `npm run dev`, start only the database and the
mailbox and point the app at them:

```bash
docker compose up -d db mail
CLOUD_SAVES=true CLOUD_PEPPER=local-test-pepper-not-secret-0123456789 \
  DATABASE_URL=postgres://games:games@localhost:5432/games COOKIE_SECURE=false \
  SMTP_HOST=localhost SMTP_PORT=1025 npm run dev

# The API tests run against a database when TEST_DATABASE_URL is set (CI does).
# They drop and recreate the cloud save tables, so give them a database of their own:
docker compose exec db createdb -U games games_test
TEST_DATABASE_URL=postgres://games:games@localhost:5432/games_test npm test
```

Server settings: `CLOUD_SAVES`, `CLOUD_PEPPER` (32+ characters),
`DATABASE_URL` or the usual `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`,
`DB_SSL`, `MAX_SAVE_BYTES`, `TRUST_PROXY`, `COOKIE_SECURE`, and for mail
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
`MAIL_FROM`.

## CI/CD

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
runs on every pull request, every push to `main`, every `v*` tag, and on
manual dispatch. Only a `vX.Y.Z` tag on a commit that is on `main` publishes
anything; every other run builds and checks without pushing.

- **`check`** runs `npm run lint` and `npm test` on Node 22. The image
  build and chart packaging wait for it.
- **`version`** runs [`scripts/release-version.sh`](scripts/release-version.sh),
  which turns a `vX.Y.Z` tag into the version `X.Y.Z` after checking the
  tagged commit is on `main`. Every other run gets `0.0.0-dev` and is not a
  release.
- **`build-and-push`** builds a multi-arch (`linux/amd64`, `linux/arm64`)
  image. On a release it pushes it to `ghcr.io/<owner>/<repo>`, tagged
  `X.Y.Z`, and also `X.Y`, `X` and `latest` unless the version is a
  prerelease (`X.Y.Z-rc.1`). The version is also set as `APP_VERSION` in
  the container.
- **`package-and-push-chart`** lints the Helm chart and packages it with
  `version` and `appVersion` set to the release version. On a release it
  pushes it as an OCI artifact to `ghcr.io/<owner>/helm/games-hub`.
- **`release`** creates a GitHub release for the tag, with install
  instructions, notes generated from the pull requests merged since the
  previous tag, and the packaged chart attached.

See [CONTRIBUTING.md](CONTRIBUTING.md#releases) for how to cut a release.

No extra setup is required — the workflow authenticates using the
automatically provisioned `GITHUB_TOKEN`. Make sure the repository's
**Settings → Actions → General → Workflow permissions** allows
"Read and write permissions" (or that packages write access is granted),
and that the resulting packages' visibility is set as desired under
**Packages** on GitHub.
