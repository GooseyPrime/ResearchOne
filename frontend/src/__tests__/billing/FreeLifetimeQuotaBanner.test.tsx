import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FreeLifetimeQuotaBanner from '../../components/billing/FreeLifetimeQuotaBanner';

const useBillingSubscriptionQuery = vi.fn();

vi.mock('../../hooks/useBillingSubscription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBillingSubscription')>();
  return {
    ...actual,
    useBillingSubscriptionQuery: () => useBillingSubscriptionQuery(),
  };
});

function renderBanner() {
  return renderToString(
    <MemoryRouter>
      <FreeLifetimeQuotaBanner />
    </MemoryRouter>
  );
}

describe('FreeLifetimeQuotaBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while tier is unresolved', () => {
    useBillingSubscriptionQuery.mockReturnValue({
      authReady: false,
      isLoading: true,
      isError: false,
      data: undefined,
    });
    expect(renderBanner()).toBe('');
  });

  it('renders nothing for paid effective tier', () => {
    useBillingSubscriptionQuery.mockReturnValue({
      authReady: true,
      isLoading: false,
      isError: false,
      data: {
        tier: 'pro',
        effectiveTier: 'pro',
        lifetimeReportCap: null,
        lifetimeReportsUsed: 0,
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      },
    });
    expect(renderBanner()).toBe('');
  });

  it('shows what is left of the free allowance', () => {
    useBillingSubscriptionQuery.mockReturnValue({
      authReady: true,
      isLoading: false,
      isError: false,
      data: {
        tier: 'free_demo',
        effectiveTier: 'free_demo',
        lifetimeReportCap: 2,
        lifetimeReportsUsed: 1,
        status: 'none',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      },
    });
    const html = renderBanner();
    expect(html).toContain('Free tier');
    expect(html).toContain('>1<');
    expect(html).toContain('>2<');
  });

  it('no longer explains a distinction between two kinds of run', () => {
    // The banner used to say the allowance was "shared across Research and
    // Deep Research modes", and that one of the two used a richer ensemble.
    // There is one kind of run, so both sentences became untrue.
    useBillingSubscriptionQuery.mockReturnValue({
      authReady: true,
      isLoading: false,
      isError: false,
      data: {
        tier: 'free_demo',
        effectiveTier: 'free_demo',
        lifetimeReportCap: 2,
        lifetimeReportsUsed: 0,
        status: 'none',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      },
    });
    const html = renderBanner();
    expect(html).not.toContain('Deep Research');
    expect(html).not.toContain('V2');
    expect(html).not.toContain('modes');
  });
});
