import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { storeKey, getKeyStatus, deleteKey, type BYOKProvider } from '../../services/byok/keyVault';
import { getUserTier } from '../../services/tier/tierService';

const router = Router();

router.use(requireAuth);

const VALID_PROVIDERS: BYOKProvider[] = ['openrouter', 'anthropic', 'openai', 'google'];

function isValidProvider(p: string): p is BYOKProvider {
  return (VALID_PROVIDERS as string[]).includes(p);
}

router.post('/keys', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const userTier = await getUserTier(userId);
    if (userTier.tier !== 'byok' && userTier.tier !== 'admin' && userTier.tier !== 'sovereign') {
      res.status(403).json({ error: 'BYOK key management requires the BYOK, Sovereign, or Admin tier' });
      return;
    }

    const { key, provider: rawProvider } = req.body as { key?: string; provider?: string };
    const provider = rawProvider ?? 'openrouter';

    if (!key || typeof key !== 'string' || key.trim().length < 8) {
      res.status(400).json({ error: 'A valid API key is required (minimum 8 characters)' });
      return;
    }

    if (!isValidProvider(provider)) {
      res.status(400).json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
      return;
    }

    const result = await storeKey(userId, provider, key.trim());

    if (!result.valid) {
      res.status(400).json({
        error: result.reason ?? 'Key validation failed',
        key_last_four: result.lastFour,
      });
      return;
    }

    res.json({
      stored: true,
      provider,
      key_last_four: result.lastFour,
      key_status: 'valid',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/keys/status', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const provider = (req.query.provider as string) ?? 'openrouter';
    if (!isValidProvider(provider)) {
      res.status(400).json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
      return;
    }

    const status = await getKeyStatus(userId, provider);

    res.json({
      has_key: status.hasKey,
      key_last_four: status.keyLastFour,
      key_status: status.keyStatus,
      provider: status.provider,
      key_validated_at: status.keyValidatedAt,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/keys', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const provider = (req.query.provider as string) ?? 'openrouter';
    if (!isValidProvider(provider)) {
      res.status(400).json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
      return;
    }

    const deleted = await deleteKey(userId, provider);

    res.json({ deleted, provider });
  } catch (err) {
    next(err);
  }
});

export default router;
