# ResearchOne

**Disciplined Anomaly Research Platform** — A structured evidence-gathering, reasoning, and long-form research reporting system built for deep scientific and ontological investigation.

> Not a chatbot. Not a hallucination machine. A disciplined investigation engine with epistemic governance built in.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        INFRASTRUCTURE                           │
│                                                                 │
│  truvector-runtime (45.55.250.106)                              │
│  ├── ResearchOne API (Express + WebSocket)                      │
│  ├── BullMQ Workers (Ingestion, Embedding, Research, Atlas)     │
│  └── Nginx (Frontend + API reverse proxy)                       │
│                                                                 │
│  truvector-postgres (138.197.11.203)                            │
│  └── PostgreSQL + pgvector (corpus, chunks, embeddings,         │
│       claims, contradictions, reports)                          │
│                                                                 │
│  truvector-redis (45.55.69.68)                                  │
│  └── Redis (BullMQ job queues, job state, caching)              │
│                                                                 │
│  OpenRouter (remote inference)                                  │
│  ├── Planner: DeepSeek-R1                                       │
│  ├── Retriever: DeepSeek-R1                                     │
│  ├── Reasoner: DeepSeek-R1                                      │
│  ├── Skeptic: DeepSeek-R1                                       │
│  ├── Synthesizer: Qwen-2.5-72B                                  │
│  └── Verifier: DeepSeek-R1                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Research Philosophy

1. **Dense centers are context, not final truth.** Consensus clustering reflects repetition, not correctness.
2. **Outliers are leads, not verdicts.** Investigate, don't dismiss or blindly trust.
3. **Bridges are high-value.** Sparse connections between conceptual regions often indicate overlooked relationships.
4. **Reason backward from anomalies.** If an outlier were true, what structure would have to exist?
5. **Preserve epistemic distinctions.** Every claim tagged: `established_fact | strong_evidence | testimony | inference | speculation`
6. **Contradiction is a first-class data type.** Never suppressed.
7. **Reports must attack themselves.** Skeptic → Synthesizer → Verifier pipeline.
8. **Atlas is an investigation map, not an oracle.**

## 6-Role Research Pipeline

| Role | Model | Purpose |
|------|-------|---------|
| Planner | DeepSeek-R1 | Decomposes query into sub-questions, retrieval targets, hypothesis, falsification criteria |
| Retriever | DeepSeek-R1 | Analyzes retrieved evidence by tier, flags outliers and bridges |
| Reasoner | DeepSeek-R1 | Builds structured argument chains, tags all claims by evidence tier |
| Skeptic | DeepSeek-R1 | Attacks conclusions, finds alternatives, prevents confirmation bias |
| Synthesizer | Qwen-2.5-72B | Writes the complete long-form research report |
| Verifier | DeepSeek-R1 | Epistemic quality gate — ensures standards are met before finalization |

## Database Schema

Key tables:
- `sources` — Every external resource ingested
- `documents` — Processed document content
- `chunks` — Segmented fragments for retrieval (with FTS indexes)
- `embeddings` — pgvector vectors for semantic search (HNSW index)
- `entities` / `entity_mentions` — Named entity extraction
- `claims` — Discrete factual assertions with evidence tiers
- `contradictions` — Explicit contradiction records (first-class data)
- `research_runs` — Full workflow execution records with model logs
- `reports` + `report_sections` — Structured long-form research reports
- `report_citations` — Evidence → section links
- `atlas_exports` — Embedding Atlas export snapshots
- `error_log` — Structured error tracking

## Quick Start

### 1. PostgreSQL (truvector-postgres)
```bash
chmod +x scripts/setup-postgres.sh
DB_PASSWORD=your_password ./scripts/setup-postgres.sh
```

### 2. Redis (truvector-redis)
```bash
chmod +x scripts/setup-redis.sh
./scripts/setup-redis.sh
```

### 3. Runtime (truvector-runtime)
```bash
chmod +x scripts/setup-runtime.sh
./scripts/setup-runtime.sh

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your credentials

# Install dependencies
cd backend && npm install
npm run build
npm run migrate   # runs schema migrations

# Start
pm2 start ecosystem.config.js
```

### 4. Frontend
```bash
cd frontend
npm install
npm run build
# Dist is served by Nginx at /opt/researchone/frontend/dist
```

### Local Development
```bash
# Start infrastructure
docker-compose up postgres redis

# Backend
cd backend
cp .env.example .env  # edit with dev settings
npm run dev

# Frontend (separate terminal)
cd frontend
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
│   │   ├── config/                 # Configuration
│   │   ├── db/
│   │   │   ├── migrations/         # SQL schema migrations
│   │   │   ├── migrate.ts          # Migration runner
│   │   │   └── pool.ts             # PostgreSQL connection pool
│   │   ├── queue/
│   │   │   ├── queues.ts           # BullMQ queue definitions
│   │   │   ├── redis.ts            # Redis connection
│   │   │   └── workers.ts          # BullMQ workers
│   │   ├── services/
│   │   │   ├── embedding/          # Embedding generation + Atlas export
│   │   │   ├── ingestion/          # Source ingestion + chunking
│   │   │   ├── openrouter/         # Model routing + prompts
│   │   │   ├── reasoning/          # 6-role research orchestrator
│   │   │   └── retrieval/          # Hybrid vector + FTS retrieval
│   │   └── utils/                  # Logger, helpers
│   └── Dockerfile
├── frontend/
│   └── src/
│       ├── pages/                  # All UI pages
│       ├── components/             # Reusable UI components
│       ├── store/                  # Zustand global state
│       └── utils/                  # API client, WebSocket
├── scripts/                        # Infrastructure setup scripts
├── docker-compose.yml
└── ecosystem.config.js             # PM2 config
```

## OpenRouter Model Strategy

Primary models with automatic fallback:
- **Reasoner/Skeptic/Verifier**: DeepSeek-R1 → Claude 3.5 Sonnet (fallback)
- **Synthesizer**: Qwen-2.5-72B-Instruct (long-context reports)
- **Embeddings**: OpenAI text-embedding-3-small (via OpenRouter)

Each model role has distinct temperature settings:
- Planning/Retrieval/Verification: Low temperature (0.1–0.3) for precision
- Skeptic/Synthesizer: Moderate temperature (0.4–0.5) for creative challenge

## Hugging Face Model Procurement

For future self-hosted inference:
- **DeepSeek-R1**: `deepseek-ai/DeepSeek-R1` (671B) / `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B` (32B, production-viable)
- **Qwen Synthesizer**: `Qwen/Qwen2.5-72B-Instruct` (long-context synthesis)
- **Embeddings**: `BAAI/bge-m3` (multilingual, local alternative)

Keep model procurement separate from runtime orchestration. The runtime only references model names via environment variables.

## Embedding Atlas Workflow

1. Ingest and embed your corpus
2. Create an export via `/api/atlas/export` or the Atlas UI page
3. Download the `.jsonl` file
4. Upload to [Nomic Atlas](https://atlas.nomic.ai)
5. Investigate: dense clusters → consensus; outliers → leads; bridges → overlooked connections
6. Bring interesting topics back to ResearchOne for targeted research

## License

See LICENSE file.

