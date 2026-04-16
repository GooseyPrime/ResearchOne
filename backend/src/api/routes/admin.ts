import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { query } from '../../db/pool';

const router = Router();
const execAsync = promisify(exec);

function getProvidedToken(header?: string): string {
  if (!header) return '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return header.trim();
}

router.post('/runtime/restart', async (req, res) => {
  const token = getProvidedToken(req.header('authorization') || req.header('x-admin-token'));
  const ok = Boolean(config.admin.token) && token === config.admin.token;

  await query(
    `INSERT INTO error_log (service, error_code, message, context)
     VALUES ($1, $2, $3, $4)`,
    [
      'admin-runtime',
      ok ? 'restart_requested' : 'restart_denied',
      ok ? 'Runtime restart requested by authenticated admin token' : 'Unauthorized runtime restart attempt',
      JSON.stringify({ ip: req.ip, at: new Date().toISOString() }),
    ]
  );

  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const command = config.admin.restartCommand;
  logger.warn(`Admin runtime restart initiated: ${command}`);

  try {
    await execAsync(command, { timeout: 30000 });
    res.json({ ok: true, status: 'restart_triggered' });
  } catch (err) {
    logger.error('Restart command failed', err);
    res.status(500).json({ ok: false, error: 'Restart command failed' });
  }
});

export default router;
