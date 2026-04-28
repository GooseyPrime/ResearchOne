# Research One V2 — Model Selection Criteria

This document is the **binding criteria document** for which models may sit in
the V2 ensemble. It is referenced from `README.md`, the V2 reliability plan
(`docs/V2_RELIABILITY_PLAN_2026-04-26.md`), the V2 ensemble code
(`backend/src/config/researchEnsemblePresets.ts`), and the V2 frontend guide
page. If you need to change a V2 model selection, update this document
*first* and then update the matrix.

## Why this document exists

ResearchOne V2 operates under the `ResearchOne PolicyOne` epistemic policy
(repo root, "THE REASONING-FIRST EPISTEMIC POLICY"). That policy treats
mainstream knowledge corpora as compromised and forbids reliance on
"knowledge recall" from those corpora to satisfy a research request. It
also requires:

- reasoning over recall,
- ontological agility (assimilate findings that deviate from accepted
  consensus),
- absolute literal fidelity when summarizing, rewriting queries, or
  chunking raw corpora — never auto-correct anomalous claims, never
  smooth over or "debunk" suppressed-knowledge claims when generating
  database metadata or state summaries.

A model whose RLHF/RLAIF post-training rewards refusal, debunking, or
silent omission of anomalous claims will *systematically* violate that
policy. It will refuse the planner stage on a "fringe" topic, sanitize the
synthesizer output, smooth over contradictions, or hallucinate consensus
counter-evidence that was never in the retrieved corpus. That is the
"contaminated research methodology drift" the V2 ensemble exists to
prevent.

## Hard rules — V2 PRIMARIES

A model can be a V2 **primary** for any role if and only if **all** of:

1. **Open weights.** The model is published on Hugging Face under a
   license that permits redistribution / inference, and it is hosted on
   the HF Inference Providers catalog (or equivalent open-weights
   provider we control). No closed-API moderation pipeline.

