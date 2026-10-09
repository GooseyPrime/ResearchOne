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

/**
 * The failure sentence to print for a customer: the server's sentence when it
 * is one, the fixed sentence when what arrived is a stored error, and nothing
 * when nothing arrived.
 */
export function customerFailureText(text: string | null | undefined): string | null {
  const value = (text ?? '').trim();
  if (!value) return null;
  return looksLikeStoredError(value) ? RUN_COULD_NOT_FINISH : plainProgressText(value);
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
