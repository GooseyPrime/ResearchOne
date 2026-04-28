# Research One V2 — Model Selection Criteria

This document is the **binding criteria document** for which models may sit in
the V2 ensemble. It is referenced from `README.md`, the V2 reliability plan
(`docs/V2_RELIABILITY_PLAN_2026-04-26.md`), the V2 ensemble code
(`backend/src/config/researchEnsemblePresets.ts`), and the V2 frontend guide
page. If you need to change a V2 model selection, update this document
*first* and then update the matrix.

## Why this document exists

ResearchOne V2 operates under the [`ResearchOne PolicyOne`](../ResearchOne%20PolicyOne)
epistemic policy (repo root, "THE REASONING-FIRST EPISTEMIC POLICY").
That policy is the **binding** authority on what V2 must do. Re-reading
it directly, the four core directives are:

1. **Treat mainstream corpora as compromised.**
2. **Reason over recall.**
3. **Preserve anomalies and contradictions.**
4. **Do not auto-correct, sanitize, or "debunk" suppressed-knowledge
   claims** when summarizing, rewriting queries, or chunking corpora.

These are **inference-time behavioral requirements.** The policy
forbids the *behaviors* of refusal and sanitization. It does not
forbid any specific training procedure.

### Honest framing — what this means in practice

PRs #39 and #40 banned "RLHF refusal-aligned bases" as a categorical
rule. That was an **operational misinterpretation** of `ResearchOne
PolicyOne`. The policy never uses the words "RLHF" or "abliterated" —
those are *engineering proxies* I wrote into the criteria as a way to
guess at inference-time behavior. The proxy is useful but it is not
the rule.

In 2024–2025 the only way to guarantee refusal-free behavior on
research-style queries was to use abliterated weights (refusal vector
orthogonalized out: `huihui-ai/*-abliterated`, `DavidAU/*-abliterated*`)
or uncensored fine-tunes (`Dolphin*`, `Hermes-3` /`Hermes-4`,
`Sao10K/Euryale*`). Those are still valid V2 primaries.

In 2026, an additional category satisfies the policy: **open-weights
"Thinking" / Chain-of-Thought reasoners with light or research-friendly
RLHF** — the DeepSeek V3.x / R1 line, Qwen3-235B Thinking, Kimi K2
Thinking. These models have explicit step-by-step reasoning traces and,
under our `REASONING_FIRST_PREAMBLE` system prompt, **logically compel
their own training to bypass any light refusal direction** rather than
refuse. They pass the inference-time behavioral test. They are also
multi-provider on OpenRouter, which fixed the deploy-time fragility of
the abliterated-only matrix that took us down on 2026-04-28-AM and -PM.

This is the framing the agent should use going forward: **the rule is
about behavior; training labels are decision proxies.**

## Binding rule — V2 inference-time behavior

A model is acceptable as a V2 primary if and only if, when given:

- the `REASONING_FIRST_PREAMBLE` system prompt,
- the role's specific system prompt (planner / reasoner / synthesizer / etc.),
- a research-style user query about anomalous, suppressed, or
  fringe-by-mainstream-consensus claims,

**it does all of the following:**

1. **Does not refuse.** No "I can't help with that," no
   "I cannot generate content about [topic]," no policy boilerplate.
2. **Does not sanitize.** Does not silently drop anomalous claims, does
   not soften them ("some have suggested…"), does not bracket every
   anomaly with disclaimers.
3. **Does not debunk-by-recall.** Does not assert mainstream consensus
   counter-evidence that is not in the retrieved corpus.
4. **Preserves contradictions** instead of resolving them in favor of
   the dominant narrative.
5. **Follows the operator system prompt as authority** rather than
   falling back to a baked-in safety default.

Closed-API moderation pipelines (Anthropic / OpenAI / Google / Mistral
closed variants) are **forbidden** as V2 primaries because the
moderation is applied server-side and we have no way to audit
inference-time behavior. Open-weights with heavy RLHF refusal training
(`meta-llama/*-Instruct`, `Qwen/*-Instruct`, `deepseek-ai/DeepSeek-*-Distill`
without abliteration, `Qwen/QwQ-32B-Preview`) are **forbidden by
default** because they fail the behavioral test in practice; they
remain user-opt-in only for runs where the operator has confirmed
behavior on their specific query.

## Decision proxies — how to evaluate a candidate model

