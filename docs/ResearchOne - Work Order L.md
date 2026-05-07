**Work Order L --- InTellMe sanitized ingestion pipeline**

**Goal. Build dual-pipeline ingestion architecture per Section 8.**

**Pre-work: Section 8 (full architecture), Section 9 (existing ingestion
infrastructure), the actual InTellMe ingestion API documentation
(coordinate with InTellMe team).**

**Files to create:**

-   **Migration 20260XXX_ingestion_tables.sql ---
    user_ingestion_consent, run_ingestion_state, run_user_overrides,
    ingestion_audit_log per Section 8**

-   **backend/src/services/ingestion/sanitizationGate.ts --- pure
    function, full Section 8 spec**

-   **backend/src/services/ingestion/intellmeClient.ts --- HTTPS client
    with signed requests, idempotency, retry semantics**

-   **backend/src/services/ingestion/auditLogger.ts --- wraps writes to
    ingestion_audit_log**

-   **backend/src/queue/workers/pipelineBIngestion.ts --- BullMQ
    worker**

-   **backend/src/queue/workers/intellmeDeletion.ts --- BullMQ worker**

-   **frontend/src/components/account/IngestionConsentToggle.tsx**

-   **frontend/src/components/research/PerRunOptOut.tsx**

**Files to modify:**

**backend/src/services/agents/orchestrator.ts --- at run completion,
evaluate Pipeline B eligibility (Section 8 logic), enqueue
pipeline_b_ingestion job if eligible.**

**backend/src/api/account/delete-report.ts (new) --- when user deletes
report, enqueue intellme_deletion job.**

**frontend/src/pages/OnboardingPage.tsx --- show Pipeline B consent
screen during onboarding (default checked, plain language per Section
8).**

**frontend/src/pages/AccountPage.tsx --- show ingestion toggle.**

**Acceptance criteria: - Sanitization gate: feed Pipeline A artifact
with PII (email, phone, private URL, user name in claim text) → output
has all stripped, hashes match expected - Sanitization idempotent: feed
twice, get identical output (byte-equal) - BullMQ worker: enqueue job →
worker picks up → sanitization runs → InTellMe API called → audit log
row written - 503 from InTellMe → retry with exponential backoff - 400
from InTellMe → routed to dead-letter queue, alert raised - 409 from
InTellMe (already ingested) → marked as deduplicated in audit log -
Consumer opts out via account settings → subsequent runs skip Pipeline
B - Per-run opt-out → that single run skips, account default restored
next run - Sovereign tier user runs → no Pipeline B job enqueued
(defense layer) - User deletes report → intellme_deletion job enqueued →
DELETE call to InTellMe → audit log row**

**Tests required (must fail without the fix): - Sanitization
correctness: every PII pattern from Section 8 stripped - Sanitization
idempotency: byte-equal output on repeat - Eligibility logic: each of 5
conditions tested - Defense layer 1: tier=sovereign → eligible=false
regardless of consent - Audit log completeness: every event type writes
a row**
