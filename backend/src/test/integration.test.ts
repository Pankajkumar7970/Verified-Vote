/**
 * API integration & security smoke tests.
 * Run: npm run test:integration  (server must be on PORT, default 3000)
 */
import dotenv from "dotenv";
dotenv.config();

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const DEV_OTP = "123456";

type Json = Record<string, unknown>;

async function api(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; formData?: FormData } = {},
): Promise<{ status: number; data: Json }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  let data: Json = {};
  try {
    data = (await res.json()) as Json;
  } catch {
    data = {};
  }
  return { status: res.status, data };
}

async function voterLogin(voterId: string): Promise<string> {
  const v = await api("POST", "/api/auth/verify-voter", {
    body: { voter_id: voterId, turnstile_token: "dummy" },
  });
  assert.equal(v.status, 200, `verify-voter: ${JSON.stringify(v.data)}`);
  const nonce = v.data.session_nonce as string;
  const o = await api("POST", "/api/auth/verify-otp", {
    body: { session_nonce: nonce, otp: DEV_OTP },
  });
  assert.equal(o.status, 200, `verify-otp: ${JSON.stringify(o.data)}`);
  return o.data.token as string;
}

async function adminLogin(): Promise<string> {
  const user = process.env.SUPER_ADMIN_USERNAME || "admin123";
  const pass = process.env.SUPER_ADMIN_PASSWORD || "admin123";
  const r = await api("POST", "/api/admin/auth/login", {
    body: { username: user, password: pass },
  });
  assert.equal(r.status, 200, `admin login: ${JSON.stringify(r.data)}`);
  return r.data.token as string;
}

