# Migration 030 — `ALTER COLUMN … USING` subquery limitation

## Failure

`030_harden_wallet_holds_run_id_uuid.sql` used `EXISTS (SELECT … FROM research_runs …)`
inside `ALTER COLUMN run_id TYPE UUID USING (CASE …)`. Postgres raises **`0A000` /
cannot use subquery in transform expression** (`transformSubLink`).

## Fix

Pre-clear invalid/orphan `TEXT` values with **`UPDATE wallet_holds … WHERE … EXISTS`**,
then use a **`USING` clause** that only references the row’s `run_id` (trim, regex, `::uuid`).

## Class

DDL **`USING` transform expressions** are not arbitrary SQL; cross-row logic belongs in
`UPDATE`/`INSERT` steps before the cast.

## Guardrail

`.cursor/rules/13-deploy-skew-and-schema.mdc` — migration idempotency § item 3 (`ALTER … USING`).
