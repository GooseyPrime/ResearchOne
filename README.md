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
│  Tiered defaults in backend/src/config/index.ts (per-role env   │
│  overrides). Examples: Kimi K2 Thinking + DeepSeek-R1 (planning  │
│  & core reasoning); Claude Sonnet 4.5 + Gemini 2.5 Pro (reports │
│  & sections); GPT-5-mini (structured JSON); distinct fallbacks.  │
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

There are **two different places** configuration lives. Do not mix them up:

| Where | What goes there |
|-------|------------------|
| **`backend/.env` on the Emma VM** (and the templates `backend/.env.production.example` / `backend/.env.development.example`) | Runtime secrets for the Node API: database, Redis, OpenRouter, `JWT_SECRET`, `CORS_ORIGINS`, etc. **No `EMMA_*` keys** — the running app never reads those names. |
| **GitHub → Settings → Secrets and variables → Actions** | **Only** for the [Deploy backend to Emma](.github/workflows/deploy-backend-emma.yml) workflow: `EMMA_HOST`, `EMMA_USER`, `EMMA_SSH_KEY`, etc. These are **not** copied into `backend/.env` unless you explicitly use the optional `EMMA_WRITE_BACKEND_ENV` secret (which writes the **whole** API env file on the server — still not individual `EMMA_SSH_*` lines in the template). |

If deploy fails with SSH or permission errors, the fix is in **GitHub repository secrets** and **server SSH authorized_keys** for `EMMA_USER`, not in `backend/.env.production.example`.

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

# Model routing (defaults — omit to use code defaults in backend/src/config/index.ts)
PLANNER_MODEL=moonshotai/kimi-k2-thinking
RETRIEVER_MODEL=deepseek/deepseek-v3.2
REASONER_MODEL=deepseek/deepseek-r1
SKEPTIC_MODEL=moonshotai/kimi-k2-thinking
SYNTHESIZER_MODEL=anthropic/claude-sonnet-4.5
VERIFIER_MODEL=anthropic/claude-sonnet-4
OUTLINE_ARCHITECT_MODEL=moonshotai/kimi-k2-thinking
SECTION_DRAFTER_MODEL=google/gemini-2.5-pro
INTERNAL_CHALLENGER_MODEL=moonshotai/kimi-k2-thinking
COHERENCE_REFINER_MODEL=anthropic/claude-sonnet-4.5
REVISION_INTAKE_MODEL=openai/gpt-5-mini
REPORT_LOCATOR_MODEL=openai/gpt-5-mini
CHANGE_PLANNER_MODEL=moonshotai/kimi-k2-thinking
SECTION_REWRITER_MODEL=google/gemini-2.5-pro
CITATION_INTEGRITY_CHECKER_MODEL=mistralai/mistral-small-3.2-24b-instruct
FINAL_REVISION_VERIFIER_MODEL=anthropic/claude-sonnet-4
EMBEDDING_MODEL=openai/text-embedding-3-small

# Fallbacks (per role — distinct provider families where possible)
PLANNER_FALLBACK=deepseek/deepseek-r1
RETRIEVER_FALLBACK=google/gemini-2.5-flash
REASONER_FALLBACK=moonshotai/kimi-k2-thinking
SKEPTIC_FALLBACK=anthropic/claude-sonnet-4
SYNTHESIZER_FALLBACK=google/gemini-2.5-pro
VERIFIER_FALLBACK=openai/o3-mini
OUTLINE_ARCHITECT_FALLBACK=deepseek/deepseek-r1
SECTION_DRAFTER_FALLBACK=anthropic/claude-sonnet-4
INTERNAL_CHALLENGER_FALLBACK=anthropic/claude-sonnet-4
COHERENCE_REFINER_FALLBACK=google/gemini-2.5-pro
REVISION_INTAKE_FALLBACK=qwen/qwen3-235b-a22b
REPORT_LOCATOR_FALLBACK=qwen/qwen3-235b-a22b
CHANGE_PLANNER_FALLBACK=deepseek/deepseek-r1
SECTION_REWRITER_FALLBACK=anthropic/claude-sonnet-4
CITATION_INTEGRITY_CHECKER_FALLBACK=meta-llama/llama-3.3-70b-instruct
FINAL_REVISION_VERIFIER_FALLBACK=openai/o3-mini

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

**Which `.env` file is which (do not confuse these):**

