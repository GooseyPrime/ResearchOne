/**
 * What a route sends when its response carries report text (slice 5, item 11).
 *
 * Every such response goes through the one presentation mapper. This is not
 * switched: there is no setting under which a route sends report text as stored.
 */
import { presentForReader, type PresentOptions } from '../services/formatting/reportPresentation';

export function forReader<T>(response: T, options?: PresentOptions): T {
  return presentForReader(response, options);
}

/** For a response that carries no report text. Says so where the response is sent, so the route test can tell a decision from an omission. */
export function notReportText<T>(response: T): T {
  return response;
}
