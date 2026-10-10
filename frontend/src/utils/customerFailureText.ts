/**
 * What a customer is shown when a run does not finish (RJ-019).
 *
 * The server sends a customer one plain sentence for a failed run and keeps the
 * stored error (the step, the model, the provider's answer, the status code)
 * for the admin and diagnostics pages. This file is the page's own guard: the
 * two halves deploy separately, a socket event can carry the stored text, and
 * a row stored before the change can still hold it. Text that reads like a
 * stored error is never printed for a customer; one fixed sentence is.
 */
import axios from 'axios';
import { plainProgressText } from '@/lib/researchone/plainWords';

/** The same words the server uses for a failure it has no closer sentence for. */
export const RUN_COULD_NOT_FINISH =
  'This run could not be finished. You have not been charged. Press Run it again to try again; you are only charged once, when a report is delivered.';

const STORED_ERROR_SHAPES: readonly RegExp[] = [
  /\b(?:role|model|status|classification|endpoint|upstream|code)\s*=/i,
  /\bmodel provider\b/i,
  /\bupstream request\b/i,
  /\bprovider request failed\b/i,
  /\bnon-recoverable\b/i,
  /\brun aborted\b/i,
  /\bretry budget\b/i,
  /\b(?:quota|credits?)\b.*\b(?:exceed|add|insufficient)/i,
  /\badd credits\b/i,
  /\bhttps?:\/\//i,
  /\b[45]\d{2}\b.*\b(?:error|status|request|response)\b/i,
  /\b(?:openrouter|hugging ?face|together(?:\.ai)?)\b/i,
  // A step code or role key: lower-case words joined by underscores.
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/,
  // A model id: vendor/name.
  /\b[a-z0-9][\w.-]*\/[a-z0-9][\w.:-]*\b/i,
];

/** True when text reads like the stored error rather than a sentence written for a customer. */
export function looksLikeStoredError(text: string | null | undefined): boolean {
  const value = (text ?? '').trim();
  if (!value) return false;
  return STORED_ERROR_SHAPES.some((shape) => shape.test(value));
}

/** The instruction a failure sentence ends with while the run can be run again. */
const RUN_AGAIN = 'Press Run it again to try again; you are only charged once, when a report is delivered.';
/** The instruction it ends with once the run cannot: the name of the link the run page offers instead. */
const SEND_AS_NEW = 'Press Send it as a new request to start it fresh; you are only charged once, when a report is delivered.';

/** The name of the run page's way on from a run that cannot be run again (RJ-022B). */
export const SEND_AS_NEW_REQUEST = 'Send it as a new request';

/**
 * What a person is told when they ask for a run to be run again and it cannot
 * be (RJ-022B). The server answers with this sentence; why it cannot is kept
 * for administrators.
 */
export const RETRY_REFUSED =
  "This request can't be run again. Press Send it as a new request to start it fresh; you have not been charged.";

const RUN_AGAIN_SENTENCES: readonly string[] = [
  'The report could not be written because our AI service is temporarily unavailable. You have not been charged. Press Run it again to try again; you are only charged once, when a report is delivered.',
  'This run stopped because our AI service is temporarily unavailable. You have not been charged. Press Run it again to try again; you are only charged once, when a report is delivered.',
  RUN_COULD_NOT_FINISH,
];

/**
 * A failure sentence for a run that cannot be run again. "Press Run it again"
 * would name a button the page does not offer, so the sentence names the link
 * it does. The server sends it this way; this is the same rule on the page,
 * for a server older than the page and for a row stored before the change.
 */
export function sentenceForRunThatCannotRunAgain(text: string): string {
  return text.endsWith(RUN_AGAIN) ? `${text.slice(0, -RUN_AGAIN.length)}${SEND_AS_NEW}` : text;
}

/**
 * The sentences the server writes for a customer (`customerFailureMessage.ts`):
 * each failure sentence in both endings, and the refusal to run a run again.
 * Only these are printed as they arrive.
 */
