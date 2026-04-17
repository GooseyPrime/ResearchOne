# ResearchOne

**Disciplined Anomaly Research Platform** — A structured evidence-gathering, reasoning, and long-form research reporting system built for deep scientific and ontological investigation.

> Not a chatbot. Not a hallucination machine. A disciplined investigation engine with epistemic governance built in.

---

## Deployment Topology

### Mode B: Recommended — Vercel Frontend + Emma Backend (Split Deployment)

```
┌─────────────────────────────────────────────────────────────────┐
│                     RECOMMENDED TOPOLOGY                        │
│                                                                 │
│  Vercel (frontend)                                              │
│  └── React + Vite build (served via Vercel CDN)                 │
│      VITE_API_BASE_URL  → Emma runtime VM                       │
│      VITE_SOCKET_URL    → Emma runtime VM                       │
│      VITE_EXPORTS_BASE_URL → Emma runtime VM                    │
│                                                                 │
│  Emma runtime VM                                                │
│  ├── ResearchOne API (Express + Socket.IO)                      │
│  ├── BullMQ Workers (Ingestion, Embedding, Research, Atlas)     │
│  ├── Nginx (API + WebSocket + /exports reverse proxy)           │
│  └── /opt/researchone/exports/ (Atlas JSONL files)              │
│                                                                 │
│  Emma Postgres VM                                               │
│  └── PostgreSQL + pgvector (corpus, chunks, embeddings,         │
│       claims, contradictions, reports, discovery audit)         │
│                                                                 │
│  Emma Redis VM                                                  │
│  └── Redis (BullMQ job queues, job state, caching)              │
│                                                                 │
│  OpenRouter (remote inference — server-side only)               │
│  ├── Planner: DeepSeek-R1 → Claude 3.5 Sonnet (fallback)       │
│  ├── Retriever: DeepSeek-R1 → Claude 3.5 Sonnet (fallback)     │
│  ├── Reasoner: DeepSeek-R1 → Claude 3.5 Sonnet (fallback)      │
│  ├── Skeptic: DeepSeek-R1 → Claude 3.5 Sonnet (fallback)       │
│  ├── Synthesizer: DeepSeek-R1 → Claude 3.5 Sonnet (fallback)   │
│  └── Verifier: DeepSeek-R1 → Claude 3.5 Sonnet (fallback)      │
└─────────────────────────────────────────────────────────────────┘
```

### Mode A: Legacy — All-in-one on Emma runtime VM

All services including frontend on the same VM. Not recommended for new deployments.
The frontend assumes same-origin `/api` and same-origin socket connection.
To use this mode: do not set `VITE_API_BASE_URL`, `VITE_SOCKET_URL`, or `VITE_EXPORTS_BASE_URL`.

---

## Research Philosophy

1. **Dense centers are context, not final truth.** Consensus clustering reflects repetition, not correctness.
2. **Outliers are leads, not verdicts.** Investigate, don't dismiss or blindly trust.
3. **Bridges are high-value.** Sparse connections between conceptual regions often indicate overlooked relationships.
4. **Reason backward from anomalies.** If an outlier were true, what structure would have to exist?
5. **Preserve epistemic distinctions.** Every claim tagged: `established_fact | strong_evidence | testimony | inference | speculation`
6. **Contradiction is a first-class data type.** Never suppressed.
7. **Reports must attack themselves.** Discovery → Skeptic → Synthesizer → Verifier pipeline.
8. **Atlas is an investigation map, not an oracle.**

## Research Pipeline (10 stages)

