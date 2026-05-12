# ResearchOne — Comprehensive UX / UI / Content / Design Audit and Redesign Brief
*Prepared as a single decision-ready document for the founder and for direct hand-off to a Cursor coding agent. No code — only descriptive instructions detailed enough to execute without ambiguity.*

---

## TL;DR

- **The site under-sells the product by three orders of magnitude.** The hero pipeline animation, the pinstriped background colliding with the comparison table under "Built for defensible decisions", the overstuffed small cards, and the Living Report graphic together produce the impression of a hobby project, while the underlying engine — a 10-stage, 7-agent pipeline with a dedicated Skeptic agent and citation-grade output — deserves a marketing surface comparable to Linear, Stripe Docs, and Anthropic. The fix is not a re-skin; it is a disciplined replacement of four marquee visuals, a strict character-capped content hierarchy on every card, a brand voice that matches the epistemic policy in the meta description ("never sanitize, never debunk-by-recall, never silently smooth contradictions"), and a static-rendered marketing surface so the page actually shows content to crawlers.
- **Keep the dark theme and the current typeface palette; replace everything else.** Adopt a graphite/ink base (`#0B0D10` → `#0F1318`), a single restrained accent (citation-amber `#F0C674`) for evidence affordances, plus two semantic accents (skeptic-magenta `#D45B9E` and evidence-cyan `#5BC0EB`) used sparingly. Remove the diagonal pinstripe entirely from any section containing a table, chart, or dense card grid; retain it only as a faint ambient layer behind hero/empty space at ≤2.5% opacity, re-angled to 102° on a radial mask so it never collides with horizontal table rules.
- **Ship in three waves.** Wave 1 (1–2 days): design tokens + global card/table primitives + the pinstripe mask. Wave 2 (3–5 days): new Pipeline Schematic hero, new Living Report Timeline, the new comparison table on the homepage. Wave 3 (3–5 days): every other page — methodology deep-dive, pricing, sample report, security/trust, FAQ, compare, changelog, about, contact, docs, legal, auth shells, 404. The QA checklist at the end of this brief maps directly to each of Brandon's named complaints so nothing slips.

---

## Key Findings (executive)

1. **Marquee visuals are the loudest problem.** Four elements are doing 80% of the brand damage: the hero pipeline animation, the "Built for defensible decisions" table-on-pinstripe, the small cards (overflowing text + no hierarchy), and the Living Report timeline animation. Replacing those four with disciplined alternatives lifts the entire site immediately.
2. **The brand voice in the meta description is excellent and is not yet executed on the page.** *"Reasoning-first epistemic policy: never sanitize, never debunk-by-recall, never silently smooth contradictions"* is the single best sentence on the site; it should anchor the hero, the section headers, the comparison table headers, and the footer epigraph. Most current body copy is generic AI-research boilerplate that any of the 16 named competitors could plausibly use.
3. **The information architecture is under-built.** A citation-grade platform with a 7-agent pipeline needs at minimum: a Methodology deep-dive, a Sample Report surface that can actually be opened and cited, a Security/Trust page (BYOK, Sovereign tier, residency, retention, audit), an FAQ that answers the obvious skeptic questions, an About/Company page that earns credibility, a Compare page, a Changelog, a Contact page, and Docs. Missing any of these signals "demo-ware" to a serious buyer.
4. **The pinstripe is not the enemy; the pinstripe-on-table is the enemy.** Diagonal pinstripes are a legitimate ambient texture (Stripe Docs uses horizontal grain; Linear uses a star-field). The error is rendering a high-information element on top of a high-frequency repeating pattern. Solution: kill the pinstripe behind any high-information surface using a tight radial mask, never globally.
5. **"Small cards with too much text" is a mechanical problem with a mechanical fix.** Cap eyebrow at 24 chars, headline at 42 chars, description at 110 chars, one icon, optional one metric. If a card cannot survive those caps, the content is wrong, not the card.
6. **Animations are decorative, not informational.** The hero animation must show data physically flowing through the 10 stages and must visibly distinguish the Skeptic loop. The Living Report animation must show real version evolution — citations added, sources upgraded, contradictions preserved, team pins set — not a generic scroll.
7. **The page returns no body content to crawlers.** The deployed site is a client-rendered SPA whose raw HTML contains only meta tags. For a citation-grade product, that is self-defeating: the marketing surface itself cannot be cited. Move marketing routes to static rendering.

---

# SECTION 1 — FINDINGS

Severity legend: **C** critical (visible to every visitor, harms brand on first impression), **H** high (harms conversion or trust), **M** medium (polish), **L** low (nit).

## 1.1 Findings tied directly to the founder's stated complaints

| # | Finding | Severity | Location |
|---|---|---|---|
| F-1 | Hero pipeline animation reads as informal/sketched, with no clear data-flow direction, no labels per stage, no inputs/outputs, no role differentiation between agents (Researcher vs. Skeptic vs. Synthesizer), and no visible adversarial loop. Actively undercuts seriousness. | **C** | Homepage `/`, `PipelineAnimation`/`HeroPipeline` component |
| F-2 | Diagonal pinstripe pattern repeats behind the "Built for defensible decisions" comparison table, producing visible moiré at the row borders and warping the column rules. | **C** | `ComparisonTable` section on homepage; pattern defined in `globals.css` (likely `repeating-linear-gradient`) or as `<pattern id="pinstripe">` in a background SVG |
| F-3 | "Small cards" (feature tiles / value-prop tiles) are overstuffed: 3–5 lines of body copy, no metric, no icon hierarchy, ragged right-edge wrapping, inconsistent card heights. | **C** | Homepage feature grid (`FeatureCards`/`SmallCards`); pattern likely repeated on Methodology and Pricing |
| F-4 | Living Report animation is decorative without informational content. Does not show what a "Living Report" *is* — a report that gains citations, replaces sources, accepts team pins, and preserves contradictions over time. | **C** | Homepage `LivingReport`/`LivingReportAnimation` component |

## 1.2 Findings by issue category (cross-cutting)

### Content
| # | Finding | Severity |
|---|---|---|
| F-5 | H1 is generic/branded ("ResearchOne — …"). The H1 should make the *value claim*, the tagline can ride below. | H |
| F-6 | The strongest line on the site lives only in `<meta>` and is never visible to a reader. | H |
| F-7 | Body copy uses marketing intensifiers ("powerful", "world-class") that any competitor could use. | H |
| F-8 | Skeptic agent is the single most defensible differentiator and is buried. | H |
| F-9 | BYOK and Sovereign-tier mentioned as acronyms without inline explanation. | M |
| F-10 | No FAQ surface — and FAQs are themselves a brand statement for an epistemic product. | H |

