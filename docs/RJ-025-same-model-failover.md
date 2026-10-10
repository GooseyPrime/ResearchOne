# RJ-025. A call that moves to another provider reaches the same model there

Fix outside the slices, 10 Oct 2026. One pull request (`rj-025-same-model-failover`). Not behind a switch.

The rule, in Brandon's words: "There should be NO BACKUPS that are trained differently because of a provider difference."

What that means here: when a role's call is refused and moves to another provider, it must reach the same model there (the same weights, the same model version). A different model is not a backup, because each vendor trains its models differently and a different model behaves differently.

## Before

A refused call moved on, in order, to: the role's own backup model, Claude Haiku 5.5 or Sonnet 5.5 on Anthropic (for every role), five Together models (`DeepSeek-V4.1-Flash`, `GLM-5.3-Flash`, `Qwen3.8-Flash`, `gpt-oss-120b`, `Llama-3.3-70B-Instruct-Turbo`), three hub models on Hugging Face Inference, an NVIDIA model picked by the size of the task (`deepseek-v4.1-flash` or `kimi-k3`), and two more OpenRouter models (`deepseek-v3.2`, `hermes-4-70b`). Every one of those is a different model from the one the role chose.

## After

A role's routes are: the model the role chose, then that exact model on every other provider that has a key on the server and is confirmed to serve it. Nothing else.

- **One table.** `SAME_MODEL_PROVIDER_TABLE` in `backend/src/services/openrouter/providerRoutes.ts` names each model once and gives its id on each provider confirmed to serve it. An id is never worked out from a name while a call is running. The date and the sources are in the comment beside the table.
- **The role's own backup is no longer called.** The backup a role names in a preset, in the server's settings or for one run is a different model, so it is not a route. Every backup stays on the allowlist and can be chosen as a role's model for one run; no allowlist entry was removed.
- **Anthropic is a route only for a Claude model.** This is in the table and is checked again in code, so a wrong row cannot send another vendor's model to Anthropic.
- **The size tables are gone.** `ROUTE_MODEL_CLASS_BY_ROLE`, `ANTHROPIC_DEFAULT_MODELS`, `NVIDIA_DEFAULT_MODELS`, `TOGETHER_BACKUP_MODELS` and `CROSS_PROVIDER_BACKUPS` were removed. The settings `ANTHROPIC_MODEL_FAST`, `ANTHROPIC_MODEL_STRONG`, `NVIDIA_MODEL_FAST` and `NVIDIA_MODEL_STRONG` are no longer read.
- **Order.** `MODEL_PROVIDER_ORDER` still decides the order. Together and Hugging Face Inference still share the `together` place, Together first.
- **When every route for the model has refused, the run stops.** The customer reads the same sentence as before ("... our AI service is temporarily unavailable. You have not been charged ..."), the run can be run again, and no payment is taken. Waiting and going over the routes again after a credit or rate refusal is unchanged.
- **Prices stay keyed by provider and model.** Anthropic prices were added for the two Claude ids the table sends to Anthropic. A Hugging Face call that answered for a role whose own id is on OpenRouter is priced from the row `huggingface_inference:<hub id>` when there is one, and otherwise at the price of the role's own id for the same model, so it is not recorded as free. That second price is an estimate.
- **One reading of a refusal changed.** OpenRouter's 404 "No endpoints found for <model>" is now read as being about OpenRouter (it has no host for the model), so the same model is asked on another provider. Before, it was read as a malformed request and ended the call. Any other 404 is unchanged.

## What each provider's catalog showed on 10 Oct 2026

Read from public catalogs. No key was used and no model was called.

| Provider | Source | Result for the models the roles choose |
|---|---|---|
| OpenRouter | `GET https://openrouter.ai/api/v1/models` and `/models/<id>/endpoints` | Serves Kimi K2 Thinking, Qwen3-235B Thinking 2507, DeepSeek R1-0528 and DeepSeek V3.2. Lists Hermes 4 70B with **no endpoint**. |
| Hugging Face Inference | `GET https://huggingface.co/api/models/<repo>?expand[]=inferenceProviderMapping` | Serves all five. |
| Together (serverless) | `https://docs.together.ai/docs/serverless-models` (the API list needs a key) | Serves none of them. Its list has newer versions of the same lines, which are different models. |
| NVIDIA NIM | `GET https://integrate.api.nvidia.com/v1/models` | Serves none of them. |
| Anthropic | `https://platform.claude.com/docs/en/about-claude/model-deprecations` and `.../pricing` | No research role uses a Claude model. For the server's own settings: Sonnet 4.5 is served until 30 Nov 2026 (deprecated), Opus 4.7 is active, Sonnet 4 was retired on 15 Jun 2026, Haiku 3.5 on 19 Feb 2026. |

## Each role, before and after

"Before" is the default order with every provider configured. All five kinds of research use the same model per role, except the planner for patent research, which uses DeepSeek R1-0528 (after: OpenRouter, then Hugging Face Inference).

