import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function attachFingerprint(
  req: Request, res: Response, next: NextFunction
) {
  const signals = [
    req.ip,
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept-encoding'] || '',
  ];

  const fingerprint = crypto
    .createHash('sha256')
    .update(signals.join('|'))
    .digest('hex')
    .substring(0, 16);

  (req as any).fingerprint = fingerprint;
  next();
}
