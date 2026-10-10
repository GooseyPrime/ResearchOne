/**
 * Where the Google Analytics tag is allowed to run (RJ-022).
 *
 * The tag is for the public pages. On every page view it also reads the text
 * on the page looking for e-mail addresses, with a pattern whose cost grows
 * with the square of the longest run of letters, digits, dots, dashes and
 * underscores it meets. Signed-in pages print a customer's request, a run's
 * trace and stored provider answers, which can hold such runs; measured in
 * Chromium, an 80,000-character run on the dossier page held the page still
 * for six seconds and a 200,000-character run for forty. A customer's research
 * is also not the tag's to read.
 *
 * Google's own switch for a measurement id is `window['ga-disable-<id>']`.
 * With it set the tag sends nothing and reads nothing. It is set for the
 * signed-in areas and cleared for the public ones, on first load
 * (`index.html`, before the tag is configured) and on every route change
 * (`MarketingDocumentEffect`).
 *
 * RJ-023: the signed-in steps between a new account and a payment are counted
 * too. They are named one by one below (an allow-list). Every other signed-in
 * address stays off, so a research page added later is private without anyone
 * having to remember this file. `index.html` holds the same two patterns.
 */
export const GA_MEASUREMENT_ID = 'G-C9CW32EES7';

const SIGNED_IN_AREAS = ['/app', '/account', '/onboarding'] as const;

/** True for the signed-in areas: the app, the account pages and onboarding. */
export function isSignedInAreaPath(pathname: string): boolean {
  return SIGNED_IN_AREAS.some((area) => pathname === area || pathname.startsWith(`${area}/`));
}

/**
 * The signed-in addresses the tag may count: onboarding, and the billing page
 * (plans, checkout start, wallet top-up, plan change, and where Stripe sends
 * the customer back after paying or cancelling). None of them prints a
 * request, a report or a run.
 */
export const TRACKED_SIGNED_IN_PATTERN = /^\/(onboarding(\/.*)?|app\/billing\/?)$/;

/** True where the tag may run: every public page, and the allow-listed signed-in ones. */
export function isAnalyticsTrackedPath(pathname: string): boolean {
  return !isSignedInAreaPath(pathname) || TRACKED_SIGNED_IN_PATTERN.test(pathname);
}

/** Switch the analytics tag off on private pages and on again on the ones it may count. */
export function applyAnalyticsScope(pathname: string): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`] = !isAnalyticsTrackedPath(pathname);
}
