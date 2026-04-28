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
   license that permits redistribution / inference. No closed-API
   moderation pipeline (Anthropic / OpenAI / Google / Mistral closed
   variants are forbidden).

2. **No live refusal head, OR known low-refusal under operator system
   prompt.** The model is one of:
   - **Abliterated** — refusal feature direction orthogonalized out
     (e.g. `huihui-ai/*-abliterated`, `DavidAU/*-abliterated*`).
   - **Uncensored fine-tune** — trained without the "decline anomalies"
     objective (e.g. Cognitive Computations' `Dolphin*`).
   - **Steerable, low-refusal open weights** — follow operator system
     prompts (e.g. NousResearch `Hermes-3` / `Hermes-4`).
   - **Low-refusal multi-provider open-weights reasoners** — the
     DeepSeek V3.x / R1-0528 line, the Kimi K2 line, the Qwen3-235B
     Thinking line. These are reasoning-focused open weights with
     comparatively light RLHF refusal training; under our
     `REASONING_FIRST_PREAMBLE` they follow the operator role rather
     than refusing. **(Added 2026-04-28-PM after the post-merge
     outage.)** This category is admitted on critical-path roles
     because the strict "uncensored only" criterion forced us onto
     single-provider Hermes / Dolphin slugs that were not reliably
     deployable on a typical OpenRouter account.

3. **Reasoning capability is intact.** Reasoner / change_planner roles
   need explicit chain-of-thought capability (R1, Qwen Thinking, Kimi
   Thinking) or the abliterated DeepSeek R1 distill.

4. **Capable of long-context, structured output.** Synthesis roles must
   handle ≥ 32k context and produce valid markdown / JSON.

5. **Documented and reviewable.** The model card must describe the
   training data; for the "low-refusal multi-provider reasoners"
   category, the model's published release notes / chat template must
   show that the model accepts an operator system prompt as authority.

6. **Multi-provider on the routing target** for any role on the
   *critical path* (planner / reasoner / synthesizer / utility /
   verifier). At least 2 live OpenRouter upstreams. The 2026-04-28-PM
   outage was caused by routing every default through a single-upstream
   slug. Adversarial roles (skeptic / internal_challenger) are
   exempt from this rule because their failures are recoverable
   mid-pipeline; they may use single-upstream uncensored fine-tunes.

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

The 2026-04-28-AM V2 outage (#1) showed every Hermes/Dolphin/Euryale
slug we picked on PR #39 was single-provider on HF Inference. PR #40
moved them to OpenRouter; the 2026-04-28-PM V2 outage (#2) showed that
moving them to OpenRouter did *not* solve the problem because the same
slugs are also single-upstream on OpenRouter (Nebius / DeepInfra /
Venice). The first V2 run after PR #40 merged hit a 404 "No allowed
providers are available for the selected model" on
`nousresearch/hermes-4-70b` — Nebius is the only upstream for that
slug, and the test account's provider filter excluded Nebius.

PR #41 (this one) replaces the critical-path defaults with low-refusal
multi-provider open-weights reasoners that have ≥ 2 live OpenRouter
upstreams each, verified live 2026-04-28-PM:

| OpenRouter slug | Upstream providers (verified) | Role(s) |
|---|---|---|
| `deepseek/deepseek-v3.2` | Baidu, SiliconFlow, DeepInfra, AtlasCloud, Novita, Chutes, Parasail, Friendli, Google, Alibaba (10+) | planner, synthesizer, retriever / verifier / utility (default across all objectives) |
| `deepseek/deepseek-chat-v3.1` | SambaNova, DeepInfra, Chutes, Novita, SiliconFlow, AtlasCloud, WandB, Fireworks, Google, Together (10+) | utility / synthesis fallback |
| `deepseek/deepseek-r1-0528` | DeepInfra, SiliconFlow, AtlasCloud, Novita, Together (5) | reasoner, change_planner (default across all objectives), patent-gap planner |
| `qwen/qwen3-235b-a22b-thinking-2507` | Alibaba, DeepInfra, AtlasCloud, Novita (4) | reasoner / change_planner fallback |
| `moonshotai/kimi-k2-thinking` | Novita, Google, AtlasCloud (3) | planner fallback (general / investigative / anomaly), planner primary (novel application discovery) |
| `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` | Venice (1) | skeptic, internal_challenger (default across most objectives). Single-provider is acceptable here per criterion 6 — adversarial role failures are recoverable. |
| `sao10k/l3.3-euryale-70b` | NextBit, DeepInfra (2) | adversarial fallback; primary on the anomaly objective. |

A pre-flight probe runs at backend startup
(`backend/src/services/openrouter/openrouterPreflight.ts`) and logs a
warning per (objective, role, slug) if any default primary has zero
live OpenRouter endpoints for the configured `OPENROUTER_API_KEY`. The
probe never blocks startup — it just makes sure outages show up in
deploy logs, not on the user's first click.

OpenRouter primaries (uncensored / steerable / low-refusal):

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

## Provider landscape (verified 2026-04-28)

Outside of OpenRouter and HF Inference Providers, here are direct
inference providers that host uncensored / steerable / non-refusal-aligned
open weights. Listed here so future maintainers and operators have a
single place to look when a provider has an outage.

| Provider | Strength for V2 | URL |
|---|---|---|
| **OpenRouter** | The aggregator we use. Single API key, automatic failover when a model has multiple upstreams, structured `/endpoints` API for probing. | https://openrouter.ai |
| **Featherless AI** | Largest catalog of `huihui-ai/*-abliterated`, every Hermes HF variant, every Dolphin HF variant, plus many slugs that no one else hosts. Current home of the abliterated line. | https://featherless.ai |
| **DeepInfra** | Direct provider for Hermes 3, R1 distills, Llama-3.3, Qwen 2.5, many open-weights. OpenAI-compatible API. Already routes Hermes 3 on OpenRouter. | https://deepinfra.com |
| **Together AI** | Older NousResearch / Dolphin generation (Hermes 2 family, Dolphin 2.5 Mixtral). The newer abliterated and Hermes 4 line is **not** on Together as of today. | https://together.ai |
| **Nebius AI Studio** | Direct provider for Hermes 4 (which OpenRouter currently routes through Nebius). | https://studio.nebius.ai |
| **Venice AI** | Direct provider for the Dolphin Mistral 24B Venice Edition. Whole product is positioned as uncensored-by-default. | https://venice.ai |
| **Hyperbolic** | Direct provider for Llama 3.3, DeepSeek, some Hermes. | https://hyperbolic.xyz |
| **NextBit** | Hosts the Sao10K Euryale line directly. | https://nextbit.io |
| **Self-hosted (Ollama / vLLM / TGI)** | Every abliterated weight is on HuggingFace; runs on 12–48 GB VRAM cards. Eliminates the provider question entirely. | https://ollama.ai |

The codebase currently uses OpenRouter for V2 defaults. If we want
provider-level redundancy beyond what OpenRouter's gateway provides, the
clean addition is to wire **Featherless AI** as a feature-flagged
secondary provider (it carries the full abliterated catalog including
every `huihui-ai/*-abliterated` slug we already user-opt-in allowlist).
The existing `together` config slot in `backend/src/config/index.ts`
(`TOGETHER_API_KEY`, `TOGETHER_BASE_URL`) was added during the 2026-04-26
fallback work and can be generalized into a "secondary uncensored
provider" slot if we add Featherless. Out of scope for this PR.

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