const CUSTOMER_SENTENCES: ReadonlySet<string> = new Set([
  ...RUN_AGAIN_SENTENCES,
  ...RUN_AGAIN_SENTENCES.map(sentenceForRunThatCannotRunAgain),
  RETRY_REFUSED,
  'This request has not stopped, so there is nothing to run again. Reload the page to see where it has got to.',
]);

/**
 * The failure sentence to print for a customer: the server's sentence when it
 * is one of the sentences above, the fixed sentence for anything else, and
 * nothing when nothing arrived. Anything that is not a known sentence may be a
 * stored error of a shape nobody listed, so it is never printed.
 */
export function customerFailureText(text: string | null | undefined): string | null {
  const value = (text ?? '').trim();
  if (!value) return null;
  const plain = plainProgressText(value);
  return CUSTOMER_SENTENCES.has(plain) ? plain : RUN_COULD_NOT_FINISH;
}

/**
 * What to print when the server refuses to run a run again: its sentence when
 * it is one of the sentences above, and the fixed refusal for anything else
 * (an older server sent a label and a reason written for whoever fixes the
 * pipeline; neither is printed).
 */
export function retryRefusedText(serverSentence: string | null | undefined): string {
  const value = (serverSentence ?? '').trim();
  return value !== '' && CUSTOMER_SENTENCES.has(value) && !RUN_AGAIN_SENTENCES.includes(value) ? value : RETRY_REFUSED;
}

/**
 * What a person is told when asking for a run to be run again got no answer
 * that says what happened (no reply, or a server error). The request may have
 * arrived, so the page does not call it refused and does not send the person
 * to a new request, which would be a second run: it looks at the run again
 * and leaves "Run it again" in place.
 */
export const RETRY_NOT_CONFIRMED =
  'We could not confirm that this request started again. This page is checking now; if it still says it did not finish, press Run it again.';

/**
 * What the server said when it refused to run a run again: its sentence for a
 * person (`error`), and, for an administrator only, why (`reason`).
 *
 * Null when the request failed some other way. The route refuses with 400 (the
 * run cannot be run again) or 409 (its reserved payment is gone) and nothing
 * else; no answer at all, or a server error, is not a refusal, because the
 * run may have been queued before the answer was lost.
 */
export function retryRefusalFromError(err: unknown): { sentence: string | null; adminReason: string | null } | null {
  if (!axios.isAxiosError(err)) return null;
  const status = err.response?.status;
  if (status !== 400 && status !== 409) return null;
  const data = err.response?.data as { error?: unknown; reason?: unknown } | undefined;
  return {
    sentence: typeof data?.error === 'string' && data.error.trim() ? data.error : null,
    adminReason: typeof data?.reason === 'string' && data.reason.trim() ? data.reason : null,
  };
}

/**
 * Whether a run may be run again, by the test the server applies before it
 * does, in the server's order (`decideRunStateOnRetryRequest`): the run has
 * failed (not been stopped for good), its stored record says it may be run
 * again (`resumeAvailable` is the flag's older name), and attempts remain.
 * An old row can still say `resumeAvailable: true` after the run was stopped
 * for good; the status is read first so the page does not offer a button the
 * server will refuse.
 */
export function runCanBeRunAgain(run: {
  status: string;
  failure_meta?: Record<string, unknown> | null;
  retry_attempts?: number | null;
  retry_budget?: number | null;
}): boolean {
  if (run.status !== 'failed') return false;
  const meta = run.failure_meta ?? {};
  if (meta.terminal === true) return false;
  if (meta.retryable !== true && meta.resumeAvailable !== true) return false;
  const attempts = run.retry_attempts;
  const budget = run.retry_budget;
  if (typeof attempts === 'number' && typeof budget === 'number' && attempts >= budget) return false;
  return true;
}

/**
 * Detail written for whoever diagnoses a run: `pending=6; failed=1;
 * waited=3000ms`, or a bare step code. A search a person typed is not this.
 */
export function looksLikeInternalDetail(detail: string | null | undefined): boolean {
  const text = (detail ?? '').trim();
  if (!text) return false;
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(text)) return true;
  return /^[a-z_]+=[^;=]*(?:;\s*[a-z_]+=[^;=]*)*;?$/i.test(text);
}
