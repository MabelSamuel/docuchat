import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function verifyWebhookSignature(secret: string, headerName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const signature = req.headers[headerName.toLowerCase()] as string;

    if (!signature) {
      return res.status(401).json({
        error: 'Missing signature header',
      });
    }

    // The body must be the RAW bytes, not parsed JSON
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      return res.status(500).json({
        error: 'Raw body not captured. Configure express.raw().',
      });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Use timingSafeEqual to prevent timing attacks
    const provided = Buffer.from(signature, 'hex');
    const expected = Buffer.from(expectedSignature, 'hex');

    if (provided.length !== expected.length ||
        !crypto.timingSafeEqual(provided, expected)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  };
}
