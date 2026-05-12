# Cursor Brief — WO-X Academic Formatting Engine (Pandoc + CSL)

**Read this first.** WO-X is the heaviest of the four WOs and has the
load-bearing cross-WO contract with WO-U. **Land WO-U first.** WO-X's
new `citation_formatter` role only makes sense once the WO-U cost
telemetry infrastructure is in place to track its spend.

---

## Goal in one sentence

Add a `POST /api/reports/:id/export?format=...&style=...` endpoint
that runs Pandoc + xelatex as a sandboxed subprocess to produce
publication-grade DOCX / PDF / Markdown / HTML output styled per MLA,
APA, Chicago, IEEE, or Harvard — with stable Lossless Evidence Aliases,
strict shell-injection defenses, and the cross-WO contract that the
new `citation_formatter` role and its `Citation Mapping` phase mapping
land in the same commit.

---

## Reading order

1. `.cursor/rules/00-pre-commit-review.mdc` — master checklist (existing).
2. `.cursor/rules/13-deploy-skew-and-schema.mdc` — extended to system
   binaries by this WO (existing).
3. `.cursor/rules/25-cost-sidecar-and-unit-economics.mdc` — WO-U's rule.
   **I-9 is the load-bearing cross-WO contract.** (existing if WO-U
   is merged.)
4. `.cursor/rules/28-academic-formatting-engine.mdc` — this WO's
   invariants. **NEW.**
