import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import LandingPage from '../../pages/LandingPage';
import MethodologyPage from '../../pages/MethodologyPage';
import PricingPage from '../../pages/PricingPage';
import FaqPage from '../../pages/FaqPage';
import GuidePage from '../../pages/GuidePage';

function renderInRouter(node: ReactElement) {
  return renderToString(<MemoryRouter>{node}</MemoryRouter>);
}

/** Strip HTML tags so patterns are matched against visible text only,
 *  avoiding false negatives when a phrase is split across elements. */
function extractText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const FORBIDDEN_UNIVERSAL_PATTERNS: readonly RegExp[] = [
  /(every|all)\s+reports?\s+require\s+falsification/i,
  /skeptic(\s+agent)?\s+(on|for)\s+every\s+(claim|conclusion)/i,
  /every\s+objective\s+passes\s+through\s+the\s+same\s+pipeline/i,
  /each\s+mode\s+runs\s+the\s+full\s+ten-?stage\s+pipeline/i,
  /write\s+a\s+specific,?\s*testable\s+query\.?/i,
];

describe('user-facing universal-claim guardrails', () => {
  const surfaces = [
    { name: 'LandingPage', html: () => renderInRouter(<LandingPage />) },
    { name: 'MethodologyPage', html: () => renderInRouter(<MethodologyPage />) },
    { name: 'PricingPage', html: () => renderInRouter(<PricingPage />) },
    { name: 'FaqPage', html: () => renderInRouter(<FaqPage />) },
    { name: 'GuidePage', html: () => renderInRouter(<GuidePage />) },
  ];

  for (const surface of surfaces) {
    it(`${surface.name} does not include forbidden universal claims`, () => {
      const text = extractText(surface.html());
      FORBIDDEN_UNIVERSAL_PATTERNS.forEach((pattern) => {
        expect(text).not.toMatch(pattern);
      });
    });
  }
});
