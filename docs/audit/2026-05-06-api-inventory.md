# API inventory — `backend/src/api/`

Mounting in `backend/src/api/app.ts`:

- Primary prefix: `/api/<segment>`
- Compatibility: same routers also mounted at `/<segment>` (strip-/api proxies)

Global middleware (before routers): Helmet (CSP disabled), CORS, `express.json` 10mb, `express.urlencoded`, morgan, rate limit 500/15min on `/api`.

Static: `GET /exports/*` → `config.exports.dir`

---

## Health — router `routes/health.ts` → `/api/health` and `/health`

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/` | Full health payload: DB/Redis/queues/OpenRouter probe (`GET .../models`), discovery config readiness, exports dir writable test, websocket io presence, build meta — status ok/degraded/down |
| GET | `/ready` | Same buildHealth; HTTP 200 if not `down`, else 503; body `{ ready, ...payload }` |

---

## Ingestion — `routes/ingestion.ts` → `/api/ingestion`

| Method | Path | Behavior |
|--------|------|----------|
| POST | `/url` | Queue URL ingestion job |
| POST | `/text` | Queue raw text ingestion |
| POST | `/file` | Multipart file upload → ingestion |
| GET | `/jobs` | List ingestion jobs |
| GET | `/jobs/:id` | Job status/detail |

---

## Research — `routes/research.ts` → `/api/research`

| Method | Path | Behavior |
|--------|------|----------|
| POST | `/` | Start research run (JSON or multipart with supplemental files); validates overrides, enqueues BullMQ |
| GET | `/v2/ensemble-presets` | Returns `V2_MODE_PRESETS` metadata for UI |
| GET | `/model-options` | Approved model slugs / options |
| GET | `/` | List research runs (query filters) |
| GET | `/:id` | Get run by id |
| GET | `/:id/artifacts` | Run artifacts |
| POST | `/:id/retry-from-failure` | Resume/retry after failure (retry budget, deploy-skew tolerant) |
| POST | `/:id/cancel` | Cancel run |
| DELETE | `/:id` | Delete run |

---

## Reports — `routes/reports.ts` → `/api/reports`

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/` | List reports (status, search) |
| GET | `/:id` | Report + sections |
| POST | `/:id/revisions` | Create/apply revision (JSON or multipart); emits `revision:progress` on socket rooms |
| POST | `/:id/publish-featured` | Publish to featured repo (admin token) |
| GET | `/:id/revisions` | List revisions |
| GET | `/:id/revisions/:revisionId` | Single revision |
| GET | `/:id/citations` | Citations |

---

## Corpus — `routes/corpus.ts` → `/api/corpus`

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/tier-distribution` | Claim tier histogram |
| GET | `/stats` | Corpus stats |
| GET | `/claims` | Claims listing |
| GET | `/contradictions` | Contradictions listing |
| GET | `/chunks` | Chunks listing/search |

---

## Atlas — `routes/atlas.ts` → `/api/atlas`

| Method | Path | Behavior |
|--------|------|----------|
| POST | `/export` | Trigger atlas export job |
| GET | `/exports` | List exports |
| GET | `/exports/:id/download` | Download export file |
| GET | `/embedded-count` | Embedding counts |
| GET | `/points` | Embedding Atlas–style points payload |
| POST | `/exports/:id/nomic-upload` | Upload export to Nomic |

---

## Graph — `routes/graph.ts` → `/api/graph`

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/` | Knowledge graph nodes/edges for D3 (`runId`, `limit` query) |

---

## Sources — `routes/sources.ts` → `/api/sources`

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/` | List sources |
| GET | `/:id` | Source detail |
| DELETE | `/:id` | Delete source |

---

## Admin — `routes/admin.ts` → `/api/admin` (Bearer / `x-admin-token` = `ADMIN_RUNTIME_TOKEN`)

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/runtime/logs` | Tail PM2/Winston logs |
| GET | `/models` | Runtime model overrides |
| PUT | `/models` | Update runtime model overrides |
| POST | `/corpus/clear` | Destructive corpus clear (confirmation phrase) |
| POST | `/corpus/delete-by-ingestion-jobs` | Delete corpus rows by job ids |
| POST | `/corpus/delete-by-research-run` | Delete corpus rows by run id |
| POST | `/runtime/restart` | Exec configured restart command |

---

## Errors

- Unmatched routes → `404 { error: 'Not found' }`
- Thrown errors → `500 { error: 'Internal server error', message }`

Socket.IO and non-REST surfaces are **not** listed here (mounted from `backend/src/index.ts`, not under `api/routes/*.ts`).
