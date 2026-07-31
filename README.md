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
└── .github/workflows/         # CI: build & publish image to GHCR
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

A chart is provided at [`helm/games-hub`](helm/games-hub).

```bash
helm lint helm/games-hub
helm template games-hub helm/games-hub | less   # preview rendered manifests

helm upgrade --install games-hub helm/games-hub \
  --set image.repository=ghcr.io/<owner>/<repo> \
  --set image.tag=<tag>
```

Key values (see [`values.yaml`](helm/games-hub/values.yaml) for the full list):

| Value                | Default                    | Description                          |
| --------------------- | --------------------------- | ------------------------------------ |
| `image.repository`    | `ghcr.io/OWNER/games-hub`   | Container image to deploy            |
| `image.tag`           | chart `appVersion`           | Image tag override                   |
| `service.port`        | `3000`                      | Service & container port             |
| `ingress.enabled`      | `false`                      | Enable an Ingress resource            |
| `autoscaling.enabled` | `false`                      | Enable a HorizontalPodAutoscaler      |
| `resources`           | `50m/64Mi` req, `250m/128Mi` limit | Pod resource requests/limits   |

## CI/CD

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
builds a multi-arch (`linux/amd64`, `linux/arm64`) image on every push to
`main` and on version tags (`v*.*.*`), and publishes it to the
[GitHub Container Registry](https://ghcr.io) at
`ghcr.io/<owner>/<repo>`. Pull requests build the image (to catch build
failures) without pushing. Images are tagged with the branch name, semver
(on tags), the short git SHA, and `latest` (on the default branch).

No extra setup is required — the workflow authenticates using the
automatically provisioned `GITHUB_TOKEN`. Make sure the repository's
**Settings → Actions → General → Workflow permissions** allows
"Read and write permissions" (or that packages write access is granted),
and that the resulting package's visibility is set as desired under
**Packages** on GitHub.
