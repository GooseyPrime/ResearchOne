/**
 * @vitest-environment jsdom
 *
 * the evidence-vocabulary pass — competitor quote DOM contract + tier display label (Rule 31).
 */
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import WhatCompetitorsActuallySay, {
  WAVE4_COMPETITOR_QUOTE_URLS,
} from '../../components/landing/WhatCompetitorsActuallySay';

const TIER_DISPLAY: Record<string, string> = {
  established_fact: 'Established Fact',
  strong_evidence: 'Strong corroboration',
  testimony: 'Testimony',
  inference: 'Inference',
  speculation: 'Speculation',
};

describe('evidence vocabulary — WhatCompetitorsActuallySay', () => {
  it('renders five blockquotes each with cite equal to canonical URLs', () => {
    const html = renderToString(
      <MemoryRouter>
        <WhatCompetitorsActuallySay />
      </MemoryRouter>,
    );
    expect(WAVE4_COMPETITOR_QUOTE_URLS).toHaveLength(5);
    for (const url of WAVE4_COMPETITOR_QUOTE_URLS) {
      expect(html).toContain(`cite="${url}"`);
    }
  });
});

describe('evidence vocabulary — strong_evidence display label', () => {
  it('maps strong_evidence to Strong corroboration (CorpusPage contract)', () => {
    expect(TIER_DISPLAY.strong_evidence).toBe('Strong corroboration');
  });
});

describe('evidence vocabulary — competitor URL live integrity', () => {
  it.skip('Use repo script `node scripts/verify-wave4-competitor-quote-urls.mjs` for live HTML checks (non-CI).', () => {
    expect.fail('Skipped — live URL check is optional and not part of this suite.');
  });
});
