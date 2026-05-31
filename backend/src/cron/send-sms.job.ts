import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';
import { SMSService } from '../services/sms/textbee.adapter.js';
import { buildSmsMessage } from '../services/sms/message-templates.js';
import { parseNotificationMetadata } from '../services/sms/parse-metadata.js';
import { decryptValue } from '../utils/crypto.js';

async function processPendingSms() {
  const pending = await db.query(
    `SELECT id, voter_id, type, metadata
     FROM notifications
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 50`
  );

  for (const notif of pending.rows) {
    try {
      const voterRes = await db.query('SELECT phone_enc FROM voters WHERE id = $1', [notif.voter_id]);
      if (voterRes.rows.length === 0) {
        await db.query(
          `UPDATE notifications SET status = 'failed', failed_reason = $1, next_retry_at = now() + interval '5 minutes' WHERE id = $2`,
          ['voter_not_found', notif.id]
        );
        continue;
      }

      const phone = await decryptValue(voterRes.rows[0].phone_enc);
      const meta = await parseNotificationMetadata(notif.metadata);
      const message = buildSmsMessage(notif.type, meta as Record<string, string>);

      await SMSService.send(phone, message);
      await db.query(
        `UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1`,
        [notif.id]
      );
      logger.info({ action: 'sms_sent', notification_id: notif.id, type: notif.type });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      await db.query(
        `UPDATE notifications
         SET status = 'failed', failed_reason = $1, retry_count = retry_count + 1,
             next_retry_at = now() + interval '5 minutes'
         WHERE id = $2`,
        [msg, notif.id]
      );
      logger.error({ action: 'sms_send_failed', notification_id: notif.id, error: msg });
    }
  }
}

export function startSendSmsJob() {
  setInterval(() => {
    void runWithLock('send_sms', processPendingSms).catch((err: unknown) => {
      logger.error({
        action: 'send_sms_job_failed',
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  }, 60 * 1000);
}
