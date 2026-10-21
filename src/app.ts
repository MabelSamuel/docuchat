import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./lib/config";
import { logger } from "./lib/logger";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger";

import { bullBoardAdapter } from "./config/bull-board";
import { verifyWebhookSignature } from "./middleware/verifyWebhook";
import { errorHandler } from "./middleware/error-handler";
import { apiLimiter, authLimiter } from "./middleware/rateLimiter";

import { authRoutes } from "./routes/auth.routes";
import { documentRoutes } from "./routes/document.routes";
import { chatRoutes } from "./routes/chat.routes";
import adminRoutes from "./routes/admin.routes";

import "./events/auth.events";
import "./events/admin.events";
import "./events/document.events";
import "./events/cache.events";
import "./events/security.events";
import { sanitizeInput } from "./middleware/sanitize";
import { requestLogger } from "./middleware/requestLogger";
import { metricsMiddleware } from "./middleware/metricsMiddleware";
import { metricsRegistry } from "./lib/metrics";
import healthRoutes from "./routes/health";

const app = express();

const secret = process.env.WEBHOOK_SECRET;

// === MIDDLEWARE (runs on every request) ===
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'none'"],
        connectSrc: ["'self'"],
        // Allow Swagger UI if you serve it
        // scriptSrc: ["'self'", "'unsafe-inline'"],
        // styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }),
); // Security headers

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3001',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,  // Allow cookies/auth headers
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // Cache preflight requests for 24 hours
})); // Cross-origin requests
// Capture raw body for webhook routes BEFORE express.json()
app.use(
  "/webhooks",
  verifyWebhookSignature(secret as string, "x-signature"),
  express.raw({
    type: "application/json",
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.json()); // Parse JSON request bodies
app.use(sanitizeInput);
app.use(requestLogger);

app.use(metricsMiddleware);

// Serve Swagger UI
app.use(
  "/api-docs",
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    },
  }),
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec),
);

// Metrics endpoint (no auth — Prometheus needs to scrape it)
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});


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
app.get("/api-docs.json", (req, res) => {
  res.json(swaggerSpec);
});

// === HEALTH CHECK ===
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
  });
});

app.use(healthRoutes);

// All authenticated API routes: general limiter
app.use("/api/v1", apiLimiter);

// === ROUTES (mounted here as you build them) ===
app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/documents", documentRoutes);
app.use("/api/v1/chat", chatRoutes);

app.use("/api/v1/admin", adminRoutes);
app.use("/admin/queues", bullBoardAdapter.getRouter());

// === ERROR HANDLER (must be last middleware) ===

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: `Route ${req.path} not found` },
  });
});

app.use(errorHandler);

export { app };
