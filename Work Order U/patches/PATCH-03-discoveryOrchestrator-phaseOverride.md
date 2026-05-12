# PATCH 03 — `discoveryOrchestrator.ts`: nested scope with `phaseOverride: 'Discovery'`

**File:** `backend/src/services/discovery/discoveryOrchestrator.ts`
**Why:** Discovery's two `callRoleModel` calls both use `role: 'planner'`.
Without intervention, the cost dashboard would attribute discovery's
token spend to the `Planning` phase — semantically wrong, because
discovery's planner is generating *retrieval queries*, not the
top-level research plan. Per Rule 25 invariant I-9, the phase mapping
must reflect actual pipeline work, and `runScope.current().phaseOverride`
is the documented mechanism.

**Behavioral guarantee:** Same as PATCH 02 — `runScope.run(...)` wraps,
preserves all `await`s, no side effects on the LLM call path.

---

## Step 1 — Add the import

In the existing imports block:

```ts
import { runScope } from '../telemetry';
```

## Step 2 — Wrap `runDiscoveryOrchestrator` body

The function declared at line 122:

```ts
export async function runDiscoveryOrchestrator(args: {
  runId: string;
  // ...
}): Promise<DiscoveryRunSummary> {
  const { runId, researchQuery, plan, engineVersion, researchObjective, allowFallbackByRole, byokApiKeyOverride, userId, onRoundComplete } = args;
  const startTime = Date.now();

  if (!config.discovery.enabled) {
    logger.info(`[discovery:${runId}] Discovery disabled via config`);
    return buildSummary(runId, false, 'Discovery disabled via DISCOVERY_ENABLED=false', [], [], [], startTime);
  }

  // ... rest of body ...
```

**Rename to `runDiscoveryOrchestratorInner`** (same pattern as PATCH 02)
**and add a wrapper:**

```ts
/**
 * Public entry. Wraps the discovery body in a nested telemetry scope
 * that overrides `phase` to 'Discovery' so all `callRoleModel` calls
 * here surface as Discovery in the admin cost dashboard, not Planning.
 *
 * The nested scope inherits `runId`, `userId`, `reportId`, `orgId`
 * from the parent (set by `runResearchJob` per PATCH 02) via
 * `runScope.current()` spread.
 *
 * Edge case: if Discovery is ever invoked outside a research run
 * (e.g. a hypothetical "discovery-only" API), `runScope.current()`
 * returns null. The OR-fallback below handles that — we still set
 * runId from args.
 */
export async function runDiscoveryOrchestrator(args: {
  runId: string;
  researchQuery: string;
  plan: Record<string, unknown>;
  filterTags?: string[];
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  byokApiKeyOverride?: string;
  userId?: string;
  onRoundComplete?: (payload: { round: number; candidatesAfter: number }) => Promise<void> | void;
}): Promise<DiscoveryRunSummary> {
  const parent = runScope.current() ?? {};
  return runScope.run(
    {
      ...parent,
      runId: parent.runId ?? args.runId,
      userId: parent.userId ?? args.userId ?? null,
      phaseOverride: 'Discovery',
    },
    () => runDiscoveryOrchestratorInner(args)
  );
}

async function runDiscoveryOrchestratorInner(args: {
  // ... same signature as the original function ...
}): Promise<DiscoveryRunSummary> {
  // ... original body unchanged ...
```

## Step 3 — `phaseOverride` precedence (no code change, just understand)

Inside `costSidecar.ts:writeRow`, the phase resolution is:

```ts
const phase = scope.phaseOverride ?? rolePhaseFor(opts.role, opts.callPurpose);
```

So once Discovery sets `phaseOverride: 'Discovery'`, ALL calls inside
the discovery block — including the `role: 'planner'` calls at lines
150 and 290 — surface as Discovery. The role itself is still recorded
in `agent_executions.agent_role` (so per-role drilldown still works),
but the human-grouped phase bucket is correct.

## Step 4 — Verify

```bash
cd backend
npx tsc --noEmit
npx vitest run discovery
```

Grep for unintended scope additions:

```bash
grep -n "runScope.run" backend/src/services/discovery/
# Expected: exactly one hit, in the new public wrapper.
```

## Test consequence

A test in `__tests__/costSidecar.test.ts`:

- Mock `runResearchJob` to call `runDiscoveryOrchestrator` directly
  inside a `runScope.run({runId: 'r1', userId: 'u1'}, ...)` (simulating
  the orchestrator wrap from PATCH 02).
- Mock both discovery `callRoleModel` calls.
- Assert the resulting `agent_executions` rows for both have:
  - `run_id='r1'`, `user_id='u1'` (inherited from parent scope) ✓
  - `phase='Discovery'` (overridden) ✓
  - `agent_role='planner'` (preserved — discovery uses planner role) ✓
- Mentally revert this patch: `phase` would be `'Planning'` (from
  `rolePhaseFor('planner', undefined)`). The test must fail. ✓
