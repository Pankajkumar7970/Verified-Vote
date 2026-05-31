# ARCHITECTURE.md — VerifiedVote
# Seed this file to every AI assistant before writing any code.
# This file is the single source of truth for all architectural decisions.
# When in doubt, refer here before generating any code, schema, or config.

---

## What This Project Is

VerifiedVote is a secure remote voting authorization platform that digitizes the postal ballot
workflow for verified exceptional-case voters (disabled, military, NRI, remote workers) in India.

It is NOT a general-purpose voting platform.
It is NOT ECI-approved or government-certified software.
It is a civic-tech research prototype requiring institutional approval before real election use.

---

## What This File Is For

This file exists because development is AI-assisted. Every AI assistant working on this project
must read and follow this file before writing a single line of code, schema, query, or config.

Violations of rules in this file are not style issues — they are security and correctness issues.
Do not deviate from these rules without explicit human approval and a documented reason.

---

## Three Services. Always Three. Never Collapse Them.

```
[React Frontend]  →  [Node.js Backend]  →  [FastAPI AI Service]
                           ↕                        ↕
                    [Neon PostgreSQL]         [Neon PostgreSQL]
                           ↕
                     [MinIO Storage]
```

| Service | Language | Deploy | Purpose |
|---|---|---|---|
| Frontend | React + Vite | Vercel | UI only. No business logic. |
| Backend | Node.js + Express | Fly.io | All business logic, auth, DB, SMS |
| AI Service | Python + FastAPI | Koyeb | Face comparison + liveness only |

**Rules:**
- Frontend NEVER calls FastAPI directly. All AI calls go through the Node backend.
- Frontend NEVER contains business logic, validation rules, or security checks.
- FastAPI NEVER writes to the database directly. It returns scores; Node backend decides.
- Node backend owns all DB writes, all auth decisions, all SMS sends.
- If you are tempted to add a fourth service, stop and ask first.

---

## Technology Choices — Locked. Do Not Substitute.

### Frontend
```
React + Vite          — not Next.js, not Remix
Tailwind CSS          — no CSS-in-JS, no styled-components
React Router v6       — not TanStack Router
React Query           — for all server state
Axios                 — for all HTTP calls
react-i18next         — for Hindi + English i18n
```

### Backend
```
Node.js + Express     — not Fastify, not Hono, not Nest.js
pg (node-postgres)    — not Prisma, not Drizzle, not TypeORM
bcrypt                — for all password and OTP hashing
jsonwebtoken          — for JWT
node-cron             — for scheduled jobs
express-rate-limit    — for rate limiting
sanitize-html         — for server-side input sanitisation
multer                — for file upload handling
```

### Database
```
Neon PostgreSQL       — not Supabase, not PlanetScale, not MongoDB
pgcrypto              — for all column-level encryption
node-pg-migrate       — for migrations (not Prisma migrate)
```

### AI Service
```
Python 3.11+
FastAPI               — not Flask, not Django
DeepFace              — VGG-Face model only
OpenCV (cv2)          — for passive liveness detection
```

### Storage
```
MinIO                 — not Cloudinary, not S3, not Supabase Storage
```

### SMS
```
TextBee               — for dev/demo
MSG91                 — for production (swap via SMS_PROVIDER env var)
```

**If a library is not listed above, ask before adding it.**
**Do not add ORMs. Do not add GraphQL. Do not add WebSockets.**

---

## Database Rules — Read Before Touching Any Schema

### Rule 1: Never put voter_id, session_id, or request_id in the votes table. Ever.

```sql
-- CORRECT
CREATE TABLE votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id   uuid REFERENCES elections(id) NOT NULL,
  candidate_id  uuid REFERENCES candidates(id) NOT NULL,
  receipt_token text UNIQUE NOT NULL,
  cast_at       timestamptz DEFAULT date_trunc('minute', now())
);

-- WRONG — never do this
CREATE TABLE votes (
  voter_id    uuid,   -- NO
  session_id  uuid,   -- NO
  request_id  uuid    -- NO
);
```

