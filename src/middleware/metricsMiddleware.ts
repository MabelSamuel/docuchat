import { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDuration } from '../lib/metrics';

export function metricsMiddleware(
  req: Request, res: Response, next: NextFunction
) {
  const end = httpRequestDuration.startTimer({
    method: req.method,
    path: normalizePath(req.route?.path || req.path),
  });

  res.on('finish', () => {
    httpRequestsTotal.inc({
      method: req.method,
      path: normalizePath(req.route?.path || req.path),
      status_code: res.statusCode.toString(),
    });
    end();
  });

  next();
}

// Normalize paths so /documents/abc-123 becomes /documents/:id
// Without this, each unique document ID creates a separate metric series
function normalizePath(path: string): string {
  return path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      ':id'
    )
    .replace(/\/\d+/g, '/:num');
}
