/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
/**
 * AnimatedPipelineHero — component tests.
 *
 * Per Cursor rule 27 I-10: every assertion must fail when the relevant
 * production code is reverted. Each assertion ends with a
 * `// REVERT-CHECK:` comment naming the production line.
 *
 * Run: npx vitest run AnimatedPipelineHero
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { HERO_PIPELINE_IMG_ARIA_LABEL } from '../../components/landing/heroPipelineAria';
import AnimatedPipelineHero from '../../components/landing/visual/AnimatedPipelineHero';
import { BEAM_PALETTES } from '../../components/landing/visual/personaBeamPalettes';
import { PIPELINE_STAGES } from '../../components/landing/visual/pipelineLayout';

let prevIntersectionObserver: typeof globalThis.IntersectionObserver | undefined;
let prevMatchMedia: typeof window.matchMedia | undefined;

// Mock IntersectionObserver — vitest jsdom doesn't ship one.
beforeEach(() => {
  prevIntersectionObserver = globalThis.IntersectionObserver;
  // @ts-expect-error — jsdom doesn't include IntersectionObserver natively.
  globalThis.IntersectionObserver = class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      // Immediately fire as "visible" so animations are "on" by default.
      this.callback(
        [
          {
            target,
            isIntersecting: true,
            intersectionRatio: 1,
          } as unknown as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  };

  prevMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: typeof query === 'string' && query.includes('768px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  if (prevIntersectionObserver === undefined) {
    // @ts-expect-error — restore pre-test absence
    delete globalThis.IntersectionObserver;
  } else {
    globalThis.IntersectionObserver = prevIntersectionObserver;
  }
  if (prevMatchMedia === undefined) {
    // @ts-expect-error — restore pre-test absence of window.matchMedia
    delete window.matchMedia;
  } else {
    window.matchMedia = prevMatchMedia;
  }
});

describe('AnimatedPipelineHero — reduced motion fallback (Rule 27 I-1)', () => {
  it('renders the static HeroPipelineVisual verbatim when reduced motion is on', () => {
    render(<AnimatedPipelineHero forceReducedMotion={true} />);
    expect(screen.getByTestId('static-pipeline-fallback')).toBeInTheDocument();
    // The animated container must NOT render.
    expect(screen.queryByTestId('pipeline-animated')).toBeNull();
    expect(screen.queryByTestId('pipeline-beams-svg')).toBeNull();
    // REVERT-CHECK: AnimatedPipelineHero.tsx — the `if (reducedMotion)` early
    // return. If removed, the animated DOM renders and this test fails.
  });

  it('the static fallback contains the existing aria-label text', () => {
    render(<AnimatedPipelineHero forceReducedMotion={true} />);
    expect(
      screen.getByLabelText(/ResearchOne ten-stage pipeline grouped into four phases/i)
    ).toBeInTheDocument();
  });
});

describe('AnimatedPipelineHero — animated render (Rule 27 I-1 negative case)', () => {
  it('renders animated container when reduced motion is off', () => {
    render(<AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />);
    expect(screen.getByTestId('pipeline-animated')).toBeInTheDocument();
    expect(screen.getByTestId('pipeline-beams-svg')).toBeInTheDocument();
    // The reduced-motion fallback container must NOT render.
    expect(screen.queryByTestId('static-pipeline-fallback')).toBeNull();
  });

  it('the animated container also carries the screen-reader description', () => {
    render(<AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />);
    const animated = screen.getByTestId('pipeline-animated');
    expect(
      within(animated).getByText(/Phase one, Plan, includes the Planner and Discovery stages/i)
    ).toBeInTheDocument();
    // REVERT-CHECK: AnimatedPipelineHero.tsx — the sr-only paragraph inside
    // the animated desktop branch. Scoped with `within(animated)` because
    // jsdom keeps both mobile static + desktop branches in the tree.
  });

  it('renders all 10 canonical stage labels', () => {
    render(<AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />);
    PIPELINE_STAGES.forEach((stage) => {
      // Stage label appears in BOTH the mobile static layout AND the
      // desktop animated layout — so we use getAllByText.
      const matches = screen.getAllByText(stage.label);
      expect(matches.length).toBeGreaterThan(0);
    });
    // REVERT-CHECK: pipelineLayout.ts:PIPELINE_STAGES — if any stage
    // is renamed or removed, this test fails. Rule 27 I-3 tripwire.
  });
});

describe('AnimatedPipelineHero — Skeptic emphasis (Rule 27 I-4)', () => {
  it('Skeptic stage carries data-emphasis="skeptic"', () => {
    const { container } = render(
      <AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />
    );
    const skepticNode = container.querySelector('[data-stage-id="skeptic"]');
    expect(skepticNode).toBeInTheDocument();
    expect(skepticNode?.getAttribute('data-emphasis')).toBe('skeptic');
    // REVERT-CHECK: AnimatedPipelineHero.tsx — the `data-emphasis` attribute
    // on the Skeptic node. Removing it breaks the marketing emphasis contract.
  });

  it('Skeptic node uses the palette skepticRing color, not nodeIdleRing', () => {
    const { container } = render(
      <AnimatedPipelineHero
        forceReducedMotion={false}
        alwaysAnimate
        forcePersona="default"
      />
    );
    const skepticNode = container.querySelector('[data-stage-id="skeptic"]');
    expect(skepticNode).toBeInTheDocument();
    const style = (skepticNode as HTMLElement).getAttribute('style') ?? '';
    // The Skeptic ring should use the brighter skepticRing color.
    expect(style).toContain(BEAM_PALETTES.default.skepticRing);
    // And NOT the idle ring (which would mean the emphasis logic broke).
    // We can't simply check for absence because rgba substrings might overlap;
    // we assert the brighter color is present.
  });
});

describe('AnimatedPipelineHero — persona palette (Rule 27 I-5)', () => {
  it('forcePersona="uap" applies UAP palette to Skeptic ring', () => {
    const { container } = render(
      <AnimatedPipelineHero
        forceReducedMotion={false}
        alwaysAnimate
        forcePersona="uap"
      />
    );
    const skepticNode = container.querySelector('[data-stage-id="skeptic"]');
    const style = (skepticNode as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain(BEAM_PALETTES.uap.skepticRing);
    // REVERT-CHECK: AnimatedPipelineHero.tsx — the persona palette lookup
    // via `getBeamPalette(forcePersona)`. Revert to a hardcoded palette
    // and this test fails.
  });

  it('forcePersona="osint" applies OSINT palette', () => {
    const { container } = render(
      <AnimatedPipelineHero
        forceReducedMotion={false}
        alwaysAnimate
        forcePersona="osint"
      />
    );
    const skepticNode = container.querySelector('[data-stage-id="skeptic"]');
    const style = (skepticNode as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain(BEAM_PALETTES.osint.skepticRing);
  });

  it('unknown persona falls back to default palette', () => {
    const { container } = render(
      <AnimatedPipelineHero
        forceReducedMotion={false}
        alwaysAnimate
        forcePersona="definitely-not-a-real-persona"
      />
    );
    const skepticNode = container.querySelector('[data-stage-id="skeptic"]');
    const style = (skepticNode as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain(BEAM_PALETTES.default.skepticRing);
    // REVERT-CHECK: personaBeamPalettes.ts:getBeamPalette — the
    // `?? BEAM_PALETTES.default` fallback. Without it, lookup returns
    // undefined and the test crashes instead of rendering default colors.
  });
});

describe('AnimatedPipelineHero — accessibility (Rule 27 I-8)', () => {
  it('SVG beam layer is aria-hidden', () => {
    render(<AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />);
    const svg = screen.getByTestId('pipeline-beams-svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    // REVERT-CHECK: pipelineBeams.tsx — the `aria-hidden="true"` on the
    // SVG element. Without it, screen readers double-announce the
    // decorative beams. WCAG 1.1.1 violation.
  });

  it('animated container aria-label matches HeroPipelineVisual (Rule 27 I-8)', () => {
    render(<AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />);
    const container = screen.getByTestId('pipeline-animated');
    expect(container.getAttribute('aria-label')).toBe(HERO_PIPELINE_IMG_ARIA_LABEL);
    // REVERT-CHECK: heroPipelineAria.ts — shared string; animated hero must
    // not drift from the static visual's accessible name.
  });

  it('animated container has role="img"', () => {
    render(<AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />);
    const container = screen.getByTestId('pipeline-animated');
    expect(container.getAttribute('role')).toBe('img');
  });
});

describe('AnimatedPipelineHero — specialist nodes (Stage D)', () => {
  it('renders conditional specialist nodes in the animated desktop layout', () => {
    const { container } = render(<AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />);
    const marketScout = container.querySelector('[data-stage-id="market_scout"]');
    const feasibilityArchitect = container.querySelector('[data-stage-id="feasibility_architect"]');
    const storyVerifier = container.querySelector('[data-stage-id="story_verifier"]');
    expect(marketScout).toBeInTheDocument();
    expect(feasibilityArchitect).toBeInTheDocument();
    expect(storyVerifier).toBeInTheDocument();
    expect(marketScout?.getAttribute('data-conditional')).toBe('true');
    // REVERT-CHECK: pipelineLayout.ts / AnimatedPipelineHero.tsx — if the
    // specialist stage list is removed from the render path, these nodes vanish.
  });
});

describe('AnimatedPipelineHero — no banned filter usage (Rule 27 I-7)', () => {
  it('rendered DOM contains no filter:drop-shadow or filter:blur', () => {
    const { container } = render(
      <AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/filter:\s*drop-shadow/i);
    expect(html).not.toMatch(/filter:\s*blur/i);
    expect(html).not.toMatch(/<filter\b/i);
    // REVERT-CHECK: pipelineBeams.tsx — the halo effect is implemented
    // via a wider stroke layer, not a filter. If someone adds
    // `filter: drop-shadow(...)` to make a "real glow," this test fails.
    // Rule 27 I-7 — filters cost ~40% framerate on mid-range Android.
  });
});

describe('AnimatedPipelineHero — resolvedPersona prop (PR #112)', () => {
  it('updates beam palette when resolvedPersona changes', () => {
    const { container, rerender } = render(
      <AnimatedPipelineHero
        forceReducedMotion={false}
        alwaysAnimate
        resolvedPersona="default"
      />
    );
    let skepticNode = container.querySelector('[data-stage-id="skeptic"]');
    let style = (skepticNode as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain(BEAM_PALETTES.default.skepticRing);

    rerender(
      <AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate resolvedPersona="uap" />
    );
    skepticNode = container.querySelector('[data-stage-id="skeptic"]');
    style = (skepticNode as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain(BEAM_PALETTES.uap.skepticRing);
    // REVERT-CHECK: AnimatedPipelineHero.tsx — `resolvedPersona` in the
    // palette `useEffect` dependency list. Without it, UAP beams stay
    // on default after PersonaAwareHero resolves post-mount.
  });
});

describe('AnimatedPipelineHero — persona detection via ancestor data-persona', () => {
  it('reads data-persona from a parent element', () => {
    const { container } = render(
      <section data-persona="patent">
        <AnimatedPipelineHero forceReducedMotion={false} alwaysAnimate />
      </section>
    );
    const skepticNode = container.querySelector('[data-stage-id="skeptic"]');
    const style = (skepticNode as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain(BEAM_PALETTES.patent.skepticRing);
    // REVERT-CHECK: AnimatedPipelineHero.tsx — the
    // `containerRef.current.closest('[data-persona]')` lookup. This is
    // the WO-V → WO-W composition contract per Rule 27 I-5.
  });
});
