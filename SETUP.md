# VerifiedVote — Local Setup Guide

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, security rules, and known prototype limitations.

---

## 1. Prerequisites

- Node.js 20+
- PostgreSQL 16 (local install, Docker, or Neon URL in `.env`)
- Docker Desktop (recommended for MinIO; optional for Postgres)
- Python 3.11+ (AI service — used at **request submit** and **voting time**)

---

## 2. Install, migrate, run

```bash
cd VerifiedVote
npm install
cp .env.example .env   # edit with your values
npm run migrate        # required — applies all migrations
npm run seed:admins
npm run dev
```

Open http://localhost:3000

**Port in use:** stop the other process (`Ctrl+C`) or set `PORT=3001` in `.env`.

### Postgres options

**Neon:** set `DATABASE_URL` to your pooler URL; allow 30s+ cold start (`DB_CONNECT_TIMEOUT_MS=30000`).

**Docker:**

```bash
docker compose up -d postgres
```

```env
DATABASE_URL=postgres://verifiedvote:verifiedvote@localhost:5432/verifiedvote
```

### Test accounts

| Role | Credentials |
|---|---|
| Voter | `ABC1234567` or `XYZ9876543`, OTP `123456` |
| Super admin | `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` |
| Reviewer | `REVIEWER_USERNAME` / `REVIEWER_PASSWORD` |

### Election regions (must match mock voters)

| Voter ID | Constituency | State |
|---|---|---|
| ABC1234567 | NEW DELHI | DELHI |
| XYZ9876543 | BANGALORE SOUTH | KARNATAKA |

Create elections via **Admin → Elections** dropdowns, then **Activate** (admin password required).

---

## 3. MinIO (documents & selfies)

Stores supporting documents, voter ID photos, request baseline selfies, and voting-time selfies. MinIO object keys are encrypted in the database; admins access files via short-lived signed URLs.

### Option A — Docker (recommended)

```bash
docker compose up -d minio
```

Console: http://localhost:9001 (`minioadmin` / `minioadmin`)

```env
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET_NAME=verifiedvote-docs
MINIO_USE_SSL=false
```

Restart `npm run dev` after changing MinIO settings.

### Option B — No MinIO (dev fallback)

Leave `MINIO_ENDPOINT` unset. Uploads may use in-memory fallback (lost on restart). Admin preview may use `GET /api/admin/doc-preview?key=<uuid>`.

---

## 4. AI service

The FastAPI service handles:

- **Request submission** — `/embed` (baseline embedding + passive liveness) and optional `/liveness/blink`
- **Voting session** — `/verify` (live selfie vs stored embedding; MinIO photo fallback if embedding fails)

### Start Python service

```bash
cd ai-service
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

First start downloads DeepFace VGG-Face weights (can take several minutes).

### Configure backend

```env
AI_SERVICE_URL=http://127.0.0.1:8000
AI_SERVICE_TIMEOUT_MS=10000
```

Verify:

```bash
curl http://127.0.0.1:8000/health
curl http://localhost:3000/api/health
```

When healthy, `/api/health` reports `ai_service: true`.

If the AI service is down during voting, sessions move to **`face_pending`** (never auto-rejected).

### End-to-end test path

1. Voter logs in → submits request (selfie triggers AI embed if service is up)
2. Reviewer + super admin approve through the queue
3. Super admin **Start voting** (password) — or wait for cron on election date
4. Voter opens `/vote?ref=…` from SMS/logs → OTP `123456` → live selfie → ballot

---

## 5. SMS (development)

Production target is TextBee (dev) / MSG91 (future). Today:

- OTP SMS (`auth_otp`, `voting_otp`) dispatch immediately after the API commits; `send-sms` cron processes any remaining `notifications` every 15s
- Without `TEXTBEE_API_KEY` and `TEXTBEE_DEVICE_ID`, SMS is mocked to the server console:

```
[MOCK SMS] To +91XXXXXXXXXX: Your OTP is ...
```

`SMS_PROVIDER` is documented but not yet wired to a provider factory — TextBee is used directly.

---

## 6. Migrations

| Migration | Purpose |
|---|---|
| `1715420000000_init-schema` | Core tables, pgcrypto, partial unique index |
| `1715420000001_fixes` | `notifications.metadata`, election status renames |
| `1715420000002_request_docs` | `voter_id_photo_minio_key`, `request_selfie_minio_key` |
| `1715500000000_add-voting-selfie` | `voting_sessions.voting_selfie_minio_key` |
| `1715510000000_session-baseline` | Session baseline embedding + MinIO snapshot columns |

Apply manually if needed:

```bash
npx node-pg-migrate up --envPath .env
```

---

## 7. Optional environment flags

| Variable | Effect |
|---|---|
| `ENABLE_AUDIT_LOG_PURGE=true` | Daily cron deletes `audit_logs` older than 1 year (off by default) |
| `VOTER_VERIFY_MODE=protean` | Selects Protean adapter — **stub only**; use `mock` for local dev |
| `DB_STARTUP_MAX_ATTEMPTS` | Limit DB retry before cron jobs start (0 = retry forever) |

---

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| `internal_error` on voter verify | Run `npm run migrate` |
| Turnstile failures locally | Use test keys in `.env.example` or clear `TURNSTILE_SECRET_KEY` |
| `ai_service: false` in health | Start uvicorn; confirm `AI_SERVICE_URL` |
| Cron jobs not running | Wait for DB connectivity; see `/api/startup-status` |
| Neon timeouts | Use pooler URL; increase `DB_CONNECT_TIMEOUT_MS` |
