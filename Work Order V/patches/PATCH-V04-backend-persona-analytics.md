# PATCH V04 — Optional: backend persona analytics endpoint

**Files (new):**
- `backend/src/db/migrations/031_landing_persona_analytics.sql`
- `backend/src/api/routes/landing.ts`

**File (modify):**
- `backend/src/api/app.ts` (mount the route)

**Status:** **OPTIONAL** for the initial WO-V rollout. The
`PersonaAwareHero` component accepts an `onPersonaResolved` callback;
if you don't wire up this endpoint, persona detection still works on
the frontend — there's just no aggregate visibility into which
personas are converting. Recommend deferring until WO-V has been
live for two weeks and the operations team wants the data.

**Why this patch exists at all:** the Master Brief identifies four
buyer tribes with materially different conversion economics. Knowing
which tribe is most responsive lets us reallocate Reddit / NICAR /
RJI outreach effort. Per Cursor rule 26 I-2, the analytics writes
ONLY a persona id + path + bucketed timestamp — no PII, no referrer
text, no user identifier.

---

## Step 1 — Migration `031_landing_persona_analytics.sql`

```sql
-- Migration 031: Landing persona analytics.
-- See: .cursor/rules/26-landing-persona-and-visual.mdc (I-2)
-- See: docs/ResearchOne - Work Order V.md
--
-- Append-only. No FK to users. No referrer string. No user id.
-- Records (persona, path, minute) only. Per Rule 26 I-2.
--
-- Idempotent: IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS landing_persona_events (
  id            BIGSERIAL PRIMARY KEY,
  persona       TEXT NOT NULL CHECK (persona IN ('osint','uap','academic','patent','default')),
  path          TEXT NOT NULL,
  -- Bucketed to the minute so aggregates can be computed without
  -- exposing individual visit timing. NOW() truncated to minute on
  -- insert via the trigger below.
  bucketed_at   TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', NOW()),
  -- Optional event type — 'view' is current; future could add
  -- 'cta_click' for in-page tracking. Keep enum tight.
  event_type    TEXT NOT NULL DEFAULT 'view' CHECK (event_type IN ('view','cta_click'))
);

CREATE INDEX IF NOT EXISTS idx_landing_persona_events_persona_time
  ON landing_persona_events(persona, bucketed_at DESC);
CREATE INDEX IF NOT EXISTS idx_landing_persona_events_path
  ON landing_persona_events(path);

COMMENT ON TABLE landing_persona_events IS
  'Append-only persona analytics. Per Cursor rule 26 I-2, NO PII or '
  'user-identifying fields. Bucketed to the minute. No FK to users.';
```

## Step 2 — Route `backend/src/api/routes/landing.ts`

```ts
import { Router } from 'express';
import { adminQuery } from '../../db/pool';
import { logger } from '../../utils/logger';

const router = Router();

const VALID_PERSONAS = new Set(['osint', 'uap', 'academic', 'patent', 'default']);
const VALID_EVENT_TYPES = new Set(['view', 'cta_click']);

/**
 * POST /api/landing/persona-event
 *
 * Body: { persona: PersonaId, path: string, eventType?: 'view'|'cta_click' }
 *
 * No auth — landing analytics fires from anonymous visitors. Rate
 * limited via the existing express-rate-limit middleware applied at
 * mount time.
 *
 * Per Cursor rule 26 I-2: validates persona against an enum (no
 * free-text writes). Validates eventType against an enum. Truncates
 * path to 200 chars defensively.
 */
router.post('/persona-event', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const persona = String(body.persona ?? '').toLowerCase();
    const path = String(body.path ?? '/').slice(0, 200);
    const eventType = String(body.eventType ?? 'view').toLowerCase();

    if (!VALID_PERSONAS.has(persona)) {
      // Silent reject — do not echo the bad value, do not 400 — we
      // do not want to give attackers a probe surface for our enum.
      // The frontend should not send invalid values; if it does, log
      // at DEBUG and return 204 so the request silently no-ops.
      logger.debug('persona-event: invalid persona, dropping', { persona });
      res.status(204).end();
      return;
    }
    if (!VALID_EVENT_TYPES.has(eventType)) {
      res.status(204).end();
      return;
    }

    await adminQuery(
      `INSERT INTO landing_persona_events (persona, path, event_type)
       VALUES ($1, $2, $3)`,
      [persona, path, eventType]
    );

    res.status(204).end();
  } catch (err) {
    // 42P01 deploy-skew tolerance — return 204 so the frontend doesn't
    // see an error.
    if ((err as { code?: string })?.code === '42P01') {
      res.status(204).end();
      return;
    }
    next(err);
  }
});

/**
 * GET /api/admin/cost/persona-rollup
 *
 * Admin-only — but this route file does NOT require admin auth at the
 * router level because the POST is public. Move this read endpoint to
 * `admin.ts` for proper guarding, OR mount with `requireAdmin` here.
 * See PATCH-V04 Step 4 for the proper wiring.
 */

export default router;
```

