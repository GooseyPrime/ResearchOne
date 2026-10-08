/** @vitest-environment jsdom */
/**
 * ResearchOne sells Free Demo, Student, Pro, BYOK and wallet credits. It does
 * not sell a Team plan, seats, a Sovereign or Enterprise plan, or the Devil's
 * Advocate review, and it has no sales desk. This is the gate that keeps those
 * offers from coming back: it fails on any text a visitor or customer can read
 * that names one of them, and on any address at intellme.com.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { removedOffersIn, scanPublishedFiles, scanRemovedOffers } from './removedOffersScan';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: async () => null }),
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
  useClerk: () => ({ signOut: async () => undefined }),
  SignedIn: () => null,
  SignedOut: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignIn: () => null,
  SignUp: () => null,
  UserButton: () => null,
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

const SRC = join(__dirname, '../..');
const FRONTEND = join(SRC, '..');
const REPO = join(FRONTEND, '..');

/**
 * Text that uses one of the words without offering anything. Each entry is a
 * file and the phrase that makes it an exception; anything else in that file
 * is still checked.
 */
const ALLOWED: Array<{ file: string; phrase: RegExp; why: string }> = [
  { file: 'App.tsx', phrase: /^\/sovereign$/, why: 'the old address, kept only so it can send its visitors to /pricing' },
];
const allowedFor = (file: string): RegExp[] => ALLOWED.filter((entry) => entry.file === file).map((entry) => entry.phrase);

/** The hosting files keep the old address for one reason: to redirect it. */
const REDIRECT_LINE = /"source": "\/sovereign", "destination": "\/pricing"/;

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'offers-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}
const lines = (...text: string[]): string => text.join('\n');
const found = (dir: string): string[] => scanRemovedOffers(dir).map((hit) => `${hit.line} ${hit.word}`);
const names = (text: string): string[] => removedOffersIn(text).map((hit) => hit.word);

