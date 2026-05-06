import { Router } from 'express';
import { Webhook } from 'svix';
import { query } from '../../db/pool';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const router = Router();

/** Svix must verify the exact raw JSON bytes Clerk signed (`express.raw` gives a Buffer). */
function clerkWebhookPayloadString(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

function clerkStringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

router.post('/', async (req, res, next) => {
  try {
    const webhookSecret = config.clerk.webhookSecret;
    if (!webhookSecret) {
      res.status(503).json({ error: 'Clerk webhook secret not configured' });
      return;
    }

    const svixId = req.header('svix-id');
    const svixTimestamp = req.header('svix-timestamp');
    const svixSignature = req.header('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      res.status(400).json({ error: 'Missing Svix signature headers' });
      return;
    }

    const payload = clerkWebhookPayloadString(req.body);

    let event: { type: string; data: Record<string, unknown> };
    try {
      const wh = new Webhook(webhookSecret);
      event = wh.verify(payload, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as { type: string; data: Record<string, unknown> };
    } catch (err) {
      logger.warn('Rejected Clerk webhook signature', err);
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    if (event.type === 'user.created') {
      const userId = String(event.data.id || '');
      const email = Array.isArray(event.data.email_addresses)
        ? String((event.data.email_addresses[0] as { email_address?: string } | undefined)?.email_address || '')
        : '';

      if (userId) {
        await query(
          `INSERT INTO users (id, email, first_name, last_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE
           SET email = EXCLUDED.email,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               updated_at = NOW()`,
          [
            userId,
            email || null,
            clerkStringField(event.data.first_name),
            clerkStringField(event.data.last_name),
          ]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
