import { query, queryOne } from '../../db/pool';
import { logger } from '../../utils/logger';

export type BillingEventKind =
  | 'subscription_started'
  | 'subscription_renewed'
  | 'subscription_updated'
  | 'subscription_canceled'
  | 'invoice_paid'
  | 'invoice_payment_failed'
  | 'addon_started'
  | 'addon_canceled';

export interface BillingEventInsert {
  userId: string;
  stripeEventId?: string | null;
  stripeInvoiceId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCheckoutSessionId?: string | null;
  eventKind: BillingEventKind;
  tier?: string | null;
  addonKind?: 'living_report' | 'reverse_citation_watch' | null;
  amountCents?: number | null;
  currency?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
}

export interface BillingHistoryRow {
  kind: 'subscription' | 'wallet';
  id: string;
  occurred_at: string;
  description: string;
  amount_cents: number | null;
  currency: string | null;
  status: 'paid' | 'failed' | 'credit' | 'debit' | 'info';
  metadata: Record<string, unknown>;
}

/** Idempotent via stripe_event_id UNIQUE — replays are no-ops. */
export async function recordBillingEvent(input: BillingEventInsert): Promise<void> {
  try {
    await query(
      `INSERT INTO billing_events (
         user_id, stripe_event_id, stripe_invoice_id, stripe_subscription_id,
         stripe_checkout_session_id, event_kind, tier, addon_kind,
         amount_cents, currency, description, metadata, occurred_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [
        input.userId,
        input.stripeEventId ?? null,
        input.stripeInvoiceId ?? null,
        input.stripeSubscriptionId ?? null,
        input.stripeCheckoutSessionId ?? null,
        input.eventKind,
        input.tier ?? null,
        input.addonKind ?? null,
        input.amountCents ?? null,
        input.currency ?? null,
        input.description,
        JSON.stringify(input.metadata ?? {}),
        input.occurredAt.toISOString(),
      ]
    );
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01' || pgCode === '42703') {
      logger.warn('recordBillingEvent skipped — billing_events not ready', {
        userId: input.userId,
        eventKind: input.eventKind,
      });
      return;
    }
    throw err;
  }
}

function mapSubscriptionEventStatus(eventKind: BillingEventKind): BillingHistoryRow['status'] {
  if (eventKind === 'invoice_paid') return 'paid';
  if (eventKind === 'invoice_payment_failed') return 'failed';
  return 'info';
}

export async function getBillingHistory(
  userId: string,
  limit: number,
  offset: number
): Promise<{ items: BillingHistoryRow[]; total: number }> {
  try {
    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM (
         SELECT id FROM billing_events WHERE user_id = $1
         UNION ALL
         SELECT id FROM wallet_ledger WHERE user_id = $1
       ) merged`,
      [userId]
    );
    const total = parseInt(countRow?.total ?? '0', 10);

    const rows = await query<{
      kind: string;
      id: string;
      occurred_at: string;
      description: string;
      amount_cents: number | null;
      currency: string | null;
      event_kind: string | null;
      entry_type: string | null;
    }>(
      `SELECT * FROM (
         SELECT
           'subscription'::text AS kind,
           ('be_' || be.id::text) AS id,
           be.occurred_at,
           be.description,
           be.amount_cents,
           be.currency,
           be.event_kind,
           NULL::text AS entry_type
         FROM billing_events be
         WHERE be.user_id = $1
         UNION ALL
         SELECT
           'wallet'::text AS kind,
           ('wl_' || wl.id::text) AS id,
           wl.created_at AS occurred_at,
           wl.description,
           wl.amount_cents,
           'usd'::text AS currency,
           NULL::text AS event_kind,
           wl.entry_type::text AS entry_type
         FROM wallet_ledger wl
         WHERE wl.user_id = $1
       ) history
       ORDER BY occurred_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const items: BillingHistoryRow[] = rows.map((row) => {
      if (row.kind === 'wallet') {
        const status: BillingHistoryRow['status'] =
          row.entry_type === 'credit' ? 'credit' : 'debit';
        return {
          kind: 'wallet',
          id: row.id,
          occurred_at: row.occurred_at,
          description: row.description,
          amount_cents: row.amount_cents,
          currency: row.currency,
          status,
          metadata: {},
        };
      }
      return {
        kind: 'subscription',
        id: row.id,
        occurred_at: row.occurred_at,
        description: row.description,
        amount_cents: row.amount_cents,
        currency: row.currency,
        status: mapSubscriptionEventStatus(row.event_kind as BillingEventKind),
        metadata: {},
      };
    });

    return { items, total };
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01' || pgCode === '42703') {
      return { items: [], total: 0 };
    }
    throw err;
  }
}
