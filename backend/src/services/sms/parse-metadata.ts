import { decryptValue } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';

export async function parseNotificationMetadata(raw: unknown): Promise<Record<string, unknown>> {
  if (!raw) return {};

  let parsed: Record<string, unknown> = {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw as Record<string, unknown>;
  } else if (typeof raw === 'string') {
    try {
      const obj = JSON.parse(raw);
      if (typeof obj === 'object' && obj !== null) {
        parsed = obj as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  } else {
    return {};
  }

  if (parsed.enc && typeof parsed.enc === 'string') {
    try {
      const buf = Buffer.from(parsed.enc, 'base64');
      const decrypted = await decryptValue(buf);
      const decObj = JSON.parse(decrypted);
      if (typeof decObj === 'object' && decObj !== null) {
        return decObj as Record<string, unknown>;
      }
    } catch (err: unknown) {
      logger.error({
        action: 'parse_notification_metadata_decrypt_failed',
        error: err instanceof Error ? err.message : 'unknown',
      });
      return {};
    }
  }

  return parsed;
}
