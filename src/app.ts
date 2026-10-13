import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './lib/config';
import { logger } from './lib/logger';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';

import { errorHandler } from './middleware/error-handler';

import { authRoutes } from './routes/auth.routes';
import { documentRoutes } from './routes/document.routes';
import { chatRoutes } from './routes/chat.routes';
import adminRoutes from './routes/admin.routes';

import './events/auth.events';
import './events/admin.events';
import './events/document.events';


const app = express();

// === MIDDLEWARE (runs on every request) ===
app.use(helmet());              // Security headers
app.use(cors());                // Cross-origin requests
app.use(express.json());        // Parse JSON request bodies

// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));



// === REQUEST LOGGING ===
app.use((req, res, next) => {
  logger.info({
    method: req.method,
    url: req.url,
    ip: req.ip,
  });
  next();
});

// Also serve the raw JSON spec (useful for code generators)
app.get('/api-docs.json', (req, res) => {
  res.json(swaggerSpec);
});

// === HEALTH CHECK ===
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
  });
});

// === ROUTES (mounted here as you build them) ===
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/chat', chatRoutes);

app.use('/api/v1/admin', adminRoutes);


// === ERROR HANDLER (must be last middleware) ===

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.path} not found` },
  });
});

app.use(errorHandler);

export { app };

