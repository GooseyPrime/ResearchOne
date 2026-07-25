# ResearchOne redesign — agent rule applicability

**Authoritative specification:** `ResearchOne_All_Purpose_Deep_Research_Redesign_Report.md` (repo root)
**Regression example:** `onlinbusinessreport.md` (repo root)  
**Created:** July 2026  
**Purpose:** Map each agent rule to its status and applicability across redesign stages so coding agents are not blocked by contradictory instructions.

---

## Stage definitions

| Stage | Description |
|---|---|
| **A** | Correctness patch — remove universal falsification from planner/verifier; make report sections intent-driven; add regression fixture |
| **B** | ResearchBrief — primary/secondary intents, requested artifacts, deliverable contract auditor, intent-specific verification |
| **C** | EZ Research intake — simplified intake UI, clarification chat, plain-language plan preview, Research Lab preservation |
| **D** | Specialist agents — capability registry, adaptive orchestration, market scout, story verifier, feasibility architect |
| **E** | Evaluation and optimization — golden-prompt corpus, A/B testing, quality/cost/latency tuning |

---

## Rule applicability table

| Rule / file | Status | Redesign stages | Reason | Required amendment |
|---|---|---|---|---|
| `.cursor/rules/00-pre-commit-review.mdc` | **AMEND** | All | Branch-workflow section amended to reflect ordered integration strategy. Test and async rules unchanged. | Section A.0 must reference `prepare-work-branch.sh --reuse` and GH013 escalation path. |
| `.cursor/rules/10-state-machine-and-multi-writer.mdc` | **KEEP** | A–D | Agent selection, plan state, and report generation all involve multiple writers. Single-writer discipline is directly applicable. | None |
| `.cursor/rules/11-error-paths-and-logging.mdc` | **KEEP** | A–E | Error paths in the planner, synthesizer, and verifier must preserve diagnostic logs when intent routing changes. | None |
| `.cursor/rules/12-event-window-math.mdc` | **CONDITIONAL** | C | Primarily relevant if trace/event UI changes in the EZ Research run-progress view. | None now; re-read when implementing run-progress stream. |
| `.cursor/rules/13-deploy-skew-and-schema.mdc` | **KEEP** | B–D | Stage B adds new `ResearchBrief` columns; Stage D adds agent registry tables. Deploy-skew handling is critical. | None |
| `.cursor/rules/14-third-party-api-contracts.mdc` | **KEEP** | D | Stage D introduces specialist tool connectors (web search APIs, domain-specific data sources). Read contracts before wiring. | None |
| `.cursor/rules/15-doc-pr-and-code-parity.mdc` | **KEEP** | All | PR body / docs parity applies to every stage. Marketing copy must match implemented behavior. | None |
| `.cursor/rules/16-tests-must-fail-without-the-fix.mdc` | **KEEP** | All | The regression fixture (Stage A) must fail without the fix. All redesign tests must be meaningful. | None |
| `.cursor/rules/17-ripple-and-grep-callers.mdc` | **KEEP** | A–D | Planner, synthesizer, and report-generator primitives have many callers. Any change to their interfaces requires grepping all callers. | None |
| `.cursor/rules/20-research-policy-guardrails.mdc` | **AMEND** | A–D | Clarified: informational/descriptive intent does not require hypothesis or falsification. Non-sanitization and contradiction preservation remain binding. Editable scope clarified. | **Done** — intent table and editable-scope clarification added to rule. |
| `.cursor/rules/21-billing-and-webhook-contracts.mdc` | **CONDITIONAL** | Stages that touch tier/billing/add-on behavior | Add-on eligibility may change when specialist agents are priced (Stage D). | None now; re-read when Stage D agent pricing is designed. |
| `.cursor/rules/22-out-of-scope-discovery.mdc` | **KEEP** | All | Redesign stages will uncover adjacent issues. Out-of-scope discoveries must be filed, not silently fixed or dismissed. | None |
| `.cursor/rules/23-early-return-resource-cleanup.mdc` | **CONDITIONAL** | C–D | Stage C attachment handling and Stage D crawl/file specialization involve staged resources. | Re-read when implementing Stage C file/URL intake. |
| `.cursor/rules/24-canonical-path-after-mutation.mdc` | **CONDITIONAL** | C–D | Stage C attachment paths; Stage D crawl artifacts. | Re-read when implementing Stage C/D file handling. |
| `.cursor/rules/25-cost-sidecar-and-unit-economics.mdc` | **KEEP** | A–E | Model and agent cost telemetry applies to every stage. Specialist agents (Stage D) must emit cost events. | None |
| `.cursor/rules/25-pm2-and-bootstrap-secrets.mdc` | **CONDITIONAL** | Deployment scripts only | No redesign change touches Emma deploy scripts. | None unless Stage D adds new services. |
| `.cursor/rules/26-landing-persona-and-visual.mdc` | **KEEP** | C and marketing work | Persona detection invariants unchanged. Marketing copy updates (Stage C) must respect Tier A rules and persona content architecture. | None to the rule; landing copy must align with new all-purpose positioning. |
| `.cursor/rules/27-animated-pipeline-hero.mdc` | **AMEND** | C–D | Hero must evolve from fixed 10-stage diagram to adaptive agent visualization (conditional specialist nodes, optional skeptic branch, bypassed stages shown). | **Done** — I-3 updated to define stable core + conditional specialist nodes; I-4 updated to make Skeptic per-intent. |
| `.cursor/rules/28-academic-formatting-engine.mdc` | **KEEP** | A–B | Stage A/B intent templates govern report shape; academic export format rules remain. | None |
| `.cursor/rules/29-marketing-scope-doc-contracts.mdc` | **CONDITIONAL** | C and marketing routes | Stage C ships new routes; scope-doc contracts apply to those PRs. | None now; apply when marketing route PRs are written. |
| `.cursor/rules/30-vercel-prerender-spa-routing.mdc` | **CONDITIONAL** | C | EZ Research adds a new route. Prerender/SPA routing must be updated to include it. | None now; re-read when `ResearchEasyPage` route is registered. |
| `.cursor/rules/31-evidence-vs-source-vocabulary.mdc` | **KEEP** | C and public copy | Marketing copy for EZ Research must use the approved evidence/sources vocabulary. | None |
| `.cursor/rules/32-dossier-canonical-read-path.mdc` | **KEEP** | B–D | New ResearchBrief and agent metadata will reach dossiers. Dossier reads must use `v_dossier` / `dossierReadService`. | None |
| `.cursor/rules/32-pr-branch-workflow.mdc` | **AMEND** | All | Added ordered integration strategy (preferred reuse → normal create → GH013 escalation → explicit direct-main). No-deadlock requirement documented. | **Done** — rule rewritten to include all four paths and GH013 block format. |
| `.cursor/rules/33-plan-confirmation-gate.mdc` | **AMEND** | A–C | Expanded to anticipate `ResearchBrief` fields, deliverable contract confirmation, natural-language plan refinement, and backward compatibility. | **Done** — ResearchBrief extension section added with interface definition and binding-downstream rule. |
| `.cursor/rules/34-run-url-sync-and-live-polling.mdc` | **KEEP** | C | Stage C EZ Research run state must follow `?runId=` attach/detach discipline. | None |
| `.cursor/rules/35-revision-spinoff-dossier-timeline.mdc` | **KEEP** | B–D | ResearchBrief lineage must be preserved in revision and spinoff flows. | None |
| `.cursor/rules/36-two-audience-copy.mdc` | **KEEP** | C and marketing | Stage C EZ Research UI copy is Tier A. Banned jargon CI check must pass for all new EZ Research labels. | None to the rule; see marketing positioning notes below. |
| `.cursor/rules/37-intent-driven-report-contracts.mdc` | **NEW** | A–D | Core correctness rule for the redesign. Captures the cascade problem (four pipeline layers re-impose adjudicative structure) and the rules for making intent the controlling contract. | Created in this PR. |
| `.cursor/rules/38-ez-research-and-lab-mode.mdc` | **NEW** | C | Governs the EZ Research / Research Lab UX split, intake flow, plan preview, and Research Lab preservation invariants. | Created in this PR. |
| `AGENTS.md` | **AMEND** | All | Branch workflow opening updated to reflect ordered integration strategy. Rule index updated. | **Done** |
| `scripts/git/prepare-work-branch.sh` | **AMEND** | All | Added `--reuse` mode for pre-assigned branches, dirty-worktree guard, GH013 detection and structured block output. | **Done** |
| `scripts/git/assert-not-on-main-branch.sh` | **AMEND** | All | Improved error message to list both supported paths (PR branch / pre-created branch reuse, or direct-main authorization). | **Done** |
| `scripts/ci/assert-main-push-authorized.sh` | **KEEP** | All | No change required. Already allows merge commits, PR references, and `[direct-main]`. | None |