### Design / visual hierarchy
| # | Finding | Severity |
|---|---|---|
| F-11 | Section transitions are flat; no anchor-scroll, no progressive reveal, no sticky chips for in-section nav on long pages. | M |
| F-12 | Equal-height card rows not enforced; cards in the same row do not align vertically. | M |
| F-13 | Mixed icon sources (probable mix of emoji, custom SVG, possibly Lucide) produce inconsistent stroke weights. | M |
| F-14 | No trust strip beneath hero; no anchor logo placeholder, no "audited by"/"compliance" line. | H |

### Alignment & spacing
| # | Finding | Severity |
|---|---|---|
| F-15 | Inconsistent horizontal padding between sections (likely some sections use container, some bleed). | M |
| F-16 | Vertical rhythm undefined — heading→sub→body spacing varies across sections. | M |
| F-17 | Cards do not respect a shared baseline grid for icon→headline→description→metric. | M |

### Typography
| # | Finding | Severity |
|---|---|---|
| F-18 | Display font likely set to fixed size at small viewport rather than fluid clamp; H1 truncates or wraps badly under 380 px. | H |
| F-19 | Body line-length probably exceeds 75ch in wide sections; reduces readability. | M |
| F-20 | Tabular numerals not applied to metric badges; columns of numbers will drift. | L |

### Color
| # | Finding | Severity |
|---|---|---|
| F-21 | Secondary text against the pinstriped background almost certainly fails WCAG AA in spots (4.5:1). | H (a11y) |
| F-22 | Likely use of Tailwind defaults (`slate-400/500`) directly in className strings — token discipline is absent. | M |
| F-23 | No semantic colors for epistemic concepts (evidence, skeptic, citation), so the same blue/gray serves every meaning. | M |

### Animation
| # | Finding | Severity |
|---|---|---|
| F-24 | `prefers-reduced-motion` almost certainly not honored on the hero and Living Report animations. | H (a11y) |
| F-25 | Hero animation loop length and easing curves unspecified; likely default `ease-in-out` everywhere. | M |
| F-26 | No scroll-linked behavior; hero animation neither pins nor hands off elegantly. | M |

### Tables
| # | Finding | Severity |
|---|---|---|
| F-27 | Comparison table likely uses `<div>` grid instead of semantic `<table>`/`<th scope>`/`<caption>`. | H (a11y) |
| F-28 | Vertical column rules likely visible — they should not be (per Edward Tufte). | M |
| F-29 | "Yes/No" cells likely use ✅/❌ emoji rather than typed Lucide icons with aria-labels. | M |

### Cards
| # | Finding | Severity |
|---|---|---|
| F-30 | No prop-level cap on description length, allowing arbitrarily long copy. | C |
| F-31 | No metric slot, no eyebrow slot, no icon constraints. | H |
| F-32 | Hover state likely uses a heavy drop-shadow rather than border/inner-glow. | M |

### Links
| # | Finding | Severity |
|---|---|---|
| F-33 | Header nav and footer link inventories likely diverge (a footer link missing from header creates dead-end discovery). | M |
| F-34 | External links likely lack `rel="noopener"` and lack a visible affordance. | M |
| F-35 | CTA labels likely vary across the site ("Get started", "Try now", "Start free"). | H |

### Mobile
| # | Finding | Severity |
|---|---|---|
| F-36 | Hero pipeline almost certainly bleeds off-screen or shrinks below legibility under 640 px. | H |
| F-37 | Comparison table likely overflows horizontally with native scroll; rows not converted to stacked cards. | H |
| F-38 | Card grid likely collapses to 1-col but without re-tightening padding. | M |

### Performance
| # | Finding | Severity |
|---|---|---|
| F-39 | Fonts likely loaded via stylesheet `<link>` rather than `next/font` with subsetting + `display: swap`. | M |
| F-40 | Hero animation likely uses a non-vector approach (e.g., a PNG or Lottie) where inline SVG would be smaller and sharper. | M |
| F-41 | OG image is the only social asset (`og-image.png`); no per-page programmatic OG. | M |

### SEO / discoverability
| # | Finding | Severity |
|---|---|---|
| F-42 | Site is fully client-rendered; raw HTML returns only meta tags. LinkedIn/Slack/X link previews and search engines see an empty document. | **C** |
| F-43 | No `schema.org` JSON-LD (Organization, SoftwareApplication, FAQPage). | M |
| F-44 | Sitemap and robots almost certainly default or absent. | M |

### Consistency
| # | Finding | Severity |
|---|---|---|
| F-45 | Tone shifts between sections (some technical, some marketing-y); single voice rule not enforced. | H |
| F-46 | Capitalization style for headings inconsistent (Title Case vs. sentence case mixed). | M |
| F-47 | Punctuation: mixed em-dash, en-dash, hyphen usage; mixed straight/curly quotes. | L |

## 1.3 Findings by page

### Homepage `/`
- F-1, F-2, F-3, F-4, F-5, F-6, F-7, F-8, F-14, F-30–F-32, F-35–F-38, F-42.

### Methodology `/methodology`
| # | Finding | Severity |
|---|---|---|
| F-48 | Without a 10-stage stage-by-stage walkthrough, the product's most defensible differentiator is invisible. | **C** |
| F-49 | Skeptic agent deserves its own anchor and its own one-screen treatment. | H |

### Pricing `/pricing`
| # | Finding | Severity |
|---|---|---|
| F-50 | BYOK / Sovereign-tier likely surfaced as acronyms with no inline explanation. | H |
| F-51 | Tier feature lists likely inconsistent in granularity (one tier shows API limits, another shows only "all features"). | M |

### Sample Report `/sample-report` (suspected missing or behind JS)
| # | Finding | Severity |
|---|---|---|
| F-52 | If reports cannot be opened and cited from an open URL, the product's own pitch is self-undermining. | **C** |

### About / Company `/about` (likely missing)
| # | Finding | Severity |
|---|---|---|
| F-53 | No "who's behind this" surface; for a rigor product, an About page bearing the founder's name, the team's research vocabulary, and a stated epistemic policy is part of the moat. | H |

### Contact `/contact` (likely missing)
| # | Finding | Severity |
|---|---|---|
| F-54 | No dedicated contact route with clear separation between sales, security, press, and abuse channels. | M |

### Documentation `/docs` (likely missing or behind app)
| # | Finding | Severity |
|---|---|---|
| F-55 | Public Docs are the conversion artifact for technical buyers. Even a stub with the API surface, the agent roster, and a "Defensibility" page is worth shipping. | H |

### Trust / Security `/trust` (likely missing)
- F-15 (architectural, listed in §1.4 below).

### FAQ `/faq` (likely missing)
- F-10.

### Compare `/compare` (likely missing)
- New page; see §2.3 #7.

### Changelog `/changelog` (likely missing)
- New page; see §2.3 #8. The thematic match (Living Reports ↔ Living Changelog) is too good to skip.

