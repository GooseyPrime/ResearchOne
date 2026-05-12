# PATCH X04 — `reportExportWorker.ts`: async export worker

**File (new):** `backend/src/queue/workers/reportExportWorker.ts`
**Why:** Async export path for DOCX/PDF jobs that would otherwise hold
an HTTP connection for tens of seconds.

The worker consumes from the `reportExportQueue` defined in your
existing `backend/src/queue/queues.ts`. Pattern mirrors
`livingReportRevisionWorker.ts` (WO-T).

---

## Step 1 — Register the queue

In `backend/src/queue/queues.ts`, add the queue export alongside the
existing ones:

```ts
import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

// ... existing queue exports ...

export const reportExportQueue = new Queue('report_export', {
  connection: redisConnection,
});
```

Mirror whatever pattern the existing queues use — the actual file
may have a `defineQueue(...)` helper.

## Step 2 — Worker implementation

Create `backend/src/queue/workers/reportExportWorker.ts`:

```ts
/**
 * Report export worker — drains the report_export BullMQ queue.
 *
 * Job payload (set by reports.ts:POST /:id/export):
 *   {
 *     exportId: string,
 *     reportId: string,
 *     format: 'docx' | 'pdf' | 'md' | 'html',
 *     style: 'mla' | 'apa' | ...,
 *     userId: string | null,
 *   }
 *
 * Lifecycle:
 *   1. UPDATE report_exports SET status='running', started_at=NOW().
 *   2. Call exportReport(...) — handles pandoc + tempdir + cleanup.
 *   3. Persist the output buffer (S3 / local) and store output_url.
 *   4. UPDATE status='completed' (or 'failed' / 'timed_out').
 *
 * Status writes are best-effort but their absence is observable —
 * the GET polling endpoint will keep returning 'running' if a worker
 * crashed mid-job. A future WO can add a stale-export reaper that
 * marks 'running' jobs older than N minutes as 'timed_out'.
 */
import { Worker, Job } from 'bullmq';
import { redisConnection } from '../redisConnection';
import { adminQuery } from '../../db/pool';
import { exportReport } from '../../services/formatting/exportOrchestrator';
import { PandocError, type ExportFormat, type ExportStyle } from '../../services/formatting/pandocRunner';
import { uploadExportOutput } from '../../services/formatting/exportStorage';   // see Step 3
import { logger } from '../../utils/logger';

interface ExportJobData {
  exportId: string;
  reportId: string;
  format: ExportFormat;
  style: ExportStyle;
  userId: string | null;
}

export const reportExportWorker = new Worker<ExportJobData>(
  'report_export',
  async (job: Job<ExportJobData>) => {
    const { exportId, reportId, format, style, userId } = job.data;

    // 1. Mark running.
    await adminQuery(
      `UPDATE report_exports
          SET status='running', started_at=NOW()
        WHERE id = $1`,
      [exportId]
    );

    try {
      // 2. Render.
      const result = await exportReport({ reportId, format, style, userId });

      // 3. Persist output. uploadExportOutput is in Step 3 below —
      //    swap implementation for S3 / GCS / local based on env.
      const outputUrl = await uploadExportOutput({
        exportId,
        reportId,
        format,
        buffer: result.outputBuffer,
      });

      // 4. Mark completed.
      await adminQuery(
        `UPDATE report_exports
            SET status='completed',
                output_url=$1,
                output_bytes=$2,
                pandoc_duration_ms=$3,
                completed_at=NOW()
          WHERE id=$4`,
        [outputUrl, result.outputBytes, result.pandocDurationMs, exportId]
      );

      return { exportId, outputUrl, outputBytes: result.outputBytes };
    } catch (err) {
      // Classify and persist.
      const errClass = err instanceof PandocError
        ? err.classification
        : 'pandoc_error';
      const errDetail = err instanceof Error
        ? err.message
        : String(err);

      await adminQuery(
        `UPDATE report_exports
            SET status=$1,
                error_class=$2,
                error_detail=$3,
                completed_at=NOW()
          WHERE id=$4`,
        [
          errClass === 'timeout' ? 'timed_out' : 'failed',
          errClass,
          errDetail.slice(0, 2000),
          exportId,
        ]
      );

      logger.warn('export worker: job failed', {
        exportId, reportId, errClass, errDetail: errDetail.slice(0, 200),
      });
      throw err;
    }
  },
  {
    connection: redisConnection,
    // Per Rule 28 I-4: each Pandoc invocation already has its own
    // wall-clock timeout. The job-level timeout here is a belt-and-
    // suspenders bound on the orchestrator wrapper.
    lockDuration: 90_000,
    // Concurrency: small. Pandoc + xelatex can chew RAM. 2 concurrent
    // jobs per worker is conservative; tune based on actual memory
    // profiling.
    concurrency: 2,
  }
);

reportExportWorker.on('failed', (job, err) => {
  logger.error('export worker: job ultimately failed after retries', {
    jobId: job?.id, exportId: job?.data?.exportId, err: err.message,
  });
});

reportExportWorker.on('completed', (job) => {
  logger.info('export worker: job completed', {
    jobId: job.id, exportId: job.data.exportId,
  });
});
```

