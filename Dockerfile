# VerifiedVote — production image (Node API + built SPA)
FROM node:20-alpine AS builder

WORKDIR /app

# Install frontend dependencies and build
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci || npm install

COPY frontend ./frontend
ARG VITE_TURNSTILE_SITE_KEY=
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN cd frontend && npm run build

# Install backend dependencies and build
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci || npm install

COPY backend ./backend
RUN cd backend && npm run build

RUN mkdir -p db/seed && cp backend/src/db/seed/voter_roll.json db/seed/voter_roll.json

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache tini

COPY backend/package.json backend/package-lock.json* ./backend/
# Install all dependencies (including dev) because docker-entrypoint.sh uses tsx and node-pg-migrate
RUN cd backend && npm ci && npm cache clean --force

COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/src/db/migrations ./backend/src/db/migrations
COPY --from=builder /app/backend/src/db/seed ./backend/src/db/seed
COPY --from=builder /app/db/seed ./db/seed
COPY --from=builder /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "./scripts/docker-entrypoint.sh"]
CMD ["node", "backend/dist/server.js"]
