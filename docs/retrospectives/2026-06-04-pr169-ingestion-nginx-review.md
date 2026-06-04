# Retrospective — PR #169 ingestion upload / nginx (Codex / Copilot review)

Date: 2026-06-04
Scope: Codex P1 ×2 and Copilot recommendations on PR #169 (`cursor/ingestion-file-cors-17mb`).

## Root cause (production)

Browsers reported CORS on `POST /api/ingestion/file` for multi-MB PDFs. `OPTIONS` was fine; **nginx default `client_max_body_size 1m`** returned **413 without CORS headers**, so the client surfaced a misleading cross-origin error. Express/multer (50 MB) never ran.

## Findings addressed

| Reviewer | Issue | Class |
|---|---|---|
| Codex P1 | `www.localhost` from blind www↔apex alias expansion | **C-ALLOWLIST-EXPANSION** — helper must not widen dev/localhost origins past env validation |
| Codex P1 | `deploy-runtime.sh` warned and continued when nginx sync failed | **C-DEPLOY-INVARIANT** — infra that gates uploads must fail deploy, with post-sync grep verify |
| Copilot | `-x` check but script invoked via `bash` | **C-SHELL-EXEC** — use `-f` for file presence when not executing directly |
| Copilot | `www.` alias on subdomains (e.g. `foo.vercel.app`) | Same as Codex P1 — **apex-only** (two-label host, not localhost/IP) |
| Copilot | All `MulterError` mapped to 413 | **C-HTTP-SEMANTICS** — only `LIMIT_FILE_SIZE` → 413; other codes → 400 |
| Copilot | Duplicate `MAX_FILE_SIZE_MB` in `.env.production.example` | **C-DOC-PARITY** |
| Copilot | Network-error copy assumed nginx still at 1 MB | **C-UX-COPY** — gate on `ERR_NETWORK`; mention proxy limit as conditional |

## Standing rules (logged in `AGENTS.md`)

See **Recurring review themes (Codex / Copilot, PR #169 — ingestion / nginx upload)** in [`AGENTS.md`](../AGENTS.md).

## Tests added / updated

- `corsOrigins.test.ts` — localhost and Vercel subdomain do not get `www.` aliases
- `errorHandler.multer.test.ts` — `LIMIT_FILE_SIZE` vs `LIMIT_FILE_COUNT` status codes
- `ingestUploadError.test.ts` — network path still documents proxy limit (conditional wording)