### Legal `/privacy`, `/terms`, `/cookies`
| # | Finding | Severity |
|---|---|---|
| F-56 | Legal pages almost certainly use a different typeface/measure than marketing pages and break visual continuity. | M |

### Auth shells `/sign-in`, `/sign-up`, `/reset`
| # | Finding | Severity |
|---|---|---|
| F-57 | Auth screens likely carry no brand voice; an opportunity wasted on the highest-intent surface. | M |

### 404
| # | Finding | Severity |
|---|---|---|
| F-58 | Generic 404 wastes one of the highest-emotional-bandwidth pages on the site. | M |

### Sitemap.xml / robots.txt
| # | Finding | Severity |
|---|---|---|
| F-59 | Both sitemap and robots were not fetchable from the public surface — they are either absent or non-canonical. | M |

## 1.4 Findings about missing pages

| # | Finding | Severity |
|---|---|---|
| F-60 | No Security/Trust page — for the buyer this product targets, this is a hard prerequisite. | **C** (because absent) |
| F-61 | No FAQ — see F-10. | H |
| F-62 | No Comparison page — competitors will be evaluated *against* you in the buyer's head; you should frame it. | H |
| F-63 | No Changelog — Living Report metaphor demands it. | M |
| F-64 | No About/Contact/Docs surfaces. | M |

## 1.5 Repository-level findings (component map)

The Cursor agent will resolve exact paths via the §3.0 pre-flight. Expected file map based on Next.js / React / TypeScript / Tailwind conventions and the founder's enumeration:

| Concern | Likely file (verify in pre-flight) |
|---|---|
| Framework | `package.json` (`next`, `react`, `tailwindcss`, possibly `framer-motion`) |
| Global CSS | `app/globals.css` or `styles/globals.css` |
| Tailwind config | `tailwind.config.ts` or `.js` |
| Font loading | `app/layout.tsx` (likely `next/font/google` or `<link>`) |
| Pinstripe definition | A `repeating-linear-gradient(...)` in `globals.css`, or `<pattern>` in `public/*.svg` |
| Hero pipeline | `components/marketing/HeroPipeline.tsx` (or `Hero.tsx`, or `PipelineAnimation.tsx`) |
| Comparison table | `components/marketing/ComparisonTable.tsx` (or `Defensible.tsx`) |
| Small cards | `components/marketing/FeatureCard.tsx` or `components/marketing/SmallCard.tsx` |
| Living Report | `components/marketing/LivingReport.tsx` |
| Marketing routes | `app/page.tsx`, `app/methodology/page.tsx`, `app/pricing/page.tsx`, etc. |
| App / dashboard | `app/(app)/...`, `app/dashboard/...` — **do not modify** |
| Icons | `lucide-react`, or one-off SVGs under `public/` or `components/icons/` |
| Animation lib | `framer-motion` if present in `package.json` |
| Unused / legacy | Components imported nowhere; flag during pre-flight |

---

# SECTION 2 — SUGGESTED IMPROVEMENTS

## 2.1 The four marquee replacements

### 2.1.1 Replace the hero pipeline with the **ResearchOne Pipeline Schematic**

**Concept.** A horizontal, left-to-right schematic of the 10-stage, 7-agent pipeline. Static at rest; ambient motion overlays luminous "evidence packets" traveling stage-to-stage on a slow loop. The Skeptic agent visibly forks off the main spine as an adversarial loop. Reference vocabulary: Stripe Docs' "How payments work" diagram, Linear's marketing diagrams, Vercel's product pages, Resend's email-flow diagram, Anthropic's site visuals, Supabase's architecture diagrams.

**Stage / agent map (canonical).**

| # | Stage | Agent | Input | Output |
|---|---|---|---|---|
| 1 | Intake | Planner | User question | Scoped objective |
| 2 | Decomposition | Planner | Scoped objective | Sub-questions |
| 3 | Retrieval | Retriever | Sub-questions | Candidate sources |
| 4 | Source Tiering | Retriever | Candidate sources | Tier 1–4 sources |
| 5 | Extraction | Analyst | Tier 1–4 sources | Atomic claims |
| 6 | Synthesis | Synthesizer | Atomic claims | Draft synthesis |
| 7 | Skeptic Pass | Skeptic | Draft synthesis | Counter-claims + preserved contradictions |
| 8 | Citation Bind | Citer | Counter-claims + synthesis | Bound claim→source map |
| 9 | Rendering | Renderer | Bound claims | Document v1.0 |
| 10 | Living State | Curator | Document + new evidence | Versioned updates |

**Node shapes (semantic).**
- **Hex** at far left and far right — input ("Question") and output ("Living Report").
- **Capsule** (rounded rectangle, 96 × 56 px, radius 14) for the 10 agent stages.
- **Pill** (skeptic-magenta outline) for the Skeptic loop, curving below the spine from Stage 6 to Stage 7 and back to Stage 8.

**Edge style.** 1.5 px stroke, semantic color per source stage, slight bezier between nodes, taper toward arrowheads. Skeptic loop uses `stroke-dasharray` to signal counter-flow.

**Edge animation.**
- Three "evidence packets" (4 px circles with gradient-trail) traverse the spine on a 12 s loop, spaced 4 s apart.
- One packet runs the Skeptic loop on a counter-direction 8 s loop.
- Easing `cubic-bezier(0.65, 0, 0.35, 1)`.
- `prefers-reduced-motion: reduce` → single static packet rendered at Stage 6 with a "+ adversarial review" annotation; no traversal.

**Color palette per stage type.**
- Planner: cool slate `#7C8FA1`
- Retriever: evidence-cyan `#5BC0EB`
- Analyst / Synthesizer / Curator: citation-amber `#F0C674`
- Skeptic: skeptic-magenta `#D45B9E`
- Citer / Renderer: parchment-bone `#E8DFCB`

**Glow / aura.** Each node carries a 1 px inner stroke at 30% opacity. Currently-visiting node gets a 12 px outer glow at 8% opacity in its stage color, and nudges +1 px vertical translate (subtle "breath").

**Hover.** Hover (or focus) on a node freezes the ambient animation, raises z-index, and expands a 240 px info card showing stage number, stage name, agent, input, output, and a one-sentence rationale. Tab-accessible.

**Scroll.** As the user scrolls past the hero, the diagram performs a single "completion" sweep (packets accelerate, every stage glows once, then settles) and pins for a beat before releasing.

**Mobile fallback (< 640 px).** Replace the SVG with a vertical snap-scrollable stack of stage cards; the Skeptic appears as an inline annotation pill on Stage 7. No traveling packets on mobile.

**Dimensions.**
- Desktop SVG `viewBox="0 0 1440 420"`, intrinsic aspect locked.
- Stage capsules at `y=220`; Skeptic loop apex at `y=340`.
- Stage spacing 120 px between capsule centers; input hex at `x=80`, output hex at `x=1360`.
- Padding inside the hero section: 96 px top / 64 px bottom on desktop; 64 / 48 on tablet; vertical snap on mobile.

