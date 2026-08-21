# Games Hub

A small web application that hosts random, self-contained browser games.
Games are listed on a lobby page and can be added without changing any
server code — just drop a new folder under `public/games/<id>/` and add an
entry to [`src/games.json`](src/games.json).

Includes **Snake** as the example game (arrow keys / WASD / swipe).

## Project layout

```
.
├── server.js                 # Express server: static hosting + /api/games + /healthz
├── src/games.json            # Game registry (id, title, description, path, thumbnail)
├── src/seed-table.js         # Binary format for pre-compiled Pipelines levels
├── tools/build-seeds.js      # Builds a seed table (see "Pipelines seed tables")
├── tools/check-seeds.js      # Re-verifies a sample of a built table
├── public/
│   ├── index.html            # Lobby page
│   ├── css/styles.css
│   ├── js/app.js             # Fetches /api/games and renders game cards
│   └── games/snake/          # Example game (self-contained HTML/CSS/JS)
├── Dockerfile                 # Multi-stage, non-root, healthchecked image
├── helm/games-hub/            # Helm chart for Kubernetes deployment
└── .github/workflows/         # CI: build & publish image + Helm chart to GHCR
```

## Adding a new game

1. Create `public/games/<your-game>/` with an `index.html` (and any assets it
   needs). Keep games self-contained — no build step required.
2. Add an entry to `src/games.json`:
   ```json
   {
     "id": "your-game",
     "title": "Your Game",
     "description": "One line describing the game.",
     "path": "/games/your-game/",
     "thumbnail": "/games/your-game/thumbnail.svg",
     "controls": "Describe controls here"
   }
   ```
3. Restart the server (or just refresh, in dev mode) — the lobby picks up the
   new entry automatically.

## Local development

Requires Node.js 20+.

```bash
npm install
npm start          # http://localhost:3000
# or, for auto-restart on file changes:
npm run dev
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
published as an OCI artifact to GHCR on every push to `main` (see
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
> immutable version tags (`1.0.0`, `1.0`, `1`) derived from
> [`package.json`](package.json)'s `version` field — set `image.tag` to one
> of these for a reproducible deploy; no `image.digest` pin is needed since
> the tag itself never changes content. `image.digest` is still useful if
> you deploy with a mutable tag such as `latest` or `main`: with
> `imagePullPolicy: IfNotPresent` (the chart default), Kubernetes only
> checks whether an image already exists locally under that
> `repository:tag` string — it does **not** compare against the registry —
> so a node that already cached an older build of `latest` will keep
> serving it forever, even after the tag is updated. Pinning `image.digest`
> makes that case immutable and guarantees a fresh pull when the digest
> changes.

## Pipelines seed tables

Pipelines generates every level from the level number alone, and checks in the
browser that the level it built has exactly one solution. That check gets
expensive as the boards grow: an 11x11 takes a moment, and a 12x12 regularly
cannot be decided inside any budget a page load can spare.

A level is a pure function of `(size, pipes, seed)`, so the search can be moved
offline. `tools/build-seeds.js` hunts for seeds that produce single-solution
boards and writes the winners to a binary table; the server hands them out and
the browser rebuilds exactly those boards without repeating the search. The
table is 8 bytes per level -- 80 KB for ten thousand levels, 8 MB for a million.

Everything about it is optional. No table, no server, a table that stops short
of the level being played, an unreachable API -- the game notices, generates
locally, and plays on.

### Building a table

```bash
# 10k levels across every core; -h lists the knobs
npm run seeds:build -- --levels 10000 --jobs 64

# resume an interrupted build
npm run seeds:build -- --levels 10000 --resume

# re-verify a sample of what was built
npm run seeds:check -- data/pipelines-seeds.bin --sample 200
```

Each level's search walks its pipe count from sparse to dense and keeps the
first board with a single solution -- sparse first, because few long pipes on a
big board is both the interesting kind of level and the hard kind to pin down.
A level that will not verify inside `--level-timeout` is still written, marked
unverified, with the best-formed board found; it is always completable, it just
has not been proven singular. Boards up to 11x11 verify readily. A 12x12 mostly
does not, for a reason no amount of CPU fixes: uniqueness wants pipes of five or
six cells, which at that size means far more pipes than a player can tell apart
by colour.

Workers are independent processes and levels are independent of each other, so
the build scales with cores almost perfectly. Results are buffered and written a
chunk at a time (`--chunk`, default 4096 records), and Ctrl-C leaves a valid
table holding everything finished so far.

### Serving it

The server reads the table once into memory and answers from there, re-checking
the file's mtime every few seconds so a rebuild lands without a restart.

```
GET /api/pipelines/seeds?from=17&count=24   # a window; what the game asks for
GET /api/pipelines/seeds/17                 # a single level
```

Both answer with the table's `total`, `buildId` and `generator`, are cacheable
for an hour, and revalidate with an ETag. `503` means no table is deployed.

Point the server at a table with `PIPELINES_SEEDS` (default
`data/pipelines-seeds.bin`). In Kubernetes the chart's existing `volumes`,
`volumeMounts` and `env` values are enough -- mount a PVC or ConfigMap and set
the variable:

```yaml
env:
  - name: PIPELINES_SEEDS
    value: /data/pipelines-seeds.bin
volumes:
  - name: seeds
    persistentVolumeClaim:
      claimName: pipelines-seeds
volumeMounts:
  - name: seeds
    mountPath: /data
    readOnly: true
```

### When the generator changes

A seed only means anything to the code that produced it. `GENERATOR_VERSION` in
`public/games/pipelines/game.js` is stamped into every table; bump it whenever a
change would make `(size, pipes, seed)` describe a different board -- the chain
mixing, the climb, the cut, the colour shuffle. The game ignores a table whose
version does not match its own and generates locally instead, rather than
serving boards whose verification is no longer true of them. `npm run
seeds:check` fails loudly on the same mismatch.

## CI/CD

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
runs two jobs on every push to `main`, on pull requests (build/lint only,
no push), and on manual dispatch:

- **`build-and-push`** builds a multi-arch (`linux/amd64`, `linux/arm64`)
  image and publishes it to the
  [GitHub Container Registry](https://ghcr.io) at `ghcr.io/<owner>/<repo>`.
  Images are tagged with the app version, major.minor, and major (all read
  from [`package.json`](package.json)'s `version` field — bump it to
  publish a new version), the branch name, the short git SHA, and `latest`
  (on the default branch only).
- **`package-and-push-chart`** lints the Helm chart, packages it (stamping
  `appVersion` from `package.json`), and pushes it as an OCI artifact to
  `ghcr.io/<owner>/helm/games-hub`, tagged with the chart's `version`
  field in [`Chart.yaml`](helm/games-hub/Chart.yaml) — bump that whenever
  the chart templates/values change.

No extra setup is required — the workflow authenticates using the
automatically provisioned `GITHUB_TOKEN`. Make sure the repository's
**Settings → Actions → General → Workflow permissions** allows
"Read and write permissions" (or that packages write access is granted),
and that the resulting packages' visibility is set as desired under
**Packages** on GitHub.