This is Invariant 1. It cannot be relaxed for any reason.

### Rule 2: cast_at is always rounded to the nearest minute.

```sql
-- CORRECT
cast_at timestamptz DEFAULT date_trunc('minute', now())

-- WRONG
cast_at timestamptz DEFAULT now()
```

Exact timestamps allow re-identification of voters. This is Invariant 17.

### Rule 3: Use the partial unique index — not a full unique constraint.

```sql
-- CORRECT
CREATE UNIQUE INDEX unique_active_request_idx
ON voting_requests(voter_id, election_id)
WHERE status NOT IN ('rejected', 'withdrawn', 'appeal_resolved');

-- WRONG
ALTER TABLE voting_requests
ADD CONSTRAINT unique_active_request UNIQUE (voter_id, election_id);
```

The full constraint would prevent a voter from reapplying after rejection.

### Rule 4: audit_logs and request_events are append-only. No exceptions.

```sql
-- These queries are FORBIDDEN on audit_logs and request_events:
UPDATE audit_logs ...         -- NEVER
DELETE FROM audit_logs ...    -- NEVER
UPDATE request_events ...     -- NEVER
DELETE FROM request_events ... -- NEVER
TRUNCATE audit_logs ...       -- NEVER
```

There are no exceptions. Not for cleanup. Not for testing. Not for "fixing a mistake."
In tests, use a separate test schema or rollback transactions.

### Rule 5: Insert into request_events BEFORE updating voting_requests.status.

```javascript
// CORRECT ORDER — always
await db.query(
  `INSERT INTO request_events
   (request_id, old_status, new_status, actor_id, actor_type, reason)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [requestId, oldStatus, newStatus, actorId, actorType, reason]
);
await db.query(
  `UPDATE voting_requests SET status = $1 WHERE id = $2`,
  [newStatus, requestId]
);

// WRONG ORDER — never do this
await db.query(`UPDATE voting_requests SET status = $1 WHERE id = $2`, [...]);
await db.query(`INSERT INTO request_events ...`, [...]);  // too late
```

This is Invariant 13.

### Rule 6: All PII columns use pgcrypto encryption.

```sql
-- Encrypted columns are bytea, not text
voter_id_enc   bytea NOT NULL  -- pgp_sym_encrypt(value, key)
name_enc       bytea NOT NULL
phone_enc      bytea NOT NULL
```

```sql
-- Lookup columns use SHA-256 hash, not plaintext
voter_id_hash  text NOT NULL UNIQUE  -- sha256(voter_id)
```

Never store voter_id, name, or phone as plaintext in any column.

### Rule 7: All queries use parameterised statements. No exceptions.

```javascript
// CORRECT
await db.query('SELECT * FROM voters WHERE voter_id_hash = $1', [hash]);

// WRONG — SQL injection vulnerability
await db.query(`SELECT * FROM voters WHERE voter_id_hash = '${hash}'`);
```

### Rule 8: OTPs use bcrypt. Never SHA-256. Never plaintext.

```javascript
// CORRECT
const otp = generateSixDigitOTP();
const otp_hash = await bcrypt.hash(otp, 10);
// store otp_hash in otps table; send otp via SMS

// Verify:
const valid = await bcrypt.compare(inputOtp, storedHash);

// WRONG
const otp_hash = crypto.createHash('sha256').update(otp).digest('hex'); // NO
const otp_plaintext = otp; // ABSOLUTELY NO
```

### Rule 9: Vote submission is always a single atomic transaction.

```javascript
// CORRECT
await db.query('BEGIN');
try {
  await db.query(`SELECT id FROM voting_sessions
    WHERE id = $1 AND state = 'face_verified'
    AND is_revoked = false AND expires_at > now() FOR UPDATE`, [sessionId]);
  await db.query(`INSERT INTO votes ...`, [...]);
  await db.query(`UPDATE voting_sessions SET state = 'vote_cast' ...`, [...]);
  await db.query(`INSERT INTO audit_logs ...`, [...]);
  await db.query('COMMIT');
} catch (err) {
  await db.query('ROLLBACK');
  throw err;
}

