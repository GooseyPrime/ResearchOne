# PR #105 — Redis `REDIS_URL` validation vs client parity (Codex)

## Finding

Production boot validation required `REDIS_HOST` when the resolved host was
still the internal placeholder `10.0.101.3`, but README and
`backend/.env.production.example` also document `REDIS_URL` as a supported
connection path. Deployments setting only `REDIS_URL` failed validation even
though that is an explicit configuration.

Separately, `backend/src/queue/redis.ts` built ioredis clients only from
`host`/`port` and ignored `config.redis.url`, so a documented `REDIS_URL` would
not have been used even if validation allowed boot.

## Class

**Documented env alternate ↔ validation ↔ runtime must agree.** Any time two
env shapes can configure the same subsystem (URL vs host/port, `DATABASE_URL`
vs discrete DB_* vars), guards and clients must recognize the same set.

## Guardrail

- `.cursor/rules/00-pre-commit-review.mdc` § M item 32
- `AGENTS.md` etiquette bullet (production env validation ↔ runtime)
