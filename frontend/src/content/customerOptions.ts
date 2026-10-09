/**
 * Every name a customer can see or choose, with what it does and one example
 * (RJ-017). This file is the one place those words are written.
 *
 * A screen that shows a report type, a setting, an add-on or a plan reads its
 * name, its one-sentence description and its example from here, by id. The ids
 * are the ones the code, the API and the database already use; only the words
 * live here. Prices are not names and stay with the billing code.
 *
 * Two tests hold this together:
 *  - every entry has a name, a description and an example, and
 *  - a screen cannot offer an option that has no entry here
 *    (`frontend/src/__tests__/wording/customerOptions.test.tsx`).
 */

export type OptionGroup =
  | 'feature'
  | 'verdict'
  | 'report_type'
  | 'research_objective'
  | 'report_format'
  | 'report_length'
  | 'citation_style'
  | 'export_format'
  | 'check_viewpoint'
  | 'request_field'
  | 'plan_field'
  | 'check_timing'
  | 'restatement_style'
  | 'add_on'
  | 'plan';

export interface CustomerOption {
  group: OptionGroup;
  /** The id the code already uses for this thing. Never shown. */
  id: string;
  /** What a customer reads as its name. */
  name: string;
  /** One sentence: what it does for the customer. */
  description: string;
  /** One short, concrete example. */
  example: string;
}

const entry = (group: OptionGroup, id: string, name: string, description: string, example: string): CustomerOption => ({
  group,
  id,
  name,
  description,
  example,
});

