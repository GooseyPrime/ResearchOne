**Work Order O --- Observability, logging, error states, and legal
stubs**

**Goal. Production-grade error handling, monitoring, real health checks,
and the legal-page stubs that need lawyer review before launch.**

**Pre-work --- read first:**

-   **ResearchOne_Update_041626.pdf --- Phase 5 (\"real system health\")
    and Phase 2 (\"research-run failure visibility\") laid out the
    plan**

-   **This report Section 8 (data handling for privacy disclosure)**

-   **This report Section 10 (observability stack)**

**Files to create:**

**Backend:**

-   **backend/src/api/health/index.ts --- real /api/health and
    /api/health/ready per the 041626 doc:**

**typescript**

**// /api/health/ready returns:**

**// {**

**// status: \'ok\' \| \'degraded\' \| \'down\',**

**// timestamp,**

**// checks: {**

**// api: { ok, latencyMs },**

**// db: { ok, latencyMs },**

**// redis: { ok, latencyMs },**

**// queue: { ok, depth },**

**// openrouter: { ok, latencyMs },**

**// socket: { ok },**

**// exports_dir: { ok },**

**// parallel: { ok, latencyMs },**

**// scite: { ok, latencyMs }**

**// }**

**// }**

**// Status is \'degraded\' if parallel or scite latencyMs \> 2000.**

-   **backend/src/services/provenance/ledgerExporter.ts --- generates
    tamper-evident PDF from research\_runs + discovery\_events + claims
    + contradictions + report\_citations data with SHA-256 manifest
    signed by ResearchOne release key. Public verification endpoint GET
    /api/provenance/verify/:manifestHash.**

-   **backend/src/middleware/errorHandler.ts --- central error handler,
    structured Winston logging, sanitizes PII before logging**

-   **backend/src/middleware/requestLogger.ts --- every request gets a
    request ID logged with user ID (when authenticated), path, status,
    latency**

-   **Sentry initialization in backend/src/index.ts and
    frontend/src/main.tsx**

**Frontend:**

-   **frontend/src/components/SystemHealthIndicator.tsx --- replaces
    fake \"System online\" with real status from /api/health/ready**

-   **frontend/src/components/ErrorBoundary.tsx --- top-level React
    error boundary with Sentry integration**

**Legal stubs (must be replaced with lawyer-reviewed text before
launch):**

-   **frontend/src/pages/TermsPage.tsx --- Terms of Service stub. Cover:
    account responsibilities, payment terms, refund policy, acceptable
    use, limitation of liability, governing law, dispute resolution**

-   **frontend/src/pages/PrivacyPage.tsx --- Privacy Policy stub. Cover:
    data collected, how used, third parties (Clerk, Stripe, OpenRouter,
    InTellMe ingestion with full disclosure, Parallel Web Systems as
    data sub-processor describing what data is sent and user opt-out
    path, Scite as data sub-processor describing what data is sent and
    user opt-out path), retention, deletion rights, GDPR/CCPA, contact.
    Legal review required before launch.**

-   **frontend/src/pages/AcceptableUsePage.tsx --- AUP stub. Cover:
    prohibited uses (harassment, defamation, illegal activity, malicious
    research targeting individuals), enforcement, reporting**

**Files to modify:**

**backend/src/index.ts --- wire request logger, error handler, Sentry.
Mount health endpoints.**

**Throughout the orchestrator --- emit research:failed events with
{runId, stage, percent, message, error, retryable} per the 041626 doc.
Fix the \"stuck at 5%\" issue.**

**Acceptance criteria:**

-   **/api/health/ready returns real component status, fails health if
    any component fails**

-   **A failed research run emits a research:failed socket event;
    frontend shows the failure with stage and reason; UI clears stuck
    progress bar**

-   **Sentry captures unhandled errors in both frontend and backend**

-   **Legal pages render with placeholder content and a clear \"this is
    a draft pending legal review\" banner that is removed only after
    lawyer sign-off**

-   **PII is never logged (audit by grepping log output during a run)**

-   **Per .cursor/rules/11-error-paths-and-logging.mdc, error paths
    preserve enough context to diagnose without losing the original
    error**

**Tests required:**

-   **Health endpoint returns degraded status when Redis is down**

-   **Failed run scenario triggers correct event flow**

-   **Error logging redacts emails, tokens, BYOK key fragments**

**What not to change.**

-   **Research engine logic**

**Manual follow-up. Schedule lawyer review of legal pages with \$2.5--5K
budget before public launch. This is a launch blocker.**
