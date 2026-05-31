# ARCHITECTURE.md — VerifiedVote

**Version 2.0** — Reflects the codebase as implemented (May 2026).  
Seed this file to every AI assistant before writing any code.  
When in doubt, refer here before generating any code, schema, query, or config.

---

## What This Project Is

VerifiedVote is a secure remote voting authorization platform that digitizes the postal ballot workflow for verified exceptional-case voters (disabled, military, NRI, remote workers) in India.

It is **NOT** a general-purpose voting platform.  
It is **NOT** ECI-approved or government-certified software.  
It is a **civic-tech research prototype** requiring institutional approval before real election use.

---

## What This File Is For

This file exists because development is AI-assisted. Every AI assistant working on this project must read and follow this file before writing a single line of code, schema, query, or config.

Violations of rules in this file are not style issues — they are security and correctness issues. Do not deviate from these rules without explicit human approval and a documented reason.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React 19 + Vite + Tailwind 4)                         │
│  Routes: /  /otp  /dashboard  /request  /vote  /admin/*         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP (same origin in dev/prod)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Express (server.ts)                                    │
│  • All business logic, auth, DB, SMS queue, MinIO, AI proxy   │
│  • Serves Vite dev middleware (dev) or static dist (prod)       │
│  • node-cron jobs via setInterval + Postgres advisory locks     │
└───────┬─────────────────┬──────────────────┬──────────────────┘
        │                 │                  │
        ▼                 ▼                  ▼
  PostgreSQL          MinIO (S3)      FastAPI AI Service
  (Neon or local)     object storage   DeepFace + OpenCV
```

| Component | Language / Stack | Purpose |
|---|---|---|
| **Frontend + API host** | React + Vite + Express (`server.ts`) | UI only on the client; all validation and auth on the server |
| **Backend logic** | TypeScript in `backend/src/` | Routes, services, cron, crypto, state machines |
| **Database** | PostgreSQL via `pg` (node-postgres) | All persistent state; `pgcrypto` for column encryption |
| **Object storage** | MinIO | Supporting documents, voter ID photos, baseline/voting selfies |
| **AI service** | Python 3.11+ FastAPI | Face embedding, comparison, passive + active (blink) liveness |
| **SMS** | TextBee adapter (dev/demo) | OTP and voting-link notifications via async queue |

### Hard boundaries (still enforced)

- Frontend **never** calls FastAPI directly. All AI calls go through the Node backend.
- FastAPI **never** writes to the database. It returns scores; Node decides.
- Node backend owns all DB writes, auth decisions, and SMS queueing.
- Do not add a fourth service without explicit approval.

---

## Runtime & Deployment Model

The repository is a **monorepo**, not separate `frontend/` and `backend/` packages:

| Path | Role |
|---|---|
| `server.ts` | Express entry point: API routes, health checks, cron startup, Vite/static serving |
| `src/` | React frontend (pages, components, contexts) |
| `backend/src/` | Express routes, services, middleware, cron, DB utilities |
| `ai-service/` | Standalone FastAPI process (port 8000) |
| `migrations/` | `node-pg-migrate` SQL migrations at repo root |

**Development:** `npm run dev` runs `tsx server.ts`, which mounts Vite in middleware mode on port 3000.  
**Production:** `npm run build` produces `dist/` (Vite assets + bundled `server.js`); `npm start` serves the SPA from Express.

**Docker Compose** (`docker-compose.yml`) can run postgres, minio, ai-service, backend, and a preview frontend — but local dev typically runs postgres/minio/ai-service in Docker and the Node app on the host.

Target production topology from the original spec (Vercel + Fly.io + Koyeb) is **aspirational**; the current code deploys as a **single Node process** plus external Postgres, MinIO, and AI service.

---

## Technology Stack (as implemented)

### Frontend
```
React 19 + Vite 6       — SPA, not Next.js
Tailwind CSS 4          — via @tailwindcss/vite
React Router 7          — (spec originally said v6; codebase uses v7)
TanStack React Query 5  — admin pages + voter dashboard server state
Axios                   — HTTP with X-Request-ID interceptor
react-i18next           — Hindi + English (partial coverage — see shortcomings)
DOMPurify               — client-side sanitisation where used
Cloudflare Turnstile    — bot protection on voter ID entry
```

### Backend
```
Node.js + Express 4     — TypeScript via tsx (dev) / esbuild bundle (prod)
pg (node-postgres)      — raw SQL, no ORM
bcrypt                  — admin passwords + OTP hashing
jsonwebtoken            — voter JWT, admin JWT, session JWT (separate secrets)
node-cron               — NOT used directly; cron via setInterval + advisory locks
express-rate-limit      — voter, OTP, session-ref, admin limiters
sanitize-html + zod     — input sanitisation and schema validation
multer                  — multipart uploads (voter request documents)
minio SDK               — S3-compatible document storage
helmet + cors           — security headers
```

### Database
```
PostgreSQL 16           — Neon in production; Docker postgres locally
pgcrypto extension      — pgp_sym_encrypt / pgp_sym_decrypt for PII columns
node-pg-migrate         — migrations in /migrations/*.cjs
```

### AI Service
```
Python 3.11+ FastAPI
DeepFace VGG-Face       — cosine similarity for face match
OpenCV                  — passive liveness (Laplacian + FFT) + blink detection
Endpoints: /health, /ready, /live, /embed, /verify, /liveness/blink
```

### SMS
```
TextBee adapter         — implemented (backend/src/services/sms/textbee.adapter.ts)
MSG91 adapter           — NOT implemented (env var documented but no adapter file)
SMS_PROVIDER env        — documented in master prompt; send job hardcodes TextBee import
```

---

## End-to-End Flows

### 1. Voter portal authentication
1. Voter enters Voter ID + Turnstile token → `POST /api/auth/verify-voter`
2. Backend calls `VoterVerificationService` (mock roll or Protean stub) → creates/fetches voter row
3. OTP generated (bcrypt hash stored), SMS queued → `POST /api/auth/verify-otp` returns **voter JWT**
4. Voter JWT stored in `localStorage` (`voter_token`); sent as `Authorization: Bearer` on `/api/voter/*` only

### 2. Remote ballot request
1. Authenticated voter selects active election → `GET /api/voter/elections`
2. Draft saved incrementally → `POST /api/voter/request/draft` (documents to MinIO, keys encrypted at rest)
3. Selfie captured → AI `/embed` via backend → **embedding encrypted in DB** + **selfie JPEG in MinIO** (`request_selfie_minio_key`)
4. Submit → status `pending` → admin review queue

### 3. Admin review (multi-role)
```
draft → pending → under_review → reviewer_approved → superadmin_approved → final_approved
                  ↘ rejected → appealed → appeal_under_review → appeal_resolved
```
- Reviewer cannot set `final_approved` directly (enforced in `state-machine.ts`)
- `request_events` row inserted **before** `voting_requests.status` update
- On approval/rejection: supporting documents deleted from MinIO; selfie keys may persist until PII cron

### 4. Voting phase
**Manual:** Super admin → `POST /api/admin/elections/:id/start-voting` (password re-entry required)  
**Automatic:** Cron `election_start_voting` transitions `active` → `voting` when `election_date <= today`

For each `final_approved` request without an existing session:
- Creates `voting_sessions` row with opaque `ref_code`
- Snapshots baseline embedding + MinIO key onto session
- Queues SMS with ref code (not JWT)

### 5. Live voting session (`/vote?ref=...`)
```
link_opened → otp_verified → face_verified → vote_cast
                          ↘ face_pending (AI failure or low scores)
                          ↘ expired (timeout / cron)
```
1. `GET /api/session/status?ref_code=` — may return session JWT for resume
2. `POST /api/session/resolve` — marks ref used, sends voting OTP via SMS
3. `POST /api/session/verify-otp` — returns **session JWT** (15 min, `SESSION_JWT_SECRET`)
4. `POST /api/session/face-verify` — compares live selfie to baseline (embedding first, MinIO photo fallback); stores voting selfie in MinIO
5. `GET /api/vote/candidates` + `POST /api/vote/cast` — atomic transaction, receipt token returned

### 6. Results
**Manual:** Super admin publishes with password → `POST /api/admin/elections/:id/publish-results`  
**Automatic:** Cron `election_complete` publishes when `election_date < today` and status is `voting` (no password)  
Public tally → `GET /api/public/elections/:id/results`  
Receipt verification → `GET /api/public/verify-receipt/:token` (returns election name + minute-rounded `cast_at` only)

---

## Session & Request State Machines

### Voting session states (`voting_sessions.state`)
| State | Meaning |
|---|---|
| `link_opened` | Ref code resolved; voter must complete OTP |
| `otp_verified` | Ready for face verification |
| `face_verified` | May load ballot and cast vote |
| `face_pending` | AI unavailable or scores below threshold; admin may override |
| `vote_cast` | Terminal — vote recorded |
| `expired` | Terminal — window elapsed or election ended |

### Election states (`elections.status`)
| State | Meaning |
|---|---|
| `draft` | Created, not accepting requests |
| `active` | Accepting remote ballot requests |
| `voting` | Approved voters may cast ballots |
| `results_published` | Tally public; PII retention clock starts |

---

## API Surface (summary)

| Prefix | Auth | Purpose |
|---|---|---|
| `/api/auth/*` | Turnstile + rate limit | Voter ID verify, OTP send/verify/resend |
| `/api/voter/*` | Voter JWT | Dashboard, draft/submit requests, appeals, withdraw |
| `/api/session/*` | Ref code / Session JWT | Voting link resolve, OTP, face verify |
| `/api/vote/*` | Session JWT (`face_verified`) | Candidates list, cast vote |
| `/api/public/*` | None | Published results, receipt verification |
| `/api/admin/auth/*` | — | Admin login |
| `/api/admin/requests/*` | Admin JWT | Review queue, approve/reject/appeal |
| `/api/admin/elections/*` | Admin JWT (+ password on critical actions) | CRUD, activate, start voting, publish results |
| `/api/admin/parties/*` | Admin JWT | Party management |
| `/api/admin/sessions/*` | Admin JWT | View/revoke voting sessions, face-pending review |
| `/api/admin/audit/*` | Admin JWT | Append-only audit log read |
| `/api/admin/cron/*` | Admin JWT | Cron job status dashboard |
| `/api/admin/verification/*` | Admin JWT | Per-election verification stats |
| `/api/admin/docs/*` | Admin JWT | Signed URL document preview |
| `/api/admin/geo/*` | Admin JWT | India state/constituency lookup |
| `/api/health`, `/api/ready`, `/api/live`, `/api/startup-status` | None | Observability |

---

## Database Schema (key tables)

| Table | Purpose |
|---|---|
| `voters` | `voter_id_hash` lookup + encrypted PII (`*_enc` bytea columns) |
| `elections` / `election_settings` / `candidates` / `parties` | Election configuration |
| `voting_requests` | Ballot authorization requests + encrypted embeddings + encrypted MinIO keys |
| `request_events` | Append-only status transition log |
| `voting_sessions` | One session per approved request; ref codes, face scores, baseline snapshot |
| `votes` | **No voter/session/request FK** — only `election_id`, `candidate_id`, `receipt_token`, `cast_at` |
| `otps` | bcrypt-hashed OTPs with attempt counts |
| `notifications` | Async SMS queue (`pending` → `sent` / `failed`) |
| `verification_logs` | Face verification attempts with scores/thresholds |
| `audit_logs` | Append-only admin/system actions |
| `cron_jobs` | Last run status per job (updated by `runWithLock`) |
| `admins` | Seeded only — no create/update API |

### Schema additions beyond initial migration
- `voting_requests.voter_id_photo_minio_key`, `request_selfie_minio_key`
- `voting_sessions.voting_selfie_minio_key`, `baseline_embedding_enc`, `baseline_selfie_minio_key`
- `notifications.metadata` (pgcrypto-encrypted JSON for SMS template vars)

---

## Cron Jobs

All jobs use Postgres **advisory locks** via `backend/src/cron/lock.ts` and update `cron_jobs`.

| Job name | Interval | Purpose |
|---|---|---|
| `send_sms` | 1 min | Process `notifications` queue via TextBee |
| `retry_sms` | 5 min | Retry failed SMS |
| `expire_sessions` | 1 min | Mark expired sessions |
| `purge_otps` | 1 hr | Delete stale OTP rows |
| `delete_pii` | 24 hr | Purge voter PII, embeddings, MinIO selfies 30 days after results |
| `purge_old_requests` | 24 hr | Clean withdrawn/rejected request artifacts |
| `cleanup_draft_elections` | 24 hr | Remove stale draft elections |
| `election_start_voting` | 1 hr | Auto-start voting on election date |
| `election_complete` | 1 hr | Auto-publish results day after election date |
| `purge_audit_logs` | 24 hr | Delete audit logs >1 year (**opt-in**, see shortcomings) |

Crons start only after DB connectivity is confirmed (`waitForDbThenStartCrons` in `server.ts`).

---

## File & Folder Structure (actual)

```
verifiedvote/
├── server.ts                    # Express + Vite/static + cron bootstrap
├── src/                         # React frontend
│   ├── App.tsx                  # Routes (voter + admin)
│   ├── main.tsx                 # QueryClientProvider + i18n
│   ├── components/              # SelfieCapture, VoterRoute, ErrorBoundary, …
│   ├── pages/
│   │   ├── voter/               # Dashboard, RequestForm, VotingSession, Ballot, …
│   │   └── admin/               # RequestQueue, Elections, Audit, Sessions, Cron, …
│   ├── store/                   # AuthContext, VoterContext, FontSizeContext
│   └── utils/                   # votingSessionApi, voterToken
├── backend/src/
│   ├── routes/                  # auth, voter, session, vote, public, admin/*
│   ├── services/
│   │   ├── face-verify.service.ts
│   │   ├── minio.service.ts
│   │   ├── otp.service.ts
│   │   ├── verification-log.service.ts
│   │   ├── india-geo.service.ts
│   │   ├── sms/                 # textbee.adapter, notification-queue, templates
│   │   └── voter-verify/        # mock.adapter, protean.adapter (stub)
│   ├── middleware/              # auth, session, rate-limit, turnstile, validate, error
│   ├── cron/                    # All scheduled jobs + lock.ts
│   ├── db/                      # pg pool, seed (admin.seed.ts, voter_roll.json)
│   ├── utils/                   # crypto, logger, errors, state-machine, ref-code, receipt-token
│   └── constants/               # system.ts, verification.ts
├── ai-service/
│   ├── main.py                  # FastAPI app
│   ├── liveness.py
│   └── models.py
├── migrations/                  # node-pg-migrate *.cjs
├── tests/                       # Playwright e2e
├── docker-compose.yml
└── ARCHITECTURE.md
```

---

## The 17 Invariants

These remain the **design intent**. See [Known Shortcomings & Assumptions](#known-shortcomings--assumptions) where implementation diverges.

| # | Invariant |
|---|---|
| 1 | Votes table never contains voter_id, session_id, or any linkable field |
| 2 | JWT never sent over SMS — opaque ref codes only |
| 3 | Voter never auto-rejected due to AI failure — always `face_pending` |
| 4 | Face embeddings nulled on rejection/withdrawal/PII purge |
| 5 | Admin accounts seeded only; no API creates or modifies admins |
| 6 | Results computed from votes table; never manually entered |
| 7 | `audit_logs` and `request_events` append-only via API |
| 8 | Cron jobs idempotent + Postgres advisory locks |
| 9 | Constituency validation enforced server-side |
| 10 | Accessibility (i18n, font size, ARIA, high contrast) built from Phase 1 |
| 11 | Vote submission is a single atomic DB transaction |
| 12 | OTPs stored as bcrypt hash only |
| 13 | `request_events` inserted BEFORE `voting_requests.status` update |
| 14 | MinIO document URLs are signed, short-lived |
| 15 | Critical admin actions require password re-entry |
| 16 | Protected endpoints check `is_revoked = false` |
| 17 | `cast_at` rounded to nearest minute (`date_trunc('minute', now())`) |

---

## Security & Correctness Rules

### Database

**Votes table — no linkable fields (Invariant 1)**
```sql
CREATE TABLE votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id   uuid REFERENCES elections(id) NOT NULL,
  candidate_id  uuid REFERENCES candidates(id) NOT NULL,
  receipt_token text UNIQUE NOT NULL,  -- SHA-256 hash of display token
  cast_at       timestamptz DEFAULT date_trunc('minute', now())
);
```

**Partial unique index on active requests**
```sql
CREATE UNIQUE INDEX unique_active_request_idx
ON voting_requests(voter_id, election_id)
WHERE status NOT IN ('rejected', 'withdrawn', 'appeal_resolved');
```

**PII encryption** — `voter_id_enc`, `name_enc`, `phone_enc` as `bytea` via `pgp_sym_encrypt`; lookup via `voter_id_hash` (SHA-256).

**Parameterised queries only.** No string concatenation in SQL.

**OTP bcrypt only** — never SHA-256 or plaintext storage.

**Vote cast atomic transaction** — see `backend/src/routes/vote.routes.ts` (`db.withTransaction`).

### Authentication

- JWT in `Authorization: Bearer` header only — no cookie auth
- Three JWT secrets: `VOTER_JWT_SECRET`, `ADMIN_JWT_SECRET`, `SESSION_JWT_SECRET`
- Voter JWT → portal (`/api/voter/*`); Session JWT → voting (`/api/session/*`, `/api/vote/*`)
- Session middleware validates existence, expiry, revocation, and expected state

### AI service

- Node backend calls FastAPI with 10s timeout (`AI_TIMEOUT_MS`); retries transient errors twice
- On failure → session state `face_pending`, never auto-reject (Invariant 3)
- FastAPI processes request images in memory; warmup writes a dummy 224×224 JPEG to temp dir then deletes it

### File storage

- MinIO keys stored **encrypted** in DB (`encryptDocKey`); signed URLs for admin preview (15 min)
- Supporting documents deleted on admin approval/rejection
- **Selfies:** embeddings in DB + JPEG in MinIO (see shortcomings — original spec said embeddings only)

### SMS

- Notifications queued in DB; `send_sms` cron sends asynchronously
- Failed sends retried by `retry_sms` cron — not inline in request handlers

---

## Known Shortcomings & Assumptions

This section documents gaps between the **original master spec** and **current implementation**. Treat these as technical debt or explicit prototype trade-offs — not as approved permanent design.

### Identity & electoral roll
| Item | Assumption / gap |
|---|---|
| **Mock voter roll** | Default `VOTER_VERIFY_MODE=mock` uses `backend/src/db/seed/voter_roll.json` — not a live ECI integration |
| **Protean adapter** | `protean.adapter.ts` is a stub; throws `protean_adapter_not_implemented` |
| **Dev OTP** | Mock mode uses fixed OTP `123456`; logged to console when TextBee keys absent |
| **Voter ID format** | Client validates `^[A-Za-z]{3}.{7}$`; server normalises to uppercase before hash |

### Biometrics & storage
| Item | Assumption / gap |
|---|---|
| **Selfies in MinIO** | Request baseline and voting-time selfies are stored as encrypted MinIO keys (`request_selfie_minio_key`, `voting_selfie_minio_key`), not embeddings-only as Rule 22 originally stated |
| **Dual baseline path** | Face verify prefers encrypted embedding; falls back to MinIO JPEG if embedding decrypt/AI fails |
| **Blink liveness fail-open** | If AI blink endpoint unavailable, backend returns `blink_detected: true` so voters are not blocked |
| **Passive liveness** | OpenCV heuristics (not certified presentation-attack detection); suitable for prototype only |
| **DeepFace warm-up** | Writes one dummy image to OS temp during startup (no biometric data) |
| **Admin session review** | Admins can view signed URLs for request + voting selfies in `AdminSessions` |

### Security & compliance
| Item | Assumption / gap |
|---|---|
| **Voter JWT in localStorage** | Portal token persisted across refreshes; XSS would expose it (session JWT is memory-only on client via VotingSession flow) |
| **Audit log deletion** | `purge_audit_logs` cron **DELETE**s rows older than 1 year when `ENABLE_AUDIT_LOG_PURGE=true` — contradicts strict append-only Rule 4 |
| **Auto result publication** | Cron publishes results without admin password — bypasses Invariant 15 for the automated path |
| **Auto start voting** | Cron can transition elections to `voting` without explicit admin action on election day |
| **i18n incomplete** | Many voter-facing strings in `App.tsx` and elsewhere are hardcoded English despite Rule 29 |
| **ARIA coverage** | Partial; not every interactive element has an aria-label (Rule 30) |
| **No WebSocket** | Correct per spec; all polling/refetch via React Query or manual fetch |

### Infrastructure & integrations
| Item | Assumption / gap |
|---|---|
| **SMS abstraction incomplete** | `send-sms.job.ts` imports `TextBeeAdapter` directly; no `SMSService` factory or MSG91 adapter despite env documentation |
| **Single Node deployment** | Production build bundles frontend into Express; original three-host deploy (Vercel/Fly/Koyeb) not codified |
| **Neon cold start** | DB pool timeout 30s; crons retry until DB available; `db:keep-alive` script exists for Neon free tier |
| **SQLite artifact** | `backend/sqlite.db` may exist locally — not used by application code (Postgres only) |
| **Test coverage** | Unit test for ref-code; integration test file exists; Playwright e2e partially configured |

### Data lifecycle assumptions
| Item | Assumption / gap |
|---|---|
| **PII retention** | Voter PII nulled 30 days after `results_published_at` (or `data_expires_at` if set) |
| **Embeddings cleared** | Same cron clears `request_selfie_embedding_enc` and deletes MinIO selfies |
| **Receipt tokens** | Display token shown once; only SHA-256 hash stored — voter cannot recover lost receipt |
| **Minute-rounded timestamps** | Reduces re-identification risk but does not eliminate it in small electorates |

### Operational assumptions
| Item | Assumption / gap |
|---|---|
| **Clock sync** | Session expiry and OTP validity assume reasonably synchronised server clocks |
| **Single-region** | No multi-region failover, read replicas, or split-brain handling documented |
| **Rate limits** | IP-based; may affect shared NAT users |
| **Admin roles** | Two seeded roles (`super_admin`, `reviewer`); no fine-grained RBAC beyond state machine |
| **Institutional approval** | System must not be used for real elections without legal and ECI review |

---

## Environment Variables (reference)

See `.env.example` for the full list. Critical vars:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (use Neon pooler host in prod) |
| `PGCRYPTO_KEY` | Symmetric key for pgp_sym_encrypt columns |
| `VOTER_JWT_SECRET` / `ADMIN_JWT_SECRET` / `SESSION_JWT_SECRET` | Separate signing keys (min 32 chars) |
| `VOTER_VERIFY_MODE` | `mock` (default) or `protean` |
| `AI_SERVICE_URL` | FastAPI base URL; omit disables face verify health |
| `MINIO_*` | Object storage endpoint and bucket |
| `TEXTBEE_API_KEY` / `TEXTBEE_DEVICE_ID` | SMS; absent → console mock |
| `TURNSTILE_SECRET_KEY` | Server-side Turnstile verify; test keys in .env.example |
| `ENABLE_AUDIT_LOG_PURGE` | Set `true` to enable audit log deletion cron |

---

## What AI Assistants Must NOT Do

```
❌ Add voter_id, session_id, or request_id to the votes table
❌ Store OTPs in plaintext or with SHA-256 alone
❌ Call FastAPI from the frontend
❌ Auto-reject a voter when FastAPI fails
❌ Add an admin creation or update endpoint
❌ Use Cloudinary or raw S3 SDK (MinIO only)
❌ Add an ORM (Prisma, Drizzle, TypeORM)
❌ Use SQL string concatenation
❌ Add UPDATE or DELETE on request_events via API
❌ Update voting_requests.status before inserting request_events
❌ Use exact timestamps for cast_at
❌ Use cookies for JWT storage
❌ Send JWT in an SMS message
❌ Skip advisory locks on cron jobs
❌ Expose internal error messages to the client
❌ Skip atomic transaction on vote submission
❌ Allow a single reviewer to set final_approved
❌ Add a fourth service without explicit approval
❌ Switch locked dependencies without explicit approval
```

---

## Quick Reference — Common Patterns

### Encrypt PII
```typescript
// backend/src/utils/crypto.ts
export async function encryptValue(plaintext: string): Promise<Buffer> {
  const result = await db.query(
    `SELECT pgp_sym_encrypt($1, $2) AS encrypted`,
    [plaintext, process.env.PGCRYPTO_KEY]
  );
  return result.rows[0].encrypted;
}
```

### Hash voter ID for lookup
```typescript
import crypto from 'crypto';
export function hashVoterId(voterId: string): string {
  return crypto.createHash('sha256').update(voterId.toUpperCase()).digest('hex');
}
```

### Record request status change (events BEFORE status update)
```typescript
await db.query(
  `INSERT INTO request_events
   (request_id, old_status, new_status, actor_id, actor_type, reason, metadata)
   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [requestId, oldStatus, newStatus, actorId, actorType, reason, metadata ?? null]
);
await db.query(`UPDATE voting_requests SET status = $1 WHERE id = $2`, [newStatus, requestId]);
```

### Cron job with advisory lock
```typescript
import { runWithLock } from '../cron/lock.js';

setInterval(() => {
  void runWithLock('job_name', async () => { /* idempotent work */ });
}, intervalMs);
```

---

*End of ARCHITECTURE.md*  
*Version 2.0 — Codebase audit May 2026*  
*Seed this file to every AI assistant at the start of every session.*
