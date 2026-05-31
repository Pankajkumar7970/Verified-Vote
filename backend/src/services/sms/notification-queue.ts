import { db } from '../../db/index.js';
import { encryptValue } from '../../utils/crypto.js';

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: { id: string }[] }>;
};

export async function queueNotification(
  voterId: string,
  type: string,
  metadata?: Record<string, unknown>,
  conn: Queryable = db
): Promise<string> {
  let dbMetadata: string | null = null;
  if (metadata) {
    const encryptedBuf = await encryptValue(JSON.stringify(metadata));
    const base64Ciphertext = encryptedBuf.toString('base64');
    dbMetadata = JSON.stringify({ enc: base64Ciphertext });
  }

  const res = await conn.query(
    `INSERT INTO notifications (voter_id, type, channel, status, metadata)
     VALUES ($1, $2, 'sms', 'pending', $3)
     RETURNING id`,
    [voterId, type, dbMetadata]
  );
  return res.rows[0].id;
}
