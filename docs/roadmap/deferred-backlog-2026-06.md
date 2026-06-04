# Deferred backlog — June 2026

Prioritized follow-ups after Wave 5.x shipping. **P0** blocks revenue or
correctness; **P1** is high-value near-term; **P2** is planned but not
urgent. See linked scope docs for detail.

## P0 — Correctness / revenue blockers

| Item | Notes | Scope |
|------|-------|-------|
| Student tier verification | SheerID token verify → `users.verified_student` → Student Stripe price | Migration `051_student_verification` (in flight) |
| Billing tier sync edge cases | Preserve admin/sovereign on non-granting Stripe webhooks | `docs/CURSOR_BRIEF_BILLING_HARDENING.md` |
| RLS backfill for legacy NULL `user_id` | Rows invisible under migration 029 policies until backfill | `docs/RUNBOOKS/backfill-user-scopes.md` |
| PDF / large supplemental staging | Queue payload must use `stagedFilePath` for PDFs over inline limit | `supplementalFileQueuePayload.ts` |

## P1 — High-value product

| Item | Notes | Scope |
|------|-------|-------|
| Monitor token economy polish | Token packs, 2-month windows, paused vs active UI | `docs/monitor-tokens-living-reports-economy.md` |
| BugNote Phase B | Verify SDK + webhook contract; wire `captureError` to error boundary | `docs/integrations/bugnote-scope.md` |
| Team tier Phase 2 MVP | Clerk org at checkout, pooled quota, seat quantity | `docs/roadmap/team-phase-2-planning.md` |
| Provenance Ledger | Tamper-evident report bundle + public verify endpoint | `docs/roadmap/phase-2-deferred-features.md` §1 |
| Admin cost / ops surfaces | Extend WO-U telemetry dashboards; runbook gaps | `docs/ResearchOne - Work Order U.md` |
| Academic export async jobs | WO-X report export worker for long PDF/DOCX paths | `docs/ResearchOne - Work Order X.md` |

## P2 — Planned / deferrable

| Item | Notes | Scope |
|------|-------|-------|
| BugNote Phase C | In-app report issue, dossier ticket links | `docs/integrations/bugnote-scope.md` |
| Team Phase 2 full | SSO, audit log UI, mid-period proration, corpus RLS extension | `docs/roadmap/team-phase-2-planning.md` |
| Reverse Citation Watch (self-serve) | Phase 2 deferred on pricing; mailto placeholder today | `docs/roadmap/phase-2-deferred-features.md` |
| Landing persona analytics (WO-V PATCH-V04) | Optional append-only persona table | `docs/ResearchOne - Work Order V.md` |
| Sovereign / BYOK hardening | Dedicated runbooks, key rotation UX | README + billing routes |
| Knowledge graph performance | Large-run graph caps, lazy load | PR #137 follow-ups |

## Explicitly out of this backlog

- V2 default model changes — governed by `ResearchOne PolicyOne` and
  `docs/V2_MODEL_SELECTION_CRITERIA.md` (Rule 20).
- Tier A marketing copy — governed by Rule 36 and
  `docs/marketing/tier-a-banned-jargon.txt`.

## Cross-references

- Phase 2 deferred features (Provenance + Team overview):
  `docs/roadmap/phase-2-deferred-features.md`
- Revision / spinoff / dossier timeline (Gates 1–5):
  `docs/revision-spinoff-dossier-timeline-scope.md`
