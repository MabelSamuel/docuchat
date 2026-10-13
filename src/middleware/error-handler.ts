import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Operational error: we created this intentionally
  if (err instanceof AppError) {
    console.warn(
      `[${err.code}] ${err.message}`,
      err.details ? { details: err.details } : ''
    );

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.isOperational ? 500 : err.code,
        message: !err.isOperational ? "Internal server error" : err.message,
        ...((err.details && !err.isOperational) && { details: err.details }),
      },
    });
  }

  // Programming error: this is a bug
  console.error('Unhandled error:', err);

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