export const CUSTOMER_OPTIONS: readonly CustomerOption[] = [
  // ── The checking step ────────────────────────────────────────────────────
  entry(
    'feature',
    'double_check',
    'Double-check',
    'Double-check restates each main finding in its strongest form, then tests it against other sources and the original records, and tells you whether it holds up.',
    "Finding: 'CISA requires paper ballots.' Double-check opens CISA's own document and finds the requirement → Holds up."
  ),

  // ── What Double-check says about a finding ───────────────────────────────
  entry(
    'verdict',
    'holds',
    'Holds up',
    'Other sources and the original records agree with the finding.',
    "Finding: 'CISA requires paper ballots.' CISA's own document states the requirement → Holds up."
  ),
  entry(
    'verdict',
    'contested',
    'Sources disagree',
    'At least one reliable source says something different, and the report shows both sides.',
    "Finding: 'The bridge cost $40 million.' The city audit says $40 million and the contractor's filing says $52 million → Sources disagree."
  ),
  entry(
    'verdict',
    'unsupported_at_primary',
    'No original record found',
    'Articles repeat the finding, but the original document, data or statement behind it could not be found.',
    "Finding: 'The agency banned the additive in 2019.' Ten news articles say so, and no order appears in the agency's own records → No original record found."
  ),
  entry(
    'verdict',
    'open',
    'Still an open question',
    'There is not enough evidence either way yet, so the finding is not stated as a fact.',
    "Finding: 'The new battery lasts 20 years.' Only two years of test data exist → Still an open question."
  ),

  // ── Report types (the plan screen names one for every request) ───────────
  entry(
    'report_type',
    'factual_report',
    'Factual report',
    'Answers a settled question with a clear, sourced explanation.',
    "'What is the Clean Water Act and what does it require?'"
  ),
  entry(
    'report_type',
    'survey',
    'Topic overview',
    'Maps a broad topic part by part, so you can see its main areas and how they connect.',
    "'Give me an overview of how cities are using congestion pricing.'"
  ),
  entry(
    'report_type',
    'adjudication',
    'Fact-check',
    'Tests one specific statement against the evidence and tells you whether it is true.',
    "'Is it true that remote work lowers productivity?'"
  ),
  entry(
    'report_type',
    'investigation',
    'Investigation',
    'Digs into a disputed topic and sets out the evidence on each side.',
    "'Why did the stadium project go 60% over budget?'"
  ),
  entry(
    'report_type',
    'story_verification',
    'Story verification',
    'Checks a news story or account statement by statement against other records.',
    "'Verify this article about the factory closure.'"
  ),
  entry(
    'report_type',
    'opportunity_discovery',
    'Opportunity search',
    'Looks for unmet needs and gaps in a market or field that someone could act on.',
    "'Where are the gaps in software for small dental practices?'"
  ),
  entry(
    'report_type',
    'feasibility',
    'Feasibility check',
    'Weighs whether a plan can work, listing what supports it and what blocks it.',
    "'Can a 20-person company realistically get SOC 2 certified in six months?'"
  ),
  entry(
    'report_type',
    'implementation',
    'Implementation plan',
    'Lays out the steps to carry out a goal, in order, each backed by a source.',
    "'Plan the move of our customer database to a new provider.'"
  ),
  entry(
    'report_type',
    'literature_review',
    'Literature review',
    'Summarizes what published studies say on a topic, in an academic style.',
    "'Review the research on intermittent fasting and blood pressure.'"
  ),
  entry(
    'report_type',
    'comparative',
    'Comparison',
    'Compares several options on the same points, side by side.',
    "'Compare Postgres, MySQL and SQLite for a small web app.'"
  ),
  entry(
    'report_type',
    'how_to',
    'How-to guide',
    'Gives step-by-step instructions for doing a task.',
    "'How do I register a trademark in the United States?'"
  ),
  entry(
    'report_type',
    'recommendation',
    'Recommendation',
    'Recommends one choice for your situation and explains the trade-offs.',
    "'Which accounting software should a five-person nonprofit use?'"
  ),
  entry(
    'report_type',
    'exploratory',
    'Open exploration',
    'Searches widely on a new topic to show you what is out there before you narrow it down.',
    "'What is happening in solid-state battery research?'"
  ),
  entry(
    'report_type',
    'position_brief',
    'Case for a position',
    'Builds the strongest sourced case for a position you name, then sets out the case against it.',
    "'Make the case for a four-day work week.'"
  ),
  entry(
    'report_type',
    'timeline',
    'Timeline',
    'Puts events in date order, each with its source.',
    "'Timeline of the Boeing 737 MAX grounding.'"
  ),
  entry(
    'report_type',
    'reference_lookup',
    'Reference lookup',
    'Finds one fact or definition quickly and cites where it came from.',
    "'What is the boiling point of ethanol?'"
  ),
  entry(
    'report_type',
    'legacy',
    'Earlier report',
    'A report made before report types were introduced; it was handled as a general report.',
    'A report you ran last year, before the plan screen named a report type.'
  ),

  // ── Research objective (request form) ────────────────────────────────────
  entry(
    'research_objective',
    'AUTO',
    'Automatic — ResearchOne selects from the request',
    'ResearchOne picks the objective that fits your request.',
    'You ask an everyday question and it uses General Research.'
  ),
  entry(
    'research_objective',
    'GENERAL_EPISTEMIC_RESEARCH',
    'General Research',
    'Balanced research for most questions: it weighs the sources against each other and reports what they support.',
    "'What are the health effects of microplastics?'"
  ),
  entry(
    'research_objective',
    'INVESTIGATIVE_SYNTHESIS',
    'Investigative Research',
    'Follows the money, the people and the connections behind an event or decision.',
    "'Who funded the campaign against the zoning change, and how are they connected?'"
  ),
  entry(
    'research_objective',
    'NOVEL_APPLICATION_DISCOVERY',
    'Application Discovery',
    'Looks for new practical uses of a known method or technology.',
    "'What else could the sensors used in car airbags be used for?'"
  ),
  entry(
    'research_objective',
    'PATENT_GAP_ANALYSIS',
    'Patent Research and Whitespace Mapping',
    'Surveys existing patents in an area and points out what nobody has patented yet.',
    "'What is already patented in drone battery swapping, and what is still open?'"
  ),
  entry(
    'research_objective',
    'ANOMALY_CORRELATION',
    'Convergence Analysis',
    'Tests whether separate unusual reports share one underlying cause.',
    "'Do these three unexplained equipment failures have a common cause?'"
  ),

  // ── Report format (request form) ─────────────────────────────────────────
  entry(
    'report_format',
    'automatic',
    'Automatic / Best fit',
    'ResearchOne chooses the layout that suits your question.',
    "A 'which is better' question comes back as a comparison table."
  ),
  entry(
    'report_format',
    'ranked_options',
    'Ranked options',
    'Lists the choices from best to worst, with the reason for each place.',
    "'Top five CRMs for a small law firm, ranked.'"
  ),
  entry(
    'report_format',
    'narrative_briefing',
    'Narrative briefing',
    'Explains the topic in flowing prose, like a briefing memo.',
    'A two-page briefing on a new privacy law for your board.'
  ),
  entry(
    'report_format',
    'step_by_step_guide',
    'Step-by-step guide',
    'Sets the answer out as numbered steps to follow.',
    "'1. File form SS-4. 2. Open a business bank account. 3. …'"
  ),
  entry(
    'report_format',
    'comparison_table',
    'Comparison table',
    'Puts the options in a table with the same points compared for each.',
    'Three laptops compared on price, weight and battery life.'
  ),
  entry(
    'report_format',
    'structured_report',
    'Structured report / Technical spec',
    'Uses fixed sections and headings, suited to technical or formal documents.',
    'A requirements document with Scope, Requirements and Risks sections.'
  ),

  // ── Report length (request form) ─────────────────────────────────────────
  entry(
    'report_length',
    'automatic',
    'Automatic (fit the question)',
    'The report is as long as the question needs.',
    'A quick definition gets a page; a broad review gets several.'
  ),
  entry('report_length', 'short', 'Short (~1,200 words)', 'The main findings only.', 'A summary to read before a meeting.'),
  entry(
    'report_length',
    'standard',
    'Standard (~2,200 words)',
    'The findings with their supporting detail.',
    'A typical report on one question.'
  ),
  entry('report_length', 'long', 'Long (~4,000 words)', 'Fuller detail and background.', 'A report covering a topic with several parts.'),
  entry(
    'report_length',
    'extra_long',
    'Extra long (~7,000 words)',
    'The most detail a single report gives.',
    'A full literature review.'
  ),
  entry(
    'report_length',
    'custom',
    'Custom word count…',
    'You set the target length yourself, from 800 to 12,000 words.',
    'You type 3,000 and the report aims for 3,000 words.'
  ),

  // ── Citation style (request form) ────────────────────────────────────────
  entry(
    'citation_style',
    'automatic',
    'Report default',
    'Numbered citations with a reference list at the end.',
    "'…rose 4% in 2023 [2].'"
  ),
  entry(
    'citation_style',
    'numeric',
    'Numbered references',
    'Bracketed numbers in the text with a numbered reference list at the end.',
    "'…rose 4% in 2023 [2].'"
  ),
  entry('citation_style', 'mla', 'MLA (9th ed.)', 'Author and page in the text, common in the humanities.', "'(Smith 42)'"),
  entry('citation_style', 'apa', 'APA (7th ed.)', 'Author and year in the text, common in the social sciences.', "'(Smith, 2021)'"),
  entry(
    'citation_style',
    'chicago-author-date',
    'Chicago — Author/Date',
    'Author and year in the text, in Chicago style.',
    "'(Smith 2021, 42)'"
  ),
  entry(
    'citation_style',
    'chicago-note',
    'Chicago — Notes & Bibliography',
    'Numbered footnotes with a bibliography, common in history.',
    "A small '1' in the text and the source in a note below."
  ),
  entry('citation_style', 'ieee', 'IEEE', 'Bracketed numbers, common in engineering.', "'[1]'"),
  entry('citation_style', 'harvard', 'Harvard', 'Author and year in the text, in Harvard style.', "'(Smith 2021)'"),

  // ── Export file types (report page) ──────────────────────────────────────
  entry('export_format', 'docx', 'Word (.docx)', 'A Word document you can edit.', 'Open it in Microsoft Word or Google Docs to add your own notes.'),
  entry('export_format', 'pdf', 'PDF (.pdf)', 'A fixed-layout file for sharing or printing.', 'Attach it to an email for a client.'),
  entry('export_format', 'md', 'Markdown (.md)', 'A plain-text file with simple formatting marks.', 'Paste it into a wiki or a notes app.'),
  entry('export_format', 'html', 'HTML (.html)', 'A web page file that opens in any browser.', 'Publish it on an internal site.'),

  // ── Whose questions Double-check asks (request form) ─────────────────────
  entry(
    'check_viewpoint',
    'none',
    'No particular viewpoint',
    'ResearchOne chooses the questions to ask from your request.',
    'For most requests you can leave this alone.'
  ),
  entry(
    'check_viewpoint',
    'fda',
    'FDA Compliance Officer',
    'Double-check asks what a drug and device regulator would ask.',
    "'Where is the trial data behind this safety statement?'"
  ),
  entry(
    'check_viewpoint',
    'peer',
    'Hostile Peer Reviewer',
    'Double-check asks what a tough academic reviewer would ask.',
    "'Was the sample large enough to support this conclusion?'"
  ),
  entry(
    'check_viewpoint',
    'defense',
    'Defense Attorney',
    'Double-check questions every finding the way a trial lawyer questions a witness.',
    "'Who actually saw this happen, and where is it written down?'"
  ),
  entry(
    'check_viewpoint',
    'investor',
    'Due-diligence Investor',
    'Double-check asks what an investor would ask before putting money in.',
    "'Is this market size from an independent source or from the company itself?'"
  ),
  entry(
    'check_viewpoint',
    'journalist',
    'Investigative Journalist',
    'Double-check traces each finding back to where it first came from.',
    "'Which original document is this quote from?'"
  ),
  entry(
    'check_viewpoint',
    'custom',
    'Custom viewpoint',
    'You describe whose questions Double-check should ask.',
    "'A city building inspector looking for code violations.'"
  ),

  // ── Request form fields ──────────────────────────────────────────────────
  entry(
    'request_field',
    'question',
    'Your research question or task',
    'What you want to know, find or have written.',
    "'How do heat pumps perform in cold climates?'"
  ),
  entry(
    'request_field',
    'extra_context',
    'Extra context (optional)',
    'Limits, sources that must be used, or what a good answer looks like.',
    "'Focus on Canada, and use government sources where you can.'"
  ),
  entry(
    'request_field',
    'documents_and_links',
    'Documents and links (optional)',
    'Files and web pages of yours that are read alongside the sources we find.',
    'A PDF of your own report and a link to a regulator page.'
  ),
  entry(
    'request_field',
    'crawl_site',
    'Read the linked site, not just the page',
    'Follows links on the same website from each page you add, so related pages are read too.',
    "You add a company's documentation home page and its sub-pages are read as well."
  ),
  entry(
    'request_field',
    'crawl_layers',
    'How many links deep',
    'How far to follow links from the page you added: 2 means the page and the pages it links to.',
    'Set to 3: your page, the pages it links to, and the pages those link to (at most 50 pages).'
  ),
  entry(
    'request_field',
    'output_preferences',
    'What the report should look like',
    'Optional choices for the objective, layout, length and citation style of the report.',
    'A long report in APA style with a comparison table.'
  ),
  entry(
    'request_field',
    'research_objective',
    'Research Objective',
    'The kind of research to do; leave it on Automatic unless you want a particular one.',
    'Choose Investigative Research to follow the money behind a decision.'
  ),
  entry(
    'request_field',
    'report_format',
    'Report Format',
    'How the report is laid out; you can pick more than one.',
    'Pick Comparison table and Ranked options together.'
  ),
  entry('request_field', 'report_length', 'Report Length', 'About how long the report should be.', 'Short for a quick summary, Long for a detailed report.'),
  entry(
    'request_field',
    'citation_style',
    'Citation Style',
    'How sources are cited in the text and listed at the end.',
    'Choose APA for a psychology paper.'
  ),
  entry(
    'request_field',
    'sources_and_check',
    'Sources and Double-check',
    'Optional choices about which sources are used and whose questions Double-check asks.',
    'Use only your documents tagged "oncology" and have a regulator’s questions asked.'
  ),
  entry(
    'request_field',
    'check_viewpoint',
    'Double-check viewpoint (optional)',
    'Whose questions the findings must stand up to; leave it alone and we choose from your request.',
    'Pick Defense Attorney to have every finding questioned like a witness.'
  ),
  entry(
    'request_field',
    'library_tags',
    'Limit your own library to these tags (optional)',
    'Uses only the documents in your library that carry these tags.',
    "'biology, oncology'"
  ),
  entry(
    'request_field',
    'saved_run_settings',
    'Saved run settings (optional)',
    'Starts the plan from settings you saved earlier; you still see the plan before anything runs.',
    "Your saved 'EU regulation' settings."
  ),
  entry(
    'request_field',
    'models',
    'Which models do the work',
    'Lets you choose the AI model for each step of this run; the defaults work without changes.',
    'Use a different model for report writing on this run only.'
  ),
  entry(
    'request_field',
    'backup_model',
    'Backup model',
    'A second model that takes over a step if the first one fails.',
    'The first model times out and the backup finishes the step.'
  ),
  entry(
    'request_field',
    'run_enhancements',
    'Run enhancements',
    'Paid extras you can switch on for this one run.',
    'Switch on Parallel Search for a wider search on this run.'
  ),

  // ── Plan screen fields ───────────────────────────────────────────────────
  entry(
    'plan_field',
    'report_type',
    'Report type',
    'The kind of report we think you asked for; you can change it before anything runs.',
    "'Is it true that…' is read as a Fact-check."
  ),
  entry(
    'plan_field',
    'confidence',
    'How sure we are',
    'How confident we are that we picked the right report type.',
    'High (92%) means the request clearly matched one report type.'
  ),
  entry(
    'plan_field',
    'check_approach',
    'How findings are checked',
    'When and how Double-check is applied to this report.',
    'Before the report is written, with each finding restated in its strongest form.'
  ),
  entry(
    'plan_field',
    'topic_read',
    'What we understood',
    'Our reading of your topic, so you can catch a misunderstanding before the run.',
    "'A comparison of three database systems for a small web app.'"
  ),
  entry(
    'plan_field',
    'research_fit',
    'How well we can research this',
    'A plain note on whether this topic suits research from published sources, and what may be hard to find.',
    "'Recent court filings may not be online yet.'"
  ),
  entry(
    'plan_field',
    'plan_changes',
    'Changes made to this plan',
    'How many times you have asked for the plan to be changed.',
    '2 means you changed the plan twice.'
  ),
  entry(
    'plan_field',
    'change_report_type',
    'I meant a different report type',
    'Pick the report type you wanted and the plan is redone for it.',
    'Change a Factual report to an Investigation.'
  ),
  entry(
    'plan_field',
    'refine_plan',
    'Change the plan (optional)',
    'Tell us in your own words what to change, and the plan is rewritten.',
    "'Use primary sources over news, and cover the EU only.'"
  ),
  entry(
    'plan_field',
    'save_settings',
    'Save these settings',
    'Keeps this plan’s settings under a name so you can start a later request from them.',
    "Saved as 'EU regulation — overview'."
  ),
  entry(
    'plan_field',
    'confirm',
    'Confirm & run',
    'Starts the research exactly as the plan describes.',
    'You press it and the search begins.'
  ),
  entry(
    'plan_field',
    'cancel',
    'Cancel and edit request',
    'Stops here; nothing is searched and you return to your request to edit it.',
    'You spot a typo in your question and cancel to fix it.'
  ),
  entry(
    'plan_field',
    'deliverables',
    'What you will get',
    'The pieces the finished report will contain.',
    'A summary, a comparison table and a reference list.'
  ),
  entry(
    'plan_field',
    'work_steps',
    'Who does the work',
    'The steps that will run for this report and what each one does.',
    'Source reading, Evidence analysis, Double-check, Report writing.'
  ),
  entry(
    'plan_field',
    'assumptions',
    'Assumptions',
    'What we assumed about your request; edit any that are wrong.',
    "'You want sources from the last five years.'"
  ),

  // ── When Double-check runs (shown on the plan screen) ────────────────────
  entry(
    'check_timing',
    'annotate',
    'Double-check, with its notes shown beside the report',
    'The findings are tested and what the test found is shown as notes next to the report.',
    'A note beside a finding: "A second source gives a lower figure."'
  ),
  entry(
    'check_timing',
    'gate',
    'Double-check before the report is written',
    'The findings are tested first, and the report is written from what stood up.',
    'A finding with no original record is reported as unconfirmed.'
  ),
  entry(
    'check_timing',
    'off',
    'No separate Double-check',
    'An earlier report that was written without the separate checking step.',
    'A report made before Double-check ran on every report.'
  ),

  // ── How findings are restated before they are tested ─────────────────────
  entry(
    'restatement_style',
    'standard',
    'Each finding restated in its strongest form before it is tested',
    'So the test is against the best version of the finding, not a weak one.',
    '"Prices rose" is restated as "Prices rose 4% in 2023, per the national statistics office" and then tested.'
  ),
  entry(
    'restatement_style',
    'per_option',
    'Each option restated in its strongest form before it is tested',
    'In a comparison, every option gets its best case before any is tested.',
    'The best case for each of three databases is written before they are compared.'
  ),
  entry(
    'restatement_style',
    'as_product',
    'The strongest case for the position is the report',
    'For a Case for a position report, the best-supported argument is what you receive.',
    'A report that makes the case for a four-day work week.'
  ),
  entry(
    'restatement_style',
    'symmetric',
    'The strongest case for each side, then the case against it',
    'Both sides of a dispute get their best version before either is tested.',
    'The best case that the project was mismanaged, and the best case that costs simply rose.'
  ),
  entry(
    'restatement_style',
    'off',
    'Findings are tested as written',
    'The findings are tested without being restated first.',
    'A quick lookup of one fact.'
  ),

  // ── Add-ons ──────────────────────────────────────────────────────────────
  entry(
    'add_on',
    'living_report',
    'Living Reports',
    'Keeps a finished report up to date: when new sources change the picture, the report is revised for you.',
    'A new study is published in March and your January report is updated to include it.'
  ),
  entry(
    'add_on',
    'reverse_citation_watch',
    'Reverse-Citation Watch',
    'Tells you when a paper, patent or policy document cites work that appears in your report.',
    'A new patent cites a study from your report and you get a notice.'
  ),
  entry(
    'add_on',
    'parallel_search',
    'Parallel Search',
    'Lets one research run read more newly found sources than usual before it writes.',
    'A run that would stop adding new sources keeps going and reads up to 17.'
  ),
  entry(
    'add_on',
    'parallel_extract',
    'Parallel Extract',
    'Gathers more passages from the sources on one run, so the report draws on more of what was read.',
    '25 passages are gathered for each part of the report instead of 15.'
  ),
  entry(
    'add_on',
    'smart_citations',
    'Smart Citations',
    'Matches each citation against twice as many passages on one run, so citations point to the right source more often.',
    'Each citation is matched against 40 passages instead of 20.'
  ),
  entry(
    'add_on',
    'provenance_ledger',
    'Provenance Ledger',
    'Keeps a dated record of every source read, every step taken and every export made, which cannot be edited afterwards.',
    'An auditor asks how a figure got into a report and the record shows each step.'
  ),
  entry(
    'add_on',
    'score_api_pro',
    'Score API Pro',
    'Lets your own software send documents to ResearchOne for compliance and policy scoring.',
    'Your system submits 200 policies overnight and receives a score for each.'
  ),
  entry(
    'add_on',
    'patent_ip_diligence',
    'Patent & IP Diligence',
    'A commissioned study of the patents around your product: what exists, what you may use, and earlier inventions.',
    'Before a launch, a report on which existing patents your design might touch.'
  ),

  // ── Plans ────────────────────────────────────────────────────────────────
  entry(
    'plan',
    'free_demo',
    'Free Demo',
    'Lets you try ResearchOne with two reports at no cost.',
    'You sign up and run two General Research reports for free.'
  ),
  entry(
    'plan',
    'student',
    'Student',
    'A lower-priced monthly plan for verified students.',
    'A student verifies enrolment and gets a monthly report allowance.'
  ),
  entry(
    'plan',
    'wallet',
    'Wallet credits',
    'Pay for each report as you go from a prepaid balance, with no subscription.',
    'You add $20 and each report is paid for from that balance.'
  ),
  entry(
    'plan',
    'pro',
    'Pro',
    'A monthly allowance of reports with every research objective and your own private document library.',
    'A consultant who runs a few reports every week.'
  ),
  entry(
    'plan',
    'byok',
    'BYOK',
    'Bring your own keys: you connect your own AI provider accounts, pay them for usage, and run as many reports as you like.',
    'You paste in your OpenRouter key and reports run on your own account.'
  ),
];

