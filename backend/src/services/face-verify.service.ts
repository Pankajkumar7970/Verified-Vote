export class FaceVerifyService {
  static async verifyFace(referenceEmbeddingEnc: string | null, imageB64: string): Promise<{ match: boolean, face_score: number, liveness_score: number, model: string, duration_ms: number }> {
    // In dev: mock the FastAPI Python service
    // In production this would use axios to POST to the Python FastAPI container
    console.log('[FastAPI Mock] Processing face verification request...');
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 800));

    return {
      match: true,
      face_score: 0.95,
      liveness_score: 0.88,
      model: "VGG-Face Mock",
      duration_ms: 812
    };
  }

  static async getEmbedding(imageB64: string): Promise<number[]> {
    // In dev: mock returning a 128-d vector
    console.log('[FastAPI Mock] Extracting generic embedding...');
    await new Promise(resolve => setTimeout(resolve, 400));
    return Array.from({ length: 128 }, () => Math.random() * 2 - 1);
  }
}
