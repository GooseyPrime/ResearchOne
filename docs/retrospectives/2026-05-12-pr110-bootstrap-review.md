# 2026-05-12 — PR #110 follow-up (Codex / Copilot)

## Findings

1. **Deploy shell exported `DATABASE_ADMIN_URL`** after decoding `DATABASE_ADMIN_URL_B64`, so the privileged URL remained in the environment for `pm2 startOrReload … --update-env`, risking propagation into the API process (Codex P1, Copilot).
2. **`ALTER DEFAULT PRIVILEGES` without `FOR ROLE`** when bootstrap runs as admin: new tables/sequences created by the migration/runtime login would not inherit grants to `application_role` (Copilot).
3. **Bootstrap CLI used ad-hoc `dotenv`** on `backend/.env` instead of `loadEnv()`, diverging from `ENV_FILE` and production semantics (Copilot).

## Resolution

- `scripts/deploy-runtime.sh`: decode into `_RO_DATABASE_ADMIN_URL_FROM_B64`, pass only via subshell to `npm run bootstrap:application-role`, `unset` before PM2.
- `applicationRoleBootstrap.ts`: `ALTER DEFAULT PRIVILEGES FOR ROLE <runtimeLogin>` for tables and sequences; exported format helpers + tests.
- `bootstrap-application-role.cli.ts`: `decodeInjectedAdminUrl` then `loadEnv()`.
- New rule: `.cursor/rules/25-pm2-and-bootstrap-secrets.mdc`; `AGENTS.md` + `00-pre-commit-review.mdc` § N.
