import { db } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { SMSService } from './textbee.adapter.js';
import { buildSmsMessage } from './message-templates.js';
import { parseNotificationMetadata } from './parse-metadata.js';
import { decryptValue } from '../../utils/crypto.js';

const OTP_TYPES = new Set(['auth_otp', 'voting_otp']);

/** Claim and send one notification. Returns false if already sent or claimed by another worker. */
export async function dispatchNotification(notificationId: string): Promise<boolean> {
  const claim = await db.query(
    `UPDATE notifications
     SET status = 'sending'
     WHERE id = $1 AND status = 'pending'
     RETURNING id, voter_id, type, metadata`,
    [notificationId],
  );

  if (claim.rows.length === 0) {
    return false;
  }

  const notif = claim.rows[0];

  try {
    const voterRes = await db.query('SELECT phone_enc FROM voters WHERE id = $1', [
      notif.voter_id,
    ]);
    if (voterRes.rows.length === 0) {
      await db.query(
        `UPDATE notifications
         SET status = 'failed', failed_reason = $1, next_retry_at = now() + interval '5 minutes'
         WHERE id = $2`,
        ['voter_not_found', notif.id],
      );
      return false;
    }

    const phone = await decryptValue(voterRes.rows[0].phone_enc);
    const meta = await parseNotificationMetadata(notif.metadata);
    const message = buildSmsMessage(notif.type, meta as Record<string, string>);

    await SMSService.send(phone, message);
    await db.query(
      `UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1`,
      [notif.id],
    );
    logger.info({
      action: 'sms_sent',
      notification_id: notif.id,
      type: notif.type,
    });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    await db.query(
      `UPDATE notifications
       SET status = 'failed', failed_reason = $1, retry_count = retry_count + 1,
           next_retry_at = now() + interval '5 minutes'
       WHERE id = $2`,
      [msg, notif.id],
    );
    logger.error({
      action: 'sms_send_failed',
      notification_id: notif.id,
      error: msg,
    });
    return false;
  }
}

/** Fire-and-forget immediate send for OTP notifications (after DB commit). */
export function scheduleOtpDispatch(notificationId: string, type: string): void {
  if (!OTP_TYPES.has(type)) {
    return;
  }

  void dispatchNotification(notificationId).catch((err: unknown) => {
    logger.error({
      action: 'otp_dispatch_unhandled',
      notification_id: notificationId,
      error: err instanceof Error ? err.message : 'unknown',
    });
  });
}

/** Reset notifications stuck in `sending` (e.g. crash mid-dispatch). */
export async function releaseStuckSendingNotifications(): Promise<void> {
  await db.query(
    `UPDATE notifications
     SET status = 'pending'
     WHERE status = 'sending'
       AND created_at < now() - interval '2 minutes'`,
  );
}
