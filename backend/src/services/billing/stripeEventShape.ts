/**
 * Reads Stripe objects in both the current API shape (2026-01-28.clover, which
 * the webhook endpoint is pinned to) and the older one, and decides whether an
 * object belongs to ResearchOne at all.
 *
 * Two things changed in the newer API shape that the handlers depended on:
 *   - a subscription's billing period moved from the subscription itself to
 *     each of its items (`items.data[n].current_period_end`);
 *   - an invoice's subscription id moved from `invoice.subscription` to
 *     `invoice.parent.subscription_details.subscription`.
 *
 * The Stripe account is shared with other products, so their sales arrive at
 * this endpoint too. Those are recognised here and left alone.
 */

import { config } from '../../config';

/** Written on every Checkout session and subscription ResearchOne creates. */
export const RESEARCHONE_APP_MARKER = 'researchone';

type Metadata = Record<string, string | null | undefined> | null | undefined;

type PeriodCarrier = {
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> | null } | null;
};

function unixSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * When the current billing period ends, as unix seconds. Read from the first
 * subscription item, then from the subscription itself. Null when neither is
 * present — callers log and carry on rather than fail.
 */
export function readSubscriptionPeriodEnd(subscription: PeriodCarrier): number | null {
  return (
    unixSeconds(subscription.items?.data?.[0]?.current_period_end) ??
    unixSeconds(subscription.current_period_end)
  );
}

type SubscriptionRef = string | { id?: string | null } | null | undefined;

function refId(ref: SubscriptionRef): string | null {
  if (!ref) return null;
  if (typeof ref === 'string') return ref.trim() || null;
  return ref.id?.trim() || null;
}

export interface StripeInvoiceLike {
  id?: string;
  subscription?: SubscriptionRef;
  parent?: {
    subscription_details?: {
      subscription?: SubscriptionRef;
      metadata?: Metadata;
    } | null;
  } | null;
  /** Older shape: subscription metadata snapshot sat on the invoice itself. */
  subscription_details?: { metadata?: Metadata } | null;
  metadata?: Metadata;
  lines?: {
    data?: Array<{
      metadata?: Metadata;
      /** Older shape. */
      price?: string | { id?: string | null } | null;
      /** Newer shape. */
      pricing?: {
        price_details?: { price?: string | { id?: string | null } | null } | null;
      } | null;
    }> | null;
  } | null;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  created?: number;
}

/** The subscription an invoice bills, in either API shape. Null for one-off invoices. */
export function readInvoiceSubscriptionId(invoice: StripeInvoiceLike): string | null {
  return refId(invoice.subscription) ?? refId(invoice.parent?.subscription_details?.subscription);
}

/** Every Stripe price id this deployment is configured to sell. */
export function researchOnePriceIds(): Set<string> {
  const ids = new Set<string>();
  for (const value of Object.values(config.stripe.priceIds ?? {})) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (id) ids.add(id);
  }
  return ids;
}

function isResearchOnePrice(priceId: string | null | undefined, known: Set<string>): boolean {
  const id = priceId?.trim();
  return Boolean(id && known.has(id));
}

/**
 * True when metadata could only have been written by ResearchOne's own
 * checkout code. `user_id` and `tier` alone do not count: other products on
 * the same Stripe account use the same key names.
 */
export function hasResearchOneMetadataMarker(metadata: Metadata, known = researchOnePriceIds()): boolean {
  if (!metadata) return false;
  if (metadata.app === RESEARCHONE_APP_MARKER) return true;
  if (metadata.monitor_kind === 'living_report' || metadata.monitor_kind === 'reverse_citation_watch') {
    return true;
  }
  if (metadata.purchase_type === 'monitor_tokens' || metadata.checkout_kind === 'monitor_tokens') {
    return true;
  }
  return isResearchOnePrice(metadata.price_id, known);
}

export function subscriptionIsResearchOne(subscription: {
  metadata?: Metadata;
  items?: { data?: Array<{ price?: string | { id?: string | null } | null }> | null } | null;
}): boolean {
  const known = researchOnePriceIds();
  const items = subscription.items?.data ?? [];
  if (items.some((item) => isResearchOnePrice(typeof item.price === 'string' ? item.price : item.price?.id, known))) {
    return true;
  }
  return hasResearchOneMetadataMarker(subscription.metadata, known);
}

export function invoiceIsResearchOne(invoice: StripeInvoiceLike): boolean {
  const known = researchOnePriceIds();
  for (const line of invoice.lines?.data ?? []) {
    const newer = line.pricing?.price_details?.price;
    const older = line.price;
    if (isResearchOnePrice(typeof newer === 'string' ? newer : newer?.id, known)) return true;
    if (isResearchOnePrice(typeof older === 'string' ? older : older?.id, known)) return true;
    if (hasResearchOneMetadataMarker(line.metadata, known)) return true;
  }
  return (
    hasResearchOneMetadataMarker(invoice.parent?.subscription_details?.metadata, known) ||
    hasResearchOneMetadataMarker(invoice.subscription_details?.metadata, known) ||
    hasResearchOneMetadataMarker(invoice.metadata, known)
  );
}

export function checkoutSessionIsResearchOne(session: {
  metadata?: Metadata;
  subscription?: unknown;
}): boolean {
  if (hasResearchOneMetadataMarker(session.metadata)) return true;
  // An expanded subscription carries its own items and metadata.
  if (session.subscription && typeof session.subscription === 'object') {
    return subscriptionIsResearchOne(session.subscription as Parameters<typeof subscriptionIsResearchOne>[0]);
  }
  return false;
}

/**
 * Whether a webhook event is about something ResearchOne sold. Only
 * subscription, invoice and checkout events are judged; anything else is
 * passed through unchanged.
 */
export function stripeEventIsForeign(eventType: string, object: Record<string, unknown>): boolean {
  if (eventType.startsWith('customer.subscription.')) {
    return !subscriptionIsResearchOne(object as Parameters<typeof subscriptionIsResearchOne>[0]);
  }
  if (eventType.startsWith('invoice.')) {
    return !invoiceIsResearchOne(object as StripeInvoiceLike);
  }
  if (eventType.startsWith('checkout.session.')) {
    return !checkoutSessionIsResearchOne(object as Parameters<typeof checkoutSessionIsResearchOne>[0]);
  }
  return false;
}
