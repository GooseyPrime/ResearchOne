/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
/**
 * PersonaAwareHero — component tests.
 *
 * Asserts:
 *   - Default copy matches the existing Hero.tsx (rule 26 I-3).
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

describe('PersonaAwareHero — default state matches existing Hero copy', () => {
  it('renders the existing eyebrow / headline / subhead verbatim', async () => {
    renderHero();
    await waitFor(() => {
      expect(screen.getByText('Built for serious research')).toBeInTheDocument();
      expect(screen.getByText('Deep research that defends itself.')).toBeInTheDocument();
      expect(
        screen.getByText(/Five deep research modes\. A ten-stage multi-agent pipeline/)
      ).toBeInTheDocument();
    });
    // REVERT-CHECK: personaContent.ts:default — if this drifts from
    // Hero.tsx the test fails. Rule 26 I-3 violation surfaces here.
  });

  it('renders the two existing default CTAs', async () => {
    renderHero();
    await waitFor(() => {
      expect(screen.getByText('Start free')).toBeInTheDocument();
      expect(screen.getByText('See a sample report')).toBeInTheDocument();
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
      expect(screen.getByText(/Adversarial reasoning/i)).toBeInTheDocument();
      expect(screen.getByText('For investigative work')).toBeInTheDocument();
    });
  });

  it('forcePersona="uap" renders the UAP variant', async () => {
    renderHero({ forcePersona: 'uap' });
    await waitFor(() => {
      expect(screen.getByText(/research engine that doesn/i)).toBeInTheDocument();
    });
  });

  it('forcePersona="academic" renders the academic variant', async () => {
    renderHero({ forcePersona: 'academic' });
    await waitFor(() => {
      expect(screen.getByText(/Citation-grade synthesis/i)).toBeInTheDocument();
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
      expect(screen.getByText(/Citation-grade synthesis/i)).toBeInTheDocument();
    });
  });
});