const BY_KEY: ReadonlyMap<string, CustomerOption> = new Map(CUSTOMER_OPTIONS.map((option) => [`${option.group}:${option.id}`, option]));

/** The entry for an id, or undefined when the registry has none. */
export function findCustomerOption(group: OptionGroup, id: string | null | undefined): CustomerOption | undefined {
  return id == null ? undefined : BY_KEY.get(`${group}:${id}`);
}

/** The entry for an id the code itself names. A missing one is a programming error, caught by the registry test. */
export function customerOption(group: OptionGroup, id: string): CustomerOption {
  const found = BY_KEY.get(`${group}:${id}`);
  if (!found) throw new Error(`customerOptions: no entry for ${group}:${id}`);
  return found;
}

/** Every entry of a group, in the order written above. */
export function customerOptionsIn(group: OptionGroup): CustomerOption[] {
  return CUSTOMER_OPTIONS.filter((option) => option.group === group);
}

/** A name for an id, or the words of the id itself when the registry has none (an id is never shown raw). */
export function customerOptionName(group: OptionGroup, id: string | null | undefined): string {
  const found = findCustomerOption(group, id);
  if (found) return found.name;
  const words = (id ?? '').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** "What it does. Example: …" — the help text shown next to an option. */
export function customerOptionHelp(option: Pick<CustomerOption, 'description' | 'example'>): string {
  return `${option.description} Example: ${option.example}`;
}

/** The checking step, as every screen names and describes it. */
export const DOUBLE_CHECK: CustomerOption = customerOption('feature', 'double_check');
