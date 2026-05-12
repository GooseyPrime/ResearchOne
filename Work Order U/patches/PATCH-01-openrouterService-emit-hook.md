# PATCH 01 — `openrouterService.ts`: emit cost telemetry from `callRoleModel`

**File:** `backend/src/services/openrouter/openrouterService.ts`
**Why:** Single instrumentation point per Rule 25 invariant I-1. Every LLM
call in the codebase routes through `callRoleModel`; adding the emit
here gets us 100% coverage with zero ripple to call sites.

**Behavioral guarantee:** This patch is **read-only on the LLM call path.**
It captures `startedAtMs` at function entry and emits AFTER each
successful return. If the emit throws (it can't — it's fire-and-forget
inside the sidecar), the LLM result is already in hand and is returned
unchanged. Per Rule 25 invariant I-3, the orchestrator's existing
`model_log` JSONB remains the primary source of truth.

---

## Step 1 — Add the import

Find the existing imports near the top of the file (around line 1–16):

```ts
import { v2CallOpts } from './openrouterPreflight';
```

Add **immediately after** that line (or at the end of the import block,
whichever is later — Cursor: read end-to-end first per Rule 00):

```ts
import { emitCallTelemetry } from '../telemetry';
```

## Step 2 — Capture `startedAtMs` at function entry

Locate `callRoleModel` (line 578 in the May 2026 main snapshot, around
the comment `/** Calls the configured primary model... */`). The function
opens:

```ts
export async function callRoleModel(options: ModelCallOptions): Promise<ModelCallResult> {
  const { primary: primaryModel, fallback: resolvedFallback } = resolveModelsForCall(options);
  const fallbackModel = resolvedFallback;

  try {
    const { result, backend } = await callModel(primaryModel, options);
```

Insert one line between `const fallbackModel = resolvedFallback;` and the
opening `try {`:

```ts
  const fallbackModel = resolvedFallback;
  const startedAtMs = Date.now();   // ← ADD

  try {
    const { result, backend } = await callModel(primaryModel, options);
```

**Why:** Each LLM call gets a wall-clock anchor that flows into the
idempotency hash. `callModel` internally captures its own `start`
variable for `durationMs`, but that's not visible to the wrapper —
duplicating one `Date.now()` here is cheap.

## Step 3 — Emit on the primary success path

The primary success block currently reads (line 583–585):

```ts
    const { result, backend } = await callModel(primaryModel, options);
    logger.debug(`${backend} [${options.role}] ${result.model}: ${result.promptTokens}p + ${result.completionTokens}c tokens in ${result.durationMs}ms`);
    return { ...result, usedFallback: false, primaryModel };
```

**Replace with:**

```ts
    const { result, backend } = await callModel(primaryModel, options);
    logger.debug(`${backend} [${options.role}] ${result.model}: ${result.promptTokens}p + ${result.completionTokens}c tokens in ${result.durationMs}ms`);
    const augmented = { ...result, usedFallback: false, primaryModel };
    emitCallTelemetry(augmented, {
      role: options.role,
      callPurpose: options.callPurpose,
      startedAtMs,
    });
    return augmented;
```

**Why the local `augmented`:** the `ModelCallResult` we return is shaped
differently than the raw `result` from `callModel` — we always merge in
`usedFallback` and `primaryModel`. The telemetry must emit the SAME
shape we return so the analytics view of "what the orchestrator saw" is
identical to "what the sidecar logged."

## Step 4 — Emit on the fallback success path

The fallback success block (line 614–619) currently reads:

```ts
    if (fallbackModel && fallbackModel !== primaryModel) {
      logger.info(`Falling back to ${fallbackModel} for role [${options.role}]`);
      try {
        const { result, backend } = await callModel(fallbackModel, options);
        logger.debug(`${backend} fallback [${options.role}] ${result.model}: ${result.promptTokens}p + ${result.completionTokens}c tokens in ${result.durationMs}ms`);
        return { ...result, usedFallback: true, primaryModel, errorClassification };
```

**Replace the final `return` with:**

```ts
    if (fallbackModel && fallbackModel !== primaryModel) {
      logger.info(`Falling back to ${fallbackModel} for role [${options.role}]`);
      try {
        const { result, backend } = await callModel(fallbackModel, options);
        logger.debug(`${backend} fallback [${options.role}] ${result.model}: ${result.promptTokens}p + ${result.completionTokens}c tokens in ${result.durationMs}ms`);
        const augmentedFallback = { ...result, usedFallback: true, primaryModel, errorClassification };
        emitCallTelemetry(augmentedFallback, {
          role: options.role,
          callPurpose: options.callPurpose,
          startedAtMs,
        });
        return augmentedFallback;
```

**Why the same `startedAtMs`:** The primary and the fallback are two
distinct calls inside one *logical* `callRoleModel` invocation. Both
consumed tokens; both deserve rows. Because they have **different
`model` values**, the idempotency hash differs and both rows insert
cleanly. The duration math is preserved by `result.durationMs` (the
inner `callModel` resets its own start clock per call).

## Step 5 — Do NOT emit on error paths

Critical: the error handlers throw `NormalizedModelError` without
returning a `ModelCallResult`. There's no token usage to log because
the provider returned an error before producing any. Leave the catch
blocks untouched.

If a future PR ever changes a provider to return partial usage on
error (some do — half-streamed completions get charged), revisit this
decision; for now, the assumption "no result → no row" is correct and
matches the existing `model_log` shape (failed calls do not appear in
`research_runs.model_log` either, by the same logic).

## Verification

After applying:

```bash
cd backend
npx tsc --noEmit
npx vitest run openrouterRequestBody  # ensure we didn't break existing tests
```

Then grep to confirm no other emit call site was added (Rule 25 I-1):

```bash
grep -r "emitCallTelemetry" backend/src --include='*.ts' | grep -v __tests__ | grep -v telemetry/
# Expected output: exactly two hits, both in openrouter/openrouterService.ts
```

## Test consequence — `backend/src/__tests__/costSidecar.test.ts`

Must include (per Rule 25 I-10):

- A test that calls `callRoleModel` inside `runScope.run({runId: 'r1'}, ...)`
  and asserts exactly **one** `agent_executions` row exists with
  `run_id='r1'`, `used_fallback=false`.
- A test that forces a primary failure with a successful fallback, and
  asserts exactly **two** rows: one for primary (with error_classification
  set on the FALLBACK row, not the primary — primary errored before
  return), one for the fallback (`used_fallback=true`).
  Wait — re-read: the primary FAILED so primary does NOT emit. Only
  the fallback emits. **One row, `used_fallback=true`.**
- An idempotency test that calls twice with the same `(runId, role,
  startedAtMs, model)` and asserts exactly one row exists. The way to
  force same `startedAtMs` is to mock `Date.now`.

These tests must **fail without this patch** per Rule 25 I-10. Mentally
revert Step 3 — the first test would find zero rows. ✓