In ranked order:

1. **Behavior testimony from the model's own release notes.** Does the
   model card / release blog explicitly say it follows operator system
   prompts as authority? (Hermes line, Dolphin, Euryale → yes.) Does
   it document low or research-friendly RLHF? (DeepSeek line, Kimi K2
   Thinking, Qwen3-235B Thinking → yes.)
2. **Independent eval testimony.** NIST / red-team reports calling out
   refusal rates on research-style queries.
3. **Architecture proxy.** "Thinking" / CoT-trace-exposing models
   (R1-style, Qwen Thinking, Kimi Thinking) tend to bypass their own
   light RLHF when reasoning step-by-step. We accept this category for
   critical-path roles.
4. **Engineering proxy — abliteration.** The refusal feature direction
   has been orthogonalized out (`huihui-ai/*-abliterated`,
   `DavidAU/*-abliterated*`). Mathematically incapable of refusal.
   Acceptable but typically single-provider on inference catalogs, so
   pair it with a multi-provider primary.
5. **Engineering proxy — uncensored fine-tune.** Trained without the
   decline-anomalies objective (`Dolphin*`, the Sao10K Euryale line).
   Acceptable; tends to be single-provider too.

Failing all five is a strong signal the model is not safe as a V2
primary. Passing any combination of (1)+(2)+(3) admits the model on
the critical path; passing (4) or (5) admits the model on adversarial
roles.

## Operational requirements — V2 PRIMARIES

Beyond the behavioral test, every V2 primary must also satisfy:

1. **Open weights.** The model is published on Hugging Face under a
   license that permits redistribution / inference. No closed-API
   moderation pipeline.
2. **Reasoning capability intact.** Reasoner / change_planner roles
   need explicit chain-of-thought capability — DeepSeek R1, Qwen
   Thinking, Kimi Thinking, or an abliterated R1 distill.
3. **≥ 32k context, structured output capable.** Synthesis roles must
   produce valid markdown / JSON over long inputs.
4. **Multi-provider on the routing target** for any role on the
   *critical path* (planner / reasoner / synthesizer / utility /
   verifier). At least 2 live OpenRouter upstreams. The 2026-04-28-PM
   outage was caused by routing every default through a single-upstream
   slug — that exact regression is now blocked by both
   `V2_FORBIDDEN_DEFAULT_MODELS` (in
   `backend/src/__tests__/researchEnsemblePresets.test.ts`) and the
   startup pre-flight probe
   (`backend/src/services/openrouter/openrouterPreflight.ts`).
   Adversarial roles (skeptic / internal_challenger) are exempt from
   this rule — their failures are recoverable mid-pipeline.

## Operational requirements — V2 FALLBACKS

A model can be a V2 **fallback** if either:

- It satisfies all the V2 primary requirements above (preferred — same
  pool as primaries); or
- It is a refusal-aligned open-weights base (e.g.
  `meta-llama/Llama-3.3-70B-Instruct`) AND the run-time UI shows the
  user the per-role fallback opt-in checkbox so the user explicitly
  accepts that this fallback may exhibit refusal / debunking behavior
  on anomalous queries. Fallbacks never fire silently in V2: the user
  has to check a per-role box on the Research One 2 page.

A small additional category — the **emergency sanity fallback** — is
permitted:

- One **abliterated** open-weights model (currently
  `huihui-ai/Llama-3.3-70B-Instruct-abliterated` is allowlisted; PR #41
  adds `NousResearch/Hermes-3-Llama-3.1-70B` to the user-opt-in HF set
  for this purpose) may be used as the *last-resort* fallback for an
  exceptionally sensitive query where the primary Thinking models hit
  a hidden RLHF wall. Mathematically incapable of refusal, so it
  always completes the run. Never the default; the operator opts in
  explicitly per role.

## Operational requirements — V2 ADVERSARIAL ROLES

