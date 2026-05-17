import { db } from '../db/index.js';
import dotenv from 'dotenv';
dotenv.config();

const key = process.env.PGCRYPTO_KEY || 'defaultkey'; // Fallback for dev

export async function encryptValue(plaintext: string): Promise<Buffer> {
  const result = await db.query(
    `SELECT pgp_sym_encrypt($1, $2) AS encrypted`,
    [plaintext, key]
  );
  return result.rows[0].encrypted;
}

export async function decryptValue(encrypted: Buffer): Promise<string> {
  const result = await db.query(
    `SELECT pgp_sym_decrypt($1, $2) AS decrypted`,
    [encrypted, key]
  );
  return result.rows[0].decrypted;
}
