/** @vitest-environment jsdom */
/**
 * The pricing page after the browser has asked the server what can be bought:
 * a product whose Stripe price is not set loses its button and gains
 * "Not yet available", and a signed-in visitor skips sign-up.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getClerkJwtForApi: vi.fn(),
}));

vi.mock('../../utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/api')>();
  return { ...actual, publicApi: { get: mocks.get } };
});
vi.mock('../../utils/clerkSession', () => ({
  getClerkJwtForApi: mocks.getClerkJwtForApi,
  registerClerkTokenGetter: vi.fn(),
}));

import PricingPage from '../../pages/PricingPage';
import { parsePurchaseAvailability } from '../../lib/billing/availability';

const ALL = {
  plans: { pro: true, byok: true },
  addons: { living_report: true, reverse_citation_watch: true },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <PricingPage />
    </MemoryRouter>,
  );
}

/** The card (plan or add-on) whose heading is `title`. */
function card(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const article = heading.closest('article');
  if (!article) throw new Error(`no card for ${title}`);
  return article;
}

const links = (el: HTMLElement) => Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));

beforeEach(() => {
  mocks.get.mockReset();
  mocks.getClerkJwtForApi.mockReset();
  mocks.getClerkJwtForApi.mockResolvedValue(null);
});
afterEach(cleanup);

describe('PricingPage with server availability', () => {
  it('asks the public endpoint, not an authenticated one', async () => {
    mocks.get.mockResolvedValue({ data: ALL });
    renderPage();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/billing/availability'));
  });

  it('keeps every buy path when everything is configured', async () => {
    mocks.get.mockResolvedValue({ data: ALL });
    renderPage();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());

    expect(links(card('BYOK'))).toContain('/sign-up?tier=byok');
    expect(links(card('Pro'))).toContain('/sign-up?tier=pro');
    expect(links(card('Living Reports'))).toContain('/app/billing#monitor-tokens');
    expect(links(card('Reverse-Citation Watch'))).toContain('/app/add-ons');
  });

  it('replaces the BYOK button with "Not yet available" when its price is not set', async () => {
    mocks.get.mockResolvedValue({ data: { ...ALL, plans: { pro: true, byok: false } } });
    renderPage();

    await waitFor(() => expect(card('BYOK').textContent).toContain('Not yet available'));
    expect(links(card('BYOK'))).not.toContain('/sign-up?tier=byok');
    expect(card('BYOK').textContent).not.toContain('Subscribe');
    // Pro is untouched.
    expect(links(card('Pro'))).toContain('/sign-up?tier=pro');
    expect(card('Pro').textContent).not.toContain('Not yet available');
  });

  it('replaces the Pro button with "Not yet available" when its price is not set', async () => {
    mocks.get.mockResolvedValue({ data: { ...ALL, plans: { pro: false, byok: true } } });
    renderPage();

    await waitFor(() => expect(card('Pro').textContent).toContain('Not yet available'));
    expect(links(card('Pro'))).toEqual([]);
  });

  it('replaces each add-on button with "Not yet available" when its price is not set', async () => {
    mocks.get.mockResolvedValue({
      data: { ...ALL, addons: { living_report: false, reverse_citation_watch: false } },
    });
    renderPage();

    await waitFor(() => expect(card('Living Reports').textContent).toContain('Not yet available'));
    expect(links(card('Living Reports'))).toEqual([]);
    expect(card('Reverse-Citation Watch').textContent).toContain('Not yet available');
    expect(links(card('Reverse-Citation Watch'))).toEqual([]);
    // The prices themselves stay on the page.
    expect(card('Living Reports').textContent).toContain('$10 / token');
    expect(card('Reverse-Citation Watch').textContent).toContain('$15/mo');
  });

  it('handles the two add-ons independently', async () => {
    mocks.get.mockResolvedValue({
      data: { ...ALL, addons: { living_report: true, reverse_citation_watch: false } },
    });
    renderPage();

    await waitFor(() => expect(card('Reverse-Citation Watch').textContent).toContain('Not yet available'));
    expect(links(card('Living Reports'))).toContain('/app/billing#monitor-tokens');
  });

  it('keeps the buy paths when the availability request fails', async () => {
    mocks.get.mockRejectedValue(new Error('network'));
    renderPage();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());

    expect(links(card('BYOK'))).toContain('/sign-up?tier=byok');
    expect(links(card('Living Reports'))).toContain('/app/billing#monitor-tokens');
  });

  it('sends a signed-in visitor straight to billing for the chosen plan', async () => {
    mocks.get.mockResolvedValue({ data: ALL });
    mocks.getClerkJwtForApi.mockResolvedValue('jwt');
    renderPage();

    await waitFor(() => expect(links(card('BYOK'))).toContain('/app/billing?intent=byok'));
    expect(links(card('Pro'))).toContain('/app/billing?intent=pro');
  });

  it('never leaves a price without a way forward or a note', async () => {
    mocks.get.mockResolvedValue({
      data: { plans: { pro: false, byok: false }, addons: { living_report: false, reverse_citation_watch: false } },
    });
    const { container } = renderPage();
    await waitFor(() => expect(card('BYOK').textContent).toContain('Not yet available'));

    for (const article of Array.from(container.querySelectorAll('article'))) {
      const text = article.textContent ?? '';
      if (!text.includes('$')) continue;
      const hasPath = article.querySelector('a') !== null;
      const hasNote = text.includes('Not yet available');
      expect(hasPath || hasNote, `dead end: ${text.slice(0, 60)}`).toBe(true);
    }
  });
});

describe('parsePurchaseAvailability', () => {
  it('accepts the server shape', () => {
    expect(parsePurchaseAvailability(ALL)).toEqual(ALL);
  });

  it.each([null, 'nope', {}, { plans: {} }, { plans: { pro: 'yes', byok: true }, addons: ALL.addons }])(
    'treats %j as unknown',
    (raw) => {
      expect(parsePurchaseAvailability(raw)).toBeNull();
    },
  );
});
