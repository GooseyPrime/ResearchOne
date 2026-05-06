# Work Order A — Baseline repository audit (read-only)

**Date:** 2026-05-06  
**Canonical spec:** `docs/ResearchOne_Final_Report.md` (Section 9 assumptions, Section 14 work orders).  
**Immutables:** `REASONING_FIRST_PREAMBLE` (`backend/src/constants/prompts.ts`), `RED_TEAM_V2_SYSTEM_PREFIX` (`backend/src/services/reasoning/reasoningModelPolicy.ts`) — verified present, not modified in this phase.

---

## 1. Reading-list acknowledgment (§1 of agent instructions)

| Item | What it constrains |
|------|---------------------|
| **AGENTS.md** | Read PolicyOne + V2 criteria first; never silently swap V2 defaults; extend rules when reviews find new failure classes. |
| **00-pre-commit-review.mdc** | Full-file reads before staging; grep callers/writers; tests fail without fix; tsc+vitest after edits; deploy-skew; doc/PR parity; immutable preambles; ≥2 upstreams before “multi-provider.” |
| **10–17, 20 .cursor/rules/** | Multi-writer/state, logging parity, event window `[...prev,new].slice(-N)`, migration skew + fallback UPDATE parity + no-tx migrations, third-party contracts + `isHfRepoModel` single router, doc parity + verify external claims, strong tests, grep ripples, V2 behavioral test + forbidden defaults + preflight. |
| **ResearchOne PolicyOne** | Reasoning-first; no recall-as-truth; preserve anomalies; no sanitize/debunk in corpus/metadata paths. |
| **docs/V2_MODEL_SELECTION_CRITERIA.md** | Binding inference-time behavior; critical-path ≥2 OpenRouter upstreams; forbidden-default list + regression test; document provider counts honestly. |
| **docs/V2_STATE_MACHINE_AND_PROVIDER_PLAN_2026-04-28.md** | V2 failure UI/socket/column coherence; HF vs OpenRouter deployability; multi-writer hazards. |
| **docs/V2_RELIABILITY_PLAN_2026-04-26.md** | V2 reliability + visibility; corrected matrix vs refusal-aligned primaries; HF catalog reality. |
| **docs/V2_OUTAGE_POSTMORTEM_2026-04-28-PM.md** | Single-upstream Hermes shape; provider block + `provider` request body; 404 classification; preflight probe rationale. |
| **Research Policy Model Compliance Review - Google Gemini.pdf** | Training-label vs inference-behavior framing for V2 (referenced in criteria; binary not in repo — not re-read as bytes here). |
| **ResearchOne_Update_041626.pdf** | Phased fix plan per report/WO P/O; binary not in repo — not re-read as bytes here. |
| **README.md** | Mode B: Vercel frontend + Emma API/workers/Postgres/Redis/OpenRouter; V2 multi-provider reasoners named. |
| **docs/ResearchOne_Final_Report.md** | Commercial/architecture/work-order spine; Section 9 snapshot vs current repo reconciled below. |
| **docs/ROUTE_A_IMPLEMENTATION_SPEC_FOR_CODING_AGENT.txt** | Route A gaps (split deploy, PDF/MD ingestion, discovery, persistence, Atlas path, Redis auth, fallbacks). |

---

## 2. Section 9 (Repo Technical Audit) — confirm or refute

Evidence from this workspace (not the Drive snapshot described in the report).

| Section 9 claim | Verdict | Evidence |
|-----------------|--------|----------|
| Stack: React+Vite frontend, Express backend | **Confirmed** | `frontend/package.json`, `backend/package.json` |
| No Clerk / Stripe in dependencies | **Confirmed** | Neither in backend or frontend `package.json` |
| No `users`, `user_tiers`, billing tables | **Confirmed** | Schema inventory — no such tables in migrations |
| No RLS | **Confirmed** | No RLS in migrations |
| No authentication on API | **Confirmed** | No auth middleware in `backend/src/api/app.ts`; admin routes use static token only |
| Commercial pages absent (landing, pricing, auth UI) | **Confirmed** | `frontend/src/App.tsx` only workbench routes; redirect `/` → `/research` |
| README route naming vs code | **Partial mismatch** | README lists `POST /api/research/runs`; code uses **`POST /api/research`** (`research.ts` router on `/`) |
| **Route A spec gaps** | **Partially overtaken by code** | PDF/Markdown extraction exists (`pdfExtractor.ts`, `markdownNormalizer.ts`, ingestion routes); discovery pipeline exists under `services/discovery/`; claims/contradictions persistence implemented in orchestrator services — spec still useful for **split-deploy UX** and **remaining gaps** |
| Vercel SPA rewrite | **Confirmed** | `vercel.json` and `frontend/vercel.json` both have `"rewrites": [{ "source": "/(.*)", "destination": "/" }]` |
| PR #41 status unconfirmed | **Refuted for this repo** | Git merge commit present (see §5) |

---

## 3. Section 14 vs `.docx` exports — reconciliation

**No `*.docx` files exist under `/workspace`** (glob `**/*.docx` returned 0). The derivative exports described in the instructions are **not present** in this clone; Section 14 remains canonical.

| Letter | Title (Section 14) | Matching `.docx` | Header match | Discrepancies |
|--------|----------------------|-------------------|--------------|---------------|
| A | Repository audit and baseline test pass | No | N/A | — |
| B | Landing page implementation | No | N/A | — |
| C | Clerk auth implementation | No | N/A | — |
| D | Protected routes and user session wiring | No | N/A | — |
| E | Stripe wallet + checkout | No | N/A | — |
| F | Stripe webhook + ledger | No | N/A | — |
| G | Tier tables and access enforcement | No | N/A | — |
| H | Research-run credit enforcement | No | N/A | — |
| I | BYOK key storage and routing | No | N/A | — |
| J | Enterprise single-tenant routing abstraction | No | N/A | — |
| K | RLS migration and shared DB isolation | No | N/A | — |
| L | InTellMe sanitized ingestion pipeline | No | N/A | — |
| M | V2 prompt templates and mode overlays | No | N/A | — |
| N | Admin dashboard | No | N/A | — |
| O | Observability, error states, and legal stubs | No | N/A | — |
| P | Production deployment hardening | No | N/A | — |
| Q | Final QA and release checklist | No | N/A | — |

**Note:** Reported header bugs (K/J, N/O, Q/P) **cannot be verified** without the `.docx` blobs; add them to the repo or point the agent at their path if reconciliation must be evidence-based.

---

## 4. Deliverables from WO A inspect list (abbreviated)

| Artifact | Result |
|----------|--------|
| **Migrations** | `docs/audit/2026-05-06-schema-inventory.md` |
| **API routes** | `docs/audit/2026-05-06-api-inventory.md` |
| **`backend/src/services/agents/`** | **Path does not exist.** Orchestration lives under `services/reasoning/` (orchestrator, report generator, claim/contradiction extractors), `services/discovery/`, `services/ingestion/`, etc. |
| **`researchEnsemblePresets.ts`** | **`ENSEMBLE_PRESETS`** (V1 per objective) + **`V2_MODE_PRESETS`** (V2); `validateV2ModePresetsAgainstAllowlist` exported |
| **`prompts.ts`** | `REASONING_FIRST_PREAMBLE` exported and used in wrappers |
| **`reasoningModelPolicy.ts`** | `RED_TEAM_V2_SYSTEM_PREFIX` exported |
| **`App.tsx` routing** | Matches Section 9 table (no commercial routes) |
| **`.env.example` files** | `backend/.env.example` is pointer-only; real keys in `backend/.env.development.example`, `backend/.env.production.example`; frontend `frontend/.env.example` lists `VITE_*` |
| **`vercel.json` ×2** | Both include SPA rewrite + CSP headers |
| **`docker-compose.yml`** | Postgres+Redis+backend+frontend; Redis `appendonly yes` |
| **`ecosystem.config.js`** | PM2 single app `researchone-api`, `cwd /opt/researchone`, `env_file ./backend/.env` |
| **`.cursor/rules/`** | 10 files (00, 10–17, 20) — see §1 |

---

## 5. PR #41 status

**Merged.** Evidence:

```text
git log --oneline --grep='#41'
bdeec44 Merge pull request #41 from GooseyPrime/cursor/v2-fix-provider-routing-and-models-c658
```

`backend/src/config/researchEnsemblePresets.ts` defines **`V2_MODE_PRESETS`** with multi-provider OpenRouter slugs (e.g. `qwen/qwen3-235b-a22b-thinking-2507`, `moonshotai/kimi-k2-thinking`, `deepseek/deepseek-r1-0528`, `deepseek/deepseek-v3.2`, …) per criteria/docs.

**Related doc note:** `docs/V2_MODEL_SELECTION_CRITERIA.md` references “PR #42” for ordering — out of scope for WO A; flag if Section 14 WO M / criteria doc should be reconciled to avoid phantom PR references.

---

## 6. Forbidden-defaults regression test

**Not executed in this environment:** `npm` is not available on PATH (`npm: command not found`), so `npx vitest run backend/src/__tests__/researchEnsemblePresets.test.ts` (or full suite) could not be run here.

**Required follow-up (owner or CI):**

```bash
cd backend && npm install && npx vitest run src/__tests__/researchEnsemblePresets.test.ts
```

---

## 7. Baseline test suite (WO A prescribed commands)

| Command | Status |
|---------|--------|
| `cd backend && npm install && npm run typecheck && npm run lint && npm test` | **Blocked** — no `npm` |
| `cd frontend && npm install && npm run typecheck && npm run lint && npm test` | **Blocked** — no `npm` |

No failures to itemize verbatim; environment lacks Node toolchain.

---

## 8. Open questions (numbered)

1. **Node toolchain for agents:** Should Cloud Agents provision `node`+`npm` (or commit `package-lock` + use `corepack`/`nvm`) so WO A’s mandatory test runs are machine-verifiable in CI-like sandboxes?

2. **`.docx` exports:** Should the `docs/ResearchOne - Work Order X.docx` files be added to the repo (or a documented path) so header mismatches K/J, N/O, Q/P can be verified against Section 14?

3. **Section 14 WO M vs immutables:** WO M says add `STANDARD_RESEARCH_PREAMBLE` / `REASONING_FIRST_PREAMBLE_V2` and explicitly says **do not modify** existing `REASONING_FIRST_PREAMBLE`. Confirm whether “V2 variant” is **new exported constants** only, or whether any change to **application order** of existing preambles is intended — this affects halt-condition handling under `.cursor/rules/20-research-policy-guardrails.mdc`.

4. **README vs API paths:** Should README Section “Revision API” and route examples be updated to `POST /api/research` (not `.../runs`) to match `backend/src/api/routes/research.ts`?

5. **Criteria doc PR #42:** Is PR #42 merged in this lineage? If not, should `docs/V2_MODEL_SELECTION_CRITERIA.md` drop or qualify the “updated PR #42” section to satisfy doc/code parity?

---

## 9. Proposed sequencing after owner review (B → Q)

Proceed **B** (commercial shell + `/app/*` routing) only after **Open Questions** 1–2 are resolved or waived — **C/D** depend on Clerk and touch every route; **E–I** depend on Stripe migrations and secrets; **K** depends on stable table list from billing/auth migrations; **L** depends on InTellMe credentials; **M** needs explicit answer on Q3 before editing prompt composition; **P** requires production credentials checklist.

**Blocked until tests run locally:** re-run WO A test subsection or attach CI logs for forbidden-defaults + full vitest in an environment with `npm`.

---

## 10. Files produced (this audit)

- `docs/audit/2026-05-06-baseline-audit.md` (this file)
- `docs/audit/2026-05-06-schema-inventory.md`
- `docs/audit/2026-05-06-api-inventory.md`
