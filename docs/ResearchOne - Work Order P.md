**Work Order P --- Production deployment hardening**

**Goal. Deploy to production with hardened configuration. Verify all
launch-blocker items.**

**Pre-work: All previous work orders' acceptance criteria, README's Mode
B topology, ResearchOne_Update_041626.pdf Phase 1 (SPA refresh fix).**

**Tasks:**

1.  **Verify both vercel.json files have SPA rewrite. Per 041626 doc,
    fix added but only one file confirmed. Check root `vercel.json`
    AND `frontend/vercel.json`. Both must contain:**

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/" }
  ]
}
```

2.  **Production environment variables. Provision all .env values: real
    Clerk keys, Stripe keys, OpenRouter key, BYOK encryption key,
    InTellMe ingestion token, SheerID program ID, PARALLEL\_API\_KEY,
    PARALLEL\_MONITOR\_WEBHOOK\_SECRET, SCITE\_API\_KEY,
    OPENALEX\_USER\_AGENT, CROSSREF\_USER\_AGENT,
    RESEARCHONE\_LEDGER\_SIGNING\_KEY (32-byte for Provenance Ledger).
    Document in secure password manager --- never commit.**

3.  **Database backups. Configure pg_basebackup + WAL archiving on Emma
    Postgres VM. Test restore. Document RPO/RTO.**

4.  **Redis persistence. Enable AOF + RDB snapshots.**

5.  **TLS configuration. Verify Nginx serves valid TLS certs (Let's
    Encrypt auto-renew). HSTS header. TLS 1.2 minimum.**

6.  **Rate limiting. Verify express-rate-limit per-endpoint (100 req/min
    most, 10 req/min auth, none on health).**

7.  **CORS. Restrict to https://researchone.io and
    https://www.researchone.io only. No wildcards.**

8.  **CSP headers. Set Content-Security-Policy via Helmet, allowing
    Clerk, Stripe, InTellMe, api.parallel.ai, api.scite.ai origins
    explicitly.**

9.  **Stripe webhook URL. Confirm Stripe dashboard webhook points to
    https://api.researchone.io/api/webhooks/stripe and secret matches
    STRIPE_WEBHOOK_SECRET.**

10. **DNS. researchone.io, www.researchone.io → Vercel;
    api.researchone.io → Emma runtime VM. Confirm
    api.researchone.io/api/webhooks/parallel-monitor routes to Emma
    runtime VM.**

11. **Monitoring. Configure uptime monitoring on /api/health/ready.
    Sentry alerts on error rate spikes.**

12. **Smoke tests. End-to-end from production URL: sign up, top up
    wallet, run Standard report, verify report generates, verify wallet
    decrement, verify Pipeline B job enqueues.**

**Acceptance criteria: - All 12 tasks completed and verified -
Production smoke test passes - Lighthouse from production: Performance
≥80, Accessibility ≥95 - TLS Labs A+ rating on api.researchone.io**
