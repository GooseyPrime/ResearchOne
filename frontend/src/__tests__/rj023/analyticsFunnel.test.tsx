// @vitest-environment jsdom
/**
 * RJ-023: the analytics tag counts the steps between a visitor and a paying
 * customer, and stays off every page that shows a customer's research.
 *
 *   1. Public pages, onboarding and the billing page switch the tag on.
 *   2. Research pages switch it off, and so does a signed-in address nobody
 *      has listed: the signed-in rule is an allow-list.
 *   3. The page's own script (`index.html`) and `analyticsScope.ts` agree.
 *   4. `purchase` is sent once per Stripe checkout session id.
 *   5. An event raised on a private page is held and sent on the next
 *      counted page, never on the private one.
 *   6. Nothing sent names a person.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GA_MEASUREMENT_ID, applyAnalyticsScope, isAnalyticsTrackedPath } from '../../lib/analyticsScope';
import PlanReviewBanner from '../../components/layout/PlanReviewBanner';
import type { ResearchRun } from '../../utils/api';

const GA_OFF = `ga-disable-${GA_MEASUREMENT_ID}`;
const flags = window as unknown as Record<string, unknown>;
const ID = '3f0c2b1e-0000-4000-8000-000000000023';

const TRACKED = [
  '/',
  '/pricing',
  '/sign-in',
  '/sign-up',
  '/byok',
  '/sample-report',
  '/onboarding',
  '/onboarding/',
  '/onboarding/plan',
  '/app/billing',
  '/app/billing/',
];

const PRIVATE = [
  '/app',
  '/app/research',
  `/app/run/${ID}`,
  '/app/dossiers',
  `/app/dossiers/${ID}`,
  `/app/dossiers/${ID}/plan-history`,
  '/app/reports',
  `/app/reports/${ID}`,
  `/app/reports/run/${ID}`,
  `/app/reports/${ID}/revising`,
  `/app/reports/${ID}/spinoff`,
  '/app/corpus',
  '/app/atlas',
  '/app/embedding-viz',
  '/app/knowledge-graph',
  '/app/ingest',
  '/app/models',
  '/app/monitors',
  '/app/monitors/living-reports',
  '/app/add-ons',
  '/app/byok',
  '/app/guide',
  '/app/admin',
  '/app/admin/telemetry',
  '/account',
  '/account/security',
  // Not listed anywhere: a page added tomorrow is private until someone lists it.
  '/app/some-new-page',
  '/app/billing-history',
  `/app/billing/${ID}`,
  '/app/billingx',
];

let sent: unknown[][];

async function freshEvents() {
  vi.resetModules();
  return import('../../lib/analyticsEvents');
}

function goTo(path: string) {
  window.history.replaceState({}, '', path);
  applyAnalyticsScope(window.location.pathname);
}

beforeEach(() => {
  sent = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  (window as unknown as { gtag: (...args: unknown[]) => void }).gtag = (...args: unknown[]) => {
    // The real tag drops everything while its switch is set.
    if (flags[GA_OFF] !== true) sent.push(args);
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { gtag?: unknown }).gtag;
  window.history.replaceState({}, '', '/');
});

describe('RJ-023: where the analytics tag runs', () => {
  it('runs on the public pages, onboarding and the billing page', () => {
    for (const path of TRACKED) {
      expect(isAnalyticsTrackedPath(path), path).toBe(true);
      applyAnalyticsScope(path);
      expect(flags[GA_OFF], path).toBe(false);
    }
  });

  it('is off on research pages and on any signed-in address that is not listed', () => {
    for (const path of PRIVATE) {
      expect(isAnalyticsTrackedPath(path), path).toBe(false);
      applyAnalyticsScope(path);
      expect(flags[GA_OFF], path).toBe(true);
    }
  });

  it("is switched by the page's own script, the same way, before the tag sees a change of address", () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(script.indexOf(`gtag('config', '${GA_MEASUREMENT_ID}')`)).toBeGreaterThan(script.indexOf('r1AnalyticsScope();'));

    const { pushState, replaceState } = window.history;
    try {
      window.history.replaceState({}, '', `/app/run/${ID}`);
      new Function(script)();
      expect(flags[GA_OFF]).toBe(true);
      // The tag listens to the same history calls; the switch is already right when they return.
      for (const path of [...TRACKED, ...PRIVATE, ...TRACKED]) {
        window.history.pushState({}, '', path);
        expect(flags[GA_OFF], path).toBe(!isAnalyticsTrackedPath(path));
        window.history.replaceState({}, '', path);
        expect(flags[GA_OFF], path).toBe(!isAnalyticsTrackedPath(path));
      }
    } finally {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
    }
  });
});

describe('RJ-023: sign_up, begin_checkout and purchase', () => {
  it('sends purchase once per Stripe session id', async () => {
    const { trackPurchase } = await freshEvents();
    goTo('/app/billing');
    const first = { transactionId: 'cs_test_one', itemId: 'plan_pro_monthly', valueCents: 2900, currency: 'usd' };
    trackPurchase(first);
    trackPurchase(first);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([
      'event',
      'purchase',
      {
        transaction_id: 'cs_test_one',
        value: 29,
        currency: 'USD',
        items: [{ item_id: 'plan_pro_monthly', item_name: 'plan_pro_monthly', quantity: 1, price: 29 }],
      },
    ]);

    // The page is opened again with the same address (reload, back button): still once.
    const again = await freshEvents();
    again.trackPurchase(first);
    expect(sent).toHaveLength(1);

    // A different session is a different purchase.
    again.trackPurchase({ ...first, transactionId: 'cs_test_two' });
    expect(sent).toHaveLength(2);
  });

  it('sends begin_checkout with the item, its price and currency', async () => {
    const { planItem, tokenPackItem, trackBeginCheckout, walletTopupItem, addOnItem } = await freshEvents();
    goTo('/app/billing');
    const options = [
      { tier: 'pro', monthlyPriceId: 'price_m', annualPriceId: 'price_a', monthlyAmountCents: 2900, annualAmountCents: 29000 },
    ];
    trackBeginCheckout(planItem('pro', 'price_a', options));
    expect(sent[0]).toEqual([
      'event',
      'begin_checkout',
      {
        value: 290,
        currency: 'USD',
        items: [{ item_id: 'plan_pro_annual', item_name: 'plan_pro_annual', quantity: 1, price: 290 }],
      },
    ]);
    expect(planItem('pro', 'price_m', options)).toEqual({ itemId: 'plan_pro_monthly', itemName: 'plan_pro_monthly', valueCents: 2900 });
    expect(walletTopupItem(2000).itemId).toBe('wallet_topup_2000');
    expect(tokenPackItem('pack_5', 2500)).toEqual({
      itemId: 'living_report_tokens_pack_5',
      itemName: 'living_report_tokens_pack_5',
      valueCents: 2500,
    });
    expect(addOnItem('reverse_citation_watch').valueCents).toBe(1500);
    // The Stripe price id is not sent.
    expect(JSON.stringify(sent)).not.toContain('price_a');
  });

  it('holds an event raised on a private page and sends it on the next counted page', async () => {
    const { addOnItem, flushQueuedAnalyticsEvents, trackBeginCheckout } = await freshEvents();
    goTo(`/app/reports/${ID}`);
    trackBeginCheckout(addOnItem('reverse_citation_watch'));
    expect(sent).toHaveLength(0);

    flushQueuedAnalyticsEvents(window.location.pathname);
    expect(sent).toHaveLength(0);

    // Stripe sends the customer back to the billing page.
    goTo('/app/billing');
    flushQueuedAnalyticsEvents(window.location.pathname);
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toBe('begin_checkout');
    flushQueuedAnalyticsEvents(window.location.pathname);
    expect(sent).toHaveLength(1);
  });

  it('sends sign_up once for a new account, and not for an old or onboarded one', async () => {
    const { trackSignUpForNewAccount } = await freshEvents();
    goTo('/onboarding');
    const account = {
      accountId: 'user_2abcDEF',
      createdAt: new Date(Date.now() - 60_000),
      onboardingComplete: false,
      method: 'oauth_google',
      plan: 'pro',
    };
    trackSignUpForNewAccount(account);
    trackSignUpForNewAccount(account);
    expect(sent).toEqual([['event', 'sign_up', { method: 'google', plan: 'pro' }]]);

    trackSignUpForNewAccount({ ...account, accountId: 'user_old', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
    trackSignUpForNewAccount({ ...account, accountId: 'user_done', onboardingComplete: true });
    trackSignUpForNewAccount({ ...account, accountId: 'user_nodate', createdAt: null });
    expect(sent).toHaveLength(1);
    // The account id is used to remember, never sent.
    expect(JSON.stringify(sent)).not.toContain('user_2abcDEF');
  });
});

describe('RJ-023: the plan banner is in plain words', () => {
  it('says what to do and that this run waits for it', () => {
    const run = { id: ID, status: 'plan_pending_confirmation' } as unknown as ResearchRun;
    render(
      <MemoryRouter>
        <PlanReviewBanner runs={[run, { ...run, id: `${ID}-b` }]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Research plan ready')).toBeTruthy();
    expect(screen.getByText('Confirm the plan or change it. This run will not start until you confirm (+1 more).')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/pipeline|orchestrat/i);
  });
});
