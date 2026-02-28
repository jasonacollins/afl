/**
 * Application error handling utilities
 */

class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true; // Indicates if this is an operational error we can handle
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Common error factory methods
const createNotFoundError = (entity = 'Resource') => {
  return new AppError(`${entity} not found`, 404, 'NOT_FOUND');
};

const createValidationError = (message = 'Validation failed') => {
  return new AppError(message, 400, 'VALIDATION_ERROR');
};

const createUnauthorizedError = (message = 'Unauthorized') => {
  return new AppError(message, 401, 'UNAUTHORIZED');
};

const createForbiddenError = (message = 'Forbidden') => {
  return new AppError(message, 403, 'FORBIDDEN');
};

// Global error handler middleware for Express
const errorMiddleware = (err, req, res, next) => {
  // Normalize status and code fields from Express and custom errors.
  const normalizedStatusCode = err.statusCode || err.status || 500;
  const normalizedErrorCode = err.errorCode || (
    normalizedStatusCode === 400 ? 'VALIDATION_ERROR' :
    normalizedStatusCode === 401 ? 'UNAUTHORIZED' :
    normalizedStatusCode === 403 ? 'FORBIDDEN' :
    normalizedStatusCode === 404 ? 'NOT_FOUND' :
    'INTERNAL_ERROR'
  );

  err.statusCode = normalizedStatusCode;
  err.errorCode = normalizedErrorCode;

  // Treat explicit 4xx errors as operational, even if they are plain Error objects.
  if (!err.isOperational && err.statusCode >= 400 && err.statusCode < 500) {
    err.isOperational = true;
  }
  
  // Development error response (includes stack trace)
  if (process.env.NODE_ENV === 'development') {
    return res.status(err.statusCode).json({
      status: 'error',
      errorCode: err.errorCode,
      message: err.message,
      stack: err.stack,
      error: err
    });
  }
  
  // Production error response (cleaned up)
  // Only show detailed messages for operational errors we expect
  if (err.isOperational) {
    // For web requests that accept HTML, render an error page
    if (req.accepts('html')) {
      return res.status(err.statusCode).render('error', {
        error: process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : err.message
      });
    }

    // For API requests, return JSON
    return res.status(err.statusCode).json({
      status: 'error',
      errorCode: err.errorCode,
      message: err.message
    });
  }
  
  // For unexpected errors, send generic message
  return res.status(500).json({
    status: 'error',
    errorCode: 'INTERNAL_ERROR',
    message: 'Something went wrong'
  });
};

// Async error handler to avoid try/catch blocks
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

module.exports = {
  AppError,
  createNotFoundError,
  createValidationError,
  createUnauthorizedError,
  createForbiddenError,
  errorMiddleware,
  catchAsync
};
