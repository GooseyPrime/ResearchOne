# Production Deployment Checklist

Per Work Order P — all items must be verified before public launch.

## 1. SPA Rewrite
- [x] `vercel.json` has `"rewrites": [{ "source": "/(.*)", "destination": "/" }]`
- [x] `frontend/vercel.json` has same rewrite rule
- Both verified in this PR.

## 2. Production Environment Variables
All must be provisioned in secure password manager. **Never commit.**

| Variable | Source | Status |
|---|---|---|
| `JWT_SECRET` | Generated random 32+ char secret | Pending |
| `CORS_ORIGINS` | Production frontend origins (`https://...`) | Pending |
| `DATABASE_URL` | Emma VM Postgres | Pending |
| `DATABASE_ADMIN_URL` | Privileged Postgres (bootstrap `application_role` only — not read by the API; see `docs/RUNBOOKS/application-role-bootstrap.md`) | Pending |
| `REDIS_HOST` | Emma VM Redis hostname | Pending |
| `REDIS_PORT` | Redis port (typically `6379`) | Pending |
| `CLERK_SECRET_KEY` | Clerk Dashboard | Pending |
| `CLERK_WEBHOOK_SECRET` | Clerk Dashboard | Pending |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard | Pending |
| `STRIPE_SECRET_KEY` | Stripe Dashboard | Pending |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard | Pending |
| `STRIPE_PRICE_ID_*` | stripe-bootstrap.ts output | Pending |
| `OPENROUTER_API_KEY` | OpenRouter Dashboard | Pending |
| `TAVILY_API_KEY` | Tavily Dashboard | Pending |
| `BYOK_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Pending |
| `INTELLME_API_KEY` | InTellMe team | Pending |
| `INTELLME_API_SECRET` | InTellMe team | Pending |
| `PARALLEL_API_KEY` | Parallel Web Systems | Pending |
| `PARALLEL_MONITOR_API_KEY` | Parallel Web Systems (or fallback to `PARALLEL_API_KEY`) | Pending |
| `PARALLEL_MONITOR_WEBHOOK_SECRET` | Self-generated | Pending |
| `SCITE_API_KEY` | Scite Dashboard | Pending |
| `OPENALEX_USER_AGENT` | `ResearchOne/1.0 (mailto:ops@researchone.io)` | Pending |
| `CROSSREF_USER_AGENT` | `ResearchOne/1.0 (mailto:ops@researchone.io)` | Pending |
| `VITE_API_BASE_URL` | Public Emma API origin (`https://api...`) | Pending |
| `VITE_SOCKET_URL` | Public Emma API origin (`https://api...`) | Pending |
| `VITE_EXPORTS_BASE_URL` | Public Emma API origin (`https://api...`) | Pending |

`REDIS_URL` may appear in `.env` templates for documentation; **runtime BullMQ/ioredis uses `REDIS_HOST` + `REDIS_PORT`** (`backend/src/queue/redis.ts`). Set host/port in production.

**Postgres RLS:** `/api/health` stays **503** when `application_role` is missing. If migration `021_rls_setup.sql` no-oped (no `CREATEROLE`), set **`DATABASE_ADMIN_URL`** and run **`npm run bootstrap:application-role`** (also run automatically from `scripts/deploy-runtime.sh`). See **`docs/RUNBOOKS/application-role-bootstrap.md`**.

Optional (feature-flag / deployment-specific):

- `HF_TOKEN` — only needed when using HF-routed model IDs.
- `TOGETHER_API_KEY` — only needed when enabling Together fallback for HF-routed IDs.
- `FEATURED_REPORT_GITHUB_TOKEN` — only needed when publishing featured reports to GitHub.
- `NOMIC_API_KEY` — only needed when enabling Nomic Atlas upload integration.
- `SEARCH_PROVIDER_API_KEY` — required only for `SEARCH_PROVIDER=brave` or `SEARCH_PROVIDER=cascade`.
- `SEARCH_PROVIDER_BASE_URL` — required only for `SEARCH_PROVIDER=generic` or `SEARCH_PROVIDER=cascade`.
- `OPENROUTER_DATA_COLLECTION` — optional OpenRouter routing preference (`allow`/`deny`).

## 3. Database Backups
- [ ] pg_basebackup configured on Emma Postgres VM
- [ ] WAL archiving enabled
- [ ] Restore tested
- [ ] RPO/RTO documented: target RPO < 1 hour, RTO < 4 hours

