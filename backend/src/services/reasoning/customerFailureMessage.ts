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

/**
 * The way on for a run that cannot be run again: the same words as a new
 * request. The run page's link has this name.
 */
const SEND_AS_NEW =
  'Press Send it as a new request to start it fresh; you are only charged once, when a report is delivered.';

/**
 * What a person is told when they ask for a run to be run again and it cannot
 * be (RJ-022B). The reason it cannot is kept for administrators.
 */
export const RETRY_REFUSED_MESSAGE =
  "This request can't be run again. Press Send it as a new request to start it fresh; you have not been charged.";

/** The same refusal for a run that has not stopped: there is nothing to run again yet. */
export const RETRY_NOT_STOPPED_MESSAGE =
  'This request has not stopped, so there is nothing to run again. Reload the page to see where it has got to.';

/**
 * A customer sentence for a run that cannot be run again: "Press Run it again"
 * would name a button the page does not offer, so it names the one it does.
 * Text that does not end with that instruction is returned as it is.
 */
export function sentenceForRunThatCannotRunAgain(text: string): string {
  return text.endsWith(RUN_AGAIN) ? `${text.slice(0, -RUN_AGAIN.length)}${SEND_AS_NEW}` : text;
}

/**
 * Whether a run may be run again: the test the retry route applies, in its
 * order (`decideRunStateOnRetryRequest`). The run has failed, not been stopped
 * for good, and its stored record says it may be run again. The status is read
 * first: an old row can still say `resumeAvailable: true` after the run was
 * stopped for good, and the route refuses such a run whatever the record says.
 */
function canRunAgain(status: string | null | undefined, meta: Record<string, unknown> | null): boolean {
  if (status !== 'failed') return false;
  if (meta?.terminal === true) return false;
  return meta?.retryable === true || meta?.resumeAvailable === true;
}

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
  'route_config_error',
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
function customerProgressEvent(event: unknown, fallback: CustomerFailureMessage, runCanRunAgain?: boolean): unknown {
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
    const sentence =
      typeof meta?.customerMessage === 'string' && meta.customerMessage.trim() ? meta.customerMessage : fallback.text;
    // Whether the run can be run again is the run's to say, so the trace and
    // the sentence above it name the same button. An event sent on its own
    // (over the socket, when the run stops) says it for itself.
    const runAgain = runCanRunAgain ?? failure.retryable === true;
    const text = runAgain ? sentence : sentenceForRunThatCannotRunAgain(sentence);
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
    const sentence = stored ?? fallback.text;
    // A run that cannot be run again is not told to press "Run it again".
    out.error_message = hasGate && !stored ? null : canRunAgain(status, meta) ? sentence : sentenceForRunThatCannotRunAgain(sentence);
  }
  if (meta) {
    const forCustomer = customerFailureMeta(meta);
    if (forCustomer && typeof forCustomer.customerMessage === 'string' && !canRunAgain(status, meta)) {
      forCustomer.customerMessage = sentenceForRunThatCannotRunAgain(forCustomer.customerMessage);
    }
    out.failure_meta = forCustomer;
  }
  if (Array.isArray(row.progress_events)) {
    // Only a run that has stopped has an answer; a run in flight leaves each event to say.
    const runAgain = failed ? canRunAgain(status, meta) : undefined;
    out.progress_events = row.progress_events.map((event) => customerProgressEvent(event, fallback, runAgain));
  }
  return out as T;
}

/**
 * Trace events as a customer is sent them, for any endpoint that returns a
 * run's events outside the run row (the diagnostics page reads them this way).
 */
export function progressEventsForCustomer(
  events: readonly unknown[],
  args: { classification?: string | null; stage?: string | null; failureMeta?: unknown; status?: string | null } = {}
): unknown[] {
  const fallback = customerFailureMessage(args);
  // With the run's status and stored failure record, the run says whether it can be run again; without them each event does.
  const stopped = args.status === 'failed' || args.status === 'aborted';
  const runAgain = stopped ? canRunAgain(args.status, isRecord(args.failureMeta) ? args.failureMeta : null) : undefined;
  return events.map((event) => customerProgressEvent(event, fallback, runAgain));
}

/**
 * A progress event as it is sent over the socket. The socket reaches every
 * signed-in browser, so it carries what a customer may read and nothing else.
 * An administrator's page gets the full event from the run row instead.
 */
export function progressEventForBroadcast<T>(event: T): T {
  return customerProgressEvent(event, customerFailureMessage({})) as T;
}
