# VerifiedVote — production image (Node app + built SPA)
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite embeds VITE_* at build time (Turnstile site key)
ARG VITE_TURNSTILE_SITE_KEY=
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY

RUN npm run build

# Mock voter roll path when bundled server runs from dist/ (see mock.adapter.ts)
RUN mkdir -p db/seed && cp backend/src/db/seed/voter_roll.json db/seed/voter_roll.json

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/backend/src/db/seed ./backend/src/db/seed
COPY --from=builder /app/db/seed ./db/seed
COPY --from=builder /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "./scripts/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
