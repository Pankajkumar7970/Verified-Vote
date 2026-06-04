# Deploying VerifiedVote

This guide covers the **recommended single-server Docker deployment** and an optional **split cloud** layout.

**Prototype warning:** Do not use for real elections without legal review, ECI approval, and hardening (HTTPS, secrets management, backups, monitoring).

---

## What you are deploying

| Component | Role |
|---|---|
| **app** | Node.js + built React SPA (port 3000) — API, cron jobs, static UI |
| **postgres** | Primary database |
| **minio** | Document and selfie object storage |
| **ai-service** | FastAPI face verification (CPU-heavy; first start is slow) |

All voter traffic goes to **one URL** (`APP_URL`). The AI service is internal only.

---

## Option A — Docker Compose on a VPS (recommended)

Best for: DigitalOcean, Hetzner, AWS EC2, a home server with a public IP.

### 1. Server requirements

- **OS:** Linux (Ubuntu 22.04+)
- **RAM:** 4 GB minimum (8 GB recommended — DeepFace is memory-hungry)
- **CPU:** 2+ vCPU
- **Docker** + **Docker Compose v2**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in
```

### 2. Clone and configure

```bash
git clone <your-repo-url> verifiedvote
cd verifiedvote
cp .env.production.example .env
```

Edit `.env`:

1. Set **`FRONTEND_URL`** and **`APP_URL`** to your public HTTPS URL (e.g. `https://vote.example.com`).
2. Generate secrets:
   ```bash
   openssl rand -hex 32   # use for each JWT secret and PGCRYPTO_KEY
   ```
