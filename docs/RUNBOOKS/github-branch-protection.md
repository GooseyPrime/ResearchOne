# GitHub branch protection (enforce PR workflow)

Rule **32** (`.cursor/rules/32-pr-branch-workflow.mdc`) requires scoped work on a PR
branch. In-repo scripts and CI reduce accidents; **branch protection on `main` is the
strongest guarantee** against direct pushes (including cloud agents).

## What this does *not* do

- **Does not delay normal shipping.** Work reaches `main` when you **merge the PR**
  (same as today). Agents should end with **“Merge PR #N to ship to `main`.”**
- **Does not block PR merges.** `main-push-gate` allows tips that look like merged PRs
  (`(#<number>)` or merge commits). Required checks on merge add seconds, not a second
  human gate before agents may start work.
- **Does not replace emergency judgment.** For prod-down / security without prior
  authorization, agents must use the **escalation block** in Rule 32 (merge PR vs
  you reply “push to main” with `[direct-main]`).

## Recommended settings (repository → Settings → Branches → `main`)

1. **Require a pull request before merging**
   - Require approvals: per your team policy (1+ for production). Use **auto-merge**
     or fast review when you want zero idle time after CI green.
2. **Require status checks to pass before merging**
   - Add: `Block unauthorized direct pushes to main` (job `main-push-gate` in `ci-guards.yml`).
   - Add: `No Vitest/Jest mocks in application src` if you want parity with deploy guards.
   - These run on the **PR** and again on the **merge result** push to `main`; both should pass for a normal merge.
3. **Do not allow bypassing the above settings** (or restrict bypass to repo owners only).
4. **Restrict who can push to matching branches** (optional): only CI/deploy bots and
   owners — blocks accidental `git push origin main` from agents and laptops.

After protection is enabled, legitimate integration is: **PR merge only**. Authorized
same-request direct-main (rare) uses `[direct-main]` in the commit message and still
requires someone with bypass rights, or a temporary protection disable.

## Emergency / hotfix (your consideration)

| Path | When | Your action |
|------|------|-------------|
| **A — Merge PR** | Fix is already on a branch with an open PR | Merge (or enable auto-merge). Fastest when CI is green. |
| **B — Direct `main`** | No PR yet, or merge blocked and incident is urgent | Reply in the agent thread: **“push to main”** (same message). Agent uses `[direct-main]` in commit message. |
| **Bypass protection** | You must land without waiting for checks | Owner bypass on GitHub (last resort); document in incident notes. |

Agents must **not** push unauthorized tips to `main` while waiting for your call. They
should surface the escalation block from Rule 32 instead of going silent.

## CI backstop

`scripts/ci/assert-main-push-authorized.sh` fails pushes to `main` when the tip commit:

- is not a merge commit,
- does not reference `(#<pr>)` (GitHub squash/merge convention), and
- does not contain `[direct-main]`.

Pair this check with required status checks so **mistaken** direct pushes do not stick.
**Merged PRs are the intended path** and satisfy the gate.

## Local optional hook

```bash
bash scripts/git/install-pre-commit-hook.sh
```

Blocks `git commit` on `main`/`master` unless `ALLOW_DIRECT_MAIN_PUSH=1`. Skip on
machines where you only ever integrate via GitHub merge UI.
