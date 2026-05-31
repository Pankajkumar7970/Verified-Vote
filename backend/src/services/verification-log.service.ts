import { db } from '../db/index.js';
import { config } from '../utils/config.js';
import { DEFAULT_LIVENESS_THRESHOLD } from '../constants/verification.js';

// In dev mode, use relaxed thresholds so testing with a webcam works reliably.
const DEFAULT_FACE_THRESHOLD = config.isProd ? 0.6 : 0.20;

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

export type VerificationLogParams = {
  requestId?: string | null;
  sessionId?: string | null;
  verificationType: 'request_time' | 'voting_time';
  faceScore: number;
  livenessScore: number | null;
  faceThreshold: number;
  livenessThreshold: number | null;
  facePassed: boolean;
  livenessPassed: boolean | null;
  overallPassed: boolean;
  modelUsed: string;
  durationMs: number;
};

export async function logVerification(
  params: VerificationLogParams,
  conn: Queryable = db
): Promise<void> {
  await conn.query(
    `INSERT INTO verification_logs
      (request_id, session_id, verification_type, face_score, liveness_score,
       face_threshold, liveness_threshold, face_passed, liveness_passed,
       overall_passed, model_used, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      params.requestId ?? null,
      params.sessionId ?? null,
      params.verificationType,
      params.faceScore,
      params.livenessScore,
      params.faceThreshold,
      params.livenessThreshold,
      params.facePassed,
      params.livenessPassed,
      params.overallPassed,
      params.modelUsed,
      params.durationMs,
    ]
  );
}

export async function getElectionSettings(electionId: string): Promise<{
  face_match_threshold: number;
  liveness_threshold: number;
}> {
  const res = await db.query(
    `SELECT face_match_threshold, liveness_threshold
     FROM election_settings WHERE election_id = $1`,
    [electionId]
  );
  const row = res.rows[0];
  return {
    face_match_threshold: row?.face_match_threshold ?? DEFAULT_FACE_THRESHOLD,
    liveness_threshold: row?.liveness_threshold ?? DEFAULT_LIVENESS_THRESHOLD,
  };
}