// WRONG — separate queries without a transaction
await db.query(`INSERT INTO votes ...`);      // partial write possible
await db.query(`UPDATE voting_sessions ...`); // if this fails, vote exists with no invalidation
```

This is Invariant 11.

---

## Authentication Rules

### Rule 10: JWT lives in the Authorization header only. Never in cookies.

```javascript
// CORRECT — sending JWT
headers: { 'Authorization': `Bearer ${token}` }

// WRONG
document.cookie = `token=${token}`; // NO
localStorage.setItem('token', token); // acceptable but prefer memory/context
```

```javascript
// CORRECT — reading JWT on backend
const token = req.headers.authorization?.split(' ')[1];

// WRONG
const token = req.cookies.token; // NO — we do not use cookie auth
```

### Rule 11: JWT never appears in SMS messages. Use opaque ref codes.

```javascript
// CORRECT — what gets sent in SMS
const refCode = generateOpaque12CharCode(); // e.g. "A3K9PL2MX7QR"
const smsContent = `Your voting link: https://verifiedvote.in/vote?ref=${refCode}`;

// WRONG
const smsContent = `Your link: https://verifiedvote.in/vote?token=${jwt}`; // NO
```

### Rule 12: Every protected endpoint checks session validity before processing.

```javascript
// Required checks on every voting session endpoint
const session = await db.query(
  'SELECT * FROM voting_sessions WHERE id = $1', [sessionId]
);
if (!session.rows[0])              throw new AuthError('session_not_found');
if (session.rows[0].is_revoked)    throw new AuthError('session_revoked');
if (session.rows[0].expires_at < new Date()) throw new AuthError('session_expired');
if (session.rows[0].state !== expectedState) throw new AuthError('invalid_state');
```

Never skip these checks. Never assume a valid JWT means a valid session.

### Rule 13: Admin accounts are never created via API.

```javascript
// There is no POST /admin/create endpoint.
// There is no PUT /admin/:id endpoint.
// Admins exist only via the seed script.

// If you are writing an admin creation endpoint — stop. Delete it.
```

---

## AI Service Rules

### Rule 14: FastAPI returns scores. Node backend makes decisions.

```javascript
// CORRECT — Node backend decides based on score
const { face_score, liveness_score } = await callFastAPI(embedding, imageB64);
const passed = face_score >= threshold && liveness_score >= livenessThreshold;
if (passed) {
  await updateSessionState(sessionId, 'face_verified');
} else {
  await updateSessionState(sessionId, 'face_pending');
}

// WRONG — FastAPI should not be making auth decisions
// FastAPI endpoint that returns { allow: true } — NO
// FastAPI writing to DB — NO
// Frontend calling FastAPI directly — NO
```

### Rule 15: FastAPI timeout always results in FACE_PENDING. Never rejection.

```javascript
// CORRECT
try {
  const result = await axios.post(AI_URL, payload, { timeout: 10000 });
  // process result
} catch (err) {
  if (err.code === 'ECONNABORTED' || err.response?.status >= 500) {
    await setFacePending(sessionId, 'ai_service_unavailable');
    // notify admin dashboard
  }
}

// WRONG
} catch (err) {
  await rejectSession(sessionId); // NEVER auto-reject on AI failure
}
```

This is Invariant 3.

### Rule 16: Images are processed in memory only. Never written to disk in FastAPI.

```python
# CORRECT
import numpy as np
import cv2

