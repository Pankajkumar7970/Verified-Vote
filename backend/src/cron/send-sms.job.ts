import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';
import {
  dispatchNotification,
  releaseStuckSendingNotifications,
} from '../services/sms/dispatch-notification.js';

const SMS_CRON_INTERVAL_MS = 15 * 1000;

export async function processPendingSms(): Promise<void> {
  await releaseStuckSendingNotifications();

  const pending = await db.query(
    `SELECT id
     FROM notifications
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 50`,
  );

  for (const notif of pending.rows) {
    await dispatchNotification(notif.id);
  }
}

function runSendSmsJob(): void {
  void runWithLock('send_sms', processPendingSms).catch((err: unknown) => {
    logger.error({
      action: 'send_sms_job_failed',
      error: err instanceof Error ? err.message : 'unknown',
    });
  });
}

export function startSendSmsJob() {
  runSendSmsJob();
  setInterval(runSendSmsJob, SMS_CRON_INTERVAL_MS);
}
