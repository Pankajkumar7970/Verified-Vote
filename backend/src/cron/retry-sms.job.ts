import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';
import { SMSService } from '../services/sms/textbee.adapter.js';

async function retryFailedSMS() {
  const result = await db.query(
    `SELECT id, voter_id, type, retry_count 
     FROM notifications 
     WHERE status = 'failed' 
       AND retry_count < 3 
       AND next_retry_at <= now()`
  );

  for (const notif of result.rows) {
    try {
      const voterReq = await db.query('SELECT phone_enc FROM voters WHERE id = $1', [notif.voter_id]);
      if (voterReq.rows.length === 0) continue;

      const { decryptValue } = await import('../utils/crypto.js');
      const phone = await decryptValue(voterReq.rows[0].phone_enc);

      // Note: We'd dynamically resolve messages based on 'type' here, mock standard msg for now
      const message = `VerifiedVote Alert: You have an update regarding your request.`; 
      
      await SMSService.send(phone, message);
      
      await db.query(
        `UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1`,
        [notif.id]
      );
      logger.info({ action: 'sms_retry_success', notification_id: notif.id });
    } catch (err: any) {
      const newCount = notif.retry_count + 1;
      const status = newCount >= 3 ? 'permanent_fail' : 'failed';
      await db.query(
        `UPDATE notifications 
         SET retry_count = $1, status = $2, failed_reason = $3, 
             next_retry_at = now() + interval '5 minutes'
         WHERE id = $4`,
        [newCount, status, err.message, notif.id]
      );
      logger.error({ action: 'sms_retry_failed', notification_id: notif.id, attempts: newCount });
    }
  }
}

export function startRetrySmsJob() {
  setInterval(() => {
    runWithLock('retry_sms', retryFailedSMS);
  }, 1 * 60 * 1000); // Every 1 minute
}
