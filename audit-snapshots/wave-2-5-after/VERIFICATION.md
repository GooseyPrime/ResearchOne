# Wave 2.5 — verification artifacts (2026-05-14)

## Production `vite preview` build (agent / CI)

Same placeholder env as Wave 2 (`audit-snapshots/wave-2-after/VERIFICATION.md`):

```bash
cd frontend
VITE_CLERK_PUBLISHABLE_KEY=pk_test_audit0000000000000000000000000000 \
VITE_API_BASE_URL=https://api.placeholder.invalid \
VITE_SOCKET_URL=wss://api.placeholder.invalid \
npm run build
npx vite preview --host 127.0.0.1 --port 4173
```

## Lighthouse + axe (numeric)

Scores, axe impact counts, and `jq` snippets are in **`LIGHTHOUSE_AXE_SUMMARY.md`**. Raw JSON: `lighthouse-*.json`, `axe-*.json` in this directory.
