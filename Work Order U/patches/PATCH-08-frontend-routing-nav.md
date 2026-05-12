# PATCH 08 — Frontend routing & nav for Cost Analytics

**Files:**
- `frontend/src/App.tsx`
- `frontend/src/pages/admin/AdminDashboard.tsx`

**Why:** Wire the new `CostAnalytics.tsx` page into the existing admin
shell alongside Users / Telemetry / Audit. No new layout — the existing
`<Outlet />` in AdminDashboard handles it.

---

## Step 1 — `App.tsx`: import and register route

**File:** `frontend/src/App.tsx` (109 lines in May 2026 snapshot).

Find the admin imports block (lines 24–27):

```ts
import AdminDashboard from './pages/admin/AdminDashboard';
import UserLookup from './pages/admin/UserLookup';
import RunTelemetry from './pages/admin/RunTelemetry';
import AuditLogViewer from './pages/admin/AuditLogViewer';
```

**Add immediately after:**

```ts
import CostAnalytics from './pages/admin/CostAnalytics';
```

Find the admin route block (lines 77–82):

```tsx
<Route path="admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>}>
  <Route index element={<Navigate to="users" replace />} />
  <Route path="users" element={<UserLookup />} />
  <Route path="telemetry" element={<RunTelemetry />} />
  <Route path="audit" element={<AuditLogViewer />} />
</Route>
```

**Add the cost route between `telemetry` and `audit`** (visually
groups operational analytics together):

```tsx
<Route path="admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>}>
  <Route index element={<Navigate to="users" replace />} />
  <Route path="users" element={<UserLookup />} />
  <Route path="telemetry" element={<RunTelemetry />} />
  <Route path="cost" element={<CostAnalytics />} />     {/* ← ADD */}
  <Route path="audit" element={<AuditLogViewer />} />
</Route>
```

## Step 2 — `AdminDashboard.tsx`: add nav link

**File:** `frontend/src/pages/admin/AdminDashboard.tsx` (27 lines).

Replace the entire `NAV_ITEMS` array (lines 3–7):

```tsx
const NAV_ITEMS = [
  { path: 'users', label: 'User Lookup' },
  { path: 'telemetry', label: 'Run Telemetry' },
  { path: 'audit', label: 'Audit Log' },
];
```

**with:**

```tsx
const NAV_ITEMS = [
  { path: 'users', label: 'User Lookup' },
  { path: 'telemetry', label: 'Run Telemetry' },
  { path: 'cost', label: 'Cost Analytics' },
  { path: 'audit', label: 'Audit Log' },
];
```

The existing render code maps over `NAV_ITEMS` and produces a link per
entry — no further changes needed.

## Step 3 — Verify

```bash
cd frontend
npx tsc --noEmit
npm run build
```

Manual smoke after PATCHes 01–07 are merged and migration 030 applied:

1. Sign in as an admin user (Clerk user id in `ADMIN_USER_IDS`).
2. Visit `/app/admin/cost`.
3. Confirm the four KPI cards render. If migration 030 not applied,
   confirm the amber `<AlertCircle>` banner shows the "migration_pending"
   message — DO NOT show a broken page.

## Test consequence — `frontend/src/__tests__/landing/` (or admin tests)

A test that mounts `<CostAnalytics />` with a mocked
`api.get('/admin/cost/summary')` returning
`{available: false, reason: 'migration_pending'}`:

- Asserts the amber alert renders with text containing "Migration 030".
- Asserts KPI cards still render with `$0`/`0` placeholder values
  (no crash, no error boundary).

Mentally revert the `migrationPending` check — the test would fail
because KPI cards would call `.toLocaleString()` on `undefined`. ✓
