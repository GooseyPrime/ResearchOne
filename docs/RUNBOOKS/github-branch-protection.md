# GitHub branch protection (enforce PR workflow)

Rule **32** (`.cursor/rules/32-pr-branch-workflow.mdc`) requires scoped work on a PR
branch. In-repo scripts and CI reduce accidents; **branch protection on `main` is the
strongest guarantee** against direct pushes (including cloud agents).

## Recommended settings (repository → Settings → Branches → `main`)

1. **Require a pull request before merging**
   - Require approvals: per your team policy (1+ for production).
2. **Require status checks to pass before merging**
   - Add: `Block unauthorized direct pushes to main` (job `main-push-gate` in `ci-guards.yml`).
   - Add: `No Vitest/Jest mocks in application src` if you want parity with deploy guards.
3. **Do not allow bypassing the above settings** (or restrict bypass to repo owners only).
4. **Restrict who can push to matching branches** (optional): only CI/deploy bots and
   owners — blocks accidental `git push origin main` from agents and laptops.

After protection is enabled, legitimate integration is: **PR merge only**. Authorized
same-request direct-main (rare) uses `[direct-main]` in the commit message and still
requires someone with bypass rights, or a temporary protection disable.

## CI backstop

`scripts/ci/assert-main-push-authorized.sh` fails pushes to `main` when the tip commit:

- is not a merge commit,
- does not reference `(#<pr>)` (GitHub squash/merge convention), and
- does not contain `[direct-main]`.

Pair this check with required status checks so unauthorized tips never merge.

## Local optional hook

```bash
bash scripts/git/install-pre-commit-hook.sh
```

Blocks `git commit` on `main`/`master` unless `ALLOW_DIRECT_MAIN_PUSH=1`.
