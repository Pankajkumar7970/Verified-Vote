import crypto from 'crypto';

export class MinIOService {
  static async uploadDocument(fileBuffer: Buffer, mimeType: string): Promise<{ key: string, hash: string }> {
    const key = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    // In dev: mock upload
    console.log(`[MinIO Mock] Uploaded doc ${key} (${mimeType}) - Hash: ${hash}`);
    return { key, hash };
  }

  static async getSignedUrl(key: string, expirySeconds = 900): Promise<string> {
    // In dev: mock signed URL
    return `https://mock-storage.local/signed/${key}?expires=${Date.now() + expirySeconds * 1000}`;
  }

  static async deleteDocument(key: string): Promise<void> {
    // In dev: mock delete
    console.log(`[MinIO Mock] Deleted doc ${key}`);
  }
}
