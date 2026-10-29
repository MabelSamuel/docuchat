import { StreamableHTTPServerTransport }
  from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { randomUUID } from 'crypto';
import express from 'express';
import { createMcpServer } from './server';
import { authenticate } from '../middleware/authenticate';
import { chatLimiter } from '../middleware/rateLimiter';
import { sanitizeInput } from '../middleware/sanitize';
import { logger } from '../lib/logger';

export function mountMCPTransport(app: express.Application) {
  // Mounted before the global middleware, so this route brings its own:
  // MCP tool calls are as expensive as direct API calls and get the same limits
  app.post('/mcp',
    express.json(),
    sanitizeInput,
    authenticate,
    chatLimiter,
    async (req, res) => {
      // Mounted before requestLogger, so resolve the correlation ID here
      const correlationId = (req.headers['x-correlation-id'] as string)
        || randomUUID();
      res.setHeader('X-Correlation-Id', correlationId);

      const userId = req.user!.id;

      // The SDK forwards req.auth to every handler as extra.authInfo
      const auth: AuthInfo = {
        token: req.headers.authorization!.slice(7),
        clientId: userId,
        scopes: [],
        extra: { userId, correlationId },
      };

      try {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({});

        res.on('close', () => {
          transport.close();
          server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(Object.assign(req, { auth }), res, req.body);
      } catch (error) {
        logger.error('MCP request failed', {
          correlationId,
          userId,
          error: (error as Error).message,
        });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

  // Handle GET for SSE streams (backwards compatibility)
  app.get('/mcp', async (req, res) => {
    res.writeHead(405).end('Method not allowed. Use POST.');
  });
}