5. `docs/ResearchOne - Work Order X.md` — the formal WO. **NEW.**
6. Existing files to read end-to-end:
   - `backend/src/services/reasoning/reasoningModelPolicy.ts` (lines
     1–50 — the `REASONING_MODEL_ROLES` shape we're appending to)
   - `backend/src/services/telemetry/costSidecar.ts` (lines 80–130 —
     the `rolePhaseFor` switch we're adding the case to)
   - `backend/src/db/migrations/001_initial_schema.sql` (lines 59–80,
     320–337 — `sources` and `report_citations` tables)
   - `backend/src/api/routes/reports.ts` (lines 410–540 — endpoint
     patterns)

---

## Write order (apply EXACTLY in this order)

### Phase A — Cursor rule + WO doc + system-binary install

1. `.cursor/rules/28-academic-formatting-engine.mdc` → `.cursor/rules/`.
2. `docs/ResearchOne - Work Order X.md` → `docs/`.
3. **Operational PR** (separate from this Cursor work): add
   `pandoc` and `texlive-xetex` to the production Docker image.
   Per Rule 28 I-6, the code tolerates a server WITHOUT these binaries
   (returns `{available: false}`), so this can ship in parallel with
   the code or even later — the user-facing behavior degrades gracefully.

### Phase B — Migration + services (no behavior yet)

4. `backend/src/db/migrations/032_formatting_engine.sql` → migrate.
5. `backend/src/services/formatting/cslConverter.ts` — copy as-is.
6. `backend/src/services/formatting/evidenceAliaser.ts` — copy as-is.
7. `backend/src/services/formatting/pandocRunner.ts` — copy as-is.
8. `backend/src/services/formatting/exportOrchestrator.ts` — copy as-is.
9. `backend/src/services/formatting/exportStorage.ts` — copy from
   PATCH-X04 Step 3.
10. Vendor CSL stylesheets — download from
    `https://github.com/citation-style-language/styles` (CC BY-SA):
    - `mla.csl` → `templates/citation-styles/mla.csl`
    - `apa.csl` → `templates/citation-styles/apa.csl`
    - `chicago-author-date.csl` → `templates/citation-styles/chicago-author-date.csl`
    - `chicago-note-bibliography.csl` → rename to `chicago-note.csl`
    - `ieee.csl` → `templates/citation-styles/ieee.csl`
    - `harvard-cite-them-right.csl` → rename to `harvard.csl`
    Commit them to the repo. They are 5–50KB each.
11. Generate reference DOCX templates:
    ```bash
    pandoc --print-default-data-file=reference.docx > /tmp/ref.docx
    # Open in Word, set fonts/margins/spacing per MLA / APA / Chicago.
    # Save as templates/<style>-reference.docx.
    ```
    Commit the three .docx files. Document the steps in
    `templates/README.md`.
12. `backend/src/__tests__/formattingEngine.test.ts` — copy and run
    `npx vitest run formatting`. All assertions pass with services in
    place.

### Phase C — The cross-WO contract (CRITICAL — single commit)

13. PATCH-X01 — `reasoningModelPolicy.ts` adds `'citation_formatter'`
    to `REASONING_MODEL_ROLES` and to `ROLE_MODEL_DEFAULTS`.
14. PATCH-X02 — `costSidecar.ts` adds `case 'citation_formatter':
    return 'Citation Mapping';` to `rolePhaseFor`.
15. Add to existing `__tests__/costSidecar.test.ts` (file shipped with
    WO-U):
    ```ts
    it('citation_formatter maps to Citation Mapping (WO-X cross-WO)', () => {
      expect(rolePhaseFor('citation_formatter')).toBe('Citation Mapping');
    });
    ```

**CRITICAL: Steps 13, 14, and 15 must be a single commit.** The
pre-commit grep:

```bash
git diff --name-only | grep -E "reasoningModelPolicy\.ts|costSidecar\.ts"
```

must show both files in any diff that touches either. If it shows
only one, the commit violates Rule 25 I-9 and Rule 28 I-1.

### Phase D — API surface + worker

16. PATCH-X03 — `backend/src/api/routes/reports.ts` adds the export
    endpoint and the polling endpoint.
17. PATCH-X04 — `backend/src/queue/workers/reportExportWorker.ts`
    (new file), `backend/src/queue/queues.ts` registers the queue,
    `backend/src/queue/index.ts` imports the worker.

### Phase E — Frontend

18. `frontend/src/components/reports/ReportExportButton.tsx` — copy
    as-is.
19. Wire `<ReportExportButton reportId={report.id} />` into the
    existing report-view component (filename varies — read the
    report-view page end-to-end and place next to existing actions).

---

## Pre-commit grep checks (Rule 28 invariants)

```bash
# I-1 — cross-WO contract enforcement (CRITICAL)
git diff --name-only | grep -E "reasoningModelPolicy\.ts|costSidecar\.ts"
# Must show BOTH files if either is in the diff.

# I-2 — only pandocRunner.ts calls subprocess in this dir
grep -rn "exec\|spawn" backend/src/services/formatting/ | \
  grep -v __tests__ | grep -v "pandocRunner.ts"
# Expected: empty

# I-3 — xelatex flag is hardcoded
grep -n "no-shell-escape" backend/src/services/formatting/pandocRunner.ts
# Expected: at least one hit

# I-4 — every invocation has a timeout
grep -n "timeoutMs\|setTimeout.*SIGKILL\|TIMEOUT" \
  backend/src/services/formatting/pandocRunner.ts
# Expected: multiple hits

# Vendored CSL files exist
ls backend/src/services/formatting/templates/citation-styles/
# Expected: mla.csl apa.csl chicago-author-date.csl chicago-note.csl ieee.csl harvard.csl
```

---

## Acceptance sanity check

After all phases land + production has pandoc + texlive-xetex installed:

1. Visit a completed report. Click Export.
2. Select APA + DOCX, click Export. Async job runs ~5–10 seconds.
   A .docx downloads.
3. Open the .docx in Word/LibreOffice. Verify:
   - Title is a heading.
   - Body text has APA in-text citations: `(Lane, 2026)`, `(Smith & Doe, 2025)`.
   - "References" section at bottom with alphabetized full citations.
   - Every citation traces to a `sources` row.
4. Re-export the same report → identical alias mapping → equivalent
   output.
5. Try Export → Chicago Notes + PDF. ~30–60s. Get a properly-styled
   .pdf with Chicago footnote citations and a bibliography.
6. Open admin cost dashboard `/app/admin/cost`. Phase breakdown
   chart shows a "Citation Mapping" slice. Filter table by
   phase=Citation Mapping → see the export-time `citation_formatter`
   rows.
7. **This is the working cross-WO contract.** Rule 25 I-9 + Rule 28
   I-1 firing live.

---

## What this WO explicitly does NOT do

- **Does NOT support Turabian, Vancouver, Nature, or AMA styles** in
  the initial release. Six styles cover the four buyer tribes. Adding
  a new style requires: a CSL file in the templates dir, a frontend
  dropdown entry, an enum extension in the API + pandocRunner.
- **Does NOT bundle citation-style customization.** No "modify APA
  to use commas instead of periods" UI. Users wanting bespoke styles
  copy a CSL, hand-edit it, and (future WO) upload to the engine.
- **Does NOT support BibTeX/.bib bibliography output.** Pandoc can
  emit it but no buyer tribe asks for it. Add later if requested.
- **Does NOT auto-detect citation style from inbound persona.** The
  default is APA because it's the most common academic style; user
  picks per-export. A future personalization WO could default the
  picker per persona (academic→APA, patent→Chicago notes, OSINT→none).
- **Does NOT validate that the rendered citations match what would
  appear in a peer-reviewed journal of that style.** CSL is a
  reasonable approximation; bespoke journal style guides (e.g. New
  England Journal of Medicine variants) require their own CSL files
  vendored separately. Six well-known styles is the floor.
- **Does NOT implement S3/R2 output storage.** PATCH-X04 ships the
  `local` backend; S3/R2 are stubs to be filled in when production
  needs them.

---

## Companion Work Orders — final 4-WO summary

| WO | Status | Hard deps | Soft deps |
|---|---|---|---|
| **WO-U** Cost Telemetry Sidecar | Independent | none | WO-X adds `citation_formatter` role → triggers WO-U I-9 cross-WO contract |
| **WO-V** Persona-adaptive Landing + Lab Notebook | Independent | none | WO-W reads WO-V's `data-persona` |
| **WO-W** Animated Multi-Agent Pipeline | needs WO-V | WO-V | none |
| **WO-X** Academic Formatting Engine | needs WO-U | WO-U | none |

**Suggested ship order:** U → V → W in any order after V → X.

WO-U is the most operationally important (it enables every other
business decision about pricing and model selection). WO-V + WO-W
together are the brand-impact deploy (the public face of the
product). WO-X is the audit-grade closer (the surface where
academics and patent buyers convert).

The four-WO package as delivered:
- 4 Cursor rules (25, 26, 27, 28)
- 4 Work Order docs
- 4 CURSOR_BRIEFs (this is the WO-X one)
- 3 design notes / ADRs (WO-U design ADR, WO-V visual design notes,
  this WO's "Critical reminders" section serving the same purpose)
- 2 database migrations (030, 032 — plus optional 031 from WO-V)
- ~12 new TypeScript modules
- ~6 new React components
- ~8 surgical patch instructions
- ~80 test assertions across 5 test files
- Every must-fail-without-the-fix tripwire mapped to a specific
  production line via `// REVERT-CHECK:` comments

The 4-WO package leaves ResearchOne with: per-report cost truth
(WO-U), persona-adaptive landing brand (WO-V), animated pipeline
proof of differentiation (WO-W), and citation-grade export
(WO-X) — each independently revertable, each independently shippable,
each with explicit pre-commit grep enforcement of its invariants.
