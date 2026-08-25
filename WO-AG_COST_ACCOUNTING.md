# WO-AG — Cost accounting that is actually correct

Repo: `GooseyPrime/ResearchOne`.
Branch via the helper: `bash scripts/git/prepare-work-branch.sh cost-accounting`

Rules 32, 44, 22 and 25 (cost sidecar / unit economics) all apply.

---

## 0. The instruction, in the operator's words

> there is a cost, which i pay for, for every fucking model we use. that cost
> will most likely increase significantly as we scale up. it needs to be figured
> out.

> there should be **no refusals** if we can use the model. the models that we use
> are tracked as well as their usage and we can assign a price to it accordingly.

> you need to make sure the pricing table you're using isn't hardcoded and is
> always updating to include new models and their fluctuating costs.

**Routing is never gated on price.** If a model can be used, it is used. Pricing
is an accounting concern applied to recorded usage, never a precondition for
doing the work. Any design that fails a run to protect a bookkeeping invariant
is wrong.

**A report's cost is the price at the time it was used. Never back-applied.**

> a report's cost will always be the price at the time it was used... never back
> applied unless i decide to do that for when the product is finalized and
> considered complete for mass use (in full production).

This overrides the first draft of AG-1, which proposed deriving every figure at
read time. That would have let a later price change silently restate what a
past run cost, which is not what was paid. The snapshot on the row is the
authoritative number.

Two cases that look alike and are not:

| | What happened | Treatment |
|---|---|---|
| **Price changed** | A rate we knew was superseded | Never restate. The call keeps the rate in effect when it ran. |
| **Price was never known** | The model had no row, so `$0` was recorded for spend that was really incurred | A gap, not a rate change. Closing it is an **explicit operator decision**, taken once, not a default behaviour. |

Nothing in this work order back-applies anything on its own.

---

## 1. What is broken

The data model is right. Its use is not.

### AG-D1 — Cost is frozen at write time, so a missing price is permanent

`costSidecar.writeRow` calls `getModelPrice(model)` and stamps
`calculated_cost_usd` into the row at INSERT. `pricingCatalog.getModelPrice`
returns `(0, 0)` for any model absent from `model_pricing`.

`/admin/cost/summary` then reports `SUM(calculated_cost_usd)`.

So an unpriced call is worth `$0` forever, and **adding the price later repairs
nothing**. The dashboard does not say "unknown"; it says zero, which is
indistinguishable from a cheap run.

### AG-D2 — Nothing ever writes to `model_pricing`

Grep the whole backend: `model_pricing` appears in `pricingCatalog.ts` (SELECT
only) and in comments. There is no INSERT, no UPDATE, no admin route, no job.
The catalog is migration 030's eleven seeded rows, permanently.

### AG-D3 — The seeded eleven do not cover what the system runs

**Seven of nine default agent roles use models with no price row:**

| Role | Default model | Priced |
|---|---|---|
| planner | `moonshotai/kimi-k2-thinking` | no |
| retriever | `deepseek/deepseek-v3.2` | no |
| reasoner | `deepseek/deepseek-r1` | no |
| steelman | `deepseek/deepseek-r1` | no |
| skeptic | `moonshotai/kimi-k2-thinking` | no |
| synthesizer | `anthropic/claude-sonnet-4.5` | no |
| internalChallenger | `moonshotai/kimi-k2-thinking` | no |
| verifier | `anthropic/claude-sonnet-4` | **yes** |
| contractAuditor | `anthropic/claude-sonnet-4` | **yes** |

The unpriced seven include the most token-heavy stages. Roughly 38 distinct
model ids are reachable across defaults, fallbacks and ensemble presets; 11 have
prices, and the overlap is 7.

### AG-D4 — The dashboard is unreachable

`/app/admin` and its children are routed and `RequireAdmin`-guarded, but
**no link to it exists anywhere in the app**. `NAV_ITEMS` in
`components/layout/Layout.tsx` has no admin entry. The only way in is typing the
URL. The operator has never opened it.

### AG-D5 — Two upstreams, one pricing shape

Not everything goes through OpenRouter. `isHfRepoModel` in
`reasoningModelPolicy.ts` routes `huihui-ai/*`, `deepseek-ai/*` and the
abliterated ensemble presets through **Hugging Face Inference**, which has no
per-token price catalog equivalent to OpenRouter's `/api/v1/models`.

---

## 2. The design

### AG-1 — Value each call at the rate in effect when it ran

`agent_executions` already records the **facts** for every call: `model`,
`input_tokens`, `output_tokens`, `started_at`, `run_id`, `user_id`.
`model_pricing` is already **time-versioned** — `effective_from`,
`effective_until`, with 030's own comment describing the vendor-price-change
flow. The schema is right.