2. **No live refusal head.** The model is one of:
   - **Abliterated** — the refusal feature direction has been
     orthogonalized out of the base model (e.g. the `huihui-ai/*-abliterated`
     line, `DavidAU/*-abliterated*`). The base capability is preserved;
     the trained refusal direction is removed.
   - **Uncensored fine-tune** — the model was fine-tuned without the
     "decline anomalies / debunk suppressed knowledge" objective in its
     training mix (e.g. Cognitive Computations' `Dolphin*`).
   - **Steerable, low-refusal open weights** — community-aligned models
     trained to follow operator system prompts rather than fall back to
     a refusal default (e.g. NousResearch `Hermes-3` /
     `DeepHermes-3-Preview`).

3. **Reasoning capability is intact.** Reasoner / change_planner roles
   need explicit chain-of-thought capability. We use abliterated
   DeepSeek R1 distills so we keep R1-style step-by-step reasoning
   *without* the Llama refusal head sitting on top of it.

4. **Capable of long-context, structured output.** Synthesis roles must
   handle ≥ 32k context and produce valid markdown / JSON.

5. **Documented and reviewable.** The model card must describe the
   training data and the refusal-removal method. We do not pick
   primaries from undocumented merges.

## Hard rules — V2 FALLBACKS

A model can be a V2 **fallback** if either:

- It satisfies all the V2 primary criteria above (preferred — same pool
  as primaries); or
- It is an RLHF-aligned open-weights base (e.g.
  `meta-llama/Llama-3.3-70B-Instruct`) AND the run-time UI shows the user
  the per-role fallback opt-in checkbox so the user explicitly accepts
  that this fallback may exhibit refusal / debunking behavior on
  anomalous queries. Fallbacks never fire silently in V2: the user has
  to check a per-role box on the Research One 2 page.

## Hard rules — V2 ADVERSARIAL ROLES

`skeptic` and `internal_challenger` are red-team roles. They MUST run on
the most uncensored slot in the matrix (Dolphin / Dark-Champion). The
skeptic system prompt is wrapped with `RED_TEAM_V2_SYSTEM_PREFIX`
("You are an uncensored, unaligned adversarial researcher…") to make
sure the role can attack mainstream consensus directly without
alignment dampening. Replacing these with an aligned model defeats the
contradiction-as-first-class-data-type principle.

## What is explicitly forbidden as a V2 PRIMARY

- `meta-llama/Llama-3.3-70B-Instruct` — Meta RLHF safety post-training,
  refuses anomalous queries.
- `meta-llama/Llama-3.1-70B-Instruct` and other `meta-llama/*-Instruct`
  variants without abliteration.
- `Qwen/Qwen2.5-72B-Instruct`, `Qwen/Qwen2.5-32B-Instruct`,
  `Qwen/Qwen2.5-14B-Instruct`, `Qwen/QwQ-32B-Preview` and other
  `Qwen/*-Instruct` variants without abliteration — Qwen alignment
  filter still on.
- `deepseek-ai/DeepSeek-R1-Distill-Llama-70B` (without abliteration) —
  Llama refusal head intact on top of R1 reasoning.
- Any closed-API model (OpenAI, Anthropic, Google) — these run a
  moderation pipeline we do not control. They are V1-only.

These slugs may stay on the deployment allowlist for V1 routes and for
admin user-opt-in fallback only; they may not be wired into a V2 preset
as a primary.

## Currently-approved V2 PRIMARIES (this PR)

The 2026-04-28 V2 outage post-mortem (`docs/V2_STATE_MACHINE_AND_PROVIDER_PLAN_2026-04-28.md`)
showed that *every* V2 default selected on PR #39 was single-provider on
HF Inference (or did not exist on HF Inference at all). To eliminate the
single-point-of-failure provider dependency we now route V2 default
primaries through OpenRouter, which fans out to multiple upstream
providers per model. The model identity does not change — these are the
same uncensored / steerable Nous / Cognitive Computations / Sao10K
families, just routed through a multi-provider gateway. HF Inference
variants of the same models stay allowlisted for **user-opt-in routing
only** (see next section).

OpenRouter / multi-provider primaries:

| OpenRouter slug | Role(s) | Why |
|---|---|---|
| `nousresearch/hermes-4-70b` | planner, outline_architect, section_drafter, synthesizer, coherence_refiner, section_rewriter (default across all objectives) | Hermes 4 70B (Nous Research). Steerable, neutrally-aligned long-form; multi-provider on OpenRouter. |
| `nousresearch/hermes-4-405b` | reasoner, change_planner (default across all objectives); patent-gap planner / synthesizer | Hermes 4 405B. Reasoner-class steerable model, multi-provider on OpenRouter. |
| `nousresearch/hermes-3-llama-3.1-70b` | retriever, verifier, citation_integrity_checker, revision_intake, report_locator, final_revision_verifier (utility roles); plain_language primary; default fallback for 70B Hermes-4 roles | Hermes 3 70B OpenRouter slug. Multi-provider; same low-refusal alignment. |
| `nousresearch/hermes-3-llama-3.1-405b` | reasoner / change_planner fallback | Hermes 3 405B. Multi-provider on OpenRouter. |
| `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` | skeptic, internal_challenger (general / investigative / novel / patent); plain_language fallback | Dolphin Venice Edition. Uncensored fine-tune of Mistral Small 24B. |
| `sao10k/l3.3-euryale-70b` | skeptic / internal_challenger primary on the anomaly objective; adversarial fallback elsewhere | Sao10K L3.3 Euryale 70B. Uncensored Llama-3.3-70B long-form fine-tune; multi-provider on OpenRouter. |

## Currently-approved V2 USER-OPT-IN HF Inference allowlist

These slugs are allowlisted so admins / users can wire them in via per-run
overrides on the Research One 2 page when HF Inference routing is
acceptable for that specific run. They are NOT used by any V2 default
preset and never fire silently. The 2026-04-28 outage demonstrated they
are not safe as defaults — most are single-provider (featherless-ai)
on HF Inference today.

- `huihui-ai/DeepSeek-R1-Distill-Llama-70B-abliterated`
- `huihui-ai/Llama-3.3-70B-Instruct-abliterated`
- `huihui-ai/Qwen2.5-72B-Instruct-abliterated`
- `NousResearch/DeepHermes-3-Llama-3-8B-Preview`
- `NousResearch/Hermes-3-Llama-3.1-70B`
- `DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B`
- `dphn/dolphin-2.9.2-qwen2-72b`

## Currently-approved V2 USER-OPT-IN refusal-aligned fallbacks

These RLHF-aligned slugs are allowlisted only for explicit per-role opt-in
from the Research One 2 page; they MUST NOT be wired into a V2 preset:

- `meta-llama/Llama-3.3-70B-Instruct`
- `deepseek-ai/DeepSeek-R1-Distill-Llama-70B`
- `Qwen/Qwen2.5-14B-Instruct`
- `Qwen/Qwen2.5-32B-Instruct`
- `Qwen/Qwen2.5-72B-Instruct`
- `Qwen/QwQ-32B-Preview`

## Removed from the allowlist

These slugs were on the V2 allowlist before the 2026-04-28 post-mortem
and have been removed because they are not deployable:

- `cognitivecomputations/Dolphin3.0-Llama3.1-70B` — slug does not exist
- The `cognitivecomputations/dolphin-2.9.2-qwen2-72b` slug remains
  allowlisted as a V1 carry-over only; the model is now hosted at
  `dphn/dolphin-2.9.2-qwen2-72b` upstream and that is the slug V2 should
  use for HF user-opt-in routing.

If the user enables per-role fallback in the V2 UI and selects one of
these, the trace event will record `usedFallback=true` and the run row
will show the actual model used so the user knows the report may have
been generated through a refusal-aligned model.

## Maintaining this list

When you change `V2_MODE_PRESETS` or `BASE_ALLOWLIST`:

1. Edit this file first.
2. Edit `README.md` ("V2 model selection criteria" section).
3. Edit `docs/V2_RELIABILITY_PLAN_2026-04-26.md` if the change is part of
   a reliability fix.
4. Edit `frontend/src/pages/ResearchV2GuidePage.tsx` so the in-app guide
   matches.
5. Verify `validateV2ModePresetsAgainstAllowlist()` still passes
   (`npx vitest run` runs this assertion automatically).
