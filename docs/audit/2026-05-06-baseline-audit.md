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
| **Research Policy Model Compliance Review - Google Gemini.pdf** | Reframes the V2 policy constraint from "ban RLHF training labels" (a misinterpretation) to "ban refusal/sanitization/debunk **behaviors at inference time**." Establishes that thinking-architecture models (Qwen3, R1, Kimi K2) can be logically compelled to bypass light RLHF via `REASONING_FIRST_PREAMBLE`, enabling the shift from abliterated-only to multi-provider reasoning ensemble. Evaluated against all four core PolicyOne directives; provides the model-selection matrix referenced in `docs/V2_MODEL_SELECTION_CRITERIA.md`. |
| **ResearchOne_Update_041626.pdf** | Documents the phased fix plan (Phases 0–4+) that drives Work Orders A and P: Phase 0 repo/branch hygiene, Phase 1 Vercel SPA routing fix, Phase 2 research-run failure visibility, Phase 3 planner failure diagnostics and structured error normalization, Phase 4 verbose live-thinking progress events, plus deployment hardening and observability items referenced throughout the work-order sequence. |
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
| README route naming vs code | **Confirmed** | README smoke-test block and code both use `POST /api/research` (`research.ts` router mounted at `/research` in `app.ts`). No mismatch. |
| **Route A spec gaps** | **Partially overtaken by code** | PDF/Markdown extraction exists (`pdfExtractor.ts`, `markdownNormalizer.ts`, ingestion routes); discovery pipeline exists under `services/discovery/`; claims/contradictions persistence implemented in orchestrator services — spec still useful for **split-deploy UX** and **remaining gaps** |
| Vercel SPA rewrite | **Confirmed** | `vercel.json` and `frontend/vercel.json` both have `"rewrites": [{ "source": "/(.*)", "destination": "/" }]` |
| PR #41 and PR #42 status unconfirmed | **Refuted for this repo** | Both merged; see §5 |

---

## 3. Section 14 vs `.docx` exports — reconciliation

Section 14 of `docs/ResearchOne_Final_Report.md` is the canonical work-order list (A–Q, 17 work orders). The `.docx` exports under `docs/ResearchOne - Work Order *.docx` are derivative and out of scope per owner directive 2026-05-06; reconciliation against them is not required.

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

## 5. PR #41 and PR #42 status

**PR #41 — Merged.** Evidence:

```text
git log --oneline --grep='#41'
bdeec44 Merge pull request #41 from GooseyPrime/cursor/v2-fix-provider-routing-and-models-c658
```

**PR #42 — Merged.** Evidence:

```text
git log --oneline --grep='#42'
696a1b6 Merge pull request #42 from GooseyPrime/claude/debug-v2-api-errors-2aWQX
```

`backend/src/config/researchEnsemblePresets.ts` defines **`V2_MODE_PRESETS`** with multi-provider OpenRouter slugs (e.g. `qwen/qwen3-235b-a22b-thinking-2507`, `moonshotai/kimi-k2-thinking`, `deepseek/deepseek-r1-0528`, `deepseek/deepseek-v3.2`, …) per criteria/docs.

`docs/V2_MODEL_SELECTION_CRITERIA.md` references “PR #42” for the promotion of Qwen3/Kimi to primaries and the model ladder rationale — these references are accurate; PR #42 is merged at `696a1b6`.

---

## 6. Forbidden-defaults regression test

**Blocked — no `npm`:** `npm` is not available on PATH in this sandbox, so `npx vitest run backend/src/__tests__/researchEnsemblePresets.test.ts` (or full suite) could not be run here. Per owner directive 2026-05-06, test verification is delegated to GitHub Actions CI on this PR; merge is gated on CI green. Local sandbox absence of npm does not block work-order completion.

**Command (for CI or local verification):**

```bash
cd backend && npm install && npx vitest run src/__tests__/researchEnsemblePresets.test.ts
```

---

## 7. Baseline test suite (WO A prescribed commands)

| Command | Status |
|---------|--------|
| `cd backend && npm install && npm run typecheck && npm run lint && npm test` | **Blocked** — no `npm` |
| `cd frontend && npm install && npm run typecheck && npm run lint && npm test` | **Blocked** — no `npm` |

No failures to itemize verbatim; environment lacks Node toolchain. Per owner directive 2026-05-06, test verification is delegated to GitHub Actions CI on this PR; merge is gated on CI green. Local sandbox absence of npm does not block work-order completion.

---

## 8. Open questions (numbered)

1. ~~**Section 14 WO M vs immutables**~~ — **Resolved in §11:** new exported constants only; `REASONING_FIRST_PREAMBLE` application order unchanged (immutable).

*Resolved / struck:*
- ~~Node toolchain for agents~~ — per owner directive 2026-05-06, test verification is delegated to GitHub Actions CI; merge is gated on green CI.
- ~~`.docx` exports~~ — per owner directive 2026-05-06, `.docx` derivatives are out of scope; Section 14 is canonical.
- ~~README vs API paths~~ — README already uses `POST /api/research`; no mismatch exists.
- ~~Criteria doc PR #42~~ — PR #42 is merged at `696a1b6`; `docs/V2_MODEL_SELECTION_CRITERIA.md` references are accurate.

---

## 11. Open question resolution (WO-R)

### WO-M preamble scope (formerly §8 Q1)

Work Order M may introduce **`STANDARD_RESEARCH_PREAMBLE`** / **`REASONING_FIRST_PREAMBLE_V2`** as **new exported constants only**. It must **not** change the **application order** or replace **`REASONING_FIRST_PREAMBLE`** — that constant remains **immutable** per `.cursor/rules/20-research-policy-guardrails.mdc` and `AGENTS.md`. Any WO-M implementation that reorders or substitutes the existing preamble requires explicit owner approval before merge.

### Users `email` column nullability (WO-R Part 2.5)

Migration `015_users_orgs_members.sql` declares `email TEXT` (nullable) while an older spec called for `NOT NULL`. **Nullable is intentional:** Clerk supports phone-only sign-up and some OAuth providers (for example Twitter/X) omit email. Presence-of-email is enforced at the application layer instead of the DDL constraint.

---

## 9. Proposed sequencing after owner review (B → Q)

Proceed **B** (commercial shell + `/app/*` routing) once open question 1 (WO M preamble scope) is resolved — **C/D** depend on Clerk and touch every route; **E–I** depend on Stripe migrations and secrets; **K** depends on stable table list from billing/auth migrations; **L** depends on InTellMe credentials; **M** needs explicit answer on Q1 before editing prompt composition; **P** requires production credentials checklist.

**Merge gated on green CI** (forbidden-defaults regression test + full vitest suite per GitHub Actions `.github/workflows/ci-backend.yml`). Local sandbox absence of npm does not block work-order completion.

---

## 10. Files produced (this audit)

- `docs/audit/2026-05-06-baseline-audit.md` (this file)
- `docs/audit/2026-05-06-schema-inventory.md`
- `docs/audit/2026-05-06-api-inventory.md`