def process_image(image_b64: str) -> np.ndarray:
    image_bytes = base64.b64decode(image_b64)
    nparr = np.frombuffer(image_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    # image never touches disk

# WRONG
with open('/tmp/face.jpg', 'wb') as f:  # NO
    f.write(base64.b64decode(image_b64))
```

---

## SMS Rules

### Rule 17: All SMS is abstracted through SMSService. Never call TextBee directly.

```javascript
// CORRECT
import { SMSService } from '../services/sms.service';
await SMSService.send(phoneNumber, message);

// WRONG — hardcoding provider
await axios.post('https://textbee.dev/api/v1/gateway/devices/.../sendMessage', ...); // NO
```

The SMS_PROVIDER env var switches providers without touching business logic.

### Rule 18: Failed SMS sends are retried via the notifications table. Not inline.

```javascript
// CORRECT — fire and handle failure via DB
const notification = await createNotification(voterId, type, 'pending');
try {
  await SMSService.send(phone, message);
  await markNotificationSent(notification.id);
} catch (err) {
  await markNotificationFailed(notification.id, err.message);
  // cron job picks this up in 5 minutes
}

// WRONG — blocking retry in request handler
for (let i = 0; i < 3; i++) {
  try { await SMSService.send(...); break; }
  catch { await sleep(2000); } // DO NOT block the request handler
}
```

---

## File Storage Rules

### Rule 19: Documents are stored in MinIO. Cloudinary is not used. S3 is not used.

```javascript
// CORRECT
import { MinIOService } from '../services/minio.service';
const { key, hash } = await MinIOService.uploadDocument(fileBuffer, mimeType);

// WRONG
import cloudinary from 'cloudinary'; // NOT IN THIS PROJECT
await s3.putObject(...);             // NOT IN THIS PROJECT
```

### Rule 20: Signed URLs only. Never public URLs. Never permanent URLs.

```javascript
// CORRECT — 15-minute signed URL for admin document review
const signedUrl = await MinIOService.getSignedUrl(docKey, 900);

// WRONG
const publicUrl = `https://storage.example.com/bucket/${docKey}`; // NO permanent URLs
```

### Rule 21: MinIO documents are deleted immediately after admin review.

```javascript
// CORRECT — delete on approval OR rejection
async function approveRequest(requestId, adminId) {
  const request = await getRequest(requestId);
  await MinIOService.deleteDocument(request.doc_minio_key);
  await db.query(`UPDATE voting_requests SET doc_minio_key = null WHERE id = $1`, [requestId]);
  // ... rest of approval logic
}

// WRONG — keeping the document after review
// "We'll delete it later" — NO. Delete immediately.
```

### Rule 22: Selfies are never stored. Embeddings only.

```javascript
// CORRECT — extract embedding, discard image
const embedding = await callFastAPI_getEmbedding(imageB64);
const embeddingEnc = await pgcryptoEncrypt(JSON.stringify(embedding), key);
await db.query(
  `UPDATE voting_requests SET request_selfie_embedding_enc = $1 WHERE id = $2`,
  [embeddingEnc, requestId]
);
// imageB64 is now garbage-collected — never written anywhere

// WRONG
await fs.writeFile(`/uploads/${requestId}.jpg`, imageBuffer); // NO
await MinIOService.upload(imageBuffer); // NO — selfies never stored
```

---

## Cron Job Rules

### Rule 23: Every cron job uses the advisory lock pattern.

```javascript
// CORRECT
import { runWithLock } from '../utils/cron-lock';

cron.schedule('* * * * *', () => runWithLock('expire_sessions', expireSessions));
cron.schedule('0 2 * * *', () => runWithLock('delete_pii', deletePIIData));

// WRONG — no lock
cron.schedule('* * * * *', expireSessions); // race condition on multiple instances
```

### Rule 24: Every cron job is idempotent.

```javascript
// CORRECT — safe to run multiple times
async function expireSessions() {
  await db.query(`
    UPDATE voting_sessions
    SET state = 'expired'
    WHERE state NOT IN ('vote_cast', 'expired')
      AND expires_at < now()
  `);
  // Running this 10 times has the same result as running it once
}

// WRONG — not idempotent
async function expireSessions() {
  const sessions = await db.query(`SELECT id FROM voting_sessions WHERE ...`);
  for (const s of sessions.rows) {
    await sendExpiryEmail(s.id); // running twice sends the email twice — BAD
  }
}
```

### Rule 25: cron_jobs table is updated on every run.

```javascript
// Inside runWithLock — already handles this, but all job functions must not skip it
// The runWithLock utility updates cron_jobs automatically — always use it
```

---

## Input Sanitisation Rules

### Rule 26: All free-text inputs are sanitised on both frontend and backend.

```javascript
// Backend — sanitise before DB write
import sanitizeHtml from 'sanitize-html';

function sanitiseText(input) {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} });
}

