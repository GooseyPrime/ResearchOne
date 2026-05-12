# Work Order V — Lab Notebook Visual Architecture and Persona-Adaptive Landing

**Goal.** Replace the static landing-page visual with a CSS-only lab-notebook ruled-paper aesthetic (muted blue horizontal ruling + muted red vertical margin against a near-black ground), enforce dark-mode typography discipline (off-white body text, +100 weight bump for legibility), and ship a persona-adaptive hero that switches copy based on inbound signals (UTM, referrer, query param, pathname) across the four Master Brief buyer tribes — OSINT/investigative journalism, UAP/paranormal disclosure, academic researchers, and patent/IP — plus a default variant that exactly matches today's hero copy character-for-character. Persona detection is 100% client-side and wire-silent (no fetch, no cookies, no fingerprinting); only the resolved persona id ever crosses the wire and only when the optional analytics endpoint is enabled. Composes cleanly with WO-W (animated multi-agent pipeline beams, which mount inside `LabNotebookCanvas` and read persona from React context) and is fully independent of WO-U (cost telemetry).

**Pre-work.** Read `.cursor/rules/00-pre-commit-review.mdc` (master checklist), `.cursor/rules/26-landing-persona-and-visual.mdc` (the ten invariants for this WO — I-1 wire-silent client-side resolution, I-2 persona id is the only thing that crosses the wire, I-3 default copy matches existing Hero character-for-character, I-5 lab notebook is CSS-only, I-6 contrast and weight non-negotiable, I-7 deterministic resolution, I-9 WO-W composition point, I-10 tests-must-fail-without-the-fix). Read `docs/WO-V_VISUAL_DESIGN_NOTES.md` for the rationale behind every color and weight choice — surface this when a designer pushes back. Read the Master Brief Section 5 (ICPs per tier) for the persona copy hooks. Existing files to read end-to-end before patching: `frontend/src/index.css` (lines 1–152, especially the existing `:root` block and the `.grid-bg` utility we're not removing), `frontend/tailwind.config.js` (lines 1–80 for the existing token palette and font stack), `frontend/src/pages/LandingPage.tsx` (247 lines — Hero is mounted at line 14ish), and `frontend/src/components/landing/Hero.tsx` (28 lines — the canonical copy source the default persona variant must match exactly).

**Dependencies.**
```bash
# Zero new packages. Everything ships with what's already in the repo.
# recharts, framer-motion, react-router-dom, @clerk/react, tailwindcss
# are all installed and used elsewhere.
#
# WO-W (animated pipeline) will add framer-motion-dependent components
# later, but framer-motion is already a frontend dep — no install
# required even then.
```

**Files to create.**

Cursor rule `.cursor/rules/26-landing-persona-and-visual.mdc`: ten invariants. Load-bearing are I-1 (no network calls in the resolver — grep enforces this in the pre-commit check), I-2 (persona id is the only field that crosses the wire to the optional analytics endpoint — no referrer, no UTM bag, no user id), I-3 (default copy matches Hero.tsx character-for-character — drift surfaces as a test failure on the existing-hero-copy assertion), I-5 (CSS-only lab notebook — no images, no base64, no SVG paths), I-6 (off-white body text at `#E0E0E0` on `#0A0E1A` for 13.5:1 contrast, never pure white on pure black per dark-mode typography research), I-7 (deterministic resolution — same inputs produce same persona every time), I-8 (sessionStorage cache TTL = browser session, no localStorage, no cross-tab sync), and I-9 (WO-W animated beams compose ON TOP of WO-V via React context — beam color palette per persona is WO-W's responsibility, not WO-V's).

Visual primitives `frontend/src/components/landing/visual/`:

- `labNotebookTokens.ts` — typed const map of canonical numeric tokens (`background`, `ruleHorizontal`, `ruleVertical`, `lineSpacingPx`, `marginPositionPx`, `lineThicknessPx`, `bodyText`, `headingText`, `mutedText`), with opacity ceilings flagged as TypeScript constants (`ruleHorizontalOpacityCeiling: 0.12`, `ruleVerticalOpacityCeiling: 0.20`) so downstream React components reading these values don't accidentally over-tune past the accessibility ceiling. Mirrored 1:1 with the `:root` CSS custom properties added in PATCH-V01.
- `LabNotebookCanvas.tsx` — thin React wrapper that applies the `.lab-notebook-canvas` className and provides a clean composition point for descendants. Accepts `children`, `className`, and `theme` (currently 'dark' only — light variant is out of scope). The wrapper does ZERO visual work itself; all the painting is in the CSS class added in PATCH-V01.

Persona primitives `frontend/src/components/landing/persona/`:

- `personaResolver.ts` — wire-silent, deterministic resolver. Exports `PERSONA_IDS` (the five canonical ids), `PersonaId` type, `isPersonaId` type guard, `resolvePersona(opts?)` with overrideable search/referrer/pathname/cache flags for tests, and `_clearPersonaCache` for test cleanup. Resolution priority (first match wins): query param (`?p=osint`), UTM bag (`utm_source` or `utm_campaign` matching tribe-specific keyword regexes), referrer host or distinctive subpath (`bellingcat.com` → osint, `/r/UFOs` → uap, `elicit.com` → academic, `patents.google.com` → patent), pathname routes (`/for/journalists` → osint, `/for/uap` → uap, etc.), then sessionStorage cache, then 'default' fallback. SSR-safe: when `window` is undefined returns 'default' without throwing.
- `personaContent.ts` — typed `HeroContent` interface (`eyebrow`, `headline`, `subhead`, `ctas`, optional `proofLine`) and a `Record<PersonaId, HeroContent>` map with five variants. The 'default' variant is locked to match Hero.tsx character-for-character. The four persona variants pull copy directly from the Master Brief Section 5 ICPs and the strategic doc's persona-specific copywriting frameworks.
- `PersonaAwareHero.tsx` — React component that wraps the existing Hero layout but pulls copy from `personaContent` keyed by the resolved persona. SSR-renders with default copy, re-resolves once on mount via `useEffect`. Carries `data-persona` attribute on the section element so WO-W's animations can read the persona from the DOM. Accepts optional `onPersonaResolved` callback (analytics fire-and-forget) and `forcePersona` override (A/B testing, persona-specific routes).

Optional backend `backend/src/api/routes/landing.ts` and migration `031_landing_persona_analytics.sql` (PATCH-V04, recommend deferring until WO-V has been live for two weeks). Append-only table with `persona` (enum-checked), `path` (truncated to 200 chars), `bucketed_at` (minute-truncated timestamp), `event_type` (enum: 'view' | 'cta_click'). No FK to users. POST endpoint validates against enums and silently 204s invalid persona ids so attackers can't probe the schema. Admin GET rollup endpoint mirrored after WO-U's cost endpoints (same `42P01` deploy-skew handling, same `adminQuery` path).

Tests:

- `frontend/src/__tests__/landing/personaResolver.test.ts` — tests every documented signal mapping (query param wins outright, UTM keyword matching, referrer host/path matching with malformed-URL fallthrough, pathname routes, determinism over 10 calls, sessionStorage cache hit and bypass, privacy invariants — `fetch` is never called and `document.cookie` is unchanged after resolve), SSR safety (returns 'default' when window is undefined without throwing). Every block ends with `// REVERT-CHECK:` per Rule 26 I-10.
- `frontend/src/__tests__/landing/PersonaAwareHero.test.tsx` — tests that the default-state DOM matches the existing Hero copy verbatim (the load-bearing assertion for Rule 26 I-3), that `data-persona` attribute carries the resolved id, that `forcePersona` overrides resolution, and that `onPersonaResolved` fires exactly once with the resolved id and the current path.

**Files to modify.**

`frontend/src/index.css` — PATCH-V01. Add eight new CSS custom properties to `:root` (`--r1-notebook-bg`, `--r1-notebook-rule-h`, `--r1-notebook-rule-v`, `--r1-notebook-line-spacing`, `--r1-notebook-margin-position`, `--r1-notebook-line-thickness`, `--r1-notebook-text-body`, `--r1-notebook-text-heading`). Add the `.lab-notebook-canvas` class to `@layer components` with the stacked `linear-gradient` + `repeating-linear-gradient` background, scoped typography color overrides for `h1/h2/h3/p/li`, the mobile media query that hides the vertical margin below 640px, and a `.no-ruling` opt-out class. Strictly additive — every existing class, property, and utility is preserved unchanged.

`frontend/tailwind.config.js` — PATCH-V02 (optional but recommended). Add a `notebook` sub-namespace under `theme.extend.colors` with the same color values as the CSS variables. Strictly additive — no existing tokens modified.

`frontend/src/pages/LandingPage.tsx` — PATCH-V03. Two import changes (`PersonaAwareHero` replaces `Hero`, `LabNotebookCanvas` is new), and the outer `<div>` is replaced with `<LabNotebookCanvas>` carrying the same className. Zero other component changes — `LandingHeader`, `EvidenceProvenancePanel`, `WhyResearchOne`, `ComparisonTable`, `FAQ`, `FinalCTA`, etc. all render unchanged.

`frontend/src/components/landing/Hero.tsx` — **NO CHANGES.** Per Rule 26 I-3, the existing Hero is the canonical default-copy source. It stays in the tree as a fallback path; PersonaAwareHero re-imports its layout shape. If `PersonaAwareHero` is ever rolled back via the one-line LandingPage import revert, Hero is immediately re-active without any other change.

`backend/src/api/app.ts` — PATCH-V04 only (deferred). Mount the landing route at `/api/landing` with rate-limiting middleware. Skip this entirely if you defer the analytics endpoint.

**Acceptance criteria.**

- A visitor lands at `/` with no UTM, no referrer, no query param — sees the existing default Hero copy ("Built for serious research" / "Deep research that defends itself." / etc.) character-for-character. The two CTAs are unchanged. The page DOES use the new lab-notebook background — muted blue horizontal ruling every 40px, faint red vertical line at 80px from the left, off-white body text at `#E0E0E0`. Body typography is weight 500; headings are 600.
- A visitor at `/?p=osint` sees: eyebrow "For investigative work", headline "Adversarial reasoning for stories that don't survive consensus.", subhead about Skeptic agent and contradictions-as-data, primary CTA "See the Investigative mode", proof line about PolicyOne. `data-persona="osint"` on the section element.
- A visitor at `/?p=uap` sees: eyebrow "For non-consensus research", headline "A research engine that doesn't suppress the anomaly.", primary CTA to anomaly-correlation sample.
- A visitor at `/?p=academic` sees: eyebrow "For literature work that has to hold up", headline "Citation-grade synthesis without the hallucinated bibliography.", primary CTA "Student plan — $9/mo".
- A visitor at `/?p=patent` sees: eyebrow "For prior-art work that catches what others miss", primary CTA "See a Patent Gap report".
- A visitor coming in from `https://www.reddit.com/r/UFOs/comments/abc/...` with no query param sees the UAP variant.
- A visitor with `?utm_source=reddit&utm_campaign=osint_research_tools` sees the OSINT variant.
- A visitor at `/?p=garbage` sees the default variant — invalid query param falls through to other signals (and ultimately default) without crashing.
- The same visitor navigates from `/` to `/pricing` then back to `/` — sees the same persona variant on return (sessionStorage cache).
- The visitor opens a new tab to `/` — sees the default variant (sessionStorage is per-tab; new tab has empty referrer).
- DevTools Network tab during persona resolve: zero outbound requests (Rule 26 I-1). DevTools Application → Cookies: unchanged after resolve.
- On a 1920×1080 desktop: red margin visible at 80px, horizontal ruling visible every 40px, both subtle enough that headline and body copy dominate visually.
- On a 375×667 mobile: red margin NOT visible (hidden under 640px breakpoint), horizontal ruling still visible.
- A11y axe scan of `/` reports zero new violations. Body-text contrast on `.lab-notebook-canvas` measures 13.5:1 (well above WCAG AAA 7:1).
- Print preview of `/` — the operator can add `.no-ruling` class manually to strip the ruling for clean PDF capture if needed.
- If PATCH-V04 is shipped: a visitor hitting `/?p=osint` produces one row in `landing_persona_events` with `persona='osint'`, `path='/'`, `bucketed_at` rounded to the minute. No referrer string, no user id, nothing else. Admin endpoint `/admin/landing/persona-rollup?days=7` aggregates correctly.

**Tests required (must fail without the fix).**

- `personaResolver.test.ts:query param wins outright` — asserts `?p=osint` returns `'osint'` even when referrer is Bellingcat (which would also resolve OSINT, but via a different code path). **Must fail if** the early `return` after `fromQueryParam()` is removed (resolution would then fall through to referrer matching, which still gives osint here — but tests downstream like `?p=uap` with a Bellingcat referrer expecting `uap` would fail).
- `personaResolver.test.ts:?p=uap overrides referrer that would resolve to osint` — the specific load-bearing assertion for the priority-order invariant. **Must fail if** referrer evaluation runs before query param.
- `personaResolver.test.ts:malformed referrer falls through silently` — passes `'not a url'` and asserts the resolver returns 'default' without throwing. **Must fail if** the `try { new URL(referrer) } catch` block is replaced with a non-catching `new URL`.
- `personaResolver.test.ts:no fetch is called during resolution` — spies on `global.fetch` and asserts zero invocations across a resolve that uses every signal type. **Must fail if** any code path adds a fetch (Rule 26 I-1 regression).
- `personaResolver.test.ts:no cookie is set` — snapshots `document.cookie` before and after a resolve and asserts they're identical. **Must fail if** the resolver writes to cookies (would be a Rule 26 I-1 violation).
- `personaResolver.test.ts:SSR safety` — deletes `globalThis.window` and asserts `resolvePersona()` returns 'default' without throwing. **Must fail if** the `typeof window === 'undefined'` guard is removed.
- `personaResolver.test.ts:determinism` — calls `resolvePersona` 10 times with identical inputs and asserts all 10 return the same id. **Must fail if** a non-deterministic input source (e.g. `Math.random()`-based bucket) is introduced.
- `personaResolver.test.ts:session cache` — sets cache via first call, then calls again with no signals and asserts cached value returns. **Must fail if** the sessionStorage read branch is removed (Rule 26 I-8 regression).
- `PersonaAwareHero.test.tsx:default state matches existing Hero copy` — asserts the rendered DOM contains the exact strings from current Hero.tsx. **Must fail if** `personaContent.default` drifts from Hero.tsx (Rule 26 I-3 regression). The test serves as a tripwire — a designer editing Hero.tsx without updating personaContent will break this test.
- `PersonaAwareHero.test.tsx:data-persona attribute` — asserts `section[data-persona="default"]` is in the DOM for the default state. **Must fail if** the attribute is removed (Rule 26 I-9 composition contract violated, WO-W's beams can't read the persona).
- `PersonaAwareHero.test.tsx:onPersonaResolved fires exactly once` — calls the component with a `vi.fn()` callback and asserts call count is 1. **Must fail if** the `useEffect` dependency array is widened to cause re-fires.

**Critical reminders.**

1. **Hero.tsx stays in the codebase.** Per Rule 26 I-3, it is the canonical copy source for the 'default' variant. Do not delete it even though `LandingPage.tsx` no longer imports it — it serves as the rollback path AND as the diff target for the must-fail-without-the-fix copy-parity test. If you find yourself editing Hero.tsx, you must update `personaContent.ts:default` in the same commit, and vice versa.
2. **The resolver makes no network calls.** Per Rule 26 I-1, the pre-commit grep is `grep -rn "fetch\\|XMLHttpRequest\\|axios" frontend/src/components/landing/persona/` and must return zero hits. If you ever feel the urge to "just enrich the persona detection with a server-side lookup," that's the urge to violate the rule — push back on the requirement instead.
3. **Persona id is the ONLY thing that crosses the wire.** Per Rule 26 I-2. The backend analytics writer validates against an enum and silent-204s anything else (no echo, no logging the bad value at INFO — only DEBUG). Do not be tempted to add "just one more field" — referrer, UTM, fingerprint, even a region code derived from `Accept-Language` — each is a surveillance vector that contradicts PolicyOne.
4. **Adding a new persona requires three coordinated edits in one commit.** Resolver detection rules, content variant, tests. Rule 26 I-7 makes determinism a property of the resolver, but the integration as a whole only stays consistent if all three move together. The pre-commit check enforces this via grep.
5. **Lab-notebook is CSS-only.** Per Rule 26 I-5, do not introduce an SVG ruling, do not preload a paper-texture image, do not generate a background via canvas API. The performance and tunability properties of the gradient approach (documented in `WO-V_VISUAL_DESIGN_NOTES.md`) are load-bearing.
6. **Opacity ceilings are enforced.** Per Rule 26 I-6, ceilings live in `labNotebookTokens.ts` as TypeScript constants. If a designer asks for darker ruling, point them at the contrast check page (`/landing-contrast-check.html`, dev only) and verify ≥ 7:1 before merging. The default values are tuned conservatively because reading speed is the more expensive resource to spend than visual presence.
7. **Composition with WO-W is a one-way contract: WO-V provides, WO-W consumes.** Per Rule 26 I-9, the persona id is exposed via `data-persona` on the section and via the `onPersonaResolved` callback. WO-W's beams read whichever. Do NOT bake beam color palettes into `personaContent.ts` — content is words, animations are visuals, they evolve at different cadences.
8. **The default copy is the rollback path.** If anything goes wrong with persona detection in production (a tab gets the wrong variant, a CTA points at the wrong route, the copy renders unstyled), the worst case is that all traffic falls through to the default variant — which is the existing copy. Rule 26 I-3 makes this guarantee load-bearing: the default is what every Cursor PR review should compare against to confirm "if persona detection completely failed, this page still works."

**Effort estimate.** 2.5 days for one engineer. CSS layer + Tailwind tokens + LabNotebookCanvas + design notes is 0.5 day. Persona resolver + content map + tests is 1 day. PersonaAwareHero + LandingPage wiring + component tests is 0.5 day. PATCH-V04 backend analytics (optional, can defer) is 0.5 day. Add 0.5 day for cross-browser visual QA at desktop and mobile breakpoints, plus the dev tooling for the `/landing-contrast-check.html` page if you choose to ship it.

**Sequencing.** Land PATCH-V01 (CSS) and PATCH-V02 (Tailwind) in deploy 1 — purely additive, no visual change to live pages yet because nothing uses `.lab-notebook-canvas` yet. Land the visual + persona modules + tests in deploy 2 — still no visual change because `LandingPage.tsx` isn't wired yet. Land PATCH-V03 (LandingPage import swap and canvas wrap) in deploy 3 — this is the live change. Defer PATCH-V04 (backend analytics) until two weeks of WO-V live traffic confirms the persona resolver fires correctly for real inbound — at that point the analytics deploys against a known-correct signal source.

Hard dependencies: none. Soft dependencies: WO-W will consume `data-persona` from this WO's `PersonaAwareHero` to color animated beams per persona. WO-U is fully independent — cost telemetry doesn't touch the landing.
