# RJ-024. Together backups that run, the Anthropic workspace header, a provider health check

Fix outside the slices, 10 Oct 2026. One pull request (`rj-024-together-anthropic-health`). Not behind a switch.

This is the record `docs/UPGRADE_PLAN.md` would normally carry, in the form its "Fix outside the slices" sections use. It is in its own file because the plan itself was not edited in this pull request (see "Not done" at the end). It follows on from the two sections of 9 Oct 2026 in the plan: "A provider that refuses must not end a run" and "Two more providers for every role".

Measured on production on 10 Oct 2026, one 5-token request per provider from the server:

- Together answered 400 "Unable to access non-serverless model deepseek-ai/DeepSeek-V3.1 ... create and start a new dedicated endpoint". Both ids the fix of 9 Oct put on the Together list are refused this way, so the Together key never answered a call. Run `6a9ef779` shows the same: every Together route refused with 400.
- Anthropic answered every request 400 "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header".
- Run `6a9ef779` was still delivered: OpenRouter answered 17 calls and NVIDIA (`moonshotai/kimi-k3`) answered 5 after every other route refused. Hugging Face Inference refused as unavailable.

New setting:

| Setting | Needed | What it is |
|---|---|---|
| `ANTHROPIC_WORKSPACE_ID` | Optional | When set, every Anthropic request carries it in the `anthropic-workspace-id` header. Needed only for a key that is not tied to one workspace. |

What changed:

- **Together is its own provider with its own models.** `TOGETHER_BACKUP_MODELS` in `openrouter/providerRoutes.ts`, cheapest capable first, each read from Together's `GET /v1/models` with a per-token price (which is how Together marks a model that needs no dedicated endpoint):

  | Order | Together model | Input / output, USD per million tokens |
  |---|---|---|
  | 1 | `deepseek-ai/DeepSeek-V4.1-Flash` | 0.30 / 1.20 |
  | 2 | `zai-org/GLM-5.3-Flash` | 0.15 / 0.50 |
  | 3 | `Qwen/Qwen3.8-Flash` | 0.15 / 0.47 |
  | 4 | `openai/gpt-oss-120b` | 0.15 / 0.60 |
  | 5 | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | 1.04 / 1.04 |

  Every role gets the whole list in this order. A Together route is included only when `TOGETHER_API_KEY` is set.
- **A hub id is no longer sent to Together.** Before, a Hugging Face repository id that failed on Hugging Face Inference was sent to Together under the same name. That assumed Together carries the id, which is what failed. Now a hub id goes to Hugging Face Inference only (included when `HF_TOKEN` is set), and Together is asked only for the ids above. The two refused ids were taken off `CROSS_PROVIDER_BACKUPS`; they stay on the allowlist so a saved per-run choice still validates.
- **Order.** Together and the hub models still share the `together` place in `MODEL_PROVIDER_ORDER`: Together's five models first, then the hub models on Hugging Face Inference. With the default order, every provider configured and a role whose own models are on OpenRouter, a call goes: the role's own model, its backup, Anthropic (Haiku 5.5 for the short-answer roles, Sonnet 5.5 for the writing and checking roles, as before), the five Together models, `NousResearch/Hermes-3-Llama-3.1-70B`, `huihui-ai/Llama-3.3-70B-Instruct-abliterated`, `huihui-ai/Qwen2.5-72B-Instruct-abliterated` on Hugging Face Inference, NVIDIA (`deepseek-ai/deepseek-v4.1-flash` or `moonshotai/kimi-k3`, as before), then the remaining OpenRouter backups (`deepseek/deepseek-v3.2`, `nousresearch/hermes-4-70b`, less whichever the role already uses).
- **A refusal about settings moves the call on and tells an administrator once.** A 400 whose message says the model is non-serverless or needs a dedicated endpoint, or says the key needs a workspace header, is classified `route_config_error` (`routeConfigurationReason` in `providerRoutes.ts`). It counts as a refusal about the provider, so the next route is tried, also when it is the role's own model that was refused. Any other 400 is still a malformed request and is not sent elsewhere. `warnRouteConfigurationOnce` writes one warning to the server log per process for each provider and reason (and per model for the dedicated-endpoint reason), marked `adminOnly`, naming the provider, the reason and what to change. Nothing about it is put on a run or shown to a customer: a customer whose run fails this way reads the same "AI service is temporarily unavailable" sentence as for any provider failure.
- **Anthropic workspace header.** `anthropicRequestHeaders` adds `anthropic-workspace-id` when `ANTHROPIC_WORKSPACE_ID` is set and leaves it out otherwise. Which roles may reach Anthropic is unchanged: that decision is still open with Brandon and nothing here touches it.
- **Cost.** A Together call carries Together's published price (`togetherListPrice`) and `getCallPrice` prices it like an Anthropic or NVIDIA call: the `model_pricing` row keyed `together:<model id>` when one exists, otherwise the published price, otherwise the row for the bare model id. Before, a Together call was priced from the bare model id, which is another provider's price when two providers share an id (`openai/gpt-oss-120b`).
- **Provider health check, administrators only.** `POST /api/admin/providers/health` (behind `requireAdmin`, like every `/api/admin` route) sends one request of at most 5 tokens to each provider that has a key, with its first model, and returns for each: `provider`, `model`, `ok`, `status`, `durationMs`, and on a refusal `classification`, `configurationReason` and a short `error` with key-like strings removed (the keys set on the server, `Bearer` values, strings with a known key prefix, long unbroken runs of letters and digits). First models: OpenRouter `deepseek/deepseek-v3.2`, Anthropic the fast Claude model, Together `deepseek-ai/DeepSeek-V4.1-Flash`, Hugging Face `NousResearch/Hermes-3-Llama-3.1-70B`, NVIDIA the fast NIM model. It is a POST and nothing calls it at startup, on a timer or during a run: each check is a real request on the server's provider accounts. Code: `openrouter/providerHealth.ts` and `api/routes/adminProviders.ts`.