// Usage — every free-text field
const reasonDetail = sanitiseText(req.body.reason_detail);
const reviewNote   = sanitiseText(req.body.review_note);
```

```javascript
// Frontend — sanitise before rendering user-supplied content
import DOMPurify from 'dompurify';
const safeContent = DOMPurify.sanitize(userSuppliedString);
```

### Rule 27: File uploads are validated before processing.

```javascript
// CORRECT
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function validateUpload(file) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) throw new Error('invalid_file_type');
  if (file.size > MAX_SIZE_BYTES) throw new Error('file_too_large');
}

// WRONG — no validation
app.post('/upload', upload.single('doc'), async (req, res) => {
  await MinIOService.upload(req.file.buffer); // without validation — NO
});
```

---

## Rate Limiting Rules

### Rule 28: Rate limits are applied as middleware, not inside route handlers.

```javascript
// CORRECT — applied at router level
import rateLimit from 'express-rate-limit';

const verifyVoterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    logRateLimitHit(req); // log to audit_logs
    res.status(429).json({ error: 'too_many_requests' });
  }
});

router.post('/auth/verify-voter', verifyVoterLimiter, verifyVoterHandler);

// WRONG — rate limiting inside handler
async function verifyVoterHandler(req, res) {
  const attempts = await countRecentAttempts(req.ip); // manual counting — fragile
  if (attempts > 5) return res.status(429)...;
}
```

---

## Accessibility Rules

### Rule 29: i18n is used for every user-facing string. No hardcoded English.

```javascript
// CORRECT
import { useTranslation } from 'react-i18next';
const { t } = useTranslation();
<button>{t('auth.verifyVoter')}</button>

// WRONG
<button>Verify Voter ID</button>  // hardcoded — NO
```

### Rule 30: Every interactive element has an ARIA label.

```jsx
// CORRECT
<button aria-label={t('ballot.submitVote')}>
  {t('ballot.submitVote')}
</button>

<input
  type="text"
  id="voter-id-input"
  aria-label={t('auth.voterIdLabel')}
  aria-describedby="voter-id-hint"
/>

// WRONG
<button>Submit</button>              // no aria-label — NO
<input type="text" />               // no label — NO
```

### Rule 31: Form validation errors use aria-live.

```jsx
// CORRECT
<div role="alert" aria-live="polite">
  {error && <span>{t(error)}</span>}
</div>

// WRONG
{error && <p style={{color: 'red'}}>{error}</p>}  // not announced to screen readers
```

---

## Error Handling Rules

### Rule 32: Every API endpoint returns structured error responses.

```javascript
// CORRECT — consistent error shape
res.status(400).json({
  error: 'invalid_voter_id',       // machine-readable code
  message: t('errors.invalidVoterId'), // human-readable (for logging)
  request_id: req.requestId       // correlation ID
});

// WRONG — inconsistent shapes
res.status(400).json({ msg: 'bad request' });     // inconsistent key
res.status(400).send('Invalid voter ID');          // plain string
res.status(500).json({ error: err.message });      // leaks internal details
```

### Rule 33: Internal errors are logged but never leaked to the client.

```javascript
// CORRECT
try {
  await db.query(...);
} catch (err) {
  logger.error({ request_id: req.requestId, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'internal_error', request_id: req.requestId });
}

// WRONG
} catch (err) {
  res.status(500).json({ error: err.message }); // leaks DB errors, stack traces — NO
}
```

### Rule 34: AI failure paths always result in FACE_PENDING, not rejection.

Already covered in Rule 15. Restated here because it must never be forgotten.
If FastAPI is down, if the model crashes, if the score is ambiguous — the voter
is flagged for human review. The voter is never automatically denied their vote
due to a technical failure. This is non-negotiable.

---

## Observability Rules

### Rule 35: Every request gets a correlation ID.

```javascript
// CORRECT — middleware applied globally
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

