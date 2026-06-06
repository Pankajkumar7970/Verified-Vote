/**
 * Express Request augmentation for VerifiedVote middleware (requestId, admin, voter).
 */
import "express";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      admin?: { id: string; role: string };
      voter?: { id: string; constituency: string; state: string };
    }
  }
}

export {};
