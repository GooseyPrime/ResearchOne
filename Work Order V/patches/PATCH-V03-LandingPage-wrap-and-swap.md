# PATCH V03 — `LandingPage.tsx`: wrap in `LabNotebookCanvas`, swap Hero for `PersonaAwareHero`

**File:** `frontend/src/pages/LandingPage.tsx`
**Why:** Mount the lab-notebook visual + persona-adaptive hero on the
public landing.

**Behavioral guarantee:** When a visitor arrives without persona
signals, `PersonaAwareHero` renders the existing default copy
character-for-character (Rule 26 I-3). The lab-notebook background
is purely visual — no JS, no layout shift. Net change for default
visitors: a more refined background and unchanged copy.

---

## Step 1 — Imports

Find the existing import block (lines 1–13). Replace:

```ts
import Hero from '../components/landing/Hero';
```

**with:**

```ts
import PersonaAwareHero from '../components/landing/persona/PersonaAwareHero';
import LabNotebookCanvas from '../components/landing/visual/LabNotebookCanvas';
```

(Leave the rest of the imports untouched. Hero.tsx remains in the
codebase — it is the canonical copy source. Per Rule 26 I-3, drift
between Hero.tsx and personaContent.default would be a code-review
fail.)

## Step 2 — Wrap the page body in `<LabNotebookCanvas>`

Find the page's return statement. The current shape is:

```tsx
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <Hero />
      {/* ... rest of sections ... */}
      <LandingFooter />
    </div>
  );
}
```

(Note: the actual class on the outer div may vary — read the file end-to-end
per Cursor rule 00 before patching.)

**Change to:**

```tsx
export default function LandingPage() {
  return (
    <LabNotebookCanvas className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <PersonaAwareHero />
      {/* ... rest of sections unchanged ... */}
      <LandingFooter />
    </LabNotebookCanvas>
  );
}
```

The `LabNotebookCanvas` renders as a `<div>` with the canvas class
applied — so the existing layout chain (`min-h-screen bg-r1-bg
text-r1-text`) still composes correctly. The `bg-r1-bg` is preserved
as a fallback color in case the canvas class fails to load (e.g. CSS
errored mid-deploy).

## Step 3 — Optional: gate behind a feature flag

For initial rollout, you may want to A/B the new visual against the
current. Wrap the swap behind a runtime check on a URL param or
environment variable:

```tsx
const useLabNotebook = new URLSearchParams(window.location.search).get('visual') !== 'classic';
return useLabNotebook ? (
  <LabNotebookCanvas>...</LabNotebookCanvas>
) : (
  <div className="min-h-screen bg-r1-bg text-r1-text">...</div>
);
```

**Recommendation:** ship without the gate. The lab-notebook background
is universally additive — operators reaching for `?visual=classic` are
the long tail and can use it for forensic comparison if needed. The
gate is more code surface to maintain than the rollback path it
saves.

## Step 4 — Verify

```bash
cd frontend
npx tsc --noEmit
npm run build
```

Then visually:

1. Visit `/` — confirm the new background renders. Headlines and body
   copy unchanged.
2. Visit `/?p=osint` — confirm the eyebrow changes to "For
   investigative work", headline shifts to "Adversarial reasoning...".
3. Visit `/?p=uap` — UAP copy.
4. Visit `/?p=academic` — academic copy with `$9/mo` CTA.
5. Visit `/?p=patent` — patent copy.
6. Visit `/?p=garbage` — falls through to default copy. Page renders
   normally.
7. Open DevTools Network tab — confirm no extra HTTP request is fired
   on persona resolution (Rule 26 I-1).
8. Open Application → Session Storage — confirm `r1.persona` is set
   after the first visit with a recognized signal, NOT set without
   one.

## Rollback

If the lab-notebook rendering breaks on a specific browser (we've
tested Chrome / Safari / Firefox; legacy Edge < 79 is unsupported),
revert this single file. The canvas wrapper falls back to a plain
`<div>` losing only the ruled-paper visual; copy and layout remain.

If the persona variants surface an unintended copy issue, swap
`<PersonaAwareHero />` back to `<Hero />` (one line). The persona
modules remain in the codebase, off-render.
