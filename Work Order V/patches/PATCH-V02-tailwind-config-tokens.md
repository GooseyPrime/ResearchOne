# PATCH V02 — `tailwind.config.js`: optional notebook-text tokens

**File:** `frontend/tailwind.config.js`
**Why:** Make the notebook off-white body color and heading color
available as Tailwind utility classes (`text-notebook-body`,
`text-notebook-heading`) so component code can reference them without
inline styles. Strictly additive — does not change any existing token.

**Behavioral guarantee:** Zero impact on existing components. Only
adds two new color names under `colors.notebook.*`.

---

## Step 1 — Add `colors.notebook.*` to the theme extension

Find the existing `colors` block (lines 7–43). The block currently
ends with `r1-accent-deep`:

```js
colors: {
  // Dark theme palette
  surface: { ... },
  accent: { ... },
  research: { ... },
  tier: { ... },
  'r1-bg': '#0A0E1A',
  'r1-bg-deep': '#060912',
  'r1-text': '#F5F7FA',
  'r1-text-muted': '#94A3B8',
  'r1-accent': '#5BCEFA',
  'r1-accent-deep': '#3AA8E0',
},
```

**Add a `notebook` sub-namespace** at the end of the colors block:

```js
colors: {
  // ... existing colors unchanged ...
  'r1-accent': '#5BCEFA',
  'r1-accent-deep': '#3AA8E0',

  // Lab Notebook tokens — WO-V.
  // Synchronized with index.css :root and labNotebookTokens.ts.
  notebook: {
    bg:       '#0A0E1A',
    body:     '#E0E0E0',
    heading:  '#F0F2F5',
    muted:    '#94A3B8',
    'rule-h': 'rgba(140, 171, 217, 0.08)',
    'rule-v': 'rgba(167, 51, 43, 0.15)',
  },
},
```

## Step 2 — Verify

```bash
cd frontend
npm run build
```

Then in a component:

```tsx
<p className="text-notebook-body">test</p>
<h1 className="text-notebook-heading">test</h1>
```

Both should compile and render at the expected colors. If Tailwind
fails to pick up the new namespace, double-check the placement is
inside `theme.extend.colors` — putting it under `theme.colors`
(without `extend`) would wipe the entire color palette.

## Why this patch is small

Most of the lab-notebook visual work happens via the CSS class
`.lab-notebook-canvas` (PATCH-V01), which sets `color` on the
descendants automatically via the cascade. The Tailwind tokens added
here are convenience only — for components that want to override the
canvas's defaults explicitly (e.g. a contradiction badge that must use
its own warning color regardless of canvas context).

If you find yourself reaching for `text-notebook-body` constantly,
that's a sign you forgot to wrap a section in `<LabNotebookCanvas>`.
The canvas should set the defaults; utility classes are for exceptions.