3. Set strong **`POSTGRES_PASSWORD`**, **`MINIO_*`**, admin passwords.
4. Add production **Turnstile** keys from [Cloudflare Turnstile](https://dash.cloudflare.com).
5. Set **`VITE_TURNSTILE_SITE_KEY`** (same site key — baked into the frontend at **build** time).
6. Add **TextBee** `TEXTBEE_API_KEY` and `TEXTBEE_DEVICE_ID` for SMS.

### 3. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First boot runs migrations automatically. Seed admins once:

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -e SEED_ADMINS=true -e RUN_MIGRATIONS=false app true
```

Or set `SEED_ADMINS=true` in `.env`, restart `app`, then set back to `false`.

### 4. HTTPS reverse proxy (required for production)

Expose only ports **80/443** on the host — not 3000 publicly. Example with **Caddy**:

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
vote.example.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

**Nginx** works similarly: `proxy_pass http://127.0.0.1:3000` with TLS from Certbot.

Update `.env` so `FRONTEND_URL` / `APP_URL` use `https://vote.example.com`, then rebuild if you changed `VITE_TURNSTILE_SITE_KEY`:

```bash
docker compose -f docker-compose.prod.yml up -d --build app
```

### 5. Verify deployment

```bash
curl -s https://vote.example.com/api/live
curl -s https://vote.example.com/api/health | jq
```

Expect `ai_service: true` when the AI container is healthy (may take 1–2 minutes after first deploy).

| Check | URL |
|---|---|
| Voter portal | `https://vote.example.com/` |
| Admin login | `https://vote.example.com/admin/login` |
| Receipt verify | `https://vote.example.com/verify-receipt` |

### 6. Firewall

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Do **not** expose Postgres (5432), MinIO (9000), or AI (8000) to the internet.

---

## Option B — Split managed services

Best for: lower ops on DB/storage, separate AI scaling.

| Service | Suggested host | Notes |
|---|---|---|
| **Postgres** | [Neon](https://neon.tech) | Use **pooler** URL; set `DB_CONNECT_TIMEOUT_MS=30000` |
| **App** | [Fly.io](https://fly.io), [Railway](https://railway.app), Render | Deploy root `Dockerfile`; set all env vars in dashboard |
| **AI service** | [Koyeb](https://koyeb.com), Fly.io | Deploy `ai-service/Dockerfile`; 2 GB+ RAM |
| **Object storage** | Self-hosted MinIO on VPS, or S3-compatible (Cloudflare R2) | Set `MINIO_ENDPOINT`, keys, `MINIO_USE_SSL=true` |

### Deploy app to Fly.io (outline)

```bash
fly launch --no-deploy
fly secrets set DATABASE_URL="..." PGCRYPTO_KEY="..." VOTER_JWT_SECRET="..." \
  ADMIN_JWT_SECRET="..." SESSION_JWT_SECRET="..." FRONTEND_URL="https://..." \
  APP_URL="https://..." MINIO_ENDPOINT="..." AI_SERVICE_URL="https://your-ai.fly.dev"
fly deploy --build-arg VITE_TURNSTILE_SITE_KEY=your_site_key
```

Run migrations **before** or **after** first deploy:

```bash
fly ssh console -C "npx node-pg-migrate up"
fly ssh console -C "npx tsx backend/src/db/seed/admin.seed.ts"
```

### Deploy AI service to Koyeb (outline)

1. Create app from GitHub, root directory `ai-service`.
2. Use existing `ai-service/Dockerfile`.
3. Set min memory **2048 MB**; scale to 1 instance (model is not multi-worker safe).
4. Copy public URL into app `AI_SERVICE_URL`.

---

## Environment variables checklist

| Variable | Required in prod | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `PGCRYPTO_KEY` | Yes | Min 16 chars; never rotate without re-encrypting data |
| `VOTER_JWT_SECRET` / `ADMIN_JWT_SECRET` / `SESSION_JWT_SECRET` | Yes | Min 32 chars each |
| `SUPER_ADMIN_*` / `REVIEWER_*` | Yes (first seed) | Used by `seed:admins` |
| `FRONTEND_URL` / `APP_URL` | Yes | Public HTTPS origin; CORS in production |
| `MINIO_ENDPOINT` + keys | Yes (recommended) | Without MinIO, files live in memory only |
| `AI_SERVICE_URL` | Yes for face verify | Voting falls back to `face_pending` if down |
| `VITE_TURNSTILE_SITE_KEY` | Yes | **Build-time** Docker arg |
| `TURNSTILE_SECRET_KEY` | Yes | Server-side Turnstile verify |
| `TEXTBEE_*` | For SMS | Without keys, SMS logs to console only |

---

## Updates and rollbacks

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run on container start (`RUN_MIGRATIONS=true`). For zero-downtime at scale, run migrations as a one-off job before swapping containers.

```bash
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml ps
```

---

## Backups

| Data | How |
|---|---|
| **Postgres** | `docker compose exec postgres pg_dump -U verifiedvote verifiedvote > backup.sql` |
| **MinIO** | Snapshot the `miniodata` Docker volume or use MinIO bucket replication |

Schedule daily backups before any pilot.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Container exits on start | `docker compose logs app` — usually missing/invalid env (JWT length, DATABASE_URL) |
| `ai_service: false` | AI still loading; check `docker compose logs ai-service` (model download) |
| Turnstile fails | Site key must match domain; rebuild app after changing `VITE_TURNSTILE_SITE_KEY` |
| CORS errors | `FRONTEND_URL` must exactly match browser origin (scheme + host) |
| Migrations fail | Ensure Postgres is up; run manually: `docker compose exec app npx node-pg-migrate up` |
| Mock voters missing | Ensure `VOTER_VERIFY_MODE=mock` and `db/seed/voter_roll.json` exists in image |

---

## Local production smoke test

Before pushing to a VPS:

```bash
cp .env.production.example .env
# set passwords locally
docker compose -f docker-compose.prod.yml up --build
```

Open http://localhost:3000 — same flow as dev, but `NODE_ENV=production`.

---

## Related docs

- [SETUP.md](./SETUP.md) — local development
- [ARCHITECTURE.md](./ARCHITECTURE.md) — security rules and known gaps
