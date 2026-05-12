import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LandingPage from '../../pages/LandingPage';
import ComparisonTable from '../../components/landing/ComparisonTable';
import MethodologyPage from '../../pages/MethodologyPage';
import PricingPage from '../../pages/PricingPage';
import ComparePage from '../../pages/ComparePage';
import FaqPage from '../../pages/FaqPage';
import AboutPage from '../../pages/AboutPage';
import ChangelogPage from '../../pages/ChangelogPage';
import ContactPage from '../../pages/ContactPage';
import MarketingDocsPage from '../../pages/MarketingDocsPage';

const COMPETITOR_NAMES_CASE_INSENSITIVE = [
  'Perplexity',
  'ChatGPT',
  'OpenAI',
  'Anthropic',
  'Gemini',
  'Elicit',
  'Scite',
  'You.com',
  'Undermind',
  'Iris.ai',
  'NotebookLM',
];

const COMPETITOR_NAMES_WITH_TRAILING_SPACE = [
  'Claude ',
  'ARI ',
  'Parallel ',
];

const COMPETITOR_NAMES_CASE_SENSITIVE = [
  'Consensus',
];

const GB_STRINGS = [' GB', 'GB ', '10 GB', '25 GB', '50 GB', 'shared corpus'];

function renderInRouter(node: React.ReactElement) {
  return renderToString(<MemoryRouter>{node}</MemoryRouter>);
}

describe('marketing hardening — no competitor names', () => {
  const pages = [
    { name: 'LandingPage', render: () => renderInRouter(<LandingPage />) },
    { name: 'ComparisonTable', render: () => renderInRouter(<ComparisonTable />) },
    { name: 'MethodologyPage', render: () => renderInRouter(<MethodologyPage />) },
    { name: 'PricingPage', render: () => renderInRouter(<PricingPage />) },
    { name: 'ComparePage', render: () => renderInRouter(<ComparePage />) },
    { name: 'FaqPage', render: () => renderInRouter(<FaqPage />) },
    { name: 'AboutPage', render: () => renderInRouter(<AboutPage />) },
    { name: 'ChangelogPage', render: () => renderInRouter(<ChangelogPage />) },
    { name: 'ContactPage', render: () => renderInRouter(<ContactPage />) },
    { name: 'MarketingDocsPage', render: () => renderInRouter(<MarketingDocsPage />) },
  ];

  for (const page of pages) {
    it(`${page.name} does not contain competitor proper nouns`, () => {
      const html = page.render();
      const htmlLower = html.toLowerCase();

      for (const name of COMPETITOR_NAMES_CASE_INSENSITIVE) {
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
  it('LandingPage contains required structural strings', () => {
    const html = renderInRouter(<LandingPage />);
    expect(html).toContain('Deep research that defends itself.');
    expect(html).toContain('Built for defensible decisions, not chat answers.');
    expect(html).toContain('When the world changes, your report knows.');
    expect(html).toContain('Every claim has a source. Every source has a reason.');
    expect(html).toContain('Stop arguing about what you found.');
    expect(html).toContain('Chat-style AI research');
    expect(html).toContain('Citation-graded');
  });

  it('MethodologyPage contains Five modes. One pipeline.', () => {
    const html = renderInRouter(<MethodologyPage />);
    expect(html).toContain('Five modes. One pipeline.');
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
