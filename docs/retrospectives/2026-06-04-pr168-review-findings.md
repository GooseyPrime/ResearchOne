# Retrospective — PR #168 product gaps (Codex / Copilot review)

Date: 2026-06-04
Scope: Codex P1 ×4 and Copilot recommendations on PR #168 (`cursor/product-gaps-pdf-billing-admin-5259`).

## Findings addressed

| Reviewer | Issue | Class |
|---|---|---|
| Codex P1 | SheerID widget called non-existent `setFormElement` / `loadIncentive` on `@sheerid/jslib@1` | **C-THIRD-PARTY-CONTRACT** — assumed API from docs/memory without reading shipped bundle |
| Codex P1 | Success check only accepted `currentStep === 'SUCCESS'` | **C-THIRD-PARTY-CONTRACT** — REST v2 returns lowercase `success` and alternate reward fields |
| Codex + Copilot | CSP missing jsdelivr + SheerID iframe origins | **C-CSP-PARITY** — third-party script/frame hosts must ship with integration |
| Codex P1 | Same SheerID verification id reusable across accounts | **C-ONE-TIME-BINDING** — external proof token must be unique per user row |
| Copilot | `fileFilter` allowed any MIME when extension matched | **C-UPLOAD-GUARD** — extension-only bypass for spoofed content types |
| Copilot | BullMQ enqueue failure left `ingestion_jobs` stuck `queued` | **C-JOB-ROW-CONSISTENCY** — row status must reflect enqueue outcome |
| Copilot | Toast said "ingested" when job was only queued | **C-ASYNC-COPY** — user-visible text must match actual pipeline stage |
| Copilot | Dev bypass UI visible in prod when SheerID unconfigured | **C-DEV-ONLY-UI** — gate bypass affordances with `import.meta.env.DEV` + server flag |
| Copilot | `avgCostPerRunUsd: 0` when no runs | **C-NULLABLE-METRIC** — zero denominator → `null`, not sentinel `0` |
| Copilot | BugNote `captureError` spread overwrote `message` | **C-OBJECT-SPREAD-ORDER** — explicit fields after spread win |
| Copilot | BugNote webhook accepted unsigned traffic in production | **C-WEBHOOK-GUARD** — missing secret → 503, not open endpoint |

## Standing rules (logged in `AGENTS.md`)

See **Recurring review themes (Codex / Copilot, PR #168 — product gaps review)** in [`AGENTS.md`](../AGENTS.md).

## Tests added / updated

- `studentVerificationService.test.ts` — success step variants, verification id reuse, persist path
- `bugnoteWebhook.test.ts` — 503 when webhook secret unset in production
- `supplementalIngestNotifications.test.ts` — asserts "queued" not "ingested"

## External verification (SheerID jslib v1)

Live bundle at `https://cdn.jsdelivr.net/npm/@sheerid/jslib@1/sheerid.js` exposes:

- `window.sheerid.loadInlineIframe(programId, element)`
- `window.sheerid.setHook(window.sheerid.hooks.ON_VERIFICATION_SUCCESS, cb)`

It does **not** expose `loadIncentive` or `setFormElement` (v2 module API differs).
