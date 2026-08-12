/** @vitest-environment jsdom */
import type { ReactElement } from 'react';
import { render, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { Layers } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from '../../pages/LandingPage';
import ComparisonTable from '../../components/landing/ComparisonTable';
import MethodologyPage from '../../pages/MethodologyPage';
import PricingPage from '../../pages/PricingPage';
import ComparePage from '../../pages/ComparePage';
import AboutPage from '../../pages/AboutPage';
import ChangelogPage from '../../pages/ChangelogPage';
import ContactPage from '../../pages/ContactPage';
import MarketingDocsPage from '../../pages/MarketingDocsPage';
import LivingReportTimeline from '../../components/landing/LivingReportTimeline';
import FeatureCard, { FEATURE_CARD_CHAR_CAPS } from '../../components/landing/FeatureCard';

const COMPETITOR_NAMES_CASE_INSENSITIVE = [
  'Perplexity',
  'ChatGPT',
  'OpenAI',
  'Anthropic',
  'Gemini',
  'Elicit',
  'You.com',
  'Undermind',
  'Iris.ai',
  'NotebookLM',
];

/** Approved corpus integrations on the Sticklight landing page. */
const LANDING_ALLOWED_NAMES = ['Scite'];

const COMPETITOR_NAMES_WITH_TRAILING_SPACE = ['Claude ', 'ARI ', 'Parallel '];

const COMPETITOR_NAMES_CASE_SENSITIVE = ['Consensus'];

const GB_STRINGS = [' GB', 'GB ', '10 GB', '25 GB', '50 GB', 'shared corpus'];

function renderInRouter(node: ReactElement) {
  return renderToString(<MemoryRouter>{node}</MemoryRouter>);
}

/** Surfaces that must stay free of named competitors (FAQ uses verbatim §2.10 and is tested separately). */
describe('marketing hardening — no competitor names', () => {
  const pages = [
    { name: 'LandingPage', render: () => renderInRouter(<LandingPage />) },
    { name: 'ComparisonTable', render: () => renderInRouter(<ComparisonTable />) },
    { name: 'PricingPage', render: () => renderInRouter(<PricingPage />) },
    { name: 'ComparePage', render: () => renderInRouter(<ComparePage />) },
    { name: 'AboutPage', render: () => renderInRouter(<AboutPage />) },
    { name: 'ChangelogPage', render: () => renderInRouter(<ChangelogPage />) },
    { name: 'ContactPage', render: () => renderInRouter(<ContactPage />) },
    { name: 'MarketingDocsPage', render: () => renderInRouter(<MarketingDocsPage />) },
  ];

  for (const page of pages) {
    it(`${page.name} does not contain competitor proper nouns`, () => {
      const html = page.render();
      const htmlLower = html.toLowerCase();
      const blocklist =
        page.name === 'LandingPage'
          ? COMPETITOR_NAMES_CASE_INSENSITIVE.filter(
              (n) => !LANDING_ALLOWED_NAMES.some((a) => a.toLowerCase() === n.toLowerCase()),
            )
          : COMPETITOR_NAMES_CASE_INSENSITIVE;

      for (const name of blocklist) {
        expect(htmlLower).not.toContain(name.toLowerCase());
      }

      for (const name of COMPETITOR_NAMES_WITH_TRAILING_SPACE) {
        expect(htmlLower).not.toContain(name.toLowerCase());
      }

      for (const name of COMPETITOR_NAMES_CASE_SENSITIVE) {
        expect(html).not.toContain(name);
      }
    });
  }

  /** Sticklight methodology page — no legacy competitor anchor section. */
  it('MethodologyPage has no competitor names in marketing copy', () => {
    const html = renderInRouter(<MethodologyPage />).toLowerCase();
    const blocklist = COMPETITOR_NAMES_CASE_INSENSITIVE.filter(
      (n) => !LANDING_ALLOWED_NAMES.some((a) => a.toLowerCase() === n.toLowerCase()),
    );
    for (const name of blocklist) {
      expect(html).not.toContain(name.toLowerCase());
    }
  });
});

describe('marketing hardening — no GB/storage language', () => {
  const pages = [
    { name: 'LandingPage', render: () => renderInRouter(<LandingPage />) },
    { name: 'PricingPage', render: () => renderInRouter(<PricingPage />) },
  ];

  for (const page of pages) {
    it(`${page.name} does not contain GB/storage references`, () => {
      const html = page.render().toLowerCase();
      for (const s of GB_STRINGS) {
        expect(html).not.toContain(s.toLowerCase());
      }
    });
  }
});

describe('marketing hardening — structural copy present', () => {
  it('LandingPage contains Sticklight vault marketing anchors', () => {
    const html = renderInRouter(<LandingPage />);
    expect(html).toContain('CAPABILITY_MATRIX');
    expect(html).toContain('Research infrastructure');
    expect(html).toContain('CORPUS_INTEGRATIONS');
    expect(html).toContain('the whole landscape');
    expect(html).toContain('id="main-content"');
  });

  it('MethodologyPage contains pipeline methodology copy', () => {
    const html = renderInRouter(<MethodologyPage />);
    expect(html).toContain('How ResearchOne works');
    expect(html).toContain('CHALLENGE_REVIEW');
  });
});

describe('Wave 2 — LivingReportTimeline badge coverage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders at least three distinct diff badge types (reduced-motion legend)', async () => {
    const { container } = render(<LivingReportTimeline />);
    await waitFor(() => {
      const types = new Set(
        Array.from(container.querySelectorAll('[data-badge-type]')).map((el) => el.getAttribute('data-badge-type'))
      );
      expect(types.size).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('Wave 2 — FeatureCard dev cap guard', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a dev warning when headline exceeds the hard cap', async () => {
    const longHeadline = 'x'.repeat(FEATURE_CARD_CHAR_CAPS.headline + 8);
    render(
      <MemoryRouter>
        <FeatureCard icon={Layers} headline={longHeadline} description="Within cap." />
      </MemoryRouter>
    );
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    const first = (console.warn as ReturnType<typeof vi.spyOn>).mock.calls[0]?.[0] as string;
    expect(first).toContain('headline');
    expect(first).toContain(String(FEATURE_CARD_CHAR_CAPS.headline));
  });
});

describe('marketing — comparison table opaque surface', () => {
  it('wraps the comparison grid in r1-marketing-surface so lab-notebook ruling does not show through', () => {
    const html = renderInRouter(<ComparisonTable />);
    expect(html).toContain('data-testid="comparison-table-surface"');
    expect(html).toContain('r1-marketing-surface');
    expect(html).toContain('<caption');
  });
});