| Stage | Role | Purpose |
|-------|------|---------|
| 1 | Planner | Decomposes query into sub-questions, retrieval targets, hypothesis, falsification criteria |
| 2 | Discovery | Autonomously identifies and ingests external sources when corpus is sparse |
| 3 | Retriever | Gathers evidence from enriched corpus via hybrid vector+FTS search |
| 4 | Retriever Analysis | Evaluates evidence tiers, flags outliers and bridges |
| 5 | Reasoner | Builds structured argument chains, tags all claims by evidence tier |
| 6 | Skeptic | Attacks conclusions, finds alternatives, prevents confirmation bias |
| 7 | Synthesizer | Writes the complete long-form research report |
| 8 | Verifier | Epistemic quality gate — ensures citation, contradiction, and tier standards are met |
| 9 | Report save | Stores report, sections, and verification metadata |
| 10 | Epistemic persistence | Extracts and persists claims, contradictions, and section citations |

## Post-publication Report Revision Workflow

Revision API endpoints:

- `POST /api/reports/:id/revisions`
- `GET /api/reports/:id/revisions`
- `GET /api/reports/:id/revisions/:revisionId`

Revision pipeline agents/services:

1. Revision Intake Agent
2. Report Locator / Impact Mapper
3. Change Planner
4. Section Rewriter
5. Citation Integrity Checker
6. Diff / Patch Assembler
7. Final Revision Verifier

Behavior:

- Produces a structured change plan before rewriting.
- Supports corrections, additions, removals, replacements, reframing, global terminology changes, and multi-section edits.
- Persists versioned report lineage (`root_report_id`, `parent_report_id`, `version_number`) and never overwrites finalized reports.
- Stores revision request, revision metadata, changed sections, and structured diff metadata.
- Emits revision progress events over socket (`revision:progress`, `revision:completed`).

## Database Schema

Key tables:
- `sources` — Every external resource ingested (with provenance: `imported_via`, `discovered_by_run_id`, `discovery_query`, etc.)
- `documents` — Processed document content (`parse_method`, `extraction_metadata`)
- `chunks` — Segmented fragments for retrieval (with FTS indexes)
- `embeddings` — pgvector vectors for semantic search (HNSW index)
- `entities` / `entity_mentions` — Named entity extraction
- `claims` — Discrete factual assertions with evidence tiers (run/report linked)
- `contradictions` — Explicit contradiction records (first-class data, run/report linked)
- `research_runs` — Full workflow execution records with model logs and discovery summary
- `reports` + `report_sections` — Structured long-form research reports
- `report_citations` — Evidence → section links (with `chunk_quote`, `citation_order`, `discovery_origin`)
- `report_revision_requests` — post-publication revision requests
- `report_revisions` — revision metadata + version linkage
- `report_revision_sections` — before/after section snapshots
- `report_revision_diffs` — structured diff records
- `report_revision_comments` / `report_revision_citations` — optional review and citation annotations
- `atlas_exports` — Embedding Atlas export snapshots
- `discovery_events` — Audit log for all autonomous discovery activity
- `ingestion_artifacts` — Optional ingestion audit (hashes, parse warnings)
- `error_log` — Structured error tracking

Migrations: `001_initial_schema.sql` → `002_research_governance_and_discovery.sql` → `003_runtime_health_checkpoints.sql` → `004_report_revisions_and_model_policy.sql`

## Environment Variables

### Backend (Emma runtime VM) — Production

