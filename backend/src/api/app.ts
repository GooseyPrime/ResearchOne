import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config';
import { requestLoggerMiddleware } from '../middleware/requestLogger';
import { centralErrorHandler } from '../middleware/errorHandler';

import ingestionRoutes from './routes/ingestion';
import researchRoutes from './routes/research';
import reportsRoutes from './routes/reports';
import corpusRoutes from './routes/corpus';
import atlasRoutes from './routes/atlas';
import graphRoutes from './routes/graph';
import sourcesRoutes from './routes/sources';
import healthRoutes from './routes/health';
import landingRoutes from './routes/landing';
import adminRoutes from './routes/admin';
import authRoutes from './routes/auth';
import billingRoutes from './routes/billing';
import byokRoutes from './routes/byok';
import { reportMonitorsRouter, userMonitorsRouter } from './routes/monitors';
import notificationsRoutes from './routes/notifications';
import clerkWebhookRoutes from './webhooks/clerk';
import stripeWebhookRoutes from './webhooks/stripe';
import parallelMonitorWebhookRoutes from './webhooks/parallelMonitor';
import { clerkAuthMiddleware } from '../middleware/clerkAuth';
import { rlsContextMiddleware } from '../middleware/rlsContext';

const app = express();
app.set('trust proxy', 1);

// JSON API only — do not send Content-Security-Policy (Helmet default breaks
// browser tooling that inspects responses; CSP belongs on the HTML document from Vercel).
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);
// Webhook routes need raw body for signature verification - MUST be before JSON parser
const webhookRawParser = express.raw({ type: 'application/json' });
app.use('/api/webhooks/clerk', webhookRawParser);
app.use('/webhooks/clerk', webhookRawParser);
app.use('/api/webhooks/stripe', webhookRawParser);
app.use('/webhooks/stripe', webhookRawParser);
app.use('/api/webhooks/parallel-monitor', webhookRawParser);
app.use('/webhooks/parallel-monitor', webhookRawParser);
// Global JSON parser for all other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));

const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication requests. Please try again later.' },
});
app.use(requestLoggerMiddleware);
app.use('/api/auth', authLimiter);

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/auth'),
});
const landingPersonaEventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', defaultLimiter);

// Public landing persona analytics — mount BEFORE Clerk so optional JWTs
// are never attached to anonymous telemetry and request logs stay
// userId-null (Rule 26 I-2). Extra-tight limiter; enum-validated writes.
app.use('/api/landing', landingPersonaEventLimiter, landingRoutes);

app.use(clerkAuthMiddleware);
app.use(rlsContextMiddleware);

// Mount public health endpoints explicitly before any auth-protected routes.
app.use('/api/health', healthRoutes);
app.use('/health', healthRoutes);

const routes: Array<[string, express.Router]> = [
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
  ['/notifications', notificationsRoutes],
];

// Webhooks - primary API prefix (compat mount below shares the same router instance)
app.use('/api/webhooks/clerk', clerkWebhookRoutes);
app.use('/api/webhooks/stripe', stripeWebhookRoutes);
app.use('/api/webhooks/parallel-monitor', parallelMonitorWebhookRoutes);

// Monitor routes are auth-protected and must only mount on their actual prefixes.
app.use('/api/reports', reportMonitorsRouter);
app.use('/api/monitors', userMonitorsRouter);

for (const [path, router] of routes) {
  app.use(`/api${path}`, router);
}

// Compatibility prefix for reverse proxies that strip /api (raw body parser registered above)
app.use('/webhooks/clerk', clerkWebhookRoutes);
app.use('/webhooks/stripe', stripeWebhookRoutes);
app.use('/webhooks/parallel-monitor', parallelMonitorWebhookRoutes);

app.use('/reports', reportMonitorsRouter);
app.use('/monitors', userMonitorsRouter);

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
