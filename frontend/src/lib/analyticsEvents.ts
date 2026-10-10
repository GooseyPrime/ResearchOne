/**
 * The three things counted on the way from a new account to a payment
 * (RJ-023), under the names Google Analytics recommends:
 *
 *   sign_up         a new account reaches onboarding
 *   begin_checkout  the customer is sent to Stripe to pay
 *   purchase        Stripe sends the customer back and the server confirms it
 *
 * What is sent: the name of the plan or pack, its price and currency, and for
 * a purchase the Stripe checkout session id. Never a name, an e-mail address,
 * an account id, a request or anything from a report.
 *
 * The tag is switched off on private pages (`analyticsScope.ts`), and an
 * event given to it there is dropped. A checkout can start on such a page
 * (an add-on bought from a report). That event is kept in this tab's session
 * storage and sent on the next page the tag may count, which is where Stripe
 * returns the customer: the billing page.
 */
import { isAnalyticsTrackedPath } from './analyticsScope';

/** One thing that can be bought. `valueCents` is left out when the price is not known on the page. */
export type CheckoutItem = { itemId: string; itemName: string; valueCents?: number };

type EventName = 'sign_up' | 'begin_checkout' | 'purchase';
type EventParams = Record<string, unknown>;
type QueuedEvent = { name: EventName; params: EventParams };

const QUEUE_KEY = 'r1_ga_queue';
const QUEUE_LIMIT = 10;
const SENT_KEY = 'r1_ga_sent';
const SENT_LIMIT = 50;
const CURRENCY = 'USD';
/** An account older than this arriving at onboarding is a return visit, not a sign-up. */
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Remembered in memory as well, for a browser that refuses storage. */
const sentThisPageLoad = new Set<string>();

function readList<T>(storage: Storage | undefined, key: string): T[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList(storage: Storage | undefined, key: string, list: unknown[]): void {
  try {
    storage?.setItem(key, JSON.stringify(list));
  } catch {
    // Storage refused (private window, full): the event is simply not kept.
  }
}

function storageOf(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window[kind];
  } catch {
    return undefined;
  }
}

/** True the first time a key is seen in this browser, false ever after. */
function firstTime(key: string): boolean {
  if (sentThisPageLoad.has(key)) return false;
  const storage = storageOf('localStorage');
  const sent = readList<string>(storage, SENT_KEY);
  if (sent.includes(key)) return false;
  sentThisPageLoad.add(key);
  writeList(storage, SENT_KEY, [...sent, key].slice(-SENT_LIMIT));
  return true;
}

function give(event: QueuedEvent): boolean {
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return false;
  gtag('event', event.name, event.params);
  return true;
}

function send(name: EventName, params: EventParams): void {
  if (typeof window === 'undefined') return;
  const event = { name, params };
  if (isAnalyticsTrackedPath(window.location.pathname) && give(event)) return;
  const storage = storageOf('sessionStorage');
  writeList(storage, QUEUE_KEY, [...readList<QueuedEvent>(storage, QUEUE_KEY), event].slice(-QUEUE_LIMIT));
}

/** Send what was held back on a private page. Called on every change of address. */
export function flushQueuedAnalyticsEvents(pathname: string): void {
  if (typeof window === 'undefined' || !isAnalyticsTrackedPath(pathname)) return;
  const storage = storageOf('sessionStorage');
  const queued = readList<QueuedEvent>(storage, QUEUE_KEY);
  if (queued.length === 0) return;
  const kept = queued.filter((event) => !give(event));
  writeList(storage, QUEUE_KEY, kept);
}

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function itemParams(item: CheckoutItem, currency: string): EventParams {
  const priced = typeof item.valueCents === 'number' && Number.isFinite(item.valueCents);
  return {
    ...(priced ? { value: dollars(item.valueCents as number), currency } : {}),
    items: [
      {
        item_id: item.itemId,
        item_name: item.itemName,
        quantity: 1,
        ...(priced ? { price: dollars(item.valueCents as number) } : {}),
      },
    ],
  };
}

export function trackBeginCheckout(item: CheckoutItem): void {
  send('begin_checkout', itemParams(item, CURRENCY));
}

/** Once per Stripe checkout session id, however often the return page is opened. */
export function trackPurchase(args: {
  transactionId: string;
  itemId: string;
  valueCents: number;
  currency: string;
}): void {
  if (!args.transactionId || !firstTime(`purchase:${args.transactionId}`)) return;
  const currency = (args.currency || CURRENCY).toUpperCase();
  send('purchase', {
    transaction_id: args.transactionId,
    ...itemParams({ itemId: args.itemId, itemName: args.itemId, valueCents: args.valueCents }, currency),
  });
}

/**
 * Once per account, and only for an account made in the last day that has not
 * finished onboarding: someone signing in again later is not a new sign-up.
 * The account id is used only to remember, in this browser, that it was counted.
 */
export function trackSignUpForNewAccount(args: {
  accountId: string;
  createdAt: Date | null | undefined;
  onboardingComplete: boolean;
  method: string;
  plan: string;
}): void {
  if (args.onboardingComplete || !args.createdAt) return;
  const age = Date.now() - new Date(args.createdAt).getTime();
  if (!(age >= 0 && age <= NEW_ACCOUNT_WINDOW_MS)) return;
  if (!firstTime(`sign_up:${args.accountId}`)) return;
  send('sign_up', { method: args.method.replace(/^oauth_/, ''), plan: args.plan });
}

/* ---- What can be bought. The server names a confirmed purchase the same way. ---- */

type PlanPriceOption = {
  tier: string;
  monthlyPriceId: string;
  annualPriceId: string;
  monthlyAmountCents?: number;
  annualAmountCents?: number;
};

export function planItem(tier: string, priceId: string, options: readonly PlanPriceOption[]): CheckoutItem {
  const option = options.find((o) => o.tier === tier);
  const annual = Boolean(option && option.annualPriceId === priceId && option.monthlyPriceId !== priceId);
  const cents = annual ? option?.annualAmountCents : option?.monthlyAmountCents;
  const period = annual ? 'annual' : 'monthly';
  return {
    itemId: `plan_${tier}_${period}`,
    itemName: `plan_${tier}_${period}`,
    ...(typeof cents === 'number' && cents > 0 ? { valueCents: cents } : {}),
  };
}

export function walletTopupItem(amountCents: number): CheckoutItem {
  const id = `wallet_topup_${amountCents}`;
  return { itemId: id, itemName: id, valueCents: amountCents };
}

export function tokenPackItem(packageId: string, priceCents?: number): CheckoutItem {
  const id = `living_report_tokens_${packageId}`;
  return { itemId: id, itemName: id, ...(typeof priceCents === 'number' ? { valueCents: priceCents } : {}) };
}

const ADD_ON_MONTHLY_CENTS: Record<string, number> = { reverse_citation_watch: 1500 };

export function addOnItem(monitorKind: string): CheckoutItem {
  const id = `addon_${monitorKind}`;
  const cents = ADD_ON_MONTHLY_CENTS[monitorKind];
  return { itemId: id, itemName: id, ...(cents ? { valueCents: cents } : {}) };
}
