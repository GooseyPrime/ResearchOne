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
import clerkWebhookRoutes from './webhooks/clerk';
import { clerkAuthMiddleware } from '../middleware/clerkAuth';
import { rlsContextMiddleware } from '../middleware/rlsContext';

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
app.use('/api/webhooks/clerk', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);
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
];

// Primary API prefix
app.use('/api/webhooks/clerk', clerkWebhookRoutes);

for (const [path, router] of routes) {
  app.use(`/api${path}`, router);
}

// Compatibility prefix for reverse proxies that strip /api
app.use('/webhooks/clerk', clerkWebhookRoutes);

for (const [path, router] of routes) {
  app.use(path, router);
}

// Serve exported Atlas files from canonical exports directory
app.use('/exports', express.static(config.exports.dir));

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

export default app;
