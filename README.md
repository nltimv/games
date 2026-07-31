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
helm upgrade --install games-hub oci://ghcr.io/<owner>/charts/games-hub \
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
  `ghcr.io/<owner>/charts/games-hub`, tagged with the chart's `version`
  field in [`Chart.yaml`](helm/games-hub/Chart.yaml) — bump that whenever
  the chart templates/values change.

No extra setup is required — the workflow authenticates using the
automatically provisioned `GITHUB_TOKEN`. Make sure the repository's
**Settings → Actions → General → Workflow permissions** allows
"Read and write permissions" (or that packages write access is granted),
and that the resulting packages' visibility is set as desired under
**Packages** on GitHub.
