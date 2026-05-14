/**
 * @vitest-environment jsdom
 *
 * Wave 2.5 — regression guards for marketing a11y structure (landmarks,
 * pipeline group role, nested-interactive scrubber pattern).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceProvenancePanel from '../../components/landing/SourceProvenancePanel';
import LivingReportTimeline from '../../components/landing/LivingReportTimeline';
import PipelineSchematic from '../../components/landing/PipelineSchematic';
import LandingPage from '../../pages/LandingPage';

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Wave 2.5 — SourceProvenancePanel confidence', () => {
  it('uses role="group" for confidence dots so aria-label is permitted', () => {
    const html = renderToString(<SourceProvenancePanel />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Confidence: 3 of 4"');
  });
});

describe('Wave 2.5 — LivingReportTimeline scrubber', () => {
  it('uses a group wrapper without role=slider (avoids nested-interactive with buttons)', () => {
    const html = renderToString(<LivingReportTimeline />);
    expect(html).toContain('role="group"');
    expect(html).toContain('Report version scrubber');
    expect(html).not.toContain('role="slider"');
  });
});

describe('Wave 2.5 — PipelineSchematic desktop', () => {
  it('exposes the schematic container as role="group" and does not aria-hide the interactive SVG', () => {
    const { container } = render(<PipelineSchematic />);
    const root = container.querySelector('[data-testid="pipeline-schematic"]');
    expect(root).toBeTruthy();
    expect(root).toHaveAttribute('role', 'group');
    const svg = root?.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg).not.toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Wave 2.5 — LandingPage main landmark', () => {
  it('includes exactly one main landmark wrapping primary content', () => {
    const html = renderToString(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );
    expect(html).toContain('id="marketing-main"');
    const mains = html.match(/<main\b/g);
    expect(mains?.length).toBe(1);
  });
});