---

## Words removed from rules (deleted / rewritten)

The following phrases have been removed or rewritten because they conflict with the approved redesign:

| Removed phrase | Location | Reason |
|---|---|---|
| "Every research objective passes through a ten-stage adversarial pipeline" | Rule 27, hero rationale | Replaced with adaptive agent team framing. The hero visualization will reflect actual orchestration in Stage C+. |
| Requirement that hypothesis/falsification appear in every report | Rule 20 (implicit) | Made conditional on intent family (adjudicative/causal_test only). |
| Single mandatory first action "run prepare-work-branch.sh" | Rule 32, AGENTS.md | Replaced with ordered four-path integration strategy; reuse of pre-assigned branch is now Path 1. |

---

## Marketing positioning update (aligned with redesign report §9)

Current landing page framing ("tests its own conclusions", "ten-stage adversarial pipeline", "Research that defends itself") should evolve toward:

> **ResearchOne turns any serious question into a research plan, assembles the right specialist agents, and delivers a citation-backed work product that matches what you actually asked for.**

Supporting line:
> Explain it. Compare it. Investigate it. Verify it. Build from it.

Adversarial review and contradiction preservation remain differentiators — they are presented as premium rigor, not as the definition of all research.

This copy change is a **Tier A edit** governed by Rule 36. Run `assert-tier-a-no-banned-jargon.sh` before shipping.

---

## GitHub ruleset status

The prior Stage A agent attempt failed with:

> GH013: Cannot create ref due to creations being restricted

This is a **server-side repository ruleset rejection** — editing agent rules cannot resolve it. The required server-side action is one of:

**Preferred:**
- Keep main protected and require PRs.
- Allow creation of non-default branches matching prefixes: `copilot/**`, `cursor/**`, `feat/**`, `fix/**`, `redesign/**`.

**Alternative:**
- Add the GitHub Copilot coding agent / GitHub App as a bypass actor for branch creation only (not for required PR review or main protection).

**Operational fallback:**
- A maintainer pre-creates the stage branch from current main and assigns Copilot to that branch. The agent then uses `bash scripts/git/prepare-work-branch.sh <topic> --reuse`.

Do not recommend disabling all repository rules or removing main protection.

---

## Unresolved server-side action

The following requires admin action outside this rules PR:

- Verify which branch-creation ruleset is active (`Settings → Rules → Rulesets`).
- Add `copilot/**` and `cursor/**` as allowed ref prefixes for agent-created branches.
- Alternatively, add the Copilot GitHub App as a bypass actor for ref creation.

Until that change is made, agents must be pre-assigned a branch or must use direct-main authorization for governance tasks.