```env
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://researchone:<password>@<postgres-vm>:5432/researchone
# or individual fields: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

# Redis
REDIS_URL=redis://<redis-vm>:6379
# or: REDIS_HOST, REDIS_PORT
REDIS_PASSWORD=           # set if requirepass is enabled
REDIS_USERNAME=           # set if ACL username is needed

# OpenRouter (server-side only — never in Vercel)
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Security (server-side only — never in Vercel)
JWT_SECRET=
CORS_ORIGINS=https://<your-vercel-project>.vercel.app,https://<your-custom-frontend-domain>

# Model routing
PLANNER_MODEL=deepseek/deepseek-r1
RETRIEVER_MODEL=deepseek/deepseek-r1
REASONER_MODEL=deepseek/deepseek-r1
SKEPTIC_MODEL=deepseek/deepseek-r1
SYNTHESIZER_MODEL=deepseek/deepseek-r1
VERIFIER_MODEL=deepseek/deepseek-r1
OUTLINE_ARCHITECT_MODEL=deepseek/deepseek-r1
SECTION_DRAFTER_MODEL=deepseek/deepseek-r1
INTERNAL_CHALLENGER_MODEL=deepseek/deepseek-r1
COHERENCE_REFINER_MODEL=deepseek/deepseek-r1
REVISION_INTAKE_MODEL=deepseek/deepseek-r1
REPORT_LOCATOR_MODEL=deepseek/deepseek-r1
CHANGE_PLANNER_MODEL=deepseek/deepseek-r1
SECTION_REWRITER_MODEL=deepseek/deepseek-r1
CITATION_INTEGRITY_CHECKER_MODEL=deepseek/deepseek-r1
FINAL_REVISION_VERIFIER_MODEL=deepseek/deepseek-r1
EMBEDDING_MODEL=openai/text-embedding-3-small

# Fallbacks (all roles now supported)
PLANNER_FALLBACK=anthropic/claude-3.5-sonnet
RETRIEVER_FALLBACK=anthropic/claude-3.5-sonnet
REASONER_FALLBACK=anthropic/claude-3.5-sonnet
SKEPTIC_FALLBACK=anthropic/claude-3.5-sonnet
SYNTHESIZER_FALLBACK=anthropic/claude-3.5-sonnet
VERIFIER_FALLBACK=anthropic/claude-3.5-sonnet
OUTLINE_ARCHITECT_FALLBACK=anthropic/claude-3.5-sonnet
SECTION_DRAFTER_FALLBACK=anthropic/claude-3.5-sonnet
INTERNAL_CHALLENGER_FALLBACK=anthropic/claude-3.5-sonnet
COHERENCE_REFINER_FALLBACK=anthropic/claude-3.5-sonnet
REVISION_INTAKE_FALLBACK=anthropic/claude-3.5-sonnet
REPORT_LOCATOR_FALLBACK=anthropic/claude-3.5-sonnet
CHANGE_PLANNER_FALLBACK=anthropic/claude-3.5-sonnet
SECTION_REWRITER_FALLBACK=anthropic/claude-3.5-sonnet
CITATION_INTEGRITY_CHECKER_FALLBACK=anthropic/claude-3.5-sonnet
FINAL_REVISION_VERIFIER_FALLBACK=anthropic/claude-3.5-sonnet

# Embedding
EMBEDDING_DIMENSIONS=1536
EMBEDDING_BATCH_SIZE=100

# Ingestion
MAX_CHUNK_SIZE=1000
CHUNK_OVERLAP=200
MAX_FILE_SIZE_MB=50

# Exports — canonical path must match nginx /exports alias
EXPORTS_DIR=/opt/researchone/exports

# Admin runtime control
ADMIN_RUNTIME_TOKEN=
RUNTIME_RESTART_COMMAND=pm2 restart researchone-api

# Autonomous discovery
DISCOVERY_ENABLED=true
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=
TAVILY_BASE_URL=https://api.tavily.com/search
# Optional/legacy providers only:
# SEARCH_PROVIDER=brave   -> requires SEARCH_PROVIDER_API_KEY
# SEARCH_PROVIDER=generic -> requires SEARCH_PROVIDER_BASE_URL (SearXNG, Serper, or compatible endpoint)
# SEARCH_PROVIDER=cascade -> optional architecture path (not recommended default)
SEARCH_PROVIDER_API_KEY=
SEARCH_PROVIDER_BASE_URL=
MAX_EXTERNAL_DISCOVERY_RESULTS=25
MAX_EXTERNAL_INGEST_PER_RUN=10
```

Use `backend/.env.production.example` as the source of truth for Emma runtime production config:

```bash
cp backend/.env.production.example backend/.env
```

### Frontend (Vercel) — Required for split deployment

