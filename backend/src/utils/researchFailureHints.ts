const HINT_HF_INFERENCE_LOGS_EMPTY =
  'The request may have failed before model execution; Hugging Face model inference logs can be empty in this case.';
const HINT_TOGETHER_AFTER_HF =
  'The failing request was sent to Together.ai after Hugging Face failed for this model id. Verify TOGETHER_API_KEY, Together service status, and that the model id is available on Together.';

export function buildModelFailureOrchestratorHints(meta: Record<string, unknown>): string[] {
  const hints: string[] = [];
  const upstream = meta.upstream;
  const classification = meta.classification;
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
