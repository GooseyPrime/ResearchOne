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

const FORBIDDEN_UNIVERSAL_PATTERNS: readonly RegExp[] = [
  /every report requires falsification/i,
  /skeptic on every claim/i,
  /every objective passes through the same pipeline/i,
  /each mode runs the full ten-stage pipeline/i,
  /write a specific,?\s*testable query\.?/i,
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
      const html = surface.html();
      FORBIDDEN_UNIVERSAL_PATTERNS.forEach((pattern) => {
        expect(html).not.toMatch(pattern);
      });
    });
  }
});