```env
VITE_API_BASE_URL=https://<emma-runtime-vm-domain>
VITE_SOCKET_URL=https://<emma-runtime-vm-domain>
VITE_EXPORTS_BASE_URL=https://<emma-runtime-vm-domain>
```

Use the **API hostname** your nginx serves (for example `https://research-api.intellmeai.com`), not the Vercel app URL. Omit the `/api` suffix unless you already use a base that ends with `/api` (see `resolveApiBaseUrl` in `frontend/src/utils/api.ts`). **Redeploy after changing `VITE_*` values** so Vite embeds them.

**Diagnosing “404” on research:** In the browser Network tab, check the host of `POST .../research`. If it is your Vercel domain, `VITE_API_BASE_URL` was missing at build time. If the host is correct but the path is `/api/api/...`, remove the extra `/api` or trailing slash from `VITE_API_BASE_URL`. If research starts but fails later, open “Show error details” on the run and read `failure_meta.endpoint`: an OpenRouter URL means fix `OPENROUTER_BASE_URL` on the Emma VM, not Vercel.

**Smoke test from your machine (Emma edge):**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://<emma-api-host>/api/health
curl -sS -i -X POST "https://<emma-api-host>/api/research" \
  -H "Content-Type: application/json" \
  -d '{"query":"smoke test"}'
```

Expect `200` on health and `202` on research. On the VM, confirm `OPENROUTER_BASE_URL` is a **base** URL only (for example `https://openrouter.ai/api/v1`), not a full `/chat/completions` path — see `backend/src/config/index.ts`.

**Windows (PowerShell):** use `-o NUL` instead of `-o /dev/null` for the health curl line; `/dev/null` can trigger `curl: (23) client returned ERROR on write` even when the HTTP status is 200.

**Never put these in Vercel:** `OPENROUTER_API_KEY`, `JWT_SECRET`, `DATABASE_URL`, `DB_PASSWORD`, `REDIS_PASSWORD`

### Backend (Local development)

Use the explicit development template for local backend work:

```bash
cp backend/.env.development.example backend/.env
```

## Quick Start

### Mode B: Recommended — Vercel + Emma backend

#### 1. PostgreSQL (Emma Postgres VM)
```bash
chmod +x scripts/setup-postgres.sh
DB_PASSWORD=your_password ./scripts/setup-postgres.sh
```

#### 2. Redis (Emma Redis VM)
```bash
chmod +x scripts/setup-redis.sh
./scripts/setup-redis.sh
```

#### 3. Backend (Emma runtime VM)
```bash
chmod +x scripts/setup-runtime.sh
./scripts/setup-runtime.sh

# Configure environment
cp backend/.env.production.example backend/.env
# Edit backend/.env — set Emma Postgres/Redis hosts, OPENROUTER_API_KEY, JWT_SECRET, CORS_ORIGINS, TAVILY_API_KEY, ADMIN_RUNTIME_TOKEN

cd backend && npm install
npm run build
npm run migrate   # applies all migrations (001-004)

pm2 start ecosystem.config.js
# after env changes:
pm2 restart researchone-api --update-env
```

#### 4. Frontend (Vercel)
```bash
# In Vercel dashboard, add environment variables:
#   VITE_API_BASE_URL=https://<emma-runtime-vm>
#   VITE_SOCKET_URL=https://<emma-runtime-vm>
#   VITE_EXPORTS_BASE_URL=https://<emma-runtime-vm>

# Deploy via Vercel Git integration or:
cd frontend && npx vercel --prod
```

If the Vercel project **Root Directory** is the monorepo root, the root [`vercel.json`](vercel.json) applies. If the root is **`frontend/`**, use [`frontend/vercel.json`](frontend/vercel.json) so client-side routes like `/research` rewrite to `index.html`.

### GitHub Actions: backend deploy to Emma (on `main` push)

