---
name: code-review-delivery
description: Ensure Copilot, Codex, Cursor, and other PR review fixes are actually published to the remote PR branch, verified, and merged instead of being lost in a local sandbox.
---

# Code review delivery protocol

Use this whenever an agent reviews or addresses a pull request.

A finding is not complete merely because an agent changed files locally. Before saying a finding is fixed, verify that the fix exists on the pull request's remote head branch.

If an agent cannot publish its changes, it must post `BLOCKED_GITHUB_DELIVERY` in the existing PR with a usable patch, the affected review threads, and the test results. A write-capable agent must then apply that patch to the existing PR branch.

Before merge:
- Read all Copilot and Codex review submissions, including suppressed and outdated comments.
- Fix each actionable finding on the PR head or reject it in-thread with technical reasoning.
- Reply to each fixed thread with the remote commit SHA and verification performed.
- Resolve a review thread only after its fix is present remotely.
- Request a fresh review after the last code-changing fix when reviewer automation is enabled.
- Re-check final CI status.
- Merge the PR to main when repository rules allow, then verify main contains the merge result.

A local commit, pushed branch, or open PR is an intermediate state; remote PR inclusion and eventual main-branch integration are the delivery states that count.
