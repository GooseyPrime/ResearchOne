import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config';
import { logger } from '../utils/logger';

import ingestionRoutes from './routes/ingestion';
import researchRoutes from './routes/research';
import reportsRoutes from './routes/reports';
import corpusRoutes from './routes/corpus';
import atlasRoutes from './routes/atlas';
import graphRoutes from './routes/graph';
import sourcesRoutes from './routes/sources';
import healthRoutes from './routes/health';
import adminRoutes from './routes/admin';
import authRoutes from './routes/auth';
import billingRoutes from './routes/billing';
import byokRoutes from './routes/byok';
import clerkWebhookRoutes from './webhooks/clerk';
import stripeWebhookRoutes from './webhooks/stripe';
import { clerkAuthMiddleware } from '../middleware/clerkAuth';
import { rlsContextMiddleware } from '../middleware/rlsContext';
import { requestLoggerMiddleware } from '../middleware/requestLogger';
import { centralErrorHandler } from '../middleware/errorHandler';

const app = express();

// JSON API only — do not send Content-Security-Policy (Helmet default breaks
// browser tooling that inspects responses; CSP belongs on the HTML document from Vercel).
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
// Webhook routes need raw body for signature verification - MUST be before JSON parser
const webhookRawParser = express.raw({ type: 'application/json' });
app.use('/api/webhooks/clerk', webhookRawParser);
app.use('/webhooks/clerk', webhookRawParser);
app.use('/api/webhooks/stripe', webhookRawParser);
app.use('/webhooks/stripe', webhookRawParser);
// Global JSON parser for all other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication requests. Please try again later.' },
});

app.use('/api/auth', authLimiter);
app.use('/api/webhooks', authLimiter);
app.use('/api', defaultLimiter);
app.use(clerkAuthMiddleware);
app.use(rlsContextMiddleware);

const routes: Array<[string, express.Router]> = [
  ['/health', healthRoutes],
  ['/ingestion', ingestionRoutes],
  ['/research', researchRoutes],
  ['/reports', reportsRoutes],
  ['/corpus', corpusRoutes],
  ['/atlas', atlasRoutes],
  ['/graph', graphRoutes],
  ['/sources', sourcesRoutes],
  ['/admin', adminRoutes],
  ['/auth', authRoutes],
  ['/billing', billingRoutes],
  ['/byok', byokRoutes],
];

// Webhooks - primary API prefix (compat mount below shares the same router instance)
app.use('/api/webhooks/clerk', clerkWebhookRoutes);
app.use('/api/webhooks/stripe', stripeWebhookRoutes);

for (const [path, router] of routes) {
  app.use(`/api${path}`, router);
}

// Compatibility prefix for reverse proxies that strip /api (raw body parser registered above)
app.use('/webhooks/clerk', clerkWebhookRoutes);
app.use('/webhooks/stripe', stripeWebhookRoutes);

for (const [path, router] of routes) {
  app.use(path, router);
}

// Serve exported Atlas files from canonical exports directory
app.use('/exports', express.static(config.exports.dir));

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler with PII redaction
app.use(centralErrorHandler);

export default app;