| Roles | Model | Before | After |
|---|---|---|---|
| planner | Kimi K2 Thinking | own model, DeepSeek V3.2, Claude Haiku 5.5, 5 Together models, 3 hub models, NVIDIA `deepseek-v4.1-flash`, Hermes 4 70B | OpenRouter `moonshotai/kimi-k2-thinking`, then Hugging Face `moonshotai/Kimi-K2-Thinking` |
| reasoner, strongest_form, change_planner | Qwen3-235B Thinking 2507 | own model, DeepSeek R1-0528, Claude (Sonnet 5.5; Haiku 5.5 for change_planner), 5 Together models, 3 hub models, NVIDIA (`kimi-k3`; `deepseek-v4.1-flash` for change_planner), DeepSeek V3.2, Hermes 4 70B | OpenRouter `qwen/qwen3-235b-a22b-thinking-2507`, then Hugging Face `Qwen/Qwen3-235B-A22B-Thinking-2507` |
| synthesizer, outline_architect, section_drafter, coherence_refiner, section_rewriter, plain_language_synthesizer | Qwen3-235B Thinking 2507 | own model, DeepSeek V3.2, Claude (Sonnet 5.5; Haiku 5.5 for plain_language_synthesizer), 5 Together models, 3 hub models, NVIDIA (`kimi-k3`; `deepseek-v4.1-flash` for plain_language_synthesizer), Hermes 4 70B | the same two routes as the row above |
| double_check, internal_challenger | Hermes 4 70B | own model, Hermes 3 70B, Claude Sonnet 5.5, 5 Together models, 3 hub models, NVIDIA `kimi-k3`, DeepSeek V3.2 | OpenRouter `nousresearch/hermes-4-70b`, then Hugging Face `NousResearch/Hermes-4-70B` |
| retriever, source_class_classifier, verifier, citation_integrity_checker, citation_formatter, revision_intake, report_locator, final_revision_verifier, contract_auditor, market_scout, competitor_mapper, demand_signal_analyst, feasibility_architect, story_verifier, timeline_reconstructor, data_analysis_specialist, quantitative_quality_auditor | DeepSeek V3.2 | own model, DeepSeek V3.1, Claude (Haiku 5.5; Sonnet 5.5 for the two verifier roles), 5 Together models, 3 hub models, NVIDIA (`deepseek-v4.1-flash`; `kimi-k3` for the two verifier roles), Hermes 4 70B | OpenRouter `deepseek/deepseek-v3.2`, then Hugging Face `deepseek-ai/DeepSeek-V3.2` |

No role reaches Anthropic, Together or NVIDIA after this change.

## Single provider: no same-model backup available

- **double_check and internal_challenger (Hermes 4 70B).** Hugging Face Inference is the only provider confirmed to serve it. OpenRouter still knows the id, lists it with no endpoint and leaves it out of its model list. The call still goes to OpenRouter first, because that is the id the role chose, and then to the same model on Hugging Face Inference. If the server has no `HF_TOKEN`, or Hugging Face Inference refuses, the call fails: there is no other host for this model and no other model is called in its place.

Also served by one provider, for a call made outside a research run with the server's own settings: Claude Sonnet 4 (OpenRouter only; the server setting of 11 roles), Gemini 2.5 Pro, GPT-5 mini, o4-mini and Mistral Small 3.2 (OpenRouter only). Claude Haiku 3.5, the server setting for plain_language_synthesizer, is listed by no provider.

## The admin provider health check

`POST /api/admin/providers/health` (administrators only) now also returns:

- `roles`: for every role, the model it chose, `servedBy` (the providers that serve that exact model), `providerCount`, `servedByWithKey` and `providerCountWithKey` (those that have a key on this server), `singleProvider`, `ownProviderConfirmed`, and `otherModels` when the role uses a different model for one kind of research or as the server's setting.
- `singleProviderRoles`: the roles whose model one provider serves.
- `providersServingNoRoleModel`: providers that have a key but serve no model any role chose. They are not asked.

A provider is asked only when it has a key and serves a role's model, with that model. This part reads the table; only the per-provider check sends a request.

## For Brandon to decide

- **Hermes 4 70B has no host on OpenRouter today.** After this change those two roles depend on Hugging Face Inference alone. Choosing another model for them is a change to the presets and is yours to make; nothing here changes a role's model.
- **Together and NVIDIA keys answer nothing now.** Neither serves a model a role chose. They come back into use when a row of the table gives one of them an id.
- **The request form still has a per-run backup field.** A backup that is a different model is no longer called, so the field has no effect. The form was not changed.

## Not done, and what it needs

- No request was sent to any provider (no keys here, and no paid calls). What OpenRouter answers for a model with no endpoint is taken from its documented message, not measured. The first real proof is an administrator calling the health check after deploy.
- Together's list was read from its documentation page, because `GET /v1/models` needs a key.
- No `.env` example file was edited. The four size settings listed above can be removed from the server at any time; they are ignored.
- No price row was added for the Hugging Face hub ids. Until a row keyed `huggingface_inference:<hub id>` exists, such a call is costed at the price of the role's own id.

## Tests

New: `rj025SameModelFailover.test.ts` (the table, every role's routes holding one model only, Anthropic only for Claude roles, no different-model backup, provider order, the single-provider roles, the failure a customer reads, run again unchanged).

Changed, because they asserted the old cross-model order:

- `modelRouteFallback.test.ts`: the role backup, Together's own models and the hub backups as routes; the `CROSS_PROVIDER_BACKUPS` cases.
- `modelProviderRoutes.test.ts`: "every role has a model on each added provider", the size-class tables, Anthropic and NVIDIA as a route for every role.
- `rj024RouteConfiguration.test.ts`: the Together backup list and each role's full old order.
- `rj024ProviderHealth.test.ts`: every provider asked with a model of its own; added the per-role cases.
- `providerCallPricing.test.ts`: ids that came from the removed tables; added the provider-and-model key cases.
