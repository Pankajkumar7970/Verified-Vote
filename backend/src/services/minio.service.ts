import crypto from 'crypto';
import { Readable } from 'stream';
import * as Minio from 'minio';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

let client: Minio.Client | null = null;
let bucketVerified = false; // cached so ensureBucket only runs once per process

function getClient(): Minio.Client | null {
  if (!process.env.MINIO_ENDPOINT) return null;
  if (!client) {
    client = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || '',
      secretKey: process.env.MINIO_SECRET_KEY || '',
    });
  }
  return client;
}

const bucket = process.env.MINIO_BUCKET_NAME || 'verifiedvote-docs';

/** In-memory store when MinIO is not configured (local dev). */
const mockObjectStore = new Map<string, Buffer>();

async function ensureBucket(minio: Minio.Client) {
  if (bucketVerified) return;
  const exists = await minio.bucketExists(bucket);
  if (!exists) {
    await minio.makeBucket(bucket, '');
  }
  bucketVerified = true;
}

export class MinIOService {
  static async uploadDocument(fileBuffer: Buffer, mimeType: string): Promise<{ key: string; hash: string }> {
    const key = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const minio = getClient();

    if (!minio) {
      mockObjectStore.set(key, fileBuffer);
      logger.info({ action: 'minio_mock_upload', key, mimeType });
      return { key, hash };
    }

    await ensureBucket(minio);
    const stream = Readable.from(fileBuffer);
    await minio.putObject(bucket, key, stream, fileBuffer.length, { 'Content-Type': mimeType });
    return { key, hash };
  }

  static async putDocument(key: string, fileBuffer: Buffer, mimeType: string): Promise<void> {
    const minio = getClient();

    if (!minio) {
      mockObjectStore.set(key, fileBuffer);
      logger.info({ action: 'minio_mock_put', key, mimeType });
      return;
    }

    await ensureBucket(minio);
    const stream = Readable.from(fileBuffer);
    await minio.putObject(bucket, key, stream, fileBuffer.length, { 'Content-Type': mimeType });
  }

  static async getSignedUrl(key: string, expirySeconds = 900): Promise<string> {
    const minio = getClient();
    if (!minio) {
      const expiresAt = Date.now() + expirySeconds * 1000;
      const hmac = crypto.createHmac('sha256', config.adminJwtSecret);
      hmac.update(`${key}:${expiresAt}`);
      const sig = hmac.digest('hex');
      return `${config.appUrl}/api/admin/docs/doc-preview?key=${encodeURIComponent(key)}&expires=${expiresAt}&sig=${sig}`;
    }
    await ensureBucket(minio);
    return minio.presignedGetObject(bucket, key, expirySeconds);
  }

  static async getDocumentBuffer(key: string): Promise<Buffer> {
    const minio = getClient();
    if (!minio) {
      const buf = mockObjectStore.get(key);
      if (!buf) throw new Error('document_not_found');
      return buf;
    }
    await ensureBucket(minio);
    const stream = await minio.getObject(bucket, key);
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk as Buffer));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  static async getDocumentStream(key: string): Promise<{ stream: Readable; mimeType: string }> {
    const minio = getClient();
    if (!minio) {
      const buf = mockObjectStore.get(key);
      if (!buf) throw new Error('document_not_found');
      
      // Basic sniffing for mock mode
      let mimeType = 'application/octet-stream';
      if (buf[0] === 0xff && buf[1] === 0xd8) mimeType = 'image/jpeg';
      else if (buf[0] === 0x89 && buf[1] === 0x50) mimeType = 'image/png';
      else if (buf[0] === 0x25 && buf[1] === 0x50) mimeType = 'application/pdf';
      
      return { stream: Readable.from(buf), mimeType };
    }
    await ensureBucket(minio);
    const stat = await minio.statObject(bucket, key);
    const stream = await minio.getObject(bucket, key);
    return { stream, mimeType: stat.metaData['content-type'] || 'application/octet-stream' };
  }

  static async deleteDocument(key: string): Promise<void> {
    const minio = getClient();
    if (!minio) {
      mockObjectStore.delete(key);
      logger.info({ action: 'minio_mock_delete', key });
      return;
    }
    try {
      await minio.removeObject(bucket, key);
    } catch (err: unknown) {
      logger.warn({
        action: 'minio_delete_failed',
        key,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  static async checkHealth(): Promise<{ healthy: boolean; details?: string }> {
    const minio = getClient();
    if (!minio) {
      return { healthy: true, details: 'mock_mode' };
    }
    try {
      await ensureBucket(minio);
      await minio.bucketExists(bucket);
      return { healthy: true };
    } catch (err: unknown) {
      return { healthy: false, details: err instanceof Error ? err.message : 'unknown' };
    }
  }
}
