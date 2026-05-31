import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { decryptValue } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

const AI_SERVICE_URL = config.aiServiceUrl;
const AI_TIMEOUT_MS = config.aiTimeoutMs;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

export class AiServiceUnavailableError extends Error {
  constructor(message = 'ai_service_unavailable') {
    super(message);
    this.name = 'AiServiceUnavailableError';
  }
}

export class AiServiceValidationError extends Error {
  constructor(message = 'invalid_selfie') {
    super(message);
    this.name = 'AiServiceValidationError';
  }
}

// Zod schemas for AI service responses
const FaceVerifyResultSchema = z.object({
  match: z.boolean(),
  face_score: z.number(),
  liveness_score: z.number(),
  model: z.string(),
  duration_ms: z.number(),
});

const EmbedResultSchema = z.object({
  embedding: z.array(z.number()),
  liveness_score: z.number(),
  model: z.string(),
  duration_ms: z.number(),
});

const BlinkCheckResultSchema = z.object({
  blink_detected: z.boolean(),
  confidence: z.number(),
  detail: z.string(),
});

export type FaceVerifyResult = z.infer<typeof FaceVerifyResultSchema>;
export type EmbedResult = z.infer<typeof EmbedResultSchema>;
export type BlinkCheckResult = z.infer<typeof BlinkCheckResultSchema>;

function aiHeaders(requestId?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (requestId) headers['X-Request-ID'] = requestId;
  return headers;
}

/**
 * FIX: In Node 18+, failed TCP connections throw an AggregateError which axios
 * wraps as err.cause instead of surfacing directly on err.code. The previous
 * check only looked at err.code, so ECONNREFUSED was never detected as
 * transient, retries were skipped, and the error bubbled up with an empty
 * message that the route couldn't classify.
 *
 * Now we check both err.code (older Node / single-attempt failures) and
 * err.cause (Node 18+ AggregateError path).
 */
const TRANSIENT_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ERR_NETWORK',
]);

