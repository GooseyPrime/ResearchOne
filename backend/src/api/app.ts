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
import dossiersRoutes from './routes/dossiers';
import runsRoutes from './routes/runs';
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
import feedbackRoutes from './routes/feedback';
import clerkWebhookRoutes from './webhooks/clerk';
import stripeWebhookRoutes from './webhooks/stripe';
import parallelMonitorWebhookRoutes from './webhooks/parallelMonitor';
import bugnoteWebhookRoutes from './webhooks/bugnote';
import { clerkAuthMiddleware } from '../middleware/clerkAuth';
import { rlsContextMiddleware } from '../middleware/rlsContext';

const app = express();

// trust proxy is set to 1 for the single Nginx hop in front of Express on Emma.
// If Cloudflare is ever placed in front of Nginx, this value must be raised to
// reflect the new proxy depth — otherwise every request appears to come from
// the Nginx IP and all per-IP buckets collapse into one global bucket.
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
app.use('/api/webhooks/bugnote', webhookRawParser);
app.use('/webhooks/bugnote', webhookRawParser);
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
  message: {
    error: 'rate_limited',
    detail: 'Too many requests. Please slow down and retry shortly.',
  },
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

// Per-user rate limit — layered on top of the per-IP floor above (WO-AE-4).
// Authenticated requests are counted per Clerk user id as well as per IP, so
// neither shared egress (office NAT, VPN exit) nor throwaway accounts defeats
// the limit on its own. Unauthenticated requests fall through to the IP limit.
//
// Two different numbers, deliberately:
//   - 150 req / 15 min is the WO-AE-4 *client* budget — what one tab watching
//     one run may consume, verified in the browser network panel. Polling hooks
//     back off while the socket is healthy (`getAdaptiveRefetchIntervalMs`).
//   - 300 req / 15 min is this *server* ceiling. It sits at 2x the client
//     budget so a user with a second tab open, or one reconnecting after a
//     socket drop, is not throttled for behaving normally. Setting the ceiling
//     to the budget would make the expected case the failure case.
// (Copilot flagged the earlier comment for citing 150 next to `max: 300`, #224.)
const perUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = (req as unknown as { auth?: { userId?: string | null } }).auth?.userId;
    // Fall back to IP so the limiter never drops requests for unknown reasons
    return userId ?? req.ip ?? 'unknown';
  },
  skip: (req) => {
    const userId = (req as unknown as { auth?: { userId?: string | null } }).auth?.userId;
    return !userId; // only apply to authenticated users
  },
  message: {
    error: 'rate_limited',
    detail: 'Too many requests from this account. Please slow down and retry shortly.',
  },
});
app.use('/api', perUserLimiter);

// Mount public health endpoints explicitly before any auth-protected routes.
app.use('/api/health', healthRoutes);
app.use('/health', healthRoutes);

const routes: Array<[string, express.Router]> = [
  ['/ingestion', ingestionRoutes],
  ['/research', researchRoutes],
  ['/reports', reportsRoutes],
  ['/dossiers', dossiersRoutes],
  ['/runs', runsRoutes],
  ['/corpus', corpusRoutes],
  ['/atlas', atlasRoutes],
  ['/graph', graphRoutes],
  ['/sources', sourcesRoutes],
  ['/admin', adminRoutes],
  ['/auth', authRoutes],
  ['/billing', billingRoutes],
  ['/byok', byokRoutes],
  ['/notifications', notificationsRoutes],
  ['/feedback', feedbackRoutes],
];

// Webhooks - primary API prefix (compat mount below shares the same router instance)
app.use('/api/webhooks/clerk', clerkWebhookRoutes);
app.use('/api/webhooks/stripe', stripeWebhookRoutes);
app.use('/api/webhooks/parallel-monitor', parallelMonitorWebhookRoutes);
app.use('/api/webhooks/bugnote', bugnoteWebhookRoutes);

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
app.use('/webhooks/bugnote', bugnoteWebhookRoutes);

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
