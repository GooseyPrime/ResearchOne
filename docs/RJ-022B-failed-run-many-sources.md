# RJ-022B. The failed run with 317 search results (9 Oct 2026)

Follows `docs/RJ-022-failed-run-freeze.md`. A fix outside the slices of `docs/UPGRADE_PLAN.md`.

After RJ-022 (#277) was live, opening run `6622a18a-03f0-4317-a839-ddf2b73132cd` from Dossiers still left the browser tab not responding. The order for this change gave the run's measured size: a 423 KB run row, of which 390 KB is the stored search record with 317 results of about 1.2 KB each, and 902 KB of diagnostics. Its premise was that something in the pages grows with the square of the number of results.

## The freeze was not reproduced, and its cause is not established

This is the third order to chase it (RJ-019, RJ-022, this one) and the third that could not make it happen.

What was done:

- A fixture of the run at its measured size (`frontend/src/__tests__/rj022b/manySourcesFixture.ts`): 317 results with titles, addresses of up to 115 unbroken characters, extracts of a few hundred characters and the reason each was or was not read; run row 423,528 bytes (live 423,098), search record 390,853 (live 390,314), diagnostics 901,606 (live 902,613).
- The production build was opened with it in Chromium: the Dossiers list and a click on the run's card, the dossier and each of its tabs, the run page (left open), and the diagnostics page closed and with every section open. As an administrator (who is sent the whole row) and as a customer. With the analytics tag blocked and with it loaded.
- The same again with each part made ten times larger, one at a time: 3,170 results, ten times the trace, ten times the request, the stored error and the plan.
- The server's work on the response (`forReader`) was timed on the same rows.
- Every pattern in the frontend was checked for time that can blow up (146 patterns).

What was found:

| Page (administrator, 317 results) | Opened in | Longest single block |
|---|---|---|
| Dossiers list, then the card | about 1 s | 54 ms |
| Dossier | under 1 s | none over 50 ms |
| Run page | under 1 s | none over 50 ms |
| Diagnostics, sections closed | under 1 s | none over 50 ms |
| Diagnostics, every section open (before this change) | under 2 s | 80 ms |

- **The 317 results are not drawn on the Dossiers page, the dossier or the run page at all.** The dossier asks for a 3 KB record and never asks for the run row. The run page receives the row and reads its trace, status and failure fields; nothing reads `discovery_summary`.
- **Nothing grows faster than the list.** At 3,170 results (a 3.9 MB row) the Dossiers page, the dossier and the run page take the same time as at 317. The only page that grew was diagnostics with its sections open: 0.7 s to open the search section and 17,000 elements. That is slow, not a freeze, and it needs a section to be opened by hand.
- The server's cleaning of the response takes 9 ms for the run row and 14 ms for diagnostics, and four times the data takes about three times as long.
- No pattern is worse than quadratic on the short strings it is given; the worst case found took 0.2 s on a 24,000-character request made for the purpose.

So the premise does not hold in this code: the number of results is not what holds the page. Two kinds of cause remain, and this work could test neither:

1. **Something the real browser session has and the test does not**: a browser extension or an automation agent attached to the tab, the real sign-in script, a live socket.
2. **Something in the run's real content** that a fixture of the same shape and size does not have.

No production data was read: the work session had no access to the production database, and the run's responses were not available to it.

## What will settle it

Two things were added so that the next attempt does not depend on reading code.

**The browser now writes down which script was running** (`frontend/src/lib/longFrameLog.ts`). Whenever a frame takes two seconds or more, Chromium reports afterwards how long it took and which scripts ran in it. The page keeps the last twenty such reports: in the console, under `localStorage['r1:long-frames']`, and for an administrator in a section at the foot of the diagnostics page. Each names the script's address (the application's bundle, the analytics tag, the sign-in script, or `chrome-extension://…`), the function, what called it, and the time. It keeps no page text and sends nothing. The earlier report of this freeze said it lasted about two minutes; a frame that ends is reported. A tab that is closed before the frame ends keeps nothing.

To use it: open the run in the browser that froze, wait for the page to come back, then in the console run `JSON.parse(localStorage['r1:long-frames'])`, or open any failed run's diagnostics page.