## 4. Redis Persistence
- [ ] AOF enabled (`appendonly yes`)
- [ ] RDB snapshots configured (`save 900 1; save 300 10; save 60 10000`)

## 5. TLS Configuration
- [ ] Nginx serves valid TLS certs (Let's Encrypt auto-renew)
- [ ] HSTS header set (added in vercel.json)
- [ ] TLS 1.2 minimum enforced
- [ ] TLS Labs A+ rating on api.researchone.io

### Emma API TLS topology

The repository **owns** `/etc/nginx/sites-available/researchone` — every deploy via
`scripts/sync-nginx-api-site.sh` overwrites it with `scripts/nginx/researchone-api-site.conf`.
The repo nginx template therefore **must** contain the full TLS server block; Certbot is
responsible only for the certificate material on disk.

| Item | Value |
|---|---|
| Primary API domain | `api.researchone.io` |
| Legacy API domain | `research-api.intellmeai.com` |
| Both domains resolve to | `45.55.250.106` (Emma VM) |
| Backend (Node) | `127.0.0.1:3001` |
| Certbot certificate name | `research-api.intellmeai.com` |
| Certificate covers | `api.researchone.io`, `research-api.intellmeai.com` |
| fullchain | `/etc/letsencrypt/live/research-api.intellmeai.com/fullchain.pem` |
| privkey | `/etc/letsencrypt/live/research-api.intellmeai.com/privkey.pem` |
| HTTPS health endpoint | `https://api.researchone.io/api/health` → HTTP 200 |
| Legacy health endpoint | `https://research-api.intellmeai.com/api/health` → HTTP 200 |

`scripts/sync-nginx-api-site.sh` validates all four Let's Encrypt files exist before
installing the config; it fails with a clear error rather than silently deploying
HTTP-only service if the certificate is missing.

Certificate renewal (`certbot renew`) runs independently (cron/systemd timer).  The
application deploy process does not issue or renew certificates; it only installs the
repository nginx template that references the already-issued certificate.

## 6. Rate Limiting
- [x] 500 req/15min default on `/api/*`
- [x] 10 req/min on `/api/auth` and `/api/webhooks`
- [x] Health endpoint (`/api/health`) not rate-limited (excluded by mount order)

## 7. CORS
- [ ] `CORS_ORIGINS=https://researchone.io,https://www.researchone.io`
- [ ] No wildcards
- Production config validation enforces non-localhost origins
- Backend also auto-adds www ↔ apex aliases when only one hostname is listed

## 7b. Nginx upload body limit (Emma API)
- [ ] `scripts/sync-nginx-api-site.sh` ran on deploy (or `client_max_body_size 64m` in `/etc/nginx/sites-available/researchone`)
- [ ] Must be ≥ `MAX_FILE_SIZE_MB` (default 50). Nginx default **1m** causes **413** on PDF uploads; browsers then show a misleading **CORS** error because nginx’s 413 page has no `Access-Control-Allow-Origin`

## 8. CSP Headers
- [x] Clerk (`js.clerk.io`, `img.clerk.com`) allowed in script-src, img-src
- [x] Stripe (`js.stripe.com`, `hooks.stripe.com`) allowed in script-src, frame-src
- [x] connect-src allows `https:` and `wss:` (covers all API subprocessors)
- [x] HSTS header added to vercel.json

## 9. Stripe Webhook URL
- [ ] Stripe dashboard → webhook endpoint: `https://api.researchone.io/api/webhooks/stripe`
- [ ] Secret matches `STRIPE_WEBHOOK_SECRET` env var

## 10. DNS
- [ ] `researchone.io` → Vercel
- [ ] `www.researchone.io` → Vercel
- [ ] `api.researchone.io` → Emma runtime VM
- [ ] Parallel monitor webhook routes to Emma runtime VM

## 11. Monitoring
- [ ] Uptime monitoring on `/api/health/ready`
- [ ] Runtime/API alerting configured for error spikes (provider/tooling per ops stack)

## 12. Smoke Tests
- [ ] Sign up via production URL
- [ ] Top up wallet via Stripe Checkout
- [ ] Run Standard report
- [ ] Verify report generates successfully
- [ ] Verify wallet decrement after completion
- [ ] Verify Pipeline B job enqueues (check ingestion audit log)

## Launch Blockers
- [x] Lawyer review of Terms, Privacy, Acceptable Use pages ($2.5-5K budget)
- [x] Remove `LegalDraftBanner` after lawyer sign-off
- [ ] Lighthouse: Performance >= 80, Accessibility >= 95
