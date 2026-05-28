import { logger } from '../../utils/logger';
import { creditMonitorTokens } from './monitorTokenService';
import { resolveMonitorTokenPackage, resolveMonitorTokenPackageByPriceId } from './monitorTokenCatalog';

export interface MonitorTokenCheckoutMetadata {
  userId?: string;
  user_id?: string;
  purchase_type?: string;
  package_id?: string;
  token_amount?: string;
  price_id?: string;
}

/**
 * Credits monitor tokens from a completed payment-mode Checkout session (idempotent per session id).
 */
export async function creditMonitorTokensFromCheckoutSession(
  sessionId: string,
  metadata: MonitorTokenCheckoutMetadata,
  eventId?: string
): Promise<boolean> {
  const purchaseType = metadata.purchase_type;
  if (purchaseType && purchaseType !== 'monitor_tokens') {
    return false;
  }

  const userId = metadata.userId ?? metadata.user_id;
  if (!userId) {
    logger.warn('monitor_token_checkout_missing_user', { eventId, sessionId });
    return false;
  }

  let tokenCount: number | null = null;
  if (metadata.token_amount) {
    tokenCount = parseInt(metadata.token_amount, 10) || null;
  }
  let packageId = metadata.package_id ?? null;
  if (metadata.price_id) {
    const pkg = resolveMonitorTokenPackageByPriceId(metadata.price_id);
    if (pkg) {
      tokenCount = pkg.tokenCount;
      packageId = pkg.id;
    }
  }
  if (!tokenCount && packageId) {
    const pkg = resolveMonitorTokenPackage(packageId);
    tokenCount = pkg?.tokenCount ?? null;
  }

  if (!tokenCount || tokenCount < 1) {
    logger.warn('monitor_token_checkout_unknown_amount', { eventId, sessionId, packageId });
    return false;
  }

  await creditMonitorTokens({
    userId,
    tokenCount,
    idempotencyKey: `stripe_monitor_tokens_${sessionId}`,
    reason: `purchase:${packageId ?? 'unknown'}`,
    stripeCheckoutSessionId: sessionId,
  });
  return true;
}