**The run's real responses can be replayed** (`frontend/scripts/failed-run-harness/`, with its own README). Save `GET /api/research/:id`, `/artifacts`, `/api/dossiers/:id` and `/api/dossiers` as the run's owner, and

```bash
cd frontend
node scripts/failed-run-harness/open-pages.mjs --data <folder> --profiles <folder>/profiles
```

opens the five pages above in Chromium against the production build and writes a CPU profile for each. If a page is held there, the profile says where. If none is, the cause is in the first group above, and the browser's own record will name it.

## What changed

**Diagnostics page: long lists are drawn a part at a time.** The search section printed the stored record whole, as JSON (390 KB in one block), and the list of results set aside drew all 292. Both, and the lists of sources used and findings, now draw the first 25 with a "Show all 317" button (`components/ui/ShowAllList.tsx`). The search section shows counts ("5 searches · 317 results found · 25 read · 292 not read"), the searches and the results (`components/research/DiscoverySummaryView.tsx`). Measured in Chromium: opening the search section went from 141 ms to 81 ms at 317 results and from 680 ms to 81 ms at 3,170; the page with everything open from 2,466 elements to 1,359, and from 17,151 to 1,414.

A customer who opens diagnostics no longer sees the stored record's field names (`selectionRationale`, `ingestionJobId`, `score=0.98, rank=1`) or the stored plan as JSON; both are for administrators, as on the dossier page. A customer sees the sources read, by title.

**A run that cannot be run again says so in plain words.**

- `POST /api/research/:id/retry-from-failure` answered a refusal with `"This failure is not retryable"` and `"The orchestrator classified this error as non-recoverable (auth / malformed request). Inspect the failure details and start a new run."`, and the page showed it. Every refusal now answers with one sentence in `error`: "This request can't be run again. Press Send it as a new request to start it fresh; you have not been charged." Why is still said, in `reason`, to administrators only (`retryRefusalForCustomer` takes it off for everyone else). `code` names the refusal for the page's logic.
- The run page and the diagnostics page offer **Send it as a new request** whenever a run cannot be run again: when it was stored that way, and when the server has just refused. The link carries the request into a new one. An administrator also sees the server's reason.
- The failure sentence of a run that cannot be run again no longer ends "Press Run it again", which named a button the page did not show. It ends "Press Send it as a new request to start it fresh; you are only charged once, when a report is delivered." The server sends it that way (`sentenceForRunThatCannotRunAgain` in `customerFailureMessage.ts`), in the run row and in the trace, and the page applies the same rule for a server older than itself.

## Why this run cannot be run again

Its report writer was refused by OpenRouter for lack of credit (HTTP 402). The answer was already recorded as what it was (`quota_exceeded`), but when the run stopped only a rate limit or an outage was written down as something a run could be run again after. So the row was stored with `retryable: false`, and the saved job a second attempt needs (`resume_job_payload`) was not kept. RJ-019 (#274) made out-of-credit recoverable for runs that fail from then on.

**Runs that stopped on a 402 before #274 stay runs that cannot be run again.** The retry rule reads the stored row. It was left that way on purpose: re-reading old rows under today's rule would still find no saved job to run and a reserved payment that has already been given back, and the order said not to change stored production data. For such a run the page now says so and offers the same request as a new one, and nothing was charged.

## Not done

- **The cause of the freeze is not found.** See above for what is needed.
- **The run row is still sent whole to an administrator's run page** (423 KB for this run), though the page reads none of the search results. Parsing it takes a few milliseconds and no page is held by it, so it was left; sending the run page a row without `discovery_summary.sources` would be a change to the API for no measured gain.
- `docs/UPGRADE_PLAN.md` was not edited. Its RJ-019 entry ("Run again", and "The two-minute freeze opening the run page was not reproduced") is continued by this file.
- The harness stands in for the sign-in script and has no live socket, so it cannot show a fault in either.
- No paid model call, and no call to production, was made. The 402 finding is from the code before and after #274, not from the stored row.

Tests: `frontend/src/__tests__/rj022b/manySourcesPage.test.tsx` (11 of its 15 tests fail before this change; the four that pass before it are the fixture's size and the time bounds of pages that never froze in test), `frontend/src/__tests__/rj022b/longFrameLog.test.ts`, `backend/src/__tests__/rj022bRetryRefusal.test.ts`.
