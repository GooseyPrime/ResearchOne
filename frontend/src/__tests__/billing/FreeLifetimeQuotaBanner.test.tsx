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

function renderBanner(variant: 'research' | 'deep-research' = 'research') {
  return renderToString(
    <MemoryRouter>
      <FreeLifetimeQuotaBanner variant={variant} />
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

  it('shows cap 2 and shared-pool copy for free_demo on Research variant', () => {
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
    const html = renderBanner('research');
    expect(html).toContain('Free tier — Research');
    expect(html).toContain('>1<');
    expect(html).toContain('>2<');
    expect(html).toContain('shared across Research and Deep Research modes');
  });

  it('shows Deep Research heading for deep-research variant', () => {
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
    const html = renderBanner('deep-research');
    expect(html).toContain('Free tier — Deep Research');
    expect(html).toContain('V2 multi-model ensemble');
  });
});