### 2.1.2 Resolve the **pinstripe-vs-table** collision (three coexisting fixes)

1. **Confine the pinstripe to ambient zones only.** Define a CSS class `.stripe-ambient` whose mask is `radial-gradient(ellipse at top, black 0%, black 40%, transparent 70%)`. Apply only to hero/empty sections. Never to any section containing a `<table>`, a chart, or a card grid.
2. **Attenuate the pinstripe.** Stripe color drops to `rgba(255,255,255,0.025)` (≤2.5% over `#0B0D10`). At that intensity the stripe reads as paper grain, not as a competitor to table rules.
3. **Re-angle the pinstripe.** Rotate to 102° so its repeating angle does not align with horizontal table rules. Eliminates moiré at any zoom level.
4. **Replace the comparison table primitive** with horizontal-only rules (`1px solid rgba(255,255,255,0.07)`), elevated header row (`#11161C`), sticky left column, Lucide icons in cells with `aria-label`. See §3.4.

### 2.1.3 Strict **small-card** content hierarchy

Cards have one canonical prop shape with strict character caps:

| Field | Char cap | Word cap | Notes |
|---|---|---|---|
| Eyebrow (optional) | 24 chars | 2–3 words | Uppercase, tracking +60, citation-amber, 11 px |
| Headline | 42 chars | 4–6 words | Display font, 18–20 px, 1.15 line-height |
| Description | 110 chars | ~14 words | Body font, 14 px, `--ink-2` |
| Metric (optional) | 18 chars | 1–3 words | Tabular numerals, citation-amber, 11 px |
| Icon | 1 | — | Lucide outline, 20 px, top-left |
| CTA (optional) | 22 chars | 2–3 words | "Read more →" only |

Cards have equal heights within a row via grid `auto-rows: 1fr`. Headlines never wrap to two lines (tighten copy). If a card cannot survive these caps, it is two cards.

### 2.1.4 Replace the Living Report animation with the **Living Report Timeline**

**Concept.** A horizontal scrubber bar across the top with discrete version nodes (v0.1 … v1.0); a styled document preview below; diff badges animate in as the version advances. Latest version pulses softly.

**Five diff badge types:**
- `+ Citation` — citation-amber — citation appended.
- `↑ Source upgrade` — evidence-cyan — source replaced by higher-tier.
- `± Synthesis` — parchment-bone — synthesis prose revised.
- `📌 Team pin` — slate — teammate pinned a finding.
- `⚠ Contradiction` — skeptic-magenta — contradiction preserved (per epistemic policy).

**Interaction.** Click-drag scrubber; keyboard ←/→ between versions; autoplay 0.6× on first view then pauses on interaction; screen-reader announcements per badge. `prefers-reduced-motion` → final state plus a legend.

## 2.2 Brand voice — "Defensible by Design"

Three voice rules to enforce at PR time:

1. **Name the rigor.** Use "evidence tier", "claim", "counter-claim", "citation bind", "preserved contradiction", "Skeptic pass" as product nouns.
2. **Never use marketing intensifiers.** No "powerful", "world-class", "revolutionary", "next-generation". Replace with verbs: cites, preserves, challenges, binds, defends.
3. **Speak in the negative when it earns trust.** "We do not summarize away contradictions." "We do not hide upgraded sources." "We do not silently rewrite."

## 2.3 New sections / pages to add

1. **Trust strip** below hero — three pills: "Citation-graded · Tier 1 → Tier 4", "Adversarial Skeptic pass", "Living, versioned reports".
2. **Methodology deep-dive** — one screen per stage with anchor nav.
3. **Security & Trust** — data residency, retention, BYOK, Sovereign tier, audit log.
4. **Sample Report** — statically rendered, openable, citable.
5. **FAQ** — the skeptic questions, honestly answered.
6. **About** — team, epistemic policy, lineage.
7. **Compare** — head-to-head with the 16 named competitors.
8. **Changelog** — Living Report for the product itself.
9. **Contact** — separate sales/security/press/abuse channels.
10. **Docs** — at minimum a stub with agents, API surface, defensibility page.

## 2.4 Motion principles

