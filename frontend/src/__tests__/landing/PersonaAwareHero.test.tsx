/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
/**
 * PersonaAwareHero — component tests.
 *
 * Asserts:
 *   - Default copy matches `Hero.tsx` / `personaContent.ts` default
 *     (Wave 2 marquee charter; founder-authorized Rule 26 I-3 override
 *     recorded in docs/governance.md).
 *   - data-persona attribute carries the resolved persona id (so
 *     downstream WO-W animations can read it via DOM query / CSS).
 *   - onPersonaResolved fires once with the resolved id and path.
 *   - forcePersona overrides resolution (test/A-B scenario).
 *
 * Run: npx vitest run PersonaAwareHero
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PersonaAwareHero from '../../components/landing/persona/PersonaAwareHero';
import { _clearPersonaCache } from '../../components/landing/persona/personaResolver';

function renderHero(props: Parameters<typeof PersonaAwareHero>[0] = {}) {
  return render(
    <MemoryRouter>
      <PersonaAwareHero {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  _clearPersonaCache();
  window.history.replaceState({}, '', '/');
  Object.defineProperty(document, 'referrer', {
    value: '',
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
});

describe('PersonaAwareHero — default state matches Hero / personaContent default', () => {
  it('renders the eyebrow / headline / subhead verbatim', async () => {
    renderHero();
    await waitFor(() => {
      expect(screen.getByText('DEEP RESEARCH PLATFORM')).toBeInTheDocument();
      expect(screen.getByText('Research that defends itself.')).toBeInTheDocument();
      expect(
        screen.getByText(
          /ResearchOne runs a 10-stage, 7-agent pipeline — including a dedicated Skeptic/
        )
      ).toBeInTheDocument();
    });
    // REVERT-CHECK: personaContent.ts:default — if this drifts from
    // Hero.tsx the test fails.
  });

  it('renders the two default CTAs', async () => {
    renderHero();
    await waitFor(() => {
      expect(screen.getByText('Open a sample report')).toBeInTheDocument();
      expect(screen.getByText('See the methodology')).toBeInTheDocument();
    });
  });

  it('section has data-persona="default"', async () => {
    const { container } = renderHero();
    await waitFor(() => {
      const section = container.querySelector('section[data-persona]');
      expect(section?.getAttribute('data-persona')).toBe('default');
    });
  });
});

describe('PersonaAwareHero — forcePersona', () => {
  it('forcePersona="osint" renders the OSINT variant immediately', async () => {
    renderHero({ forcePersona: 'osint' });
    await waitFor(() => {
      expect(screen.getByText(/Skeptic reasoning/i)).toBeInTheDocument();
      expect(screen.getByText('For investigative work')).toBeInTheDocument();
    });
  });

  it('forcePersona="uap" renders the UAP variant', async () => {
    renderHero({ forcePersona: 'uap' });
    await waitFor(() => {
      expect(screen.getByText(/weak signals on the record/i)).toBeInTheDocument();
    });
  });

  it('forcePersona="academic" renders the academic variant', async () => {
    renderHero({ forcePersona: 'academic' });
    await waitFor(() => {
      expect(screen.getByText(/Citation-grade reports/i)).toBeInTheDocument();
      expect(screen.getByText(/Student plan/i)).toBeInTheDocument();
    });
  });

  it('forcePersona="patent" renders the patent variant', async () => {
    renderHero({ forcePersona: 'patent' });
    await waitFor(() => {
      expect(screen.getByText(/Non-consensus prior art/i)).toBeInTheDocument();
    });
  });
});

describe('PersonaAwareHero — analytics callback', () => {
  it('onPersonaResolved fires exactly once with the resolved persona and path', async () => {
    const cb = vi.fn();
    window.history.replaceState({}, '', '/?p=osint');
    renderHero({ onPersonaResolved: cb });
    await waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
    expect(cb).toHaveBeenCalledWith('osint', '/');
  });

  it('onPersonaResolved fires once even when forcePersona is set', async () => {
    const cb = vi.fn();
    renderHero({ forcePersona: 'patent', onPersonaResolved: cb });
    await waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
    expect(cb).toHaveBeenCalledWith('patent', '/');
  });
});

describe('PersonaAwareHero — URL query param routes to persona variant', () => {
  it('?p=academic surfaces the academic copy', async () => {
    window.history.replaceState({}, '', '/?p=academic');
    renderHero();
    await waitFor(() => {
      expect(screen.getByText(/Citation-grade reports/i)).toBeInTheDocument();
    });
  });
});
