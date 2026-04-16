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
import sourcesRoutes from './routes/sources';
import healthRoutes from './routes/health';
import adminRoutes from './routes/admin';

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.corsOrigins, credentials: true }));
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

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/ingestion', ingestionRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/corpus', corpusRoutes);
app.use('/api/atlas', atlasRoutes);
app.use('/api/sources', sourcesRoutes);
app.use('/api/admin', adminRoutes);

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
