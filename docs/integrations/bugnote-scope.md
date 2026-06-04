# BugNote integration scope

Minimal, env-gated feedback and error-reporting integration with
[BugNote](https://bugnote.io). **Widget script URL, global SDK method
names, webhook event schema, and signature header are unverified** until
BugNote workspace documentation is provided — treat Phase A as a stub
that logs and no-ops safely when disabled.

## Environment variables

| Variable | Surface | Purpose |
|----------|---------|---------|
| `VITE_BUGNOTE_ENABLED` | Frontend (Vercel) | Must be exactly `true` to load the widget |
| `VITE_BUGNOTE_WIDGET_URL` | Frontend (Vercel) | Full HTTPS URL of the BugNote embed script |
| `BUGNOTE_WEBHOOK_SECRET` | Backend (Emma) | HMAC secret for inbound webhook verification |

When `VITE_BUGNOTE_ENABLED` is unset or not `true`, or
`VITE_BUGNOTE_WIDGET_URL` is blank, the SPA does not inject any BugNote
script. When `BUGNOTE_WEBHOOK_SECRET` is unset, the webhook accepts POST
bodies without signature verification (development only — set the secret
in production).

## API contract status

**Unverified** (2026-06-04). Assumptions used in Phase A code:

- Widget exposes a global `window.BugNote` with optional `identify`,
  `capture`, or `captureException` methods.
- Outbound webhooks POST JSON to `POST /api/webhooks/bugnote` with an
  `X-BugNote-Signature` header (HMAC-SHA256 hex digest of the raw body,
  optional `sha256=` prefix — same shape as Parallel Monitor until docs
  say otherwise).
- Event payload includes top-level `type` or `event` and optional `id`.

Reconcile header name, digest algorithm, and payload fields against
BugNote docs before Phase B ships to production.

## Content Security Policy (Vercel)

`vercel.json` adds placeholder allowlist entries for BugNote CDN/API
hosts:

- `script-src` / `script-src-elem`: `https://*.bugnote.io`
- `connect-src`: `https://*.bugnote.io`

**Deploy must verify the live BugNote widget and API hostnames** from the
workspace dashboard. Replace or narrow `https://*.bugnote.io` if BugNote
uses a different domain (e.g. `cdn.bugnote.app`).

## Phases

### Phase A — Env-gated stub (this PR)

- `BugNoteProvider` injects widget script when enabled.
- `captureError(message, context)` context hook for future call sites.
- `Layout` passes `userId`, `route`, `runId` into provider context.
- `POST /api/webhooks/bugnote` verifies HMAC when secret set; logs event
  metadata; returns `200`.
- Scope doc + CSP placeholders.

### Phase B — Verified contract + wiring

- Replace placeholder SDK calls with documented BugNote APIs.
- Wire `captureError` from global error boundary and research failure
  surfaces.
- Webhook idempotency table + event dispatch (ticket created, status
  changed).
- Confirm CSP hostnames against BugNote production URLs.

### Phase C — Product integration

- In-app “Report issue” affordance with screenshot / console bundle.
- Link BugNote tickets to `research_runs` / `reports` via metadata.
- Operator dashboard: open BugNote from dossier row.
- Production webhook secret required; reject unsigned requests.

## Routes

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/webhooks/bugnote` | HMAC (`BUGNOTE_WEBHOOK_SECRET` when set) |
| POST | `/webhooks/bugnote` | Same (compat prefix without `/api`) |

## Related code

- `frontend/src/components/integrations/BugNoteProvider.tsx`
- `frontend/src/components/layout/Layout.tsx`
- `backend/src/api/webhooks/bugnote.ts`
- `backend/src/api/app.ts`
