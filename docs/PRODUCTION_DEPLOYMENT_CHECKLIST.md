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
| `CLERK_SECRET_KEY` | Clerk Dashboard | Pending |
| `CLERK_WEBHOOK_SECRET` | Clerk Dashboard | Pending |
| `STRIPE_SECRET_KEY` | Stripe Dashboard | Pending |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard | Pending |
| `STRIPE_PRICE_ID_*` | stripe-bootstrap.ts output | Pending |
| `OPENROUTER_API_KEY` | OpenRouter Dashboard | Pending |
| `BYOK_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Pending |
| `INTELLME_API_KEY` | InTellMe team | Pending |
| `INTELLME_API_SECRET` | InTellMe team | Pending |
| `PARALLEL_API_KEY` | Parallel Web Systems | Pending |
| `PARALLEL_MONITOR_WEBHOOK_SECRET` | Self-generated | Pending |
| `SCITE_API_KEY` | Scite Dashboard | Pending |
| `OPENALEX_USER_AGENT` | `ResearchOne/1.0 (mailto:admin@researchone.io)` | Pending |
| `CROSSREF_USER_AGENT` | `ResearchOne/1.0 (mailto:admin@researchone.io)` | Pending |
| `RESEARCHONE_LEDGER_SIGNING_KEY` | Self-generated (32 bytes) | Pending |
| `SENTRY_DSN` | Sentry project | Pending |
| `DATABASE_URL` | Emma VM Postgres | Pending |
| `REDIS_URL` | Emma VM Redis | Pending |
| `CORS_ORIGINS` | `https://researchone.io,https://www.researchone.io` | Pending |
| `VITE_API_BASE_URL` | `https://api.researchone.io` | Pending |
| `VITE_SOCKET_URL` | `https://api.researchone.io` | Pending |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard | Pending |
| `ADMIN_RUNTIME_TOKEN` | Self-generated | Pending |
| `ADMIN_USER_IDS` | Clerk user IDs for admin users | Pending |

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

## 6. Rate Limiting
- [x] 500 req/15min default on `/api/*` (skips `/api/auth` to avoid double-limit)
- [x] 10 req/min on `/api/auth` (stricter for login attempts)
- [x] Webhooks NOT rate-limited (Stripe/Clerk retries need headroom)
- [x] `trust proxy` set to 1 for correct client IP behind Nginx/Vercel
- Note: `/api/health` is rate-limited by the default limiter (500/15min is sufficient for monitoring)

## 7. CORS
- [ ] `CORS_ORIGINS=https://researchone.io,https://www.researchone.io`
- [ ] No wildcards
- Production config validation enforces non-localhost origins

## 8. CSP Headers
- [x] Clerk (`js.clerk.io`, `img.clerk.com`, `challenges.cloudflare.com`) in script-src, img-src, frame-src
- [x] Stripe (`js.stripe.com`, `hooks.stripe.com`) in script-src, frame-src
- [x] `worker-src 'self' blob:` for Clerk service worker
- [x] connect-src allows `https:` and `wss:` (covers all API subprocessors)
- [x] HSTS header (without `includeSubDomains`/`preload` until all subdomains verified HTTPS)

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
- [ ] Sentry alerts on error rate spikes
- [ ] Sentry DSN provisioned and wired

## 12. Smoke Tests
- [ ] Sign up via production URL
- [ ] Top up wallet via Stripe Checkout
- [ ] Run Standard report
- [ ] Verify report generates successfully
- [ ] Verify wallet decrement after completion
- [ ] Verify Pipeline B job enqueues (check ingestion audit log)

## Launch Blockers
- [ ] Lawyer review of Terms, Privacy, Acceptable Use pages ($2.5-5K budget)
- [ ] Remove `LegalDraftBanner` after lawyer sign-off
- [ ] Lighthouse: Performance >= 80, Accessibility >= 95
