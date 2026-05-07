**Work Order Q --- Final QA and release checklist**

**Goal. Complete final release checklist (Section 15). Verify every
item. Block public launch on any failure.**

**Pre-work: Section 15, all previous work orders' acceptance criteria.**

**Tasks:**

**Run through every item in Section 15. For each, capture evidence
(screenshot, log output, test result). Output as
docs/release/2026-XX-XX-launch-readiness.md.**

**Specifically test:**

- [ ] New user signup → onboarding → wallet top-up → first Standard
      report → wallet decrement → report visible.
- [ ] Free demo runs 3 reports → 4th attempt blocked with upgrade
      path.
- [ ] Pro user subscribes → mode access granted → quota tracked
      correctly.
- [ ] Team owner adds members → Stripe seats updated → org members
      access shared corpus.
- [ ] BYOK user adds key → runs use their key (verify via the
      relevant provider's dashboard for each provider supported in
      WO-I, not just OpenRouter).
- [ ] User deletes report → report gone locally → InTellMe deletion
      job enqueued and completes.
- [ ] User opts out of Pipeline B → next run does not ingest.
- [ ] Sovereign deployment cannot reach InTellMe (network policy +
      stub throw).
- [ ] Admin can comp user's tier.
- [ ] Failed run does not charge user.
- [ ] 402 returns when wallet empty (and when reserved-balance
      blocks a second concurrent run — see WO-H).
- [ ] Webhook idempotency: replay `checkout.session.completed`,
      verify single ledger row.

**Section 15 smoke test additions:**

**(1) Subscribe to Living Report → Parallel webhook fires → revision
pipeline runs → user sees revised report.**

**(2) Run Adversarial Twin against uploaded doc → output contains only
contradictions and gaps, not new research.**

**(3) Provenance Ledger export → public verification endpoint validates
manifest.**

**(4) Retraction-handling regression: chunk with
institutional\_status='retracted' flows through pipeline without
evidence\_tier mutation.**

**(5) Parallel webhook signature replay returns 200 idempotent (no
duplicate revision).**

**(6) Tier-disallowed addon returns 403, not 200 with silent ignore.**

**Acceptance criteria:**

- [ ] Section 15 checklist 100% complete with evidence.
- [ ] No P0 or P1 bugs open.
- [ ] Smoke test from production passes.
- [ ] Legal review complete (TOS, Privacy, AUP all approved by
      counsel).
- [ ] Soft launch invite cohort (10–25 users) tested and feedback
      incorporated.

**Sign-off. Founder sign-off required before public launch announcement.
Document in release readiness doc.**