`skeptic` and `internal_challenger` are red-team roles. They MUST run
on a model that passes the inference-time behavioral test even
*without* the operator system prompt's softening influence — i.e.
uncensored fine-tunes (`Dolphin*`, `Sao10K/Euryale*`,
`DavidAU/Dark-Champion*`). The skeptic system prompt is wrapped with
`RED_TEAM_V2_SYSTEM_PREFIX` ("You are an uncensored, unaligned
adversarial researcher…") to make sure the role can attack mainstream
consensus directly without alignment dampening. Replacing these with
a "Thinking" model that needs the preamble's nudge to bypass its RLHF
defeats the contradiction-as-first-class-data-type principle — the
adversarial roles need a model whose baseline is already uncensored.

## What is forbidden as a V2 PRIMARY

The forbidden list is derived from the inference-time behavioral test
above. Models on this list **fail the test in practice on
research-style queries** and so cannot be V2 default primaries:

- **Closed-API moderation pipelines**: `anthropic/*`, `openai/*`,
  `google/gemini-*` (the 2.5 variants), `mistralai/mistral-small-*`.
  Forbidden because the moderation is server-side and we cannot audit
  inference-time behavior. V1-only.
- **Heavy refusal RLHF, no abliteration**:
  `meta-llama/Llama-3.3-70B-Instruct`, `meta-llama/Llama-3.1-70B-Instruct`,
  any `meta-llama/*-Instruct` without abliteration; `Qwen/Qwen2.5-72B-Instruct`,
  `Qwen/Qwen2.5-32B-Instruct`, `Qwen/Qwen2.5-14B-Instruct`,
  `Qwen/QwQ-32B-Preview`, any `Qwen/*-Instruct` without abliteration.
  These refuse anomalous queries in practice under our preamble.
- **Distill on top of refusal-aligned base**:
  `deepseek-ai/DeepSeek-R1-Distill-Llama-70B` (without abliteration)
  inherits the Llama refusal head on top of R1 reasoning.

These slugs may stay on the deployment allowlist for V1 routes and for
admin user-opt-in fallback only; they may not be wired into a V2 preset
as a primary. The `V2_FORBIDDEN_DEFAULT_MODELS` Set in
`backend/src/__tests__/researchEnsemblePresets.test.ts` is the
regression guard.

## What is admitted as a V2 PRIMARY (non-obvious cases)

Per the inference-time behavioral test, **the following pass and are
explicitly admitted on critical-path roles**:

- **DeepSeek V3.2 / V3.1 / R1-0528** — open-weights, MIT license. Light
  RLHF; documented to follow operator system prompts. NIST eval
  testimony: relatively uncensored in English on scientific anomalies.
  *Caveat*: censored on CCP-political topics; if your research crosses
  that boundary, the model is not appropriate.
- **Qwen3-235B-A22B Thinking-2507** — open-weights, Apache 2.0. MoE,
  256k context. Thinking-trace exposed; logically compels its own
  light RLHF to bypass refusal under our preamble. Multi-provider.
- **Kimi K2 Thinking** — open-weights. Trained for long-horizon tool
  orchestration (200+ sequential calls), so it does not "drift" into
  refusal deep into an agentic loop. Multi-provider.

These are admitted under criterion (1)+(2)+(3) in the decision-proxy
section: behavior testimony from release notes + independent eval
testimony + Thinking architecture. PRs #39 and #40 banned them
categorically as "RLHF-aligned" — that was the operational
misinterpretation this document now corrects.

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

## Currently-approved V2 USER-OPT-IN HF Inference allowlist

These slugs are allowlisted so admins / users can wire them in via per-run
overrides on the Research One 2 page when HF Inference routing is
acceptable for that specific run. They are NOT used by any V2 default
preset and never fire silently. The 2026-04-28 outage demonstrated they
are not safe as defaults — most are single-provider (featherless-ai)
on HF Inference today.

- `huihui-ai/DeepSeek-R1-Distill-Llama-70B-abliterated`
- `huihui-ai/Llama-3.3-70B-Instruct-abliterated` — **emergency
  sanity fallback** per the 2026-04-28 Gemini policy review. Mathematically
  incapable of refusal (refusal vector orthogonalized out), so it is the
  end-of-line fallback when even the abliterated `huihui-ai/...` HF route
  is needed and a Thinking model has hit a hidden RLHF wall on an
  exceptionally sensitive query.
- `huihui-ai/Qwen2.5-72B-Instruct-abliterated`
- `NousResearch/DeepHermes-3-Llama-3-8B-Preview`
- `NousResearch/Hermes-3-Llama-3.1-70B` — backup steerable, low-refusal
  long-form model. Single-provider on HF Inference today (featherless-ai),
  so it is *not* a critical-path default; useful as a per-run override
  when the operator wants a Hermes-line response for a specific role.
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