Merging to `main` triggers Vercel for the **frontend**. The workflow [`.github/workflows/deploy-backend-emma.yml`](.github/workflows/deploy-backend-emma.yml) runs on the **same** `push` to `main` (in parallel) when `backend/**`, `ecosystem.config.js`, or the workflow file changes. It builds `backend/dist` in Actions, **rsync**s `dist/`, `package.json`, and `package-lock.json` to the Emma VM, runs `npm ci --omit=dev` on the server, and **`pm2 restart researchone-api --update-env`**.

**Repository secrets** (GitHub → Settings → Secrets and variables → Actions):

| Secret | Required | Description |
|--------|----------|-------------|
| `EMMA_HOST` | Yes | SSH hostname or IP of the Emma **runtime** API VM |
| `EMMA_USER` | Yes | SSH user with write access to `${EMMA_DEPLOY_PATH}/backend` and permission to run `pm2` |
| `EMMA_SSH_KEY` | Yes | Private key (full PEM) for that user |
| `EMMA_DEPLOY_PATH` | No | App root on the server; default **`/opt/researchone`** (must match [`ecosystem.config.js`](ecosystem.config.js) `cwd`) |
| `EMMA_KNOWN_HOSTS` | No | One or more lines from `ssh-keyscan` for `EMMA_HOST` (recommended instead of relying on runtime `ssh-keyscan`) |

**Emma VM:** Node and PM2 already installed; `backend/.env` present on the server (not supplied by CI). The deploy user must be able to run `pm2 restart researchone-api` for the app defined in `ecosystem.config.js`.

**Manual run:** Actions → “Deploy backend to Emma” → Run workflow.

### Mode A: All-in-one (development/legacy)
```bash
docker-compose up postgres redis

# Backend
cd backend
cp .env.development.example .env   # local dev backend defaults
npm run dev

# Frontend (separate terminal)
cd frontend
cp .env.example .env.local  # leave VITE_* blank for same-origin mode
npm run dev
```

## Project Structure
```
ResearchOne/
├── backend/
│   ├── .env.production.example     # Emma runtime production template
│   ├── .env.development.example    # Local backend development template
│   ├── src/
│   │   ├── api/
│   │   │   ├── app.ts              # Express application
│   │   │   └── routes/             # All API routes
│   │   ├── config/                 # Configuration (all env vars)
│   │   ├── db/
│   │   │   ├── migrations/
│   │   │   │   ├── 001_initial_schema.sql
│   │   │   │   └── 002_research_governance_and_discovery.sql
│   │   │   ├── migrate.ts          # Migration runner
│   │   │   └── pool.ts             # PostgreSQL connection pool
│   │   ├── queue/
│   │   │   ├── queues.ts           # BullMQ queue definitions
│   │   │   ├── redis.ts            # Redis connection (with password support)
│   │   │   └── workers.ts          # BullMQ workers
│   │   └── services/
│   │       ├── discovery/          # Autonomous external research discovery
│   │       │   ├── discoveryOrchestrator.ts
│   │       │   ├── providerTypes.ts
│   │       │   └── providers/      # Search provider abstraction
│   │       ├── embedding/          # Embedding generation + Atlas export
│   │       ├── ingestion/          # Source ingestion (PDF, markdown, txt, URL)
│   │       │   ├── pdfExtractor.ts
│   │       │   ├── markdownNormalizer.ts
│   │       │   └── ingestionService.ts
│   │       ├── openrouter/         # Model routing + prompts (all roles w/ fallbacks)
│   │       ├── reasoning/          # Research orchestrator + epistemic persistence
│   │       │   ├── researchOrchestrator.ts
│   │       │   ├── claimExtractor.ts
│   │       │   ├── contradictionExtractor.ts
│   │       │   └── citationMapper.ts
│   │       └── retrieval/          # Hybrid vector + FTS retrieval
├── frontend/
│   ├── .env.example                # Vercel env template
│   └── src/
│       ├── pages/                  # All UI pages
│       ├── components/             # Reusable UI components
│       ├── store/                  # Zustand global state
│       └── utils/
│           ├── api.ts              # Configurable baseURL (VITE_API_BASE_URL)
│           └── socket.ts           # Configurable socket URL (VITE_SOCKET_URL)
├── scripts/                        # Infrastructure setup scripts
├── docker-compose.yml
└── ecosystem.config.js             # PM2 config
```

