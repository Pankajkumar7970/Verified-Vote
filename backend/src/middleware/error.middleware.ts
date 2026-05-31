import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { BaseError, ServiceUnavailableError } from '../utils/errors.js';
import { isDbConnectionError } from '../db/index.js';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (isDbConnectionError(err)) {
    err = new ServiceUnavailableError('db_unavailable', 'Database temporarily unavailable');
  }

  // Log the error with correlation ID
  logger.error({
    request_id: req.requestId,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // If it's a known error type, use its status code
  if (err instanceof BaseError && err.isOperational) {
    return res.status(err.statusCode).json({
      error: (err as any).code || 'unknown_error',
      message: err.message,
      request_id: req.requestId
    });
  }

  // For unknown errors, return 500 and don't leak details
  res.status(500).json({
    error: 'internal_error',
    message: 'An unexpected error occurred',
    request_id: req.requestId
  });
}
