# PATCH X03 — `reports.ts`: `POST /:id/export` endpoint

**File:** `backend/src/api/routes/reports.ts`
**Why:** Public API surface for the formatting engine. Synchronous
path for small reports (bounded 10s), async-via-BullMQ path for
anything larger.

**Behavioral guarantee:** When Pandoc is not installed (Rule 28 I-6),
returns HTTP 200 with `{available: false, reason:
'pandoc_not_installed'}` — frontend disables the export button with a
tooltip. Never 500.

---

## Step 1 — Imports

Add to the existing import block at the top of `reports.ts`:

```ts
import { exportReport } from '../../services/formatting/exportOrchestrator';
import { pandocAvailable, PandocError, type ExportFormat, type ExportStyle } from '../../services/formatting/pandocRunner';
import { reportExportQueue } from '../../queue/queues';   // see PATCH-X04
import { adminQuery } from '../../db/pool';
```

## Step 2 — Add the endpoint

Insert AFTER the existing `router.get('/:id/citations', ...)` handler
(around line 473 in the May 2026 snapshot) and BEFORE `export default router;`:

```ts
const VALID_FORMATS: ReadonlySet<ExportFormat> = new Set(['docx', 'pdf', 'md', 'html']);
const VALID_STYLES: ReadonlySet<ExportStyle> = new Set([
  'mla', 'apa', 'chicago-author-date', 'chicago-note', 'ieee', 'harvard',
]);

/**
 * POST /api/reports/:id/export
 *
 * Body: { format: 'docx'|'pdf'|'md'|'html', style: 'mla'|'apa'|..., sync?: boolean }
 *
 * sync=true (default for md/html): runs the export inline, streams the
 * file in the response. Bounded by pandocRunner's wall-clock timeout
 * (30s for DOCX/MD/HTML, 60s for PDF).
 *
 * sync=false (default for docx/pdf for larger reports): enqueues a
 * BullMQ job and returns the exportId for polling via
 * GET /api/reports/exports/:exportId.
 *
 * Auth: requireAuth has already been applied at router.use(requireAuth)
 * earlier in this file.
 */
router.post('/:id/export', async (req, res, next) => {
  try {
    const reportId = req.params.id;
    const body = req.body as Record<string, unknown>;
    const format = String(body.format ?? '').toLowerCase() as ExportFormat;
    const style = String(body.style ?? '').toLowerCase() as ExportStyle;
    const sync = body.sync === true;

    // Validation per Rule 28 I-9 — enum check before anything touches
    // the subprocess layer.
    if (!VALID_FORMATS.has(format)) {
      res.status(400).json({ error: 'invalid format', validFormats: Array.from(VALID_FORMATS) });
      return;
    }
    if (!VALID_STYLES.has(style)) {
      res.status(400).json({ error: 'invalid style', validStyles: Array.from(VALID_STYLES) });
      return;
    }

    // Confirm the user owns this report (RLS handles this via
    // adminQuery + user_id check). adminQuery is used here because
    // exports cross the user boundary in service layer and we filter
    // explicitly.
    const userId = (req as { user?: { id?: string } }).user?.id ?? null;
    const owned = await adminQuery<{ id: string }>(
      `SELECT id FROM reports WHERE id = $1 AND ($2::text IS NULL OR user_id = $2) LIMIT 1`,
      [reportId, userId]
    );
    if (owned.length === 0) {
      res.status(404).json({ error: 'report not found' });
      return;
    }

    // System dep check per Rule 28 I-6 — deploy-skew tolerance for
    // Pandoc as a system binary.
    const avail = await pandocAvailable();
    if (!avail.available) {
      res.json({
        available: false,
        reason: 'pandoc_not_installed',
        detail: 'Pandoc is not installed on this server. Contact your administrator.',
      });
      return;
    }

    // Synchronous path — return the file in the response.
    if (sync) {
      try {
        const result = await exportReport({
          reportId,
          format,
          style,
          userId,
        });
        const mime = mimeForFormat(format);
        res.setHeader('Content-Type', mime);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="report-${reportId.slice(0, 8)}-${style}.${format}"`
        );
        res.send(result.outputBuffer);
        return;
      } catch (err) {
        if (err instanceof PandocError) {
          // Classified errors are visible to the user; the message
          // is safe (no filesystem paths or shell echoes per
          // pandocRunner's classification logic).
          res.status(err.classification === 'timeout' ? 504 : 422).json({
            error: err.classification,
            detail: err.message,
          });
          return;
        }
        throw err;
      }
    }

    // Async path — enqueue and return an export id.
    const exportRows = await adminQuery<{ id: string }>(
      `INSERT INTO report_exports (report_id, user_id, format, style, status)
       VALUES ($1, $2, $3, $4, 'queued')
       RETURNING id`,
      [reportId, userId, format, style]
    );
    const exportId = exportRows[0].id;

    await reportExportQueue.add('export', {
      exportId, reportId, format, style, userId,
    }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600 },   // keep 1h for status polling
      removeOnFail: { age: 86400 },
    });

    res.status(202).json({
      exportId,
      status: 'queued',
      pollUrl: `/api/reports/exports/${exportId}`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/exports/:exportId
 *
 * Polling endpoint for async exports. Returns status and (when
 * status === 'completed') the output URL.
 */
router.get('/exports/:exportId', async (req, res, next) => {
  try {
    const userId = (req as { user?: { id?: string } }).user?.id ?? null;
    const rows = await adminQuery<{
      id: string;
      status: string;
      format: string;
      style: string;
      output_url: string | null;
      output_bytes: number | null;
      error_class: string | null;
      error_detail: string | null;
      created_at: string;
      completed_at: string | null;
    }>(
      `SELECT id, status, format, style, output_url, output_bytes,
              error_class, error_detail, created_at, completed_at
         FROM report_exports
        WHERE id = $1 AND ($2::text IS NULL OR user_id = $2)
        LIMIT 1`,
      [req.params.exportId, userId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'export not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

function mimeForFormat(format: ExportFormat): string {
  switch (format) {
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'pdf':  return 'application/pdf';
    case 'md':   return 'text/markdown; charset=utf-8';
    case 'html': return 'text/html; charset=utf-8';
  }
}
```

## Step 3 — Verify

```bash
cd backend
npx tsc --noEmit
npx vitest run reports
```

Manual smoke (after migration 032 applies and Pandoc installed):

```bash
# Sync path — small Markdown export.
curl -X POST -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"format":"md","style":"apa","sync":true}' \
     http://localhost:3001/api/reports/<reportId>/export \
     -o /tmp/test.md
cat /tmp/test.md   # should contain the report body with [E1] aliases → (Author, 2026) form

# Async path — DOCX.
curl -X POST -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"format":"docx","style":"mla"}' \
     http://localhost:3001/api/reports/<reportId>/export
# Returns {exportId, status:'queued', pollUrl}.
# Poll the pollUrl until status === 'completed', then download output_url.
```

## Pandoc-missing smoke test

To verify Rule 28 I-6 in a dev env, temporarily rename pandoc:

```bash
sudo mv $(which pandoc) /usr/local/bin/pandoc.disabled
# call _resetAvailabilityCache() via test helper, or restart backend
curl -X POST .../api/reports/<id>/export ...
# Response: 200 OK, body: {available:false, reason:'pandoc_not_installed'}
sudo mv /usr/local/bin/pandoc.disabled $(which pandoc)
```

Frontend `ReportExportButton` reads `available` and disables the
button with a tooltip explaining the missing dep.