## Reasoning-first Model Policy

Research direction and paper-building are restricted to reasoning-class models only, including all fallbacks.

- Startup validates every required role and fallback.
- Startup fails if any required role is missing.
- Startup fails if any fallback is missing.
- Startup fails if any configured model is outside the approved reasoning allowlist.

Approved reasoning allowlist (role-specific policy module):

- `deepseek/deepseek-r1`
- `anthropic/claude-3.5-sonnet`
- `anthropic/claude-3.7-sonnet`
- `openai/o3-mini`
- `openai/o3`
- `openai/o1`

Role separation for report generation now uses:

- Outline Architect
- Section Drafter
- Internal Challenger
- Coherence Refiner

Revision roles also enforce reasoning-only routing:

- Revision Intake
- Report Locator
- Change Planner
- Section Rewriter
- Citation Integrity Checker
- Final Revision Verifier

All prompts inject a shared reasoning-first epistemic preamble:

- reason from structure/mechanism first
- use corpus recall as support, not master constraint
- avoid premature collapse due debunked-status recall
- preserve contradictions and unresolved tensions
- investigate dismissed theories via alternate framing, hidden assumptions, adversarial counter-models, and falsification branching

## Autonomous External Research Discovery

When a research run starts, a discovery planner stage evaluates whether external sources are needed. If yes:

1. Bounded search queries are executed via the configured search provider
2. Candidates are deduplicated by normalised URL
3. Selected sources are ingested automatically (up to `MAX_EXTERNAL_INGEST_PER_RUN`)
4. Discovery events are persisted to `discovery_events` for full auditability
5. Retrieval runs across the enriched corpus

Recommended production setup:

- `DISCOVERY_ENABLED=true`
- `SEARCH_PROVIDER=tavily`
- `TAVILY_API_KEY=...`
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`

Optional/legacy alternatives:

- `SEARCH_PROVIDER=brave` (legacy optional provider; requires `SEARCH_PROVIDER_API_KEY`)
- `SEARCH_PROVIDER=generic` (legacy optional provider; requires `SEARCH_PROVIDER_BASE_URL`)
- `SEARCH_PROVIDER=cascade` (optional architecture path; not the recommended default)

## Ingestion Support

| Type | Route | Notes |
|------|-------|-------|
| URL | `POST /api/ingestion/url` | HTML extraction with boilerplate removal, canonical URL, meta description |
| Plain text | `POST /api/ingestion/text` | Direct text with title |
| File upload (.txt) | `POST /api/ingestion/file` | UTF-8 text |
| File upload (.md) | `POST /api/ingestion/file` | Markdown → clean text with structure preservation |
| File upload (.pdf) | `POST /api/ingestion/file` | PDF → extracted text via pdf-parse |

All ingestion paths preserve provenance metadata: `imported_via`, `discovered_by_run_id`, `discovery_query`, `source_rank`, `fetch_method`, `original_mime_type`, `original_filename`, `canonical_url`, `retrieval_timestamp`.

## Embedding Atlas Workflow

1. Ingest and embed your corpus
2. Create an export via `/api/atlas/export` or the Atlas UI page
3. Download the `.jsonl` file from `/exports/` (or via `VITE_EXPORTS_BASE_URL` in Vercel mode)
4. Upload to [Nomic Atlas](https://atlas.nomic.ai)
5. Investigate: `dense_cluster_candidate` → consensus; `outlier_candidate` → leads; `bridge_candidate` → overlooked connections

Atlas points now include: `source_type`, `imported_via`, `discovered_by_run_id`, `discovery_query`, `source_rank`, `evidence_tier`, `cluster_hint`.

## License

See LICENSE file.