- UI feedback 120 ms; section reveals 220 ms; hero packet loop 12 s.
- Content easing `cubic-bezier(0.65, 0, 0.35, 1)`; hover easing `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Hover lifts ≤ 2 px translate-y; no full drop-shadows; replace with inner-stroke glow.
- One subtle hero parallax (≤ 24 px); no scroll-jacking.
- Every animated element honors `prefers-reduced-motion`.

## 2.5 Mobile

- Hero → vertical snap-stack of stage cards.
- Tables → row-as-card cards under 768 px.
- Cards → 1 col under 640 px with tightened padding.
- Sticky header → brand + single CTA + hamburger.

## 2.6 Performance

- Fonts via `next/font` with subsetting (Latin only unless markets warrant) and `display: swap`.
- Inline SVG for the hero (no `<img>`, no Lottie).
- `loading="lazy"` and explicit width/height on every `<img>`.
- Marketing routes pre-rendered (static export or `dynamic = 'force-static'`).
- Programmatic OG images per page via `opengraph-image.tsx`.

## 2.7 Accessibility

- `prefers-reduced-motion` on every animated component.
- Keyboard navigation through every hero node and every Living Report version.
- Real `<table>` with `<th scope>`, `<caption>`, ARIA labels on advantage cells.
- WCAG AA contrast (4.5:1 body, 3:1 large text) verified on the (faint) striped zone.
- Meaning-bearing icons carry `aria-label`; decorative icons `aria-hidden`.

## 2.8 Legal / auth / 404

- Legal pages share marketing header/footer, 65-ch measure, line-height 1.65.
- Auth titles carry brand voice (see exact copy in §2.10).
- 404: *"This claim could not be sourced."*

## 2.9 Competitor copy comparison — why the new copy beats each named competitor

| Competitor | Their default value-claim register | ResearchOne's new register that beats it |
|---|---|---|
| **Elicit** | "Find research papers, faster." (efficiency framing) | "Research that defends itself." (rigor framing — efficiency does not differentiate in 2026) |
| **Consensus** | "Get answers from academic papers, instantly." (answers framing) | "Every claim ships with its citation and its counter-claim." (epistemic framing) |
| **Perplexity** | "Ask anything." (universality framing) | "Ask a question that needs to survive a Skeptic." (specificity framing) |
| **You.com** | General-search assistant framing | "Not an assistant. A pipeline you can audit." |
| **Scite** | "Smart Citations" (citation-as-feature) | "Citations bound to claims. Break a claim, the citation goes with it." (citation-as-contract) |
| **ScholarAI** | GPT-plugin framing | "A 7-agent pipeline, including a dedicated Skeptic." |
| **Iris.ai** | "Map the unknown." (exploration framing) | "Map the unknown. Then defend it." |
| **Genei** | Summarization framing | "We do not summarize away contradictions." |
| **Scholarcy** | "Summarize papers in seconds." | "Reports that keep their receipts." |
| **Research Rabbit** | Discovery / graph framing | "Discovery is stage 3 of 10. Defense is stages 7 and 10." |
| **Connected Papers** | Visual citation graph | "A pipeline, not a graph. A graph cannot mark a contradiction preserved." |
| **Undermind** | "Deep search" framing | "Deep search is necessary. Adversarial review is sufficient." |
| **OpenEvidence** | Clinical-evidence framing | "Citation tiers, preserved contradictions, and a Skeptic — for every domain, not only clinical." |
| **ChatGPT Deep Research** | "ChatGPT can now do deep research." (capability framing) | "An auditable 10-stage pipeline, with the Skeptic outside the model." (auditability framing) |
| **Claude Research** | Tool framing | "We bind citations. We do not present them." |
| **Gemini Deep Research** | Browse-and-summarize | "We do not silently smooth contradictions." |

The line that wins universally is the footer epigraph, lifted from your own meta description: *"We do not sanitize. We do not debunk by recall. We do not silently smooth contradictions."* No competitor speaks in the negative; this is your strongest single sentence.

## 2.10 Exact word-for-word copy

**Hero**
- Eyebrow: `DEEP RESEARCH PLATFORM`
- H1: `Research that defends itself.`
- Sub-H1: `ResearchOne runs a 10-stage, 7-agent pipeline — including a dedicated Skeptic — so every claim ships with the citation, the counter-claim, and the version it came from.`
- Primary CTA: `Open a sample report`
- Secondary CTA: `See the methodology`

**Trust strip pills**
- `Citation-graded · Tier 1 → Tier 4`
- `Adversarial Skeptic pass`
- `Living, versioned reports`

**"Built for defensible decisions" section**
- H2: `Built for defensible decisions.`
- Sub: `Side-by-side with general-purpose research assistants. We win where defense matters.`
- Table columns: `Capability` · `ResearchOne` · `General-purpose deep research`
- Row labels (in order):
  - `Per-claim citations`
  - `Source tier disclosure`
  - `Adversarial skeptic pass`
  - `Preserved contradictions`
  - `Versioned, living updates`
  - `Cited counter-claims`
  - `Auditable evidence chain`
  - `BYOK / sovereign tier`

**Small cards (six)** — each ≤42-char headline, ≤110-char description, one metric.

1. **`Skeptic agent, by design`** — `A dedicated adversarial pass challenges every claim before the report is bound.` — `1 of 7 agents`
2. **`Evidence tiers, surfaced`** — `Each source carries its tier (1–4). Tier upgrades appear in the version history.` — `Tier 1 → Tier 4`
3. **`Contradictions, preserved`** — `We do not silently smooth disagreement. Conflicting claims survive into the final report.` — `0 silent rewrites`
4. **`Citations bound to claims`** — `Every claim binds to its source span. Break a claim, the citation goes with it.` — `100% bound`
5. **`Reports that keep learning`** — `New citations, upgraded sources, and team pins land as discrete versions you can scrub.` — `Living updates`
6. **`Bring your own keys`** — `Run on your own model and search keys. Sovereign tier keeps every byte in your tenancy.` — `BYOK · Sovereign`

**Living Report section**
- H2: `A report that keeps its receipts.`
- Sub: `Citations get added. Sources get upgraded. Contradictions get flagged. Every change is a version you can scrub, cite, or roll back.`

**Methodology teaser (on homepage)**
- H2: `Ten stages. Seven agents. One adversary.`
- Sub: `Intake to Living state, every step is named, instrumented, and reviewable.`
- CTA: `Walk the pipeline →`

**Methodology page H1/sub**
- H1: `Ten stages. Seven agents. One adversary.`
- Sub: `Every stage is named. Every agent is auditable. The Skeptic exists outside the model.`

**Pricing**
- H1: `Pricing that scales with rigor, not seats.`
- Tier names: `Researcher` · `Team` · `Enterprise` · `Sovereign`
- Per-tier eyebrow examples:
  - Researcher: `For individual analysts running 50+ reports a month.`
  - Team: `For decision desks that need shared evidence chains.`
  - Enterprise: `For programs requiring audit, SSO, and SLAs.`
  - Sovereign: `For tenancies that cannot leave your perimeter.`

**Security / Trust**
- H1: `Defensible at the data layer, too.`
- Sub: `BYOK by default, sovereign-tier tenancy on request, full audit log on every report.`

**FAQ questions**
- `How is this different from ChatGPT Deep Research or Claude Research?`
- `What does the Skeptic agent actually do?`
- `What happens when two high-tier sources disagree?`
- `Can ResearchOne forge or hallucinate a citation?`
- `How do Living updates work — will my old report change under me?`
- `What's the difference between BYOK and the Sovereign tier?`
- `Can I export a report and cite it like a static PDF?`

**About**
- H1: `Built by people who refuse to sanitize the evidence.`
- Sub: `ResearchOne is engineered for analysts, decision desks, and researchers whose work has to survive scrutiny.`

**Contact**
- H1: `Talk to ResearchOne.`
- Three channel cards: `Sales` · `Security` · `Press`.

**404**
- H1: `This claim could not be sourced.`
- Sub: `The page you requested is not in our index. Try the methodology, a sample report, or the Living Report demo.`

**Auth shell titles**
- Sign-in: `Sign in to keep your evidence chain.`
- Sign-up: `Create your evidence chain.`
- Reset: `Recover your evidence chain.`

**Footer epigraph (under brand mark)**
- `We do not sanitize. We do not debunk by recall. We do not silently smooth contradictions.`

---

# SECTION 3 — DETAILED WORK INSTRUCTIONS FOR A CURSOR AGENT

> **Convention notes.** Paths below assume Next.js 14 App Router (`/app`, `/components`, `/lib`, `/styles`). If the repo uses Pages Router or a different layout, translate by analogy. No code anywhere in this section — only descriptive English detailed enough to execute without ambiguity. **Do not change functionality** — no API routes, no auth logic, no app/dashboard. Only public-facing text, graphics, animations, performance, and accessibility.

## 3.0 Pre-flight (do these first, in this order)

