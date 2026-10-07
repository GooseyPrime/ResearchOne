/**
 * What a route sends when its response carries report text (slice 5, item 11).
 *
 * With READER_VIEW_ENABLED on, the response goes through the one presentation
 * mapper. With it off the response is sent exactly as before the slice (S1).
 * The report and revision detail routes were cleaned before this slice and
 * still are, switch or no switch; this adds to that, it does not replace it.
 */
import { readerViewEnabled } from '../config';
import { presentForReader, type PresentOptions } from '../services/formatting/reportPresentation';

export function forReader<T>(response: T, options?: PresentOptions): T {
  return readerViewEnabled() ? presentForReader(response, options) : response;
}

/** For a response that carries no report text. Says so where the response is sent, so the route test can tell a decision from an omission. */
export function notReportText<T>(response: T): T {
  return response;
}
