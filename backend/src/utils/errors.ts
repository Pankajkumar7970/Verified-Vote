export class BaseError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AuthError extends BaseError {
  code: string;
  constructor(code: string, message = 'Authentication failed') {
    super(message, 401);
    this.code = code;
    this.name = 'AuthError';
  }
}

export class ValidationError extends BaseError {
  code: string;
  constructor(code = 'validation_failed', message = 'Validation failed') {
    super(message, 400);
    this.code = code;
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends BaseError {
  code: string;
  constructor(code = 'not_found', message = 'Resource not found') {
    super(message, 404);
    this.code = code;
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends BaseError {
  code: string;
  constructor(code = 'forbidden', message = 'Access forbidden') {
    super(message, 403);
    this.code = code;
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends BaseError {
  code: string;
  constructor(code = 'conflict', message = 'Resource conflict') {
    super(message, 409);
    this.code = code;
    this.name = 'ConflictError';
  }
}

export class ServiceUnavailableError extends BaseError {
  code: string;
  constructor(code = 'service_unavailable', message = 'Service temporarily unavailable') {
    super(message, 503);
    this.code = code;
    this.name = 'ServiceUnavailableError';
  }
}