// When calling FastAPI
await axios.post(AI_URL, payload, {
  headers: { 'X-Request-ID': req.requestId }
});
```

### Rule 36: All logs are structured JSON.

```javascript
// CORRECT
logger.info({
  timestamp: new Date().toISOString(),
  level: 'info',
  request_id: req.requestId,
  service: 'node-backend',
  action: 'otp_verified',
  voter_id: voterId,
  message: 'OTP verified successfully'
});

// WRONG
console.log('OTP verified for voter ' + voterId); // unstructured — NO
console.log('Error:', err);                        // unstructured — NO
```

### Rule 37: /health, /ready, /live endpoints exist on both services.

```javascript
// Node backend
app.get('/health', async (req, res) => {
  const dbOk = await checkDB();
  const smsOk = await checkSMS();
  const aiOk  = await checkAI();
  res.json({ status: 'ok', db: dbOk, sms: smsOk, ai_service: aiOk });
});

app.get('/ready', async (req, res) => {
  const allOk = await checkAllDependencies();
  res.status(allOk ? 200 : 503).json({ ready: allOk });
});

app.get('/live', (req, res) => res.json({ alive: true }));
```

---

## Multi-Admin Approval Rules

### Rule 38: Reviewer actions never trigger final_approved directly.

```
Reviewer can set:     under_review, reviewer_approved, rejected
Super Admin can set:  superadmin_approved, final_approved, rejected, appeal actions

No single admin can move a request from pending to final_approved alone.
```

```javascript
// CORRECT — check role before allowing status transition
async function updateRequestStatus(requestId, newStatus, adminId, adminRole) {
  const allowed = getAllowedTransitions(adminRole);
  if (!allowed.includes(newStatus)) {
    throw new ForbiddenError('role_insufficient_for_transition');
  }
  // proceed
}

