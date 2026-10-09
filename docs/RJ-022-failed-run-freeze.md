# RJ-022. Opening a failed run held the browser tab still (9 Oct 2026)

A fix outside the slices of `docs/UPGRADE_PLAN.md`; it follows that file's entry of the same day for RJ-019.

Seen live at 20:32 UTC on run `6622a18a-03f0-4317-a839-ddf2b73132cd`: clicking its card on Dossiers left the tab not responding, as the run page had earlier in the day.

What was done to find it. The run's shape was built as a fixture (`frontend/src/__tests__/rj022/failedRunFixture.ts`: request, plan, about 110 trace events, routes tried, a 46-entry model log) and the Dossiers page, the dossier, the run page and the diagnostics page were opened with it in Chromium, against the development build and the production build, with the live connection off, on, flooded with events, and with the server not answering for 70 seconds. With that fixture every page draws in a few passes and asks for each thing once. No loop is in the page code.

What was found, by making the text larger and recording where the time went:

- **The analytics tag reads signed-in pages.** `index.html` loads Google's tag on every page. On each page view the tag looks through the page's text for e-mail addresses, with a pattern whose time grows with the square of the longest run of letters, digits, dots, dashes, underscores and percent signs. The pages printed a request and a run's stored text in full. Measured: an 80,000-character run on the dossier page held the tab for 6 seconds, a 200,000-character run for 20 seconds on the list and the run page and 40 seconds on the dossier (which prints the request twice). All of that time was inside the tag's pattern, none in our code, which is why reading the code found nothing.
- **Taking old labels out of a dossier card could take minutes.** `stripReportLabels` read each `, Chunk 5` of a `(inference, Chunk 1, Chunk 2, …` list two ways, so a list with no closing bracket doubled the time per item: 26 items took 33 seconds in the test, 30 would take minutes.

What changed:

- The tag is off on `/app`, `/account` and `/onboarding`, through Google's own per-id switch: set in `index.html` before the tag is configured, and kept on route changes by `frontend/src/lib/analyticsScope.ts` (called from `MarketingDocumentEffect`). Public pages are measured as before. Checked in Chromium: no time in the pattern and no hit sent from a signed-in page, whether opened directly or reached from a public page.
- `reportLabels.ts`: a list of passage numbers and a list of origins no longer overlap, so the time is in proportion to the text.

Not established, and what it needs:

- **Whether either of these is what held run `6622a18a` still.** The run's stored text was not read (no production database access for this order), so it is not known that it holds a run of characters long enough, and its dossier card was on screen before the click, which the label pattern alone would have prevented. Both are real ways for these pages to stop responding and both are closed; the live cause is not confirmed. Next step if it happens again: a performance recording in the browser that froze, or the longest unbroken run of characters in the run's `query`, `supplemental`, `error_message` and trace.
- `backend/src/services/formatting/reportPresentation.ts` builds its label pattern the same way. There it would hold the API process, not a browser. Not changed here (a frontend order).
- A burst of live events makes the run page ask for the whole run row once per event. Only a server sending many events a second does this; none was observed.

Tests: `frontend/src/__tests__/rj022/failedRunPage.test.tsx`.
