import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';
import { SMSService } from '../services/sms/textbee.adapter.js';
import { buildSmsMessage } from '../services/sms/message-templates.js';
import { parseNotificationMetadata } from '../services/sms/parse-metadata.js';
import { decryptValue } from '../utils/crypto.js';

async function retryFailedSMS() {
  const result = await db.query(
    `SELECT id, voter_id, type, metadata, retry_count
     FROM notifications
     WHERE status = 'failed'
       AND retry_count < 3
       AND (next_retry_at IS NULL OR next_retry_at <= now())`
  );

  for (const notif of result.rows) {
    try {
      const voterReq = await db.query('SELECT phone_enc FROM voters WHERE id = $1', [notif.voter_id]);
      if (voterReq.rows.length === 0) continue;

      const phone = await decryptValue(voterReq.rows[0].phone_enc);
      const meta = await parseNotificationMetadata(notif.metadata);
      const message = buildSmsMessage(notif.type, meta as Record<string, string>);

      await SMSService.send(phone, message);

      await db.query(`UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1`, [notif.id]);
      logger.info({ action: 'sms_retry_success', notification_id: notif.id });
    } catch (err: unknown) {
      const newCount = notif.retry_count + 1;
      // After exhausting retries mark as 'dead_letter' so the query never picks it up again.
      const status = newCount >= 3 ? 'dead_letter' : 'failed';
      await db.query(
        `UPDATE notifications
         SET retry_count = $1, status = $2, failed_reason = $3, next_retry_at = now() + interval '5 minutes'
         WHERE id = $4`,
        [newCount, status, err instanceof Error ? err.message : 'unknown', notif.id]
      );
      logger.error({ action: 'sms_retry_failed', notification_id: notif.id, attempts: newCount });
    }
  }
}

export function startRetrySmsJob() {
  setInterval(() => {
    void runWithLock('retry_sms', retryFailedSMS).catch((err: unknown) => {
      logger.error({
        action: 'retry_sms_job_failed',
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  }, 5 * 60 * 1000);
}