// WRONG — no role check on status update
await db.query(`UPDATE voting_requests SET status = $1 WHERE id = $2`, [newStatus, requestId]);
```

---

## What AI Assistants Must NOT Do

The following are explicitly forbidden. If an AI assistant generates any of these,
the output must be rejected and the assistant corrected.

```
❌ Add voter_id, session_id, or request_id to the votes table
❌ Store OTPs in plaintext or with SHA-256
❌ Use SHA-256 alone for password or OTP hashing (use bcrypt)
❌ Call FastAPI from the frontend
❌ Auto-reject a voter when FastAPI fails
❌ Add an admin creation or update endpoint
❌ Store selfie images (embeddings only)
❌ Use Cloudinary (MinIO only)
❌ Use an ORM (Prisma, Drizzle, TypeORM, Sequelize)
❌ Write direct SQL string concatenation (parameterised queries only)
❌ Add UPDATE or DELETE on audit_logs or request_events
❌ Update voting_requests.status before inserting into request_events
❌ Use exact timestamps for cast_at (date_trunc('minute', now()) only)
❌ Use cookies for JWT storage
❌ Send JWT in an SMS message
❌ Use a full UNIQUE constraint instead of partial unique index on voting_requests
❌ Skip the advisory lock on cron jobs
❌ Write non-idempotent cron jobs
❌ Hardcode any user-facing string (use i18n keys)
❌ Add a fourth service without explicit approval
❌ Switch any locked dependency without explicit approval
❌ Skip ARIA labels on interactive elements
❌ Skip sanitisation on any free-text field
❌ Expose internal error messages or stack traces to the client
❌ Skip the atomic transaction on vote submission
❌ Allow a single admin to move a request to final_approved
```

---

## File and Folder Structure

```
verifiedvote/
├── frontend/                        # React + Vite
│   ├── public/
│   ├── src/
│   │   ├── components/              # Reusable UI components
│   │   │   ├── ui/                  # Base components (Button, Input, etc.)
│   │   │   └── features/            # Feature-specific components
│   │   ├── pages/                   # Route-level pages
│   │   │   ├── voter/               # Voter-facing pages
│   │   │   └── admin/               # Admin-facing pages
│   │   ├── hooks/                   # Custom React hooks
│   │   ├── services/                # Axios API calls
│   │   ├── store/                   # React context providers
│   │   │   ├── AuthContext.jsx
│   │   │   ├── FontSizeContext.jsx
│   │   │   └── ThemeContext.jsx
│   │   ├── i18n/
│   │   │   ├── en.json
│   │   │   └── hi.json
│   │   ├── utils/
│   │   └── App.jsx
│   ├── index.html
│   └── vite.config.js
│
├── backend/                         # Node.js + Express
│   ├── src/
│   │   ├── routes/                  # Express routers
│   │   │   ├── auth.routes.js
│   │   │   ├── voter.routes.js
│   │   │   ├── request.routes.js
│   │   │   ├── session.routes.js
│   │   │   ├── vote.routes.js
│   │   │   └── admin/
│   │   │       ├── election.routes.js
│   │   │       ├── party.routes.js
│   │   │       ├── request-review.routes.js
│   │   │       └── audit.routes.js
│   │   ├── controllers/             # Route handlers (thin — call services)
│   │   ├── services/                # All business logic
│   │   │   ├── auth.service.js
│   │   │   ├── otp.service.js       # bcrypt OTP hashing + verification
│   │   │   ├── voter-verify/
│   │   │   │   ├── index.js         # VoterVerificationService interface
│   │   │   │   ├── mock.adapter.js  # MockAdapter
│   │   │   │   └── protean.adapter.js
│   │   │   ├── sms/
│   │   │   │   ├── index.js         # SMSService interface
│   │   │   │   ├── textbee.adapter.js
│   │   │   │   └── msg91.adapter.js
│   │   │   ├── minio.service.js
│   │   │   ├── face-verify.service.js  # calls FastAPI; handles timeout → FACE_PENDING
│   │   │   ├── session.service.js
│   │   │   ├── vote.service.js      # atomic transaction
│   │   │   └── results.service.js
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js   # JWT + is_revoked check
│   │   │   ├── rate-limit.middleware.js
│   │   │   ├── turnstile.middleware.js
│   │   │   ├── sanitise.middleware.js
│   │   │   ├── upload.middleware.js
│   │   │   └── request-id.middleware.js
│   │   ├── db/
│   │   │   ├── index.js             # pg pool
│   │   │   ├── migrations/          # node-pg-migrate files
│   │   │   └── seed/
│   │   │       ├── admin.seed.js
│   │   │       └── voter_roll.json  # MockAdapter test data
│   │   ├── cron/
│   │   │   ├── lock.js              # runWithLock utility
│   │   │   ├── expire-sessions.job.js
│   │   │   ├── delete-pii.job.js
│   │   │   ├── retry-sms.job.js
│   │   │   ├── purge-otps.job.js
│   │   │   └── purge-audit-logs.job.js
│   │   ├── utils/
│   │   │   ├── crypto.js            # pgcrypto helpers
│   │   │   ├── logger.js            # structured JSON logger
│   │   │   └── errors.js            # custom error classes
│   │   └── app.js
│   ├── .env.example
│   └── package.json
│
├── ai-service/                      # Python FastAPI
│   ├── main.py                      # FastAPI app + /verify + /health
│   ├── liveness.py                  # OpenCV passive liveness detection
│   ├── models.py                    # Pydantic request/response models
│   ├── requirements.txt
│   └── Dockerfile
│
└── ARCHITECTURE.md                  # This file — seed to all AI assistants
```

---

## The 17 Invariants

These are absolute. No invariant can be broken for any reason without
explicit documented approval from the project owner.

| # | Invariant |
|---|---|
| 1 | Votes table never contains voter_id, session_id, or any linkable field |
| 2 | JWT never sent over SMS, email, or any unencrypted channel |
| 3 | A voter is never auto-rejected due to AI service failure — always FACE_PENDING |
| 4 | Face embeddings are request-scoped; nulled immediately on rejection or withdrawal |
| 5 | Admin accounts seeded only; no API endpoint creates or modifies admins |
| 6 | Results are system-computed from votes table; never entered manually |
| 7 | audit_logs and request_events are append-only; no UPDATE or DELETE via any API |
| 8 | All cron jobs are idempotent and protected by Postgres advisory locks |
| 9 | Constituency validation enforced server-side and at DB query level |
| 10 | Accessibility (i18n, font size, ARIA, high contrast) built from Phase 1 |
| 11 | Vote submission is a single atomic DB transaction; no partial writes |
| 12 | OTPs stored as bcrypt hash only; never plaintext or SHA-256; invalidated on resend or use |
| 13 | request_events row inserted BEFORE voting_requests.status is updated |
| 14 | MinIO document URLs are signed, short-lived, never publicly accessible |
| 15 | Critical actions (result publication, election activation) require password re-entry |
| 16 | Every protected endpoint checks is_revoked = false before processing |
| 17 | cast_at in votes table is rounded to nearest minute; never exact timestamp |

---

## Quick Reference — Common Patterns

### Encrypt a PII value before storing
```javascript
// utils/crypto.js
export async function encryptValue(plaintext) {
  const result = await db.query(
    `SELECT pgp_sym_encrypt($1, $2) AS encrypted`,
    [plaintext, process.env.PGCRYPTO_KEY]
  );
  return result.rows[0].encrypted;
}