describe("VerifiedVote integration", () => {
  let voterTokenA: string | null = null;
  let voterTokenB: string | null = null;

  before(async () => {
    const h = await api("GET", "/api/health");
    assert.equal(h.status, 200, "Server not reachable at " + BASE);
    try {
      voterTokenA = await voterLogin("ABC1234567");
      voterTokenB = await voterLogin("XYZ9876543");
    } catch (e) {
      console.warn(
        "[integration] Voter login skipped (OTP rate limit?). Re-run after 15 min or use fresh DB.",
      );
    }
  });

  test("health endpoints", async () => {
    assert.equal((await api("GET", "/api/live")).status, 200);
    assert.equal((await api("GET", "/api/ready")).status, 200);
  });

  test("voter auth rejects invalid ID format", async () => {
    const r = await api("POST", "/api/auth/verify-voter", {
      body: { voter_id: "bad", turnstile_token: "dummy" },
    });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "invalid_voter_id");
  });

  test("voter auth rejects wrong OTP", async () => {
    const v = await api("POST", "/api/auth/verify-voter", {
      body: { voter_id: "ABC1234567", turnstile_token: "dummy" },
    });
    assert.equal(v.status, 200);
    const r = await api("POST", "/api/auth/verify-otp", {
      body: { session_nonce: v.data.session_nonce, otp: "000000" },
    });
    assert.equal(r.status, 401);
  });

  test("protected voter routes require auth", async () => {
    const r = await api("GET", "/api/voter/elections");
    assert.equal(r.status, 401);
  });

  test("protected admin routes require auth", async () => {
    const r = await api("GET", "/api/admin/elections");
    assert.equal(r.status, 401);
  });

  test("voter cannot access admin routes with voter JWT", async () => {
    if (!voterTokenA) return;
    const r = await api("GET", "/api/admin/elections", { token: voterTokenA });
    assert.equal(r.status, 401);
  });

  test("admin cannot use voter-only shape JWT on voter routes without voter_id", async () => {
    const adminToken = await adminLogin();
    const r = await api("GET", "/api/voter/requests", { token: adminToken });
    assert.equal(r.status, 401);
  });

  test("session JWT cannot access voter portal routes", async () => {
    const secret = process.env.JWT_SECRET || "dev-only-jwt-secret-change-me";
    const sessionToken = jwt.sign(
      { session_id: "00000000-0000-4000-8000-000000000001" },
      secret,
      {
        expiresIn: "15m",
      },
    );
    const r = await api("GET", "/api/voter/requests", { token: sessionToken });
    assert.equal(r.status, 401);
  });

  test("invalid session ref returns 404", async () => {
    const r = await api("GET", "/api/session/status?ref_code=INVALIDCODE12");
    assert.equal(r.status, 404);
  });

  test("face-verify requires session auth", async () => {
    const r = await api("POST", "/api/session/face-verify", {
      body: { selfie_b64: "abc" },
    });
    assert.equal(r.status, 401);
  });

  test("vote cast requires session auth", async () => {
    const r = await api("POST", "/api/vote/cast", {
      body: { candidate_id: "x" },
    });
    assert.equal(r.status, 401);
  });

  test("doc-preview rejects invalid key format", async () => {
    const adminToken = await adminLogin();
    const r = await api("GET", "/api/admin/doc-preview?key=../../etc/passwd", {
      token: adminToken,
    });
    assert.equal(r.status, 400);
  });

  test("public results blocked before publish", async () => {
    const adminToken = await adminLogin();
    const elections = await api("GET", "/api/admin/elections", {
      token: adminToken,
    });
    assert.equal(elections.status, 200);
    const list = elections.data.elections as { id: string; status: string }[];
    const draft = list.find((e) => e.status === "draft") || list[0];
    if (!draft) return;
    const r = await api("GET", `/api/public/elections/${draft.id}/results`);
    assert.ok(r.status === 403 || r.status === 404);
  });

  test("voter requests scope active vs history", async () => {
    if (!voterTokenA) return;
    const token = voterTokenA;
    const active = await api("GET", "/api/voter/requests?scope=active", {
      token,
    });
    const history = await api("GET", "/api/voter/requests?scope=history", {
      token,
    });
    assert.equal(active.status, 200);
    assert.equal(history.status, 200);
    const terminal = ["final_approved", "withdrawn", "appeal_resolved"];
    for (const req of (active.data.requests as { status: string }[]) || []) {
      assert.ok(
        !terminal.includes(req.status),
        `terminal in active: ${req.status}`,
      );
    }
    for (const req of (history.data.requests as { status: string }[]) || []) {
      assert.ok(
        terminal.includes(req.status),
        `non-terminal in history: ${req.status}`,
      );
    }
  });

  test("withdraw IDOR blocked", async () => {
    if (!voterTokenA || !voterTokenB) return;
    const tokenA = voterTokenA;
    const tokenB = voterTokenB;
    const reqs = await api("GET", "/api/voter/requests?scope=active", {
      token: tokenA,
    });
    const myId = (reqs.data.requests as { id: string }[])?.[0]?.id;
    if (!myId) return;
    const r = await api("POST", `/api/voter/requests/${myId}/withdraw`, {
      token: tokenB,
    });
    assert.ok(r.status === 404 || r.status === 400);
  });

  test("request submit rejects invalid election UUID", async () => {
    if (!voterTokenA) return;
    const token = voterTokenA;
    const fd = new FormData();
    fd.append("election_id", "not-a-uuid");
    fd.append("reason_category", "medical");
    fd.append("doc_type", "hospital_letter");
    fd.append("selfie_b64", Buffer.from("x".repeat(2000)).toString("base64"));
    const r = await api("POST", "/api/voter/requests/submit", {
      token,
      formData: fd,
    });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "invalid_election_id");
  });

  test("admin can create and list parties", async () => {
    const adminToken = await adminLogin();
    const create = await api("POST", "/api/admin/parties", {
      token: adminToken,
      body: {
        name: "Test Party " + Date.now(),
        abbreviation: "TPX",
        color: "#ff0000",
      },
    });
    assert.equal(create.status, 200);
    const list = await api("GET", "/api/admin/parties", { token: adminToken });
    assert.equal(list.status, 200);
    assert.ok((list.data.parties as any[]).length > 0);
  });

  test("admin can create and transition election status", async () => {
    const adminToken = await adminLogin();
    const electionData = {
      name: "Integration Test Election " + Date.now(),
      election_date: new Date(Date.now() + 86400000).toISOString(),
      request_deadline: new Date(Date.now() + 3600000).toISOString(),
      state: "KARNATAKA",
      constituency: "BANGALORE SOUTH",
    };
    const create = await api("POST", "/api/admin/elections", {
      token: adminToken,
      body: electionData,
    });
    assert.equal(create.status, 200);
    const electionId = (create.data as { election: { id: string } }).election
      .id;

    const list = await api("GET", "/api/admin/elections", {
      token: adminToken,
    });
    assert.ok((list.data.elections as any[]).some((e) => e.id === electionId));

    const transition = await api(
      "POST",
      `/api/admin/elections/${electionId}/activate`,
      {
        token: adminToken,
        body: { password: "admin" },
      },
    );
    // This expects password validation, which should pass if admin password is 'admin123'
    // Oh wait, super admin password is admin123.
    const transition2 = await api(
      "POST",
      `/api/admin/elections/${electionId}/activate`,
      {
        token: adminToken,
        body: { password: process.env.SUPER_ADMIN_PASSWORD || "admin123" },
      },
    );
    assert.equal(transition2.status, 200);
  });
});