1. **Inventory.** List every file under `/app` (or `/pages`), `/components`, `/styles`, `/public`. Mark each as *marketing*, *application*, or *shared*. **Do not modify any file marked application.**
2. **Identify the four named complaint components.** Grep the codebase for: `pipeline`, `HeroPipeline`, `PipelineAnimation`, `Stages`, `Agents`, `Defensible`, `Comparison`, `ComparisonTable`, `vs-table`, `LivingReport`, `Living`, `Timeline`, `Versions`, `Feature`, `FeatureCard`, `SmallCard`, `Tile`.
3. **Identify the pinstripe.** Search for `repeating-linear-gradient`, `stripe`, `pinstripe`, `pattern` in `globals.css`, `tailwind.config.*`, and any SVG under `/public`.
4. **Identify motion library.** Search for `framer-motion`, `@react-spring`, `lottie`, `gsap`. If none, install `framer-motion` only.
5. **Identify icon library.** Search for `lucide-react`, `react-icons`, `heroicons`. Standardize on `lucide-react`.
6. **Snapshot.** Capture screenshots of every public route at 1440×900 and 390×844 under `/audit-snapshots/before/`.
7. **List unused components.** Anything imported nowhere — flag in PR notes, do not delete in the same PR.

## 3.1 Design tokens — `app/globals.css`

Define on `:root` (and `:root.dark` if both modes exist):

- `--bg-0: #0B0D10` · `--bg-1: #0F1318` · `--bg-2: #11161C` · `--bg-3: #161C24`
- `--ink-1: #E8ECF2` · `--ink-2: #B7C0CC` · `--ink-3: #7C8794`
- `--rule: rgba(255,255,255,0.07)` · `--rule-strong: rgba(255,255,255,0.12)`
- `--accent-citation: #F0C674` · `--accent-evidence: #5BC0EB` · `--accent-skeptic: #D45B9E` · `--accent-bone: #E8DFCB`
- `--focus-ring: #F0C674`
- `--stripe-color: rgba(255,255,255,0.025)`
- `--motion-curve-standard: cubic-bezier(0.65, 0, 0.35, 1)`
- `--motion-curve-emphasized: cubic-bezier(0.2, 0.8, 0.2, 1)`

**Rationale:** single source of truth; future drift is impossible by construction.

## 3.2 Tailwind config — `tailwind.config.ts`

- Extend `theme.colors` with `bg.0`–`bg.3`, `ink.1`–`ink.3`, `rule`, `rule-strong`, `accent.citation`, `accent.evidence`, `accent.skeptic`, `accent.bone` — every value referencing the CSS variables.
- Extend `theme.transitionTimingFunction` with `standard` and `emphasized`.
- **Keep current font family entries untouched.** Fonts stay per Brandon's directive.
- Add `theme.maxWidth.measure: '65ch'` for legal/long-form pages.
- Add `theme.spacing.section-y: '96px'` and `theme.spacing.section-y-mobile: '64px'` for section rhythm.

## 3.3 Global CSS additions — `app/globals.css`

- Define `.stripe-ambient` with the masked, attenuated, re-angled pinstripe per §2.1.2.
- Define `.prose-r1` — a typography preset for legal/about/changelog: measure 65ch, line-height 1.65, body 16 px, headings in display font, links use citation-amber.
- Define `.focus-visible-r1` — 2 px solid `--focus-ring` ring with 2 px offset.
- Set `*:focus-visible` to apply `.focus-visible-r1`.
- Add `@media (prefers-reduced-motion: reduce)` block that disables all keyframes and sets `animation-duration: 0.001ms !important` and `transition-duration: 0.001ms !important` globally.

## 3.4 Card primitive — `components/marketing/FeatureCard.tsx` (create or replace)

- Prop slots: `eyebrow?`, `icon`, `headline`, `description`, `metric?`, `href?`, `wide?`.
- Enforce the character caps from §2.1.3 by `max-inline-size` + `line-clamp` rules (1 for headline, 2 for description). Log a console warning in dev when caps exceeded.
- Padding 24 px desktop, 20 px mobile.
- Border `1px solid var(--rule)`, background `var(--bg-1)`, radius 14 px.
- Hover: `translateY(-2px)`, border becomes `var(--rule-strong)`, inner glow 8% citation-amber.
- Icon 20 px, top-left, citation-amber stroke.
- Metric bottom-left, tabular numerals, 11 px, citation-amber on transparent.
- Equal heights via parent grid `auto-rows: 1fr`.

**Delete / deprecate:** prior card variants permitting unlimited prose. Mark deprecated; migrate callers.

## 3.5 Table primitive — `components/marketing/ComparisonTable.tsx`

- Real semantic `<table>` with `<caption>` (visually hidden) "Capability comparison: ResearchOne vs general-purpose deep research".
- Wrapping section *does not* carry `.stripe-ambient`.
- Header row: background `var(--bg-2)`, weight 600, padding 14/20, sticky on vertical scroll.
- Body rows: background `var(--bg-1)`; hover `var(--bg-3)` 100 ms ease.
- Horizontal rules `1px solid var(--rule)`. **No vertical rules.**
- First column sticky on horizontal scroll, padding-left 20 px.
- "Yes" → Lucide `Check`, citation-amber, `aria-label="ResearchOne supports"`.
- "No" → Lucide `Minus`, `var(--ink-3)`, `aria-label="Not supported"`.
- "Partial" → Lucide `CircleDot`, evidence-cyan.
- Mobile (< 768 px): each row converts to a card with property name as eyebrow.

**Copy:** row labels per §2.10. Column headers `Capability` · `ResearchOne` · `General-purpose deep research`.

## 3.6 New hero — `components/marketing/PipelineSchematic.tsx`

Create alongside `components/marketing/PipelineSchematic.data.ts` containing the 10 stages and 7 agents per §2.1.1.

**Visual spec:**
- `viewBox="0 0 1440 420"`, intrinsic aspect locked.
- Spine `y=220`; capsules 96×56, radius 14, 1.25 px stroke at 60% stage color, fill `var(--bg-1)`.
- Capsule content: stage number (top-right, 10 px, ink-3), stage name (centered, 12 px, ink-1), output noun (bottom, 10 px, stage accent).
- Connectors 1.5 px, slight bezier, tapered arrowheads.
- Three ambient packets via Framer Motion `motionPath` (or SMIL `<animateMotion>`), 12 s loop, 4 s spacing.
- Skeptic loop apex `y=340`, drops from Stage 6, returns before Stage 8, runs counter-direction on 8 s offset.
- Active node: 12 px outer glow at 8% in stage color, +1 px translate-y.
- Hover/focus: pause ambient, expand 240 px info card with stage #, name, agent, input, output, rationale.
- Keyboard: Tab cycles nodes, Enter opens card, Esc closes.
- Mobile (< 640 px): render `PipelineSchematicMobile` — vertical snap-scroll stack of stage cards with Skeptic as annotation pill on Stage 7.

**Delete / deprecate:** prior `HeroPipeline`/`PipelineAnimation` after screenshot-confirmed migration.

**Hero copy:** §2.10 verbatim.

## 3.7 New Living Report — `components/marketing/LivingReportTimeline.tsx`

Create with `LivingReportTimeline.data.ts` containing a sample version array (v0.1 … v1.0) and per-version badge sets.