export async function decryptValue(encrypted) {
  const result = await db.query(
    `SELECT pgp_sym_decrypt($1, $2) AS decrypted`,
    [encrypted, process.env.PGCRYPTO_KEY]
  );
  return result.rows[0].decrypted;
}
```

### Hash a Voter ID for lookup
```javascript
import crypto from 'crypto';
export function hashVoterId(voterId) {
  return crypto.createHash('sha256').update(voterId.toUpperCase()).digest('hex');
}
```

### Hash and verify an OTP
```javascript
import bcrypt from 'bcrypt';
export const hashOTP   = (otp)          => bcrypt.hash(otp, 10);
export const verifyOTP = (otp, hash)    => bcrypt.compare(otp, hash);
```

### Insert a request_event (always call before status update)
```javascript
export async function recordStatusChange(db, { requestId, oldStatus, newStatus, actorId, actorType, reason, metadata }) {
  await db.query(
    `INSERT INTO request_events
     (request_id, old_status, new_status, actor_id, actor_type, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [requestId, oldStatus, newStatus, actorId, actorType, reason, metadata ?? null]
  );
}
```

### Log to audit_logs
```javascript
export async function auditLog(db, { actorType, actorId, action, entityType, entityId, metadata, ipAddress, requestId }) {
  await db.query(
    `INSERT INTO audit_logs
     (actor_type, actor_id, action, entity_type, entity_id, metadata, ip_address, request_id_header)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actorType, actorId, action, entityType, entityId ?? null, metadata ?? null, ipAddress ?? null, requestId ?? null]
  );
}
```

### Session validity check middleware
```javascript
export async function requireValidSession(expectedState) {
  return async (req, res, next) => {
    const sessionId = req.session?.id;
    const session = await db.query(
      'SELECT * FROM voting_sessions WHERE id = $1', [sessionId]
    );
    const s = session.rows[0];
    if (!s)               return res.status(401).json({ error: 'session_not_found' });
    if (s.is_revoked)     return res.status(401).json({ error: 'session_revoked' });
    if (s.expires_at < new Date()) return res.status(401).json({ error: 'session_expired' });
    if (s.state !== expectedState) return res.status(409).json({ error: 'invalid_state' });
    req.votingSession = s;
    next();
  };
}
```

---

*End of ARCHITECTURE.md*
*Version: 1.0 — Matches VerifiedVote Master Prompt v3*
*Seed this file to every AI assistant at the start of every session.*