For Brandon to know:

- **Two of the five Together models are refusal-aligned lines** (`openai/gpt-oss-120b`, `meta-llama/Llama-3.3-70B-Instruct-Turbo`), and the list serves every role, Double-check and the strongest-form restating included. `docs/V2_MODEL_SELECTION_CRITERIA.md` keeps such lines out of the presets and out of `CROSS_PROVIDER_BACKUPS`. The list is the one ordered for this fix and is reached only after the role's own model, its backup and Anthropic were refused; no preset, allowlist entry or forbidden-defaults test was changed. To keep them from the challenge roles, `togetherModelsForRole` is the one place a per-role rule goes.
- **Hugging Face Inference refused as unavailable in run `6a9ef779`.** Its three hub routes now come after Together's five, so a call that Together answers makes no Hugging Face request.

Not done, and what it needs:

- No request was sent to any provider from this work (no paid calls allowed). The tests replace the HTTP client and the Hugging Face client. The first real proof is an administrator calling the health check after deploy.
- The Anthropic key was not replaced and `ANTHROPIC_WORKSPACE_ID` was not set on the server: both are Brandon's to do. Until one of them is done, Anthropic keeps answering 400, calls move on, and the log carries the one warning.
- `backend/.env.*.example` and the README settings list were not edited (no changes to env files for this fix). `ANTHROPIC_WORKSPACE_ID` is recorded here; the other provider settings of 9 Oct are in the plan.
- **`docs/UPGRADE_PLAN.md` was not edited.** The work session could not push with git and had to send each changed file whole through the GitHub connector; the plan is too large to send that way safely. What the plan still needs, in a pull request made with a normal push: one row in its status table ("Together backups that run, the Anthropic workspace header, an admin provider health check | In review, 10 Oct 2026 | `rj-024-together-anthropic-health`. See `docs/RJ-024-together-anthropic-health.md`."), and a line under the 9 Oct section "A provider that refuses must not end a run" saying that its two Together ids (`deepseek-ai/DeepSeek-V3.1`, `deepseek-ai/DeepSeek-V3`) were refused by Together and were replaced here.

Tests: `rj024RouteConfiguration.test.ts` (the Together list and each role's order, the two refusals measured on production, the one warning, the workspace header), `rj024ProviderHealth.test.ts` (who is asked, the request sent, what is reported, key-like strings removed, admin only), and the Together cases in `providerCallPricing.test.ts`, `modelRouteFallback.test.ts` and `modelProviderRoutes.test.ts`.
