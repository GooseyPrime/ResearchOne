const HINT_HF_INFERENCE_LOGS_EMPTY =
  'The request may have failed before model execution; Hugging Face model inference logs can be empty in this case.';
const HINT_TOGETHER_AFTER_HF =
  'The failing request was sent to Together.ai after Hugging Face failed for this model id. Verify TOGETHER_API_KEY, Together service status, and that the model id is available on Together.';
const HINT_OPENROUTER_NO_ALLOWED_PROVIDERS =
  'OpenRouter returned 404 "No allowed providers are available for the selected model." This is an account-side configuration mismatch, not a transient outage: every upstream provider for this model is excluded by your account\'s privacy / data-collection / model-policy filter. Action: (1) on https://openrouter.ai/settings/preferences, ensure "Allow training on prompts" is permitted (or set OPENROUTER_DATA_COLLECTION=allow on the server); (2) or pick a different model in the per-run override panel — open the V2 page, click "Show model ensemble", and switch the failing role to a model with multiple upstream providers.';
const HINT_OPENROUTER_404 =
  'If the upstream is OpenRouter and the model id was just changed, verify the slug is in https://openrouter.ai/api/v1/models. Stale slugs return HTTP 404 "Model not found".';

export function buildModelFailureOrchestratorHints(meta: Record<string, unknown>): string[] {
  const hints: string[] = [];
  const upstream = meta.upstream;
  const classification = meta.classification;
  const providerMessage = typeof meta.providerMessage === 'string' ? meta.providerMessage : '';
  const status = meta.status;

  if (upstream === 'huggingface_inference' && classification === 'provider_unavailable') {
    hints.push(HINT_HF_INFERENCE_LOGS_EMPTY);
  }
  if (meta.providerFallbackAttempted === true) {
    const fb = typeof meta.providerFallbackBackend === 'string' ? meta.providerFallbackBackend : 'unknown';
    const fbResult = typeof meta.providerFallbackResult === 'string' ? meta.providerFallbackResult : 'unknown';
    hints.push(`Provider fallback attempted via ${fb} (result=${fbResult}).`);
  }
  if (upstream === 'together') {
    hints.push(HINT_TOGETHER_AFTER_HF);
  }

  // OpenRouter "No allowed providers are available" — account-side
  // provider-policy mismatch. Always actionable; surface a specific
  // hint instead of the generic "non-recoverable" copy that the state
  // machine would otherwise emit.
  if (upstream === 'openrouter' && /no allowed providers/i.test(providerMessage)) {
    hints.push(HINT_OPENROUTER_NO_ALLOWED_PROVIDERS);
  } else if (upstream === 'openrouter' && (status === 404 || status === '404')) {
    hints.push(HINT_OPENROUTER_404);
  }

  return hints;
}

/** Merges standard orchestrator hints into failure_meta without duplicating strings. */
export function mergeOrchestratorHintsIntoFailureMeta(meta: Record<string, unknown>): void {
  const existing = Array.isArray(meta.orchestratorHints)
    ? meta.orchestratorHints.filter((h): h is string => typeof h === 'string')
    : [];
  const extra = buildModelFailureOrchestratorHints(meta);
  const merged = [...existing];
  for (const h of extra) {
    if (!merged.includes(h)) merged.push(h);
  }
  if (merged.length) meta.orchestratorHints = merged;
}
