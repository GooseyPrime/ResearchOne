# Governance — marketing and landing rules

This document records **where** the binding Cursor rules for the marketing shell live and **when** an explicit founder override has temporarily superseded them for a scoped pull request.

## Rule sources (do not duplicate full rule text here)

| Topic | Location |
| --- | --- |
| Landing persona, default copy parity, lab notebook visual | `.cursor/rules/26-landing-persona-and-visual.mdc` |
| Animated / schematic pipeline hero (reduced motion, canonical stages, performance) | `.cursor/rules/27-animated-pipeline-hero.mdc` |
| Master pre-commit checklist | `.cursor/rules/00-pre-commit-review.mdc` |

The authoritative rule **text** remains in the `.cursor/rules/*.mdc` files above. This file only adds **override history** so reviewers can see that a given PR operated under an explicit, time-bounded exception.

## Override history

### 2026-05-12 — Wave 2 marquee visual rebuild

- **PR:** Assign the GitHub pull-request number after the Wave 2 branch is opened from `cursor/wave-2-marquee-visuals-05122026-c538` (see `docs/ResearchOne Site Audit 05122026.md`, section **Wave 2 — Authorized overrides recording**).
- **Founder:** Michael Brandon Lane, InTellMe AI (authorization recorded in project chat, 2026-05-12).
- **Rules overridden (scope limited to the enumerated items in that authorization only):** **Rule 26 I-3** and **Rule 27** (see the audit doc for the exact enumerated list: hero copy, `PipelineSchematic`, `LivingReportTimeline`, strict `FeatureCard`, related homepage assembly, and specified marketing routes).
- **Rule text:** Not amended. Overrides are **episodic** and **enumerated**; all other surfaces remain governed by the original `.mdc` files.
