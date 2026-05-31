import crypto from 'crypto';

/** Opaque receipt shown to voter; only hash stored in votes.receipt_token. */
export function generateReceiptToken(): { display: string; storedHash: string } {
  const display = crypto.randomBytes(16).toString('hex');
  const storedHash = crypto.createHash('sha256').update(display).digest('hex');
  return { display, storedHash };
}