## Step 3 — Output storage abstraction

Create `backend/src/services/formatting/exportStorage.ts`:

```ts
/**
 * Storage abstraction for rendered export files.
 *
 * Three implementations behind one interface:
 *   - 'local':  /var/r1-exports/<exportId>.<format> + filesystem URL
 *   - 's3':     uploads to S3 bucket, returns signed URL with TTL
 *   - 'r2':     same as S3 but Cloudflare R2 endpoint
 *
 * Selected via EXPORT_STORAGE_BACKEND env (default: 'local' for dev).
 *
 * The signed URL TTL is short (default 1h) — long enough for a user
 * to click download from the polling response, short enough that a
 * leaked URL doesn't grant indefinite access.
 */
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export interface UploadArgs {
  exportId: string;
  reportId: string;
  format: string;
  buffer: Buffer;
}

const BACKEND = process.env.EXPORT_STORAGE_BACKEND ?? 'local';
const LOCAL_DIR = process.env.EXPORT_LOCAL_DIR ?? '/var/r1-exports';

export async function uploadExportOutput(args: UploadArgs): Promise<string> {
  switch (BACKEND) {
    case 'local':
      return uploadLocal(args);
    case 's3':
    case 'r2':
      // Stub — implementations depend on your existing AWS SDK usage.
      // For initial rollout, 'local' is correct; promote to 's3' when
      // you have a bucket + IAM role provisioned. The interface is
      // already in place.
      throw new Error(`EXPORT_STORAGE_BACKEND=${BACKEND} not yet implemented`);
    default:
      throw new Error(`unknown EXPORT_STORAGE_BACKEND: ${BACKEND}`);
  }
}

async function uploadLocal(args: UploadArgs): Promise<string> {
  const path = join(LOCAL_DIR, `${args.exportId}.${args.format}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, args.buffer);
  // Returns a path that the API can serve via a static-file route
  // gated by the same auth as the polling endpoint.
  return `/exports/${args.exportId}.${args.format}`;
}
```

## Step 4 — Worker registration

Find the existing worker boot in `backend/src/queue/index.ts` or
similar and add:

```ts
import './workers/reportExportWorker';
```

Per the existing pattern — the import side-effect is enough; the
worker registers itself with BullMQ on construction.

## Verify

```bash
cd backend
npx tsc --noEmit
npx vitest run reportExportWorker
```

Manual end-to-end after the full WO-X is wired:

1. Issue an async DOCX export via POST `/api/reports/<id>/export`.
2. Poll `/api/reports/exports/<exportId>` — should transition
   `queued` → `running` → `completed`.
3. Visit `output_url` from the completed response — should download
   the .docx file.
4. Verify in WO-U cost dashboard: a new row in `agent_executions`
   tagged `agent_role='citation_formatter'`, `phase='Citation Mapping'`.
   This is the load-bearing cross-WO contract firing live.