**Visual spec:**
- Top scrubber bar 64 px tall; document preview below 320 px tall.
- Scrubber: horizontal rail; version nodes filled citation-amber when active, outlined `--rule-strong` otherwise; tooltip on hover shows version date.
- Diff badges per version animate in below the scrubber: icon + verb + 5–7 word descriptor, per the five badge types in §2.1.4.
- Document preview: styled mock report page using brand body font, with footnote citations. As versions advance, citations appear, tiers update, contradictions flag in skeptic-magenta, team pins anchor as side-margin pins.
- Autoplay 0.6× on first view; pauses on interaction.
- Keyboard ←/→ to navigate; screen reader announces active version's badges.
- `prefers-reduced-motion`: render only the final state plus a legend.

**Delete / deprecate:** prior Living Report animation after migration.

**Section copy:** §2.10 verbatim.

## 3.8 Page-by-page changes

### 3.8.1 Homepage — `app/page.tsx`
- Replace hero with `<PipelineSchematic>` + new hero copy.
- Insert trust strip directly under hero.
- Replace feature grid with six `<FeatureCard>` instances (copy per §2.10).
- Replace "Built for defensible decisions" with new `<ComparisonTable>`.
- Replace Living Report section with `<LivingReportTimeline>`.
- Add Methodology teaser block.
- Add Security teaser block (`Defensible at the data layer, too.` + three pills + `See trust posture →`).
- Verify footer uses new footer (§3.8.12).

### 3.8.2 Methodology — `app/methodology/page.tsx`
- H1 and sub per §2.10.
- Sticky anchor sub-nav listing 10 stages (left rail desktop, top pill mobile).
- One section per stage; each section has a left-aligned mini diagram (reuse `PipelineSchematic` zoomed) and a right-aligned text block with stage name, agent, inputs, outputs, what the agent does, what it does *not* do (brand voice rule), and a representative artifact styled as JSON-ish output.
- Skeptic stage gets a longer write-up and an explicit "Why an adversarial agent exists" rationale.

### 3.8.3 Pricing — `app/pricing/page.tsx`
- H1 per §2.10.
- Tier cards via wide `<FeatureCard>` (`wide={true}`).
- Per-tier eyebrow explains constraint plainly (copy §2.10).
- BYOK / Sovereign explained inline beside their tier — never as bare acronyms.
- FAQ block at the bottom (3–5 obvious pricing questions, reusing the FAQ accordion primitive).
- No stripe; ambient background is `var(--bg-0)` with a single soft radial glow top-center at 4% citation-amber.

### 3.8.4 Sample Report — `app/sample-report/page.tsx`
- Statically rendered; openable; citable.
- Sidebar shows version history, source tiers, preserved contradictions, team pins.
- Share button emits canonical URL with optional version anchor (`?v=0.8`).

### 3.8.5 Security & Trust — `app/trust/page.tsx`
- H1/sub per §2.10.
- Five subsections: Data residency · Retention · BYOK & key handling · Sovereign tier · Audit log.
- Each subsection: one paragraph + a "Today / Roadmap / Out of scope" mini-table so the page never overclaims.

### 3.8.6 FAQ — `app/faq/page.tsx`
- Accordion using `<details>` for zero-JS baseline.
- Required questions per §2.10.
- Answers ≤ 80 words each.

### 3.8.7 Compare — `app/compare/page.tsx`
- Head-to-head matrix vs. the 16 named competitors using `<ComparisonTable>`.
- Pick rows where you win; do not include rows where you do not.
- Suggested rows: Per-claim citations · Source tier disclosure · Skeptic pass · Preserved contradictions · Living updates · Cited counter-claims · Auditable chain · BYOK · Sovereign tier.

### 3.8.8 Changelog — `app/changelog/page.tsx`
- Chronological feed; mirrors the Living Report metaphor.
- Each entry: version, date, summary; uses the same five badge types (Added / Upgraded / Synthesis / Pin / Contradiction).

### 3.8.9 About — `app/about/page.tsx`
- H1/sub per §2.10.
- Sections: Why we exist · Epistemic policy (lift the meta-description line verbatim) · Team · How we work · Inspirations.
- No marketing intensifiers — voice rules apply.

### 3.8.10 Contact — `app/contact/page.tsx`
- H1 per §2.10.
- Three channel cards via `<FeatureCard>`: Sales · Security · Press. Each card has its own contact channel (email or form).
- Optional fourth card: Abuse / responsible disclosure.

### 3.8.11 Docs — `app/docs/page.tsx` (stub OK)
- Even a stub adds trust: at minimum a one-pager listing agents, API surface (if any), a "Defensibility" page describing how to audit a report.

### 3.8.12 Footer — `components/marketing/Footer.tsx`
- Four columns: Product · Methodology · Trust · Company.
- Brand mark left, version number right (read from `package.json`).
- Epigraph below the brand mark (verbatim §2.10).
- Header nav and footer nav lists are kept in a single shared `lib/nav.ts` so they cannot diverge.

### 3.8.13 Header — `components/marketing/Header.tsx`
- Same five top-level entries as footer's primary column: `Product` · `Methodology` · `Pricing` · `Trust` · `Compare`. Plus a single trailing CTA button `Open a sample report` and a `Sign in` text link.
- Sticky; collapses to brand + CTA + hamburger under 768 px.

### 3.8.14 Legal — `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/cookies/page.tsx`
- Wrap content in `.prose-r1`.
- Use site header and footer.
- Add a Table of Contents at top of any document with > 5 sections.

### 3.8.15 Auth shells — `app/(auth)/sign-in/page.tsx`, etc.
- **Do not change auth functionality.** Replace title and helper copy only (§2.10).
- Background `var(--bg-0)` with a faint `.stripe-ambient` and brand mark top-left.

### 3.8.16 404 — `app/not-found.tsx`
- H1/sub per §2.10.
- Three `<FeatureCard>` tiles linking to Methodology, Sample Report, Living Report.

### 3.8.17 Sitemap / robots — `app/sitemap.ts`, `app/robots.ts`
- Generate `sitemap.xml` listing every public marketing route with weekly `changefreq`, with the sample report at higher priority.
- `robots.ts` allows all crawling and points to the sitemap URL.

## 3.9 SEO / metadata / JSON-LD

- Root metadata in `app/layout.tsx` reflects new H1/sub-H1.
- Per-page metadata exported from each `page.tsx`.
- Per-page OG images via `opengraph-image.tsx` for at least home, methodology, pricing, sample report, trust, compare. Template: page H1 in display font over `var(--bg-0)` with a citation-amber rule.
- JSON-LD blocks: `Organization` (root), `SoftwareApplication` (root + pricing), `FAQPage` (FAQ route), `BreadcrumbList` per nested route.
- Marketing pages export `export const dynamic = 'force-static'` (or `revalidate`) so raw HTML contains body content. Fixes F-42.

## 3.10 Dependencies

