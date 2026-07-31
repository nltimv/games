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

# Run as a non-root user for defense in depth.
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
