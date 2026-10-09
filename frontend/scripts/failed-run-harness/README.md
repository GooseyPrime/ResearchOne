# Failed-run harness (RJ-022B)

Opens one failed run in Chromium, against the **production build**, on the four
pages a person reaches it from, and reports how long each page was held:

| Page | Address |
|---|---|
| Dossiers list, then the run's card | `/app/dossiers` |
| The dossier | `/app/dossiers/:id` |
| The run page | `/app/run/:id` |
| Diagnostics (sections closed, then every section and every "Show all" open) | `/app/reports/run/:id` |

It exists because run `6622a18a` held a browser tab still in production on
9 Oct 2026 and the cause could not be found by reading the code. Use it to
replay the run's **real** responses, which is the step that was not possible
when it was written (see `docs/RJ-022B-failed-run-many-sources.md`).

## Run it

From `frontend/`:

```bash
# The repository's fixture of the run (317 search results, 423 KB run row, 900 KB diagnostics)
node scripts/failed-run-harness/open-pages.mjs

# The run's real responses, saved from the live API (see below), with CPU profiles
node scripts/failed-run-harness/open-pages.mjs --data ~/run-6622a18a --profiles ~/run-6622a18a/profiles
```

Options: `--customer` (answer as someone who is not an administrator),
`--with-analytics` (let the page load Google's tag), `--skip-build` (reuse the
last build), `HARNESS_PORT` (default 4010), `HARNESS_LIMIT_MS` (default 45000),
`CHROMIUM_PATH` (a Chromium to use instead of Playwright's).

It prints one row per page: whether it opened, the longest single block of the
page, the total time blocked, and how many elements were drawn. A page that
does not answer within the limit is reported as `NOT RESPONDING` and the
command exits 1. With `--profiles`, a `.cpuprofile` per page is written; load
it in Chrome DevTools (Performance > Load profile) to see where the time went.

## Replaying the real run

Signed in as the run's owner, save these four responses into one folder, under
these names. Nothing is written to production by reading them.

| File | Request |
|---|---|
| `run.json` | `GET /api/research/<run id>` |
| `artifacts.json` | `GET /api/research/<run id>/artifacts` |
| `dossier.json` | `GET /api/dossiers/<run id>` |
| `dossiers.json` | `GET /api/dossiers` |

`runs.json` (`GET /api/research`) is optional. The files hold a customer's
research: keep them out of the repository.

## What it is and is not

- The build is the application's own (`vite.config.ts`), with `@clerk/react`
  replaced by a signed-in stand-in (`clerk-stub.tsx`) and the API address
  pointed at the harness's own small server. Nothing else is changed, and
  none of this is part of the application build.
- It makes no request to production, to Clerk, to Stripe or to a model.
- It does not reproduce a browser extension, the real Clerk script, or a live
  socket. If a page is held in production and not here with the same
  responses, the cause is in one of those.