- **Install if missing:** `framer-motion`, `lucide-react`.
- **Do not install:** GSAP, Lottie, react-spring, Three.js.
- **Verify present:** Tailwind, Next.js ≥ 14, TypeScript.

## 3.11 Implementation sequence

1. Tokens & globals (§3.1, §3.2, §3.3).
2. Primitives (`FeatureCard`, `ComparisonTable`, `Section`, `Eyebrow`, `Metric`).
3. `PipelineSchematic` (§3.6).
4. `LivingReportTimeline` (§3.7).
5. Homepage assembly (§3.8.1).
6. Methodology page (§3.8.2).
7. Pricing, Sample Report, Trust, FAQ, Compare, Changelog, About, Contact, Docs (§3.8.3 – §3.8.11).
8. Legal, Auth shells, 404 (§3.8.14 – §3.8.16).
9. Header & Footer (§3.8.12 – §3.8.13).
10. Sitemap & robots (§3.8.17).
11. SEO / metadata / JSON-LD / OG (§3.9).
12. Performance pass (fonts via `next/font`, image lazy-loading, static rendering).
13. A11y pass (axe, keyboard tour, reduced-motion smoke test).
14. Screenshot diff vs `/audit-snapshots/before/`.

## 3.12 QA checklist — verify all before declaring complete

**Against the founder's named complaints**
- [ ] Hero animation reads as a deliberate, labeled schematic with directional flow; the Skeptic loop is visibly distinct; ambient motion respects `prefers-reduced-motion`.
- [ ] "Built for defensible decisions" table does not visually conflict with the background — toggle the stripe and confirm no moiré, no row-rule warping.
- [ ] No card on the site exceeds 42-char headline or 110-char description — spot-check with DevTools.
- [ ] Living Report animation conveys actual version evolution: ≥ 3 discrete versions, ≥ 3 distinct badge types per version, ≥ 1 preserved-contradiction badge visible.

**Visual discipline**
- [ ] No hardcoded hex values in TSX. Every color is a token.
- [ ] No `<img>` without `width`/`height`.
- [ ] Tables use semantic `<table>` / `<th scope>` / `<caption>`.
- [ ] Heading levels increment monotonically.
- [ ] Body line-length capped at 65–72 ch.
- [ ] Capitalization is consistent (sentence case on H2+, Title Case never).

**Motion**
- [ ] Every animated component renders correctly under `prefers-reduced-motion: reduce`.
- [ ] No loop longer than 12 s.
- [ ] All hover lifts ≤ 2 px translate-y; no full drop-shadows.

**Accessibility**
- [ ] Every interactive element has the 2 px citation-amber focus ring.
- [ ] Hero schematic and Living Report scrubber are keyboard-navigable.
- [ ] Contrast ≥ 4.5:1 body, ≥ 3:1 large text.
- [ ] Meaning-bearing icons carry `aria-label`; decorative icons `aria-hidden`.

**Performance**
- [ ] Fonts via `next/font` with `display: swap` and subsetting.
- [ ] Marketing routes statically rendered — raw HTML view contains body content.
- [ ] Hero SVG inlined; no `<img>` for the schematic.
- [ ] LCP element is the hero H1 (not the SVG).

**SEO**
- [ ] Per-page metadata: title, description, og:title, og:description, og:image.
- [ ] JSON-LD at root + FAQ.
- [ ] Canonical URLs set per page.
- [ ] Sitemap.xml and robots.txt resolve.

**Consistency**
- [ ] All CTAs use the same two primary labels (`Open a sample report`, `See the methodology`) plus tier-specific CTAs on pricing.
- [ ] Footer epigraph appears on every page.
- [ ] Skeptic agent is named explicitly on Home, Methodology, FAQ, and Compare.
- [ ] Header and footer link lists do not diverge (sourced from shared `lib/nav.ts`).

**Final**
- [ ] Screenshot diff `/audit-snapshots/before/` vs `/after/` attached to the PR.
- [ ] Lighthouse on Home, Methodology, Pricing — ≥ 95 Best Practices, ≥ 90 Performance.
- [ ] axe on Home, Methodology, Pricing, Sample Report — zero critical issues.

---

# Recommendations

1. **Ship Wave 1 first** (tokens + primitives + the four marquee replacements). Everything else is incremental polish; the marquee fix is the 10× lift Brandon will feel immediately.
2. **Adopt the brand voice rule (§2.2) as a written editorial standard** checked at PR time. The voice rule is the single most differentiating asset on the site — no competitor speaks in the negative.
3. **Make the marketing surface statically rendered before the next outbound campaign.** A citation-grade product whose homepage shows no body content to crawlers is self-defeating.
4. **Treat the Methodology page as the centerpiece**, not the homepage. Buyers in this category convert on rigor.
5. **Defer changelog/blog/customer-logo strip to Wave 3.** They are accelerants, not foundations.

**Thresholds that would change these recommendations**
- If pre-flight reveals the repo is **not** Next.js (e.g., Astro or Vite), translate `app/` paths to that framework's conventions; design/copy/motion/a11y instructions are unchanged.
- If `framer-motion` is already present, do not add another animation library.
- If a Sample Report surface is already SSR'd, skip §3.8.4 and update copy only.
- If customer logos have confirmed permissions, promote the trust strip from Wave 2 to Wave 1.

---

# Caveats

1. **Direct file enumeration of the attached zip was not possible inside this environment** — there is no tool that unpacks user-uploaded archives in this harness. Every file path in Section 3 follows Next.js 14 App Router convention (which the meta `theme-color: #0f172a` and the founder's own confirmation of the stack make highly likely). The Cursor agent must run the §3.0 pre-flight inventory first; if the repo uses Pages Router or a non-standard layout, translate `app/<route>/page.tsx` to the appropriate equivalent. The design, copy, motion, and a11y instructions are framework-agnostic.
2. **The deployed site is a fully client-rendered SPA.** Direct HTML fetches return only meta tags; web caches had no usable body content at audit time. Page-by-page findings therefore lean on (a) the founder's own detailed enumeration of the components, (b) the verifiable meta description, and (c) conventional IA expectations. Any page that does not yet exist on the live site is flagged in Section 2 as a *new* page to create, not as a current-state defect.
3. **Performance and accessibility numbers (Lighthouse, axe)** were not measurable from outside; the QA checklist in §3.12 captures the thresholds the Cursor agent must hit.
4. **The line "We do not sanitize. We do not debunk by recall. We do not silently smooth contradictions." comes from your own meta description** and is the strongest sentence currently in the project. Surface it as the footer epigraph and let it anchor the voice.
5. **No code is included anywhere in this brief**, per instruction. Every prescriptive statement is descriptive English aimed at a Cursor agent with autonomy. Where ambiguity is encountered, default to the convention named here, log the deviation in PR notes, and continue — do not pause for clarification.