# VerifiedVote

VerifiedVote is a secure, remote postal voting application for citizens who cannot vote in person (medical reasons, military service, living abroad, remote work). It combines document review, AI-assisted facial verification, and cryptographic receipt tokens.

**Prototype only** — not ECI-approved or certified for real elections. See [ARCHITECTURE.md](./ARCHITECTURE.md) for design rules, flows, and known limitations.

---

## Key Features

### For Voters
- **Remote ballot requests** — Submit Voter ID, supporting documents, and a baseline selfie for an active election.
- **AI identity verification** — At voting time, a live selfie is compared to the stored baseline (DeepFace VGG-Face + OpenCV liveness).
- **Secret ballot + receipt** — Votes are stored without voter linkage; voters receive a one-time **receipt token** to confirm their vote was recorded (not how they voted).
- **Accessible UI** — Responsive layout, Hindi/English i18n (partial), font-size control, and high-contrast mode.

### For Election Administrators
- **Review queue** — Multi-step approval (reviewer → super admin) with signed document preview.
- **Election management** — Create elections, parties, and candidates; activate request intake; start voting; publish results.
- **Audit trail** — Append-only `audit_logs` and `request_events` for admin and system actions.
- **Session oversight** — View voting sessions, face-pending cases, and revoke sessions when needed.

---

## Architecture

VerifiedVote runs as **three logical services** (see [ARCHITECTURE.md](./ARCHITECTURE.md)):

| Layer | Stack | Role |
|---|---|---|
| **App host** | React 19 + Vite 6 + Express (`server.ts`) | SPA + REST API on one port (3000 in dev) |
| **Backend** | Node.js + TypeScript + **pg** (raw SQL) | Auth, state machines, cron, MinIO, AI proxy |
| **Database** | PostgreSQL (+ `pgcrypto`) | Neon or local/Docker Postgres |
| **Storage** | MinIO | Documents, ID photos, baseline/voting selfies |
| **AI service** | Python FastAPI + DeepFace | `/embed`, `/verify`, `/liveness/blink` |
| **Integrations** | Cloudflare Turnstile, TextBee SMS | Bot protection; immediate OTP SMS + 15s queue backup |

The frontend never calls the AI service directly. All business logic and DB writes live in the Node backend.

---

## Voting Flow

1. **Election setup** — Admin creates an election (state + constituency), adds candidates, and activates it for requests.
2. **Voter auth** — Voter verifies ID (mock roll or future Protean API), completes OTP, and receives a portal JWT.
3. **Request** — Voter uploads documents + baseline selfie; AI extracts an embedding; request enters `pending`.
4. **Review** — Reviewer and super admin approve through `reviewer_approved` → `superadmin_approved` → `final_approved`.
5. **Voting opens** — Super admin starts voting (password) or cron auto-starts on election date; SMS sends an opaque ref link (not a JWT).
6. **Live verify** — Voter opens `/vote?ref=…`, completes OTP, takes a live selfie; AI compares to baseline.
7. **Ballot** — On success, voter casts a vote and receives a receipt token; results publish manually or via cron.

---

## Local Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 16 (local, Docker, or [Neon](https://neon.tech))
- Docker Desktop (recommended for MinIO; optional for Postgres)
- Python 3.11+ (AI service)

### Quick start

```bash
cp backend/.env.example backend/.env    # DATABASE_URL, JWT, MinIO, SMS, AI
cp frontend/.env.example frontend/.env  # VITE_TURNSTILE_SITE_KEY

# Install dependencies for both independent directories
cd frontend && npm install
cd ../backend && npm install

# Run database migrations and seed (inside backend directory)
npm run migrate
npm run seed:admins

cd ..
docker compose up -d minio   # optional but recommended
docker compose up -d         # Starts Postgres, MinIO, AI, Backend (port 3000), Frontend (port 5173)
```

The repository separates `frontend/` (React + Vite) and `backend/` (Express API) into completely independent directories rather than using NPM workspaces. The frontend's Vite config will automatically load environment variables from `frontend/.env` as well as the root project directory (if injected by CI/CD).

Open **http://localhost:3000**.

For Postgres via Docker: `docker compose up -d postgres` and set  
`DATABASE_URL=postgres://verifiedvote:verifiedvote@localhost:5432/verifiedvote`.

### AI service (separate terminal)

```bash
cd ai-service
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 7860
```

Set `AI_SERVICE_URL=http://127.0.0.1:7860` in `.env`. First startup downloads DeepFace weights (several minutes).

Detailed steps: [SETUP.md](./SETUP.md).

### Test credentials

| Role | Credentials |
|---|---|
| **Voter** | `ABC1234567` (Delhi) or `XYZ9876543` (Karnataka) |
| **OTP** | `123456` in dev (also logged if SMS is mocked) |
| **Super admin** | `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` from `.env` |
| **Reviewer** | `REVIEWER_USERNAME` / `REVIEWER_PASSWORD` from `.env` |

Create elections in **Admin → Elections** using the state/constituency dropdowns that match the test voters above.

### Scripts

| Command | Purpose |
|---|---|
| `docker compose up` | Run all services locally (Backend, Frontend, Postgres, MinIO, AI) |
| `npm run dev` (in `backend/`) | Start Express dev server |
| `npm run build` (in `backend/`) | Production build (uses ESBuild via `build.mjs`) |
| `npm run migrate` (in `backend/`) | Apply Postgres migrations |
| `npm run seed:admins` (in `backend/`) | Seed super admin + reviewer |
| `npm test` (in `backend/`) | Unit tests |
| `npm run test:integration` (in `backend/`) | Integration tests |

---

## Documentation

- **[DEPLOY.md](./DEPLOY.md)** — Production deployment (Docker VPS, Fly/Koyeb split)
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Source of truth: invariants, API map, cron jobs, shortcomings
- **[SETUP.md](./SETUP.md)** — Extended local setup (MinIO, AI, SMS, migrations)
