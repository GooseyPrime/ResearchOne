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
│  ├── Synthesizer: Qwen-2.5-72B → Qwen-2.5-72B (fallback)       │
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
- `atlas_exports` — Embedding Atlas export snapshots
- `discovery_events` — Audit log for all autonomous discovery activity
- `ingestion_artifacts` — Optional ingestion audit (hashes, parse warnings)
- `error_log` — Structured error tracking

Migrations: `001_initial_schema.sql` → `002_research_governance_and_discovery.sql`

## Environment Variables

### Backend (Emma runtime VM) — Required

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
CORS_ORIGINS=https://<your-vercel-frontend-domain>,http://localhost:5173

# Model routing
PLANNER_MODEL=deepseek/deepseek-r1
RETRIEVER_MODEL=deepseek/deepseek-r1
REASONER_MODEL=deepseek/deepseek-r1
SKEPTIC_MODEL=deepseek/deepseek-r1
SYNTHESIZER_MODEL=qwen/qwen-2.5-72b-instruct
VERIFIER_MODEL=deepseek/deepseek-r1
EMBEDDING_MODEL=openai/text-embedding-3-small

# Fallbacks (all roles now supported)
PLANNER_FALLBACK=anthropic/claude-3.5-sonnet
RETRIEVER_FALLBACK=anthropic/claude-3.5-sonnet
REASONER_FALLBACK=anthropic/claude-3.5-sonnet
SKEPTIC_FALLBACK=anthropic/claude-3.5-sonnet
SYNTHESIZER_FALLBACK=qwen/qwen-2.5-72b-instruct
VERIFIER_FALLBACK=anthropic/claude-3.5-sonnet

# Embedding
EMBEDDING_DIMENSIONS=1536
EMBEDDING_BATCH_SIZE=100

# Ingestion
MAX_CHUNK_SIZE=1000
CHUNK_OVERLAP=200
MAX_FILE_SIZE_MB=50

# Exports — canonical path must match nginx /exports alias
EXPORTS_DIR=/opt/researchone/exports

# Autonomous discovery
DISCOVERY_ENABLED=true
SEARCH_PROVIDER=generic
SEARCH_PROVIDER_API_KEY=
SEARCH_PROVIDER_BASE_URL=    # SearXNG, Serper, or compatible JSON search endpoint
MAX_EXTERNAL_DISCOVERY_RESULTS=25
MAX_EXTERNAL_INGEST_PER_RUN=10
```

### Frontend (Vercel) — Required for split deployment

```env
VITE_API_BASE_URL=https://<emma-runtime-vm-domain>
VITE_SOCKET_URL=https://<emma-runtime-vm-domain>
VITE_EXPORTS_BASE_URL=https://<emma-runtime-vm-domain>
```

**Never put these in Vercel:** `OPENROUTER_API_KEY`, `JWT_SECRET`, `DATABASE_URL`, `DB_PASSWORD`, `REDIS_PASSWORD`

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
cp backend/.env.example backend/.env
# Edit backend/.env — set DATABASE_URL, REDIS_URL, OPENROUTER_API_KEY, JWT_SECRET, CORS_ORIGINS, EXPORTS_DIR
# Set CORS_ORIGINS to include your Vercel frontend domain

cd backend && npm install
npm run build
npm run migrate   # applies 001 and 002 migrations

pm2 start ecosystem.config.js
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

### Mode A: All-in-one (development/legacy)
```bash
docker-compose up postgres redis

# Backend
cd backend
cp .env.example .env   # edit with dev settings (leave VITE_* vars unset)
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

## OpenRouter Model Strategy

All six roles now have automatic fallback:

| Role | Primary | Fallback |
|------|---------|---------|
| Planner | DeepSeek-R1 | Claude 3.5 Sonnet |
| Retriever | DeepSeek-R1 | Claude 3.5 Sonnet |
| Reasoner | DeepSeek-R1 | Claude 3.5 Sonnet |
| Skeptic | DeepSeek-R1 | Claude 3.5 Sonnet |
| Synthesizer | Qwen-2.5-72B | Qwen-2.5-72B |
| Verifier | DeepSeek-R1 | Claude 3.5 Sonnet |

Model log entries now include `usedFallback`, `primaryModel`, and `errorClassification` for operational debugging.

## Autonomous External Research Discovery

When a research run starts, a discovery planner stage evaluates whether external sources are needed. If yes:

1. Bounded search queries are executed via the configured search provider
2. Candidates are deduplicated by normalised URL
3. Selected sources are ingested automatically (up to `MAX_EXTERNAL_INGEST_PER_RUN`)
4. Discovery events are persisted to `discovery_events` for full auditability
5. Retrieval runs across the enriched corpus

To enable: set `DISCOVERY_ENABLED=true` and configure `SEARCH_PROVIDER_BASE_URL` with a compatible JSON search endpoint (SearXNG, Serper, or custom).

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
