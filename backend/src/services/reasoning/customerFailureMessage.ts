/**
 * What a customer reads when a run does not finish.
 *
 * The stored error (`research_runs.error_message`) and `failure_meta` are
 * written for whoever has to fix the problem: they name the step, the model,
 * the provider's answer and its status. A customer is never shown those. A
 * customer is shown one of the sentences below, chosen from what kind of
 * failure it was, and the stored detail stays on the admin and diagnostics
 * pages.
 *
 * Every sentence says what the billing code does: a run is charged only when
 * it finishes with a report (`consumeHold` on completion in the orchestrator),
 * so a run that stops here has not been charged, and running it again cannot
 * charge twice.
 *
 * "Run it again" starts the research over. The run's saved checkpoints are a
 * record of what each stage produced; nothing reads them back to skip a stage,
 * so no sentence here promises that finished work is reused.
 */

export type CustomerFailureMessageId =
  | 'ai_service_unavailable_writing'
  | 'ai_service_unavailable'
  | 'run_could_not_finish';

const NOT_CHARGED = 'You have not been charged.';
const RUN_AGAIN =
  'Press Run it again to try again; you are only charged once, when a report is delivered.';

export const CUSTOMER_FAILURE_MESSAGES: Readonly<Record<CustomerFailureMessageId, string>> = {
  ai_service_unavailable_writing: `The report could not be written because our AI service is temporarily unavailable. ${NOT_CHARGED} ${RUN_AGAIN}`,
  ai_service_unavailable: `This run stopped because our AI service is temporarily unavailable. ${NOT_CHARGED} ${RUN_AGAIN}`,
  run_could_not_finish: `This run could not be finished. ${NOT_CHARGED} ${RUN_AGAIN}`,
};

/** Failures that are about an AI provider (credit, rate limit, outage, key, network), not about the request. */
const AI_SERVICE_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  'quota_exceeded',
  'rate_limited',
  'provider_unavailable',
  'network_error',
  'auth_error',
  'endpoint_not_found',
]);

const WRITING_STAGES: ReadonlySet<string> = new Set(['synthesis', 'synthesizer', 'plain_language']);

export interface CustomerFailureMessage {
  id: CustomerFailureMessageId;
  text: string;
}

export function customerFailureMessage(args: {
  classification?: string | null;
  stage?: string | null;
}): CustomerFailureMessage {
  const classification = (args.classification ?? '').trim();
  const stage = (args.stage ?? '').trim().toLowerCase();
  let id: CustomerFailureMessageId = 'run_could_not_finish';
  if (AI_SERVICE_CLASSIFICATIONS.has(classification)) {
    id = WRITING_STAGES.has(stage) ? 'ai_service_unavailable_writing' : 'ai_service_unavailable';
  }
  return { id, text: CUSTOMER_FAILURE_MESSAGES[id] };
}

/** Fields of `failure_meta` a customer's page needs to decide what to offer. Nothing here names a model, a step or a provider. */
const CUSTOMER_FAILURE_META_KEYS = [
  'retryable',
  'terminal',
  'resumeAvailable',
  'retryAttempts',
  'retryBudget',
  'attemptsRemaining',
  'gate_status',
  'customerMessageId',
  'customerMessage',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function customerFailureMeta(meta: unknown): Record<string, unknown> | null {
  if (!isRecord(meta)) return null;
  const out: Record<string, unknown> = {};
  for (const key of CUSTOMER_FAILURE_META_KEYS) {
    if (meta[key] !== undefined) out[key] = meta[key];
  }
  return out;
}

/** A trace event as a customer is sent it: no model id, no token counts, no internal detail, no stored error text. */
function customerProgressEvent(event: unknown, fallback: CustomerFailureMessage): unknown {
  if (!isRecord(event)) return event;
  const { model: _model, tokenUsage: _tokenUsage, internalDetail: _internalDetail, failureMeta: _failureMeta, failure, ...rest } = event;
  void _model;
  void _tokenUsage;
  void _internalDetail;
  void _failureMeta;
  const out: Record<string, unknown> = { ...rest };
  // Events stored before the detail was split carried `key=value` text here.
  if (typeof out.detail === 'string' && looksLikeInternalDetail(out.detail)) delete out.detail;
  if (isRecord(failure)) {
    const meta = customerFailureMeta(failure.failureMeta);
    const text =
      typeof meta?.customerMessage === 'string' && meta.customerMessage.trim() ? meta.customerMessage : fallback.text;
    out.failure = { errorMessage: text, retryable: failure.retryable === true, ...(meta ? { failureMeta: meta } : {}) };
    // The line written for a stopped run used to repeat the stored error.
    if (out.eventType === 'run_failed' || out.eventType === 'run_aborted') out.message = text;
  }
  return out;
}

/** `pending=6; failed=1; waited=3000ms`, or a bare step code such as `no_sources_ingested`. */
export function looksLikeInternalDetail(detail: string): boolean {
  const text = detail.trim();
  if (!text) return false;
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(text)) return true;
  return /^[a-z_]+=[^;=]*(?:;\s*[a-z_]+=[^;=]*)*;?$/i.test(text);
}

/**
 * A run row as a customer is sent it. A gate outcome (a report that was
 * written but did not pass a check) keeps its own explanation, which the page
 * already has plain words for; every other failure gets one of the sentences
 * above in place of the stored error.
 */
export function runRowForCustomer<T>(row: T): T {
  if (!isRecord(row)) return row;
  const status = typeof row.status === 'string' ? row.status : '';
  const meta = isRecord(row.failure_meta) ? row.failure_meta : null;
  const fallback = customerFailureMessage({
    classification: typeof meta?.classification === 'string' ? meta.classification : null,
    stage: typeof row.failed_stage === 'string' ? row.failed_stage : null,
  });
  const out: Record<string, unknown> = { ...row };
  delete out.resume_job_payload;
  delete out.model_log;
  const failed = status === 'failed' || status === 'aborted';
  if (failed || row.error_message != null) {
    const stored = typeof meta?.customerMessage === 'string' && meta.customerMessage.trim() ? meta.customerMessage : null;
    const hasGate = typeof meta?.gate_status === 'string' && meta.gate_status.trim() !== '';
    out.error_message = hasGate && !stored ? null : stored ?? fallback.text;
  }
  if (meta) out.failure_meta = customerFailureMeta(meta);
  if (Array.isArray(row.progress_events)) {
    out.progress_events = row.progress_events.map((event) => customerProgressEvent(event, fallback));
  }
  return out as T;
}

/**
 * Trace events as a customer is sent them, for any endpoint that returns a
 * run's events outside the run row (the diagnostics page reads them this way).
 */
export function progressEventsForCustomer(
  events: readonly unknown[],
  args: { classification?: string | null; stage?: string | null } = {}
): unknown[] {
  const fallback = customerFailureMessage(args);
  return events.map((event) => customerProgressEvent(event, fallback));
}

/**
 * A progress event as it is sent over the socket. The socket reaches every
 * signed-in browser, so it carries what a customer may read and nothing else.
 * An administrator's page gets the full event from the run row instead.
 */
export function progressEventForBroadcast<T>(event: T): T {
  return customerProgressEvent(event, customerFailureMessage({})) as T;
}