| File | Role |
|------|------|
| `backend/.env.example` | Pointer only — tells you to copy a real template |
| `backend/.env.production.example` | **Committed template** for Emma/production — copy to `backend/.env` and edit |
| `backend/.env.development.example` | **Committed template** for local backend dev — copy to `backend/.env` for laptop work |
| `backend/.env` | **Real runtime secrets** — gitignored; this is what Node and PM2 use on the VM and locally |

Emma runtime production setup:

```bash
cp backend/.env.production.example backend/.env
# edit backend/.env — never commit it
```

### Frontend (Vercel) — Required for split deployment

```env
VITE_API_BASE_URL=https://<emma-runtime-vm-domain>
VITE_SOCKET_URL=https://<emma-runtime-vm-domain>
VITE_EXPORTS_BASE_URL=https://<emma-runtime-vm-domain>
```

Set each `VITE_*` value to the **origin only** (scheme + host, no path): correct `https://api.example.com`, wrong `https://api.example.com/api`. The client code appends `/api` itself (`resolveApiBaseUrl` in `frontend/src/utils/api.ts`). Use the hostname nginx serves on the Emma VM, not the Vercel URL. **Redeploy the frontend after changing `VITE_*`** so Vite embeds them.

If your VM only exposes **HTTP on port 80** (no TLS / no listener on 443), use `http://` in `VITE_*` until TLS is configured. Public `https://` smoke tests only work when HTTPS is actually terminated (443).

**Diagnosing “404” on research:** In the browser Network tab, check the host of `POST .../research`. If it is your Vercel domain, `VITE_API_BASE_URL` was missing at build time. If the host is correct but the path is `/api/api/...`, remove the extra `/api` or trailing slash from `VITE_API_BASE_URL`. If research starts but fails later, open “Show error details” on the run and read `failure_meta.endpoint`: an OpenRouter URL means fix `OPENROUTER_BASE_URL` on the Emma VM, not Vercel.

**Smoke test from your machine (Emma edge):** use `https://` only if TLS is configured; otherwise `http://` on port 80.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "https://<emma-api-host>/api/health"
curl -sS -i -X POST "https://<emma-api-host>/api/research" \
  -H "Content-Type: application/json" \
  -d '{"query":"smoke test"}'
```

On the **VM**, localhost always works for the API process:

```bash
curl -sS "http://127.0.0.1:3001/api/health"
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

One-time: clone this repo to `/opt/researchone`, configure `backend/.env`, run `scripts/setup-runtime.sh` for nginx/user/exports.

**Canonical app root:** `/opt/researchone` (must match [`ecosystem.config.js`](ecosystem.config.js) `cwd`). **All PM2 commands that use `ecosystem.config.js` must be run from that directory**, not from `backend/`:

```bash
cd /opt/researchone
```

**Deploy / update (idempotent):** runs `git fetch` + `reset` to `origin/main`, full `npm ci`, `build`, `migrate`, PM2 from the ecosystem file, and a localhost health smoke test:

```bash
cd /opt/researchone
cp backend/.env.production.example backend/.env   # first time only; then edit backend/.env
./scripts/deploy-runtime.sh
```

After changing only `backend/.env` (no git pull):

```bash
cd /opt/researchone
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

Merging to `main` triggers Vercel for the **frontend** independently. The workflow [`.github/workflows/deploy-backend-emma.yml`](.github/workflows/deploy-backend-emma.yml) SSHs to the Emma VM and runs [`scripts/deploy-runtime.sh`](scripts/deploy-runtime.sh): the VM **fetches and resets to `origin/main`**, runs **`npm ci`** (full install, including devDependencies required for migrations), **`npm run build`**, **`npm run migrate`**, then starts or reloads PM2 from **`ecosystem.config.js`**. The backend is **not** built in Actions and rsynced anymore; the VM always runs the current tree from git.

**Secrets for this workflow** can live in either place — **not** both required:

- **Repository secrets:** GitHub → repo → Settings → Secrets and variables → **Actions** (tab “Repository secrets”).
- **Environment secrets:** Settings → **Environments** → e.g. `production` → **Environment secrets**. If you use these, the workflow job must declare `environment: production` (see [`.github/workflows/deploy-backend-emma.yml`](.github/workflows/deploy-backend-emma.yml)); otherwise `secrets.EMMA_SSH_KEY` is **empty** and `webfactory/ssh-agent` fails with “ssh-private-key argument is empty”.

These are **not** listed in `backend/.env.production.example` because Actions reads them only at workflow runtime:

| Secret | Required | Description |
|--------|----------|-------------|
| `EMMA_HOST` | Yes | SSH hostname or IP of the Emma **runtime** API VM |
| `EMMA_USER` | Yes | SSH user with write access to the deploy path and permission to run `git`, `npm`, and `pm2` |
| `EMMA_SSH_KEY` | Yes | **Private** key (full PEM), including `-----BEGIN ... PRIVATE KEY-----` and `-----END...` lines — the same material as your local `id_rsa` / `.pem` file, **not** the `.pub` public key |
| `EMMA_DEPLOY_PATH` | No | App root on the server; default **`/opt/researchone`** (must match [`ecosystem.config.js`](ecosystem.config.js) `cwd`) |
| `EMMA_PORT` | No | SSH port on the VM; default **`22`**. Set if `sshd` listens elsewhere. Regenerate **`EMMA_KNOWN_HOSTS`** with `ssh-keyscan -p <port> -H <host>` when the port is not 22. |
| `EMMA_KNOWN_HOSTS` | No | One or more lines from `ssh-keyscan` for `EMMA_HOST` (recommended) |
| `EMMA_WRITE_BACKEND_ENV` | No | **Opt-in:** multiline contents written to `backend/.env` on the VM before deploy (only if you choose CI-managed secrets) |
| `EMMA_PUBLIC_HEALTH_URL` | No | **Opt-in:** full URL for an extra curl after deploy (use `http://` or `https://` to match your TLS setup) |