describe('the removed-offers gate', () => {
  it('finds no Team, seat, Sovereign, Enterprise, sales, Devil’s Advocate or intellme.com text anywhere in the app', () => {
    expect(scanRemovedOffers(SRC, allowedFor).map((hit) => `${hit.file}:${hit.line} [${hit.word}] ${hit.text}`)).toEqual([]);
  });

  it('finds none in the sitemap (which is also the prerender list), the page shell, robots.txt or the hosting files', () => {
    const published = [
      join(FRONTEND, 'public/sitemap.xml'),
      join(FRONTEND, 'public/robots.txt'),
      join(FRONTEND, 'index.html'),
      join(FRONTEND, 'vercel.json'),
      join(REPO, 'vercel.json'),
    ];
    for (const path of published.slice(0, 3)) expect(existsSync(path), path).toBe(true);
    expect(scanPublishedFiles(published, [REDIRECT_LINE]).map((hit) => `${hit.file}:${hit.line} [${hit.word}] ${hit.text}`)).toEqual([]);
  });

  it('every allowed exception is still there, so the list cannot hide a deleted file or a fixed line', () => {
    const hits = scanRemovedOffers(SRC);
    for (const allowed of ALLOWED) {
      expect(hits.some((hit) => hit.file === allowed.file), `${allowed.file}: ${allowed.why}`).toBe(true);
    }
  });

  it('names each removed offer', () => {
    expect(names('Team')).toEqual(['Team plan']);
    expect(names('Add-ons require an active Pro, BYOK, Team, or Sovereign subscription.')).toEqual(['Team plan', 'Sovereign']);
    expect(names('$99/seat/mo (3-seat min) — 80 reports/seat pooled — team library, SSO')).toEqual(['/seat', 'seats', '/seat', 'Team plan']);
    expect(names('Add team seats at any time, billed per seat.')).toEqual(['team seat', 'per seat']);
    expect(names('Five seats included')).toEqual(['seats']);
    expect(names('Sovereign Enterprise')).toEqual(['Sovereign', 'Enterprise']);
    expect(names('Coming soon — Enterprise')).toEqual(['Enterprise']);
    expect(names('governed by a separate enterprise agreement')).toEqual(['Enterprise']);
    expect(names('Talk to sales')).toEqual(['Talk to sales']);
    expect(names("Devil's Advocate Review: Included in Sovereign")).toEqual(["Devil's Advocate", 'Sovereign']);
    expect(names('Devil’s Advocate')).toEqual(["Devil's Advocate"]);
    expect(names('mailto:sales@intellme.com')).toEqual(['intellme.com']);
    expect(names('https://api.intellme.com/v1')).toEqual(['intellme.com']);
  });

  it('leaves ordinary words and our own domain alone', () => {
    expect(names('mailto:brandon@intellmeai.com')).toEqual([]);
    expect(names('nothing silently rewrites the version your team already agreed on')).toEqual([]);
    expect(names('Agent team')).toEqual([]);
    expect(names('Stanford STORM project team, methodology page.')).toEqual([]);
    expect(names('Pro or BYOK')).toEqual([]);
  });

  it('reads visible text, labels and link targets, and passes over tier keys and identifiers', () => {
    const dir = tree({
      'pages/Bad.tsx': lines(
        "const TIERS = ['pro', 'team', 'byok', 'sovereign'] as const;",
        "export function Bad({ tier, teamSeatCount }: { tier: string; teamSeatCount: number }) {",
        "  const isTeam = tier === 'team' || tier === 'sovereign';",
        '  return (',
        '    <div className="team-card" data-testid="sovereign">',
        '      <PricingCard title="Team" cta="Talk to sales" to="/sovereign" />',
        '      <p>Billed per seat. {teamSeatCount} {isTeam ? TIERS.length : 0}</p>',
        '      <a href="mailto:sales@intellme.com">Write to us</a>',
        '      <a href="mailto:brandon@intellmeai.com">Write to us</a>',
        '    </div>',
        '  );',
        '}'
      ),
      'content/nav.ts': lines(
        "export const links = [{ to: '/sovereign', label: 'Pricing' }];",
        "export const card = { metric: 'BYOK · Sovereign', inquiryMailto: 'mailto:hello@intellme.com' };"
      ),
    });
    expect(found(dir).sort()).toEqual(
      ['1 Sovereign', '2 Sovereign', '2 intellme.com', '6 Sovereign', '6 Talk to sales', '6 Team plan', '7 per seat', '8 intellme.com'].sort()
    );
  });
});

describe('the pricing page', () => {
  it('lists the plans that are sold and nothing else', async () => {
    const { default: PricingPage } = await import('../../pages/PricingPage');
    // Rendered to a string: the page as it is served, before the browser asks the server anything.
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PricingPage />
      </MemoryRouter>
    );
    expect(removedOffersIn(html).map((hit) => hit.word)).toEqual([]);
    expect(html).toContain('Add-ons require an active Pro or BYOK subscription.');
    expect([...html.matchAll(/<h[23][^>]*>([^<]+)</g)].map((match) => match[1]).slice(0, 4)).toEqual(['Free Demo', 'Student', 'Pro', 'BYOK']);
    expect([...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]).filter((href) => /sovereign|intellme\.com|team/i.test(href))).toEqual([]);
  });
});

describe('the old /sovereign address', () => {
  it('sends its visitor to the pricing page', async () => {
    const { AppRoutes } = await import('../../App');
    function Where() {
      return <output data-testid="where">{useLocation().pathname}</output>;
    }
    render(
      <MemoryRouter initialEntries={['/sovereign']}>
        <AppRoutes />
        <Where />
      </MemoryRouter>
    );
    expect(screen.getByTestId('where').textContent).toBe('/pricing');
  });

  it('is not in the header or footer navigation', async () => {
    const { MARKETING_FOOTER_LINKS } = await import('../../lib/marketingNav');
    const { footerNavSections } = await import('../../content/researchoneUiData');
    const all = JSON.stringify([MARKETING_FOOTER_LINKS, footerNavSections]);
    expect(all).not.toMatch(/sovereign/i);
    const { default: LandingFooter } = await import('../../components/landing/LandingFooter');
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LandingFooter />
      </MemoryRouter>
    );
    expect(removedOffersIn(html).map((hit) => hit.word)).toEqual([]);
  });
});
