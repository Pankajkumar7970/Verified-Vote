# VerifiedVote — local setup guide

## 1. Prerequisites

- Node.js 20+
- PostgreSQL (or Neon URL in `.env`)
- Optional: Docker Desktop (for MinIO)
- Optional: Python 3.10+ (for AI face service at vote time)

## 2. Install and database

```bash
cd VerifiedVote
npm install
cp .env.example .env   # then edit with your values
npm run migrate        # run ALL migrations (required!)
npm run seed:admins
npm run dev
```

Open http://localhost:3000

**If port 3000 is in use:** stop the other terminal (`Ctrl+C`) or set `PORT=3001` in `.env`.

### Test accounts

| Role | Credentials |
|------|-------------|
| Voter | `ABC1234567` or `XYZ9876543`, OTP `123456` (dev) |
| Admin | Values from `.env`: `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` |

### Election regions (must match voters)

| Voter ID | Constituency | State |
|----------|--------------|-------|
| ABC1234567 | NEW DELHI | DELHI |
| XYZ9876543 | BANGALORE SOUTH | KARNATAKA |

Create elections using the **dropdown** on Admin → Elections, then **Activate** (admin password).

---

## 3. MinIO setup (document & photo storage)

MinIO stores supporting documents, voter ID photos, and baseline selfies.

### Option A — Docker (recommended)

```bash
docker compose up -d minio
```

MinIO console: http://localhost:9001 (login `minioadmin` / `minioadmin`)

Add to `.env`:

```env
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET_NAME=verifiedvote-docs
MINIO_USE_SSL=false
```

Restart `npm run dev`. Admin “View document” links use real presigned URLs.

### Option B — No MinIO (dev mock)

Leave `MINIO_ENDPOINT` unset. Files are stored **in server memory** (lost on restart). Admin preview uses:

`GET /api/admin/doc-preview?key=<uuid>`

---

## 4. AI service setup (voting face verify only)

The AI service is **not** used when submitting a postal ballot request (manual review). It runs when a voter opens their **voting link** and takes a live selfie.

### Start the Python service

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

First start downloads DeepFace models (can take several minutes).

### Configure Node backend

In `.env`:

```env
AI_SERVICE_URL=http://127.0.0.1:8000
AI_SERVICE_TIMEOUT_MS=10000
```

Verify:

```bash
curl http://localhost:8000/health
curl http://localhost:3000/api/health
```

`ai_service` should be `true` when both are running.

### Voting flow test

1. Voter submits request (camera + voter ID photo + document) — **no AI**
2. Admin approves request
3. Admin **Start voting** (password) — SMS queued (see server logs if TextBee not wired)
4. Voter opens `/vote?ref=...`, OTP `123456`, live selfie — **AI runs here**

---

## 5. SMS (testing)

TextBee is not fully wired; OTPs are logged:

```
[TextBee Mock SMS] To: +91... | message: ...
```

Pending notifications are processed every 60s by the send-SMS cron inside `npm run dev`.

---

## 6. Migrations

| Migration | Purpose |
|-----------|---------|
| `1715420000000_init-schema` | Core tables |
| `1715420000001_fixes` | `notifications.metadata`, election status renames |
| `1715420000002_request_docs` | `voter_id_photo_minio_key`, `request_selfie_minio_key` |

```bash
npx node-pg-migrate up --envPath .env
```