## Step 3 — Frontend wiring

In `LandingPage.tsx`, pass an analytics callback to `PersonaAwareHero`:

```tsx
import PersonaAwareHero from '../components/landing/persona/PersonaAwareHero';
import api from '../utils/api';

export default function LandingPage() {
  return (
    <LabNotebookCanvas className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <PersonaAwareHero
        onPersonaResolved={(persona, path) => {
          // Fire-and-forget. Errors swallowed.
          api.post('/landing/persona-event', { persona, path, eventType: 'view' })
            .catch(() => { /* analytics failures must not surface */ });
        }}
      />
      {/* ... */}
    </LabNotebookCanvas>
  );
}
```

## Step 4 — Mount the route in `backend/src/api/app.ts`

Find the existing route mounts (search for `app.use('/api`). Add:

```ts
import landingRouter from './routes/landing';

// Public landing analytics — rate limited, no auth, validates enums
// strictly (Rule 26 I-2). Place AFTER auth middleware so any
// authenticated visitor has their session loaded, but BEFORE any
// requireAuth guard.
app.use('/api/landing', expressRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
}), landingRouter);
```

(The exact rate-limit middleware import depends on the existing
patterns in `app.ts` — read end-to-end first per Cursor rule 00. The
project already uses `express-rate-limit`.)

## Step 5 — Admin endpoint for the rollup view (optional, in `admin.ts`)

Add to `backend/src/api/routes/admin.ts` (the file the cost endpoints
also live in, post-PATCH-07):

```ts
// ─── Persona conversion rollup ─────────────────────────────────────
router.get('/landing/persona-rollup', async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await adminQuery<{
      persona: string;
      view_count: string;
      cta_click_count: string;
    }>(
      `SELECT
         persona,
         COUNT(*) FILTER (WHERE event_type='view')::text       AS view_count,
         COUNT(*) FILTER (WHERE event_type='cta_click')::text  AS cta_click_count
       FROM landing_persona_events
       WHERE bucketed_at >= $1
       GROUP BY persona
       ORDER BY view_count::bigint DESC`,
      [since.toISOString()]
    );

    res.json({
      available: true,
      days,
      personas: rows.map((r) => ({
        persona: r.persona,
        viewCount: Number(r.view_count),
        ctaClickCount: Number(r.cta_click_count),
      })),
    });
  } catch (err) {
    if ((err as { code?: string })?.code === '42P01') {
      res.json({ available: false, reason: 'migration_pending', personas: [] });
      return;
    }
    next(err);
  }
});
```

This is the admin surface for the persona conversion data. Same
deploy-skew tolerance, same auth path as the cost endpoints.

## Verify

```bash
cd backend && npx tsc --noEmit && npx vitest run
cd frontend && npx tsc --noEmit && npm run build
```

Smoke: visit `/?p=osint` in a browser, then check the DB:

```bash
psql -c "SELECT persona, COUNT(*) FROM landing_persona_events GROUP BY persona;"
```

Expected: one row with `persona='osint'`, `count=1`.

## Acceptance test consequence (post-merge)

After running for one week with real traffic, query:

```sql
SELECT persona, COUNT(*) FROM landing_persona_events
 WHERE bucketed_at > NOW() - INTERVAL '7 days'
 GROUP BY persona ORDER BY COUNT(*) DESC;
```

If `default` is >95% of all rows, the persona detection is not firing
for most inbound — investigate the resolver against real referrer
strings the team is seeing in server access logs.

If one persona is >50% (e.g. UAP heavily over-represented), the
Master Brief's outreach mix is producing concentrated traffic from
that community — reallocate budget accordingly.
