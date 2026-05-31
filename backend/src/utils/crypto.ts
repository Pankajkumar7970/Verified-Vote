import { db } from '../db/index.js';
import { config } from './config.js';

export async function encryptValue(plaintext: string): Promise<Buffer> {
  const result = await db.query(`SELECT pgp_sym_encrypt($1, $2) AS encrypted`, [
    plaintext,
    config.pgcryptoKey,
  ]);
  return result.rows[0].encrypted;
}

export async function decryptValue(encrypted: Buffer): Promise<string> {
  const result = await db.query(`SELECT pgp_sym_decrypt($1, $2) AS decrypted`, [
    encrypted,
    config.pgcryptoKey,
  ]);
  return result.rows[0].decrypted;
}

/** Encrypt MinIO object key for storage in voting_requests.doc_minio_key (text column). */
export async function encryptDocKey(key: string): Promise<string> {
  const enc = await encryptValue(key);
  return enc.toString('base64');
}

export async function decryptDocKey(stored: string): Promise<string> {
  return decryptValue(Buffer.from(stored, 'base64'));
}