The write-time snapshot (`input_price_per_1m_usd`, `output_price_per_1m_usd`,
`calculated_cost_usd`) stays **authoritative**. It is what the call cost. A
later price change must never restate it.

What changes:

1. **A `$0` from a missing price must be distinguishable from a `$0` that means
   free.** Add `price_source` to `agent_executions` — `priced` | `unpriced` —
   stamped at insert. Summaries then report priced totals and unpriced usage
   separately instead of adding zero to a number that looks complete.
2. **Close the coverage gap going forward** by keeping the catalog current
   (AG-3), so new calls are priced when they happen. This is the fix that
   matters: it prevents the gap rather than repairing it.
3. **Back-filling the historical gap is a separate, operator-triggered action**,
   not part of normal reads. If and when it is wanted, it is an explicit job
   that stamps a rate onto rows whose `price_source = 'unpriced'`, records that
   it did so, and leaves `priced` rows untouched. Not built in this work order.

**T4:** what did `SUM(calculated_cost_usd)` provide? A total that silently
included unpriced calls as zero. The replacement must still be one scan, and
must additionally report what it could not value.

### AG-2 — Unpriced usage is a first-class number, never a silent zero

Every cost figure the dashboard shows is accompanied by its coverage:

```
Total (priced)      $ 12.4130
Unpriced usage      41 calls · 2,318,442 tokens · 6 models
Coverage            73% of calls, 61% of tokens
```

A total that omits unpriced usage while looking complete is the T8 defect —
"a job whose failure logs the same as its success has no monitoring value."
Unpriced models are listed by id so the gap is closable in one look.

### AG-3 — Keep the catalog current, automatically

- A scheduled job pulls OpenRouter's models endpoint and, for each model whose
  price differs from the current effective row, closes that row
  (`effective_until = NOW()`) and inserts a new one. New models are inserted.
  Nothing is ever updated in place — the history is the feature.
- Add a `source` column: `openrouter` | `operator` | `seed`, so a hand-set rate
  is never silently overwritten by the sync and its provenance is visible.
- Hugging Face Inference models take an **operator-assigned** rate
  (`source = 'operator'`). There is no catalog to sync; an invented per-token
  number would be worse than a labelled estimate.
- An admin route to set an operator price, so closing a coverage gap does not
  require a SQL session.

**T8 for the job:** what does it log on a non-2xx from the provider, what happens
if it throws before its first try/catch, and what does it exit with when nothing
was synced? A pricing sync that reports success on a 401 is worse than no sync.

**T9:** the model id from the provider response reaches a SQL statement — it is
a parameter, never interpolated.

### AG-4 — Make the dashboard reachable

Add an admin-only entry to `NAV_ITEMS` in `Layout.tsx` (`requireAdmin: true`,
same gate as Corpus / Atlas / Models). One line of the actual fix; the rest of
this work order is worthless until it exists.

### AG-5 — Per-run cost structure

The reports table currently surfaces only `topPhase`. Add a drill-down per run,
from the same rows:

- by **phase** (Planning, Discovery, Retrieval, Reasoning, Challenge, Synthesis,
  Verification, …)
- by **agent role**
- by **model**, with unpriced models flagged in place

Columns: calls, input tokens, output tokens, cost, share of run. Plus the run
total and its coverage.

### AG-6 — Accumulated totals and per-user lookup

- Every endpoint is windowed by `days`. Add **all-time**, because "what has this
  cost me" is not a 30-day question.
- Per-user: `userFilter` currently takes a raw `user_id`. Accept an email and
  resolve it via `users`. Add a per-user rollup — total spend, run count, average
  cost per run, top models — and a leaderboard across all users.

---

## 3. Definition of done

1. No routing decision anywhere consults price. No refusals.
2. Every call is valued at the rate in effect when it ran, and that value is
   never restated by a later price change.
3. Unpriced usage is displayed as calls, tokens and model ids — never as `$0`.
4. `model_pricing` updates automatically from OpenRouter, with history preserved
   and operator-set rates protected from being overwritten.
5. The admin dashboard is reachable from the app nav for admins.
6. Per-run cost breaks down by phase, role and model.
7. All-time totals; per-user lookup by email.
8. Rule 44 self-check in full; both bots reviewed; every finding answered.

## 4. Verification that is not self-confirming

- Seed a model with no price, record usage against it, assert the summary shows
  it under unpriced rather than adding `$0` to the total.
- Insert a price, record new usage, and assert the new calls are priced while the
  earlier ones are still reported as unpriced — the gap is closed forward, not
  backward.
- Supersede that price with a later `effective_from` row and assert the earlier
  calls still report their original cost. A price change must not move a number
  that was already paid.
- Run the pricing sync against a stubbed non-2xx and assert it exits nonzero and
  logs distinguishably from success.
