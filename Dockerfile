# syntax=docker/dockerfile:1

# ---- Dependencies stage -----------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Runtime stage ------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Run as a non-root user for defense in depth. node:alpine ships a "node"
# user with numeric UID/GID 1000; using it (as a numeric ID) lets
# Kubernetes' runAsNonRoot check verify non-root status without needing to
# resolve /etc/passwd.
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=1000:1000 package.json ./
COPY --chown=1000:1000 server.js ./
COPY --chown=1000:1000 src ./src
COPY --chown=1000:1000 public ./public

USER 1000:1000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
