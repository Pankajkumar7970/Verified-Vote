import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({
          action: 'validation_failed',
          request_id: (req as any).requestId,
          errors: error.issues
        });
        const msg = error.issues[0]?.message || 'invalid_input';
        return next(new ValidationError(msg));
      }
      next(error);
    }
  };
};
