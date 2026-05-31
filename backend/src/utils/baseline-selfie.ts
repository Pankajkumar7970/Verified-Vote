import { db } from '../db/index.js';
import { decryptDocKey } from './crypto.js';
import { MinIOService } from '../services/minio.service.js';
import { FaceVerifyService } from '../services/face-verify.service.js';

export function byteaToBuffer(value: unknown): Buffer | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value.length > 0 ? value : null;
  if (value instanceof Uint8Array) {
    const buf = Buffer.from(value);
    return buf.length > 0 ? buf : null;
  }
  if (typeof value === 'string') {
    if (value.length === 0) return null;
    if (value.startsWith('\\x')) {
      const buf = Buffer.from(value.slice(2), 'hex');
      return buf.length > 0 ? buf : null;
    }
    const buf = Buffer.from(value, 'base64');
    return buf.length > 0 ? buf : null;
  }
  return null;
}

export function hasBaseline(
  embeddingEnc: unknown,
  minioKeyEnc: string | null | undefined,
): boolean {
  return !!byteaToBuffer(embeddingEnc) || !!minioKeyEnc;
}

export type BaselineSource = {
  embeddingEnc: Buffer | null;
  minioKeyEnc: string | null;
};

/**
 * Resolve voting-time baseline from session snapshot, then request row.
 * Backfills session snapshot when baseline exists on request only.
 */
/** Copy baseline from request onto session if not already snapshotted. */
export async function ensureSessionBaselineSnapshot(
  sessionId: string,
  requestId: string,
): Promise<void> {
  try {
    const requestRes = await db.query(
      `SELECT request_selfie_embedding_enc, request_selfie_minio_key
       FROM voting_requests WHERE id = $1`,
      [requestId],
    );
    const requestRow = requestRes.rows[0] as {
      request_selfie_embedding_enc?: unknown;
      request_selfie_minio_key?: string | null;
    };
    if (
      !requestRow ||
      !hasBaseline(
        requestRow.request_selfie_embedding_enc,
        requestRow.request_selfie_minio_key,
      )
    ) {
      return;
    }
    await db.query(
      `UPDATE voting_sessions
       SET baseline_embedding_enc = COALESCE(baseline_embedding_enc, $1),
           baseline_selfie_minio_key = COALESCE(baseline_selfie_minio_key, $2),
           updated_at = now()
       WHERE id = $3`,
      [
        byteaToBuffer(requestRow.request_selfie_embedding_enc),
        requestRow.request_selfie_minio_key,
        sessionId,
      ],
    );
  } catch {
    // Migration not applied yet
  }
}

export async function resolveVotingBaseline(
  sessionId: string,
  requestId: string,
): Promise<BaselineSource> {
  await ensureSessionBaselineSnapshot(sessionId, requestId);

  const sessionRes = await db.query(
    `SELECT baseline_embedding_enc, baseline_selfie_minio_key
     FROM voting_sessions WHERE id = $1`,
    [sessionId],
  );
  const sessionRow = sessionRes.rows[0];

  const requestRes = await db.query(
    `SELECT request_selfie_embedding_enc, request_selfie_minio_key
     FROM voting_requests WHERE id = $1`,
    [requestId],
  );
  const requestRow = requestRes.rows[0];
  if (!requestRow) {
    return { embeddingEnc: null, minioKeyEnc: null };
  }

  let embeddingEnc =
    byteaToBuffer(sessionRow?.baseline_embedding_enc) ??
    byteaToBuffer(requestRow.request_selfie_embedding_enc);
  let minioKeyEnc =
    sessionRow?.baseline_selfie_minio_key ??
    requestRow.request_selfie_minio_key ??
    null;

  const needsBackfill =
    sessionRow &&
    ((!sessionRow.baseline_embedding_enc &&
      requestRow.request_selfie_embedding_enc) ||
      (!sessionRow.baseline_selfie_minio_key &&
        requestRow.request_selfie_minio_key));

  if (needsBackfill) {
    try {
      await db.query(
        `UPDATE voting_sessions
         SET baseline_embedding_enc = COALESCE(baseline_embedding_enc, $1),
             baseline_selfie_minio_key = COALESCE(baseline_selfie_minio_key, $2),
             updated_at = now()
         WHERE id = $3`,
        [
          byteaToBuffer(requestRow.request_selfie_embedding_enc),
          requestRow.request_selfie_minio_key,
          sessionId,
        ],
      );
      embeddingEnc =
        byteaToBuffer(sessionRow.baseline_embedding_enc) ?? embeddingEnc;
      minioKeyEnc = sessionRow.baseline_selfie_minio_key ?? minioKeyEnc;
    } catch {
      // Columns may not exist until migration is applied
    }
  }

  return { embeddingEnc, minioKeyEnc };
}

/** Creates a voting session and snapshots baseline selfie data from the request. */
export async function insertVotingSessionWithBaseline(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  requestId: string,
  refCode: string,
  expiresAt: Date,
): Promise<boolean> {
  const baselineRes = await client.query(
    `SELECT request_selfie_embedding_enc, request_selfie_minio_key
     FROM voting_requests WHERE id = $1`,
    [requestId],
  );
  const baseline = baselineRes.rows[0] as {
    request_selfie_embedding_enc?: unknown;
    request_selfie_minio_key?: string | null;
  };
  if (
    !baseline ||
    !hasBaseline(
      baseline.request_selfie_embedding_enc,
      baseline.request_selfie_minio_key,
    )
  ) {
    return false;
  }

  try {
    await client.query(
      `INSERT INTO voting_sessions
       (request_id, ref_code, expires_at, state, baseline_embedding_enc, baseline_selfie_minio_key)
       VALUES ($1, $2, $3, 'link_opened', $4, $5)`,
      [
        requestId,
        refCode,
        expiresAt,
        baseline.request_selfie_embedding_enc,
        baseline.request_selfie_minio_key,
      ],
    );
  } catch {
    await client.query(
      `INSERT INTO voting_sessions (request_id, ref_code, expires_at, state)
       VALUES ($1, $2, $3, 'link_opened')`,
      [requestId, refCode, expiresAt],
    );
  }
  return true;
}

export async function verifyAgainstBaseline(
  baseline: BaselineSource,
  liveImageB64: string,
  requestId?: string,
) {
  if (baseline.embeddingEnc) {
    try {
      return await FaceVerifyService.verifyFace(
        baseline.embeddingEnc,
        liveImageB64,
        requestId,
      );
    } catch (err) {
      // Decrypt/AI failure — fall through to MinIO photo if available
      if (!baseline.minioKeyEnc) throw err;
    }
  }

  if (baseline.minioKeyEnc) {
    const refSelfieKey = await decryptDocKey(baseline.minioKeyEnc);
    const refSelfieBuf = await MinIOService.getDocumentBuffer(refSelfieKey);
    const referenceImageB64 = refSelfieBuf.toString('base64');
    return FaceVerifyService.verifyFaceAgainstReferencePhoto(
      referenceImageB64,
      liveImageB64,
      requestId,
    );
  }

  return null;
}