**If `EMMA_SSH_KEY` “looks right” but SSH still fails:** confirm the matching **public** key is in **`EMMA_USER`’s `~/.ssh/authorized_keys`** on the VM; confirm the secret is the **private** key for that pair; paste the PEM with **no** extra quotes or `Key::` prefixes; for ed25519 use `BEGIN OPENSSH PRIVATE KEY` PEM as output by `ssh-keygen`. Workflows triggered from **fork PRs** do not receive repository secrets — use **`workflow_dispatch`** on `main` or merge to **`main`** on this repo.

**Emma VM:** must be a **git clone** of this repo with `origin` reachable; `backend/.env` must exist on the server unless you use `EMMA_WRITE_BACKEND_ENV`.

**If the workflow fails with `Connection timed out` to `EMMA_HOST` port 22:** GitHub-hosted runners run on the public internet. The VM must have a **routable** `EMMA_HOST` (not a private LAN IP), **`sshd` listening** on **`EMMA_PORT`** (default 22), and your cloud **firewall / security group** must **allow inbound TCP** from the internet (or from [GitHub Actions IP ranges](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners#ip-addresses-of-github-hosted-runners) if you restrict sources). Your laptop working while Actions times out usually means the runner’s IP is blocked.

**Manual run:** Actions → “Deploy backend to Emma” → Run workflow.

After pulling new backend migrations, run `npm run migrate` on Emma so tables/columns exist for **runtime model overrides** (`004_runtime_model_overrides.sql`) and **research run progress polling** (`005_research_run_progress_columns.sql`).

**Model routing (UI):** Sidebar → **Models** (`/models`) — requires admin token; saves overrides in Postgres (not `.env`). Same allowlist as [`reasoningModelPolicy`](backend/src/services/reasoning/reasoningModelPolicy.ts).

**PM2 logs in System status:** If runtime logs return 404, set `RUNTIME_LOG_OUT` and `RUNTIME_LOG_ERR` on the server to paths from `pm2 describe researchone-api` (the API tries several default paths automatically).

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
│   ├── .env.production.example     # Emma runtime production template (copy → .env)
│   ├── .env.development.example    # Local backend development template (copy → .env)
│   ├── .env.example                # Pointer — use one of the templates above
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

Approved reasoning allowlist (`backend/src/services/reasoning/reasoningModelPolicy.ts`). Confirm IDs still exist in [OpenRouter’s model list](https://openrouter.ai/models) or `GET https://openrouter.ai/api/v1/models` — stale slugs return HTTP 404 from `/chat/completions`.

- `anthropic/claude-3.5-haiku`
- `anthropic/claude-3.7-sonnet`
- `anthropic/claude-sonnet-4`
- `anthropic/claude-sonnet-4.5`
- `deepseek/deepseek-chat`
- `deepseek/deepseek-r1`
- `deepseek/deepseek-v3.2`
- `google/gemini-2.5-flash`
- `google/gemini-2.5-pro`
- `meta-llama/llama-3.3-70b-instruct`
- `mistralai/mistral-small-3.2-24b-instruct`
- `moonshotai/kimi-k2-thinking`
- `openai/gpt-5-mini`
- `openai/o1`
- `openai/o3`
- `openai/o3-mini`
- `qwen/qwen3-235b-a22b`

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