function isTransientError(err: unknown): boolean {
  if (!(err instanceof AxiosError)) return false;

  const status = err.response?.status;
  if (status === 429 || (status !== undefined && status >= 500)) return true;

  // Direct code on the AxiosError (older Node / single-attempt)
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;

  // FIX: Node 18+ wraps ECONNREFUSED in an AggregateError stored at err.cause.
  // axios sets err.code = undefined in this case, so we must check the cause.
  const cause = err.cause;
  if (cause instanceof AggregateError) {
    return cause.errors?.some(
      (e: Error & { code?: string }) => e.code && TRANSIENT_CODES.has(e.code),
    ) ?? false;
  }
  if (cause instanceof Error && (cause as any).code) {
    return TRANSIENT_CODES.has((cause as any).code);
  }

  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleAiError(err: unknown, requestId?: string): Promise<never> {
  if (err instanceof AiServiceUnavailableError || err instanceof AiServiceValidationError) {
    throw err;
  }

  const axiosErr = err as AxiosError;
  const status = axiosErr.response?.status;

  // FIX: Extract a meaningful message from AggregateError cause so the log
  // entry is not blank when ECONNREFUSED is the underlying reason.
  const causeMessage =
    axiosErr.cause instanceof AggregateError
      ? axiosErr.cause.errors?.map((e: Error) => e.message).join(', ')
      : axiosErr.cause instanceof Error
        ? axiosErr.cause.message
        : undefined;

  logger.error({
    request_id: requestId,
    service: 'node-backend',
    action: 'ai_service_call_failed',
    status,
    code: axiosErr.code,
    message: axiosErr.message || causeMessage || 'unknown',
    cause: causeMessage,
  });

  if (status === 422) {
    throw new AiServiceValidationError();
  }

  // Any connectivity or server-side failure → AiServiceUnavailableError.
  // This includes the AggregateError / ECONNREFUSED path that previously fell
  // through with no code and no status, producing a silent failure.
  throw new AiServiceUnavailableError();
}

async function withRetry<T>(
  fn: () => Promise<T>,
  requestId?: string,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || i === maxRetries) {
        break;
      }
      const delayMs = RETRY_DELAY_MS * Math.pow(2, i);
      logger.warn({
        request_id: requestId,
        action: 'ai_service_retry',
        attempt: i + 1,
        delay_ms: delayMs,
      });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

export class FaceVerifyService {
  static async checkHealth(): Promise<boolean> {
    if (!AI_SERVICE_URL) return false;
    try {
      const res = await axios.get(`${AI_SERVICE_URL}/health`, { timeout: AI_TIMEOUT_MS });
      return res.data?.status === 'ok' && res.data?.model === 'loaded';
    } catch {
      return false;
    }
  }

  static async getEmbedding(
    imageB64: string,
    requestId?: string,
  ): Promise<EmbedResult> {
    if (!AI_SERVICE_URL) {
      throw new AiServiceUnavailableError();
    }

    try {
      const res = await withRetry(
        () =>
          axios.post(
            `${AI_SERVICE_URL}/embed`,
            { live_image_b64: imageB64 },
            {
              timeout: AI_TIMEOUT_MS,
              headers: aiHeaders(requestId),
            },
          ),
        requestId,
      );
      return EmbedResultSchema.parse(res.data);
    } catch (err) {
      await handleAiError(err, requestId);
    }
  }

  static async verifyFaceAgainstReferencePhoto(
    referenceImageB64: string,
    liveImageB64: string,
    requestId?: string,
  ): Promise<FaceVerifyResult> {
    if (!AI_SERVICE_URL) {
      throw new AiServiceUnavailableError();
    }
    const embed = await this.getEmbedding(referenceImageB64, requestId);
    try {
      const res = await withRetry(
        () =>
          axios.post(
            `${AI_SERVICE_URL}/verify`,
            {
              reference_embedding: embed.embedding,
              live_image_b64: liveImageB64,
            },
            {
              timeout: AI_TIMEOUT_MS,
              headers: aiHeaders(requestId),
            },
          ),
        requestId,
      );
      return FaceVerifyResultSchema.parse(res.data);
    } catch (err) {
      await handleAiError(err, requestId);
    }
  }

  static async verifyFace(
    referenceEmbeddingEnc: Buffer | null,
    imageB64: string,
    requestId?: string,
  ): Promise<FaceVerifyResult> {
    if (!AI_SERVICE_URL) {
      throw new AiServiceUnavailableError();
    }

    if (!referenceEmbeddingEnc) {
      throw new AiServiceValidationError('missing_reference_embedding');
    }

    let referenceEmbedding: number[];
    try {
      const decrypted = await decryptValue(referenceEmbeddingEnc);
      referenceEmbedding = JSON.parse(decrypted) as number[];
      if (!Array.isArray(referenceEmbedding) || referenceEmbedding.length < 128) {
        throw new Error('invalid_embedding_format');
      }
    } catch (err: unknown) {
      logger.error({
        request_id: requestId,
        service: 'node-backend',
        action: 'embedding_decrypt_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
      throw new AiServiceUnavailableError();
    }

    try {
      const res = await withRetry(
        () =>
          axios.post(
            `${AI_SERVICE_URL}/verify`,
            {
              reference_embedding: referenceEmbedding,
              live_image_b64: imageB64,
            },
            {
              timeout: AI_TIMEOUT_MS,
              headers: aiHeaders(requestId),
            },
          ),
        requestId,
      );
      return FaceVerifyResultSchema.parse(res.data);
    } catch (err) {
      await handleAiError(err, requestId);
    }
  }

  static async checkBlink(
    framesB64: string[],
    requestId?: string,
  ): Promise<BlinkCheckResult> {
    if (!AI_SERVICE_URL) {
      return { blink_detected: true, confidence: 0.0, detail: 'ai_service_not_configured' };
    }
    try {
      const res = await withRetry(
        () =>
          axios.post(
            `${AI_SERVICE_URL}/liveness/blink`,
            { frames_b64: framesB64 },
            { timeout: AI_TIMEOUT_MS, headers: aiHeaders(requestId) },
          ),
        requestId,
      );
      return BlinkCheckResultSchema.parse(res.data);
    } catch (err) {
      // Fail-open: blink check failure must never block a legitimate voter.
      // Log for monitoring but return detected=true so submission proceeds.
      logger.warn({
        request_id: requestId,
        service: 'node-backend',
        action: 'blink_check_failed',
        message: err instanceof Error ? err.message : 'unknown',
        // FIX: also surface AggregateError cause in the log
        cause:
          err instanceof AxiosError && err.cause instanceof AggregateError
            ? err.cause.errors?.map((e: Error) => e.message).join(', ')
            : undefined,
      });
      return { blink_detected: true, confidence: 0.0, detail: 'blink_check_unavailable' };
    }
  }
}