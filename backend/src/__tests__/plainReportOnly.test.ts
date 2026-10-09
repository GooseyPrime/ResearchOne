/**
 * The plain report is the only report (Brandon, 8 Oct 2026).
 *
 * Guards that fail on the layout that was removed:
 *  (a) nothing the synthesis stage can be handed as a template, an outline or a
 *      writing instruction names a section of the old layout or carries its
 *      stock sentences;
 *  (c) with every old switch set to "false", in the process and for the run, a
 *      report of every type is still written to the reader layout, and what a
 *      route sends is still presented for a reader.
 * The frontend half (what the page shows) is in
 * frontend/src/__tests__/reader/plainReportOnly.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callRoleModelMock = vi.hoisted(() => vi.fn());

vi.mock('../services/openrouter/openrouterService', async (original) => ({
  ...(await original<typeof import('../services/openrouter/openrouterService')>()),
  callRoleModel: callRoleModelMock,
}));

import * as config from '../config';
import { runWithFlags } from '../config';
import { MODE_OVERLAYS } from '../constants/modeOverlays';
import { forReader } from '../api/readerResponse';
import { INTENT_OUTPUT_TEMPLATES } from '../services/formatting/templates/intentOutputTemplates';
import { readerStatus } from '../services/formatting/readerEvidence';
import { cleanReaderMetadata, presentSectionForReader, stripInternalLabelsFromReport } from '../services/formatting/reportPresentation';
import { acceptedFlagOverride } from '../services/eval/flagOverride';
import { HARNESS_FLAG_NAMES, RETIRED_FLAG_NAMES } from '../services/eval/harnessFlags';
import {
  REPORT_WRITING_ROLES,
  STANDARD_SYSTEM_PROMPTS,
  SYSTEM_PROMPTS,
  buildVerifierPromptForIntent,
  getSystemPrompt,
} from '../services/openrouter/openrouterService';
import { readerSections } from '../services/reasoning/baselineReport';
import { CHALLENGE_PASS_TITLE, CHALLENGE_PASS_WRITER_PROMPT, appendChallengePass, cleanChallengePass, writeChallengePass } from '../services/reasoning/challengePass';
import { OUTLINE_HEADING_INSTRUCTION, appendRequestedFormatSections, generateIterativeReport } from '../services/reasoning/reportGenerator';
import { buildReaderFrontMatter } from '../services/reasoning/researchOrchestrator';
import { describeGateFailure } from '../services/reasoning/runStatusDisplay';
import type { LockedPassage } from '../services/reasoning/citationLock';

vi.mock('../services/auth/adminAllowlist', () => ({ isAllowlistedAdminUserId: (id: string | null | undefined) => id === 'admin' }));

/** Named by the order. Exact words: a section name of the old layout, or one of its stock sentences. */
const NEVER_IN_AN_INSTRUCTION = [
  'Framing',
  'Primary Evidence',
  'Contested Zones',
  'Unresolved',
  'Falsification',
  'Contradictions',
  'evidence chunks',
  'conditional on corpus coverage',
] as const;

/** A heading is checked in any case and spelling: a section key such as `contested_zones` becomes a heading. */
const NEVER_A_HEADING = /fram(?:e|ing)\b|primary[ _]evidence|contested[ _]zones?|unresolved|falsif|contradiction|evidence[ _]ledger|case[ _](?:for|against)|verdict/i;

const INTENTS = Object.values(INTENT_OUTPUT_TEMPLATES).map((template) => template.intentId);
const OLD_SWITCHES = ['BASELINE_LAYER_ENABLED', 'CITATION_LOCK_ENABLED', 'READER_VIEW_ENABLED'] as const;
const ALL_OFF = Object.fromEntries(OLD_SWITCHES.map((name) => [name, false]));

type RoleCall = { role: string; isAdjudicative?: boolean; baselineLayer?: boolean; messages: Array<{ role: string; content: string }> };
const calls = (): RoleCall[] => callRoleModelMock.mock.calls.map((call) => call[0] as RoleCall);

function answerLikeAWriter(): void {
  callRoleModelMock.mockImplementation(async (call: RoleCall) => {
    if (call.role === 'outline_architect') {
      return { content: JSON.stringify({ title: 'Harbour contract records', outline: ['Opening of the tender', 'Award and amendments'] }) };
    }
    if (call.role === 'section_drafter') {
      const prompt = call.messages[1]?.content ?? '';
      if (prompt.startsWith('Section to draft: Key findings')) return { content: '- The tender opened in March 2019 [P1].\n- One bidder was named [P1].\n- The dates differ between two records [P1].' };
      return { content: 'The port authority opened the tender in March 2019 [P1].' };
    }
    return { content: '' };
  });
}

const PASSAGE: LockedPassage = {
  marker: 'P1',
  chunkId: 'chunk-1',
  sourceId: 'source-1',
  text: 'The port authority opened the tender on 4 March 2019 and named one bidder in the award notice.',
  source: { title: 'Award notice 2019/44', publisher: 'Port Authority', date: '2019-06-01', url: 'https://example.org/notice' },
} as LockedPassage;

async function writeReport(intentId: string, extra: Partial<Parameters<typeof generateIterativeReport>[0]> = {}) {
  return generateIterativeReport({
    query: 'Investigate whether the 2019 port tender was awarded properly',
    plan: { hypothesis: 'The tender was awarded properly' },
    sourceContext: 'CHUNK 1: The port authority opened the tender on 4 March 2019.',
    retrieverAnalysis: 'analysis',
    reasoningChains: 'reasoning',
    challenges: 'The award rests on one notice.',
    intentId,
    outputTemplateId: `intent_${intentId}`,
    lockedPassages: [PASSAGE],
    ...extra,
  });
}

beforeEach(() => {
  callRoleModelMock.mockReset();
  answerLikeAWriter();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('(a) every template, outline and instruction the synthesis stage can use', () => {
  const expectClean = (text: string, where: string): void => {
    for (const word of NEVER_IN_AN_INSTRUCTION) expect(text, `${where}: "${word}"`).not.toContain(word);
  };

  it.each(Object.values(INTENT_OUTPUT_TEMPLATES).map((template) => [template.id, template] as const))('%s carries none of the old layout', (id, template) => {
    expectClean(JSON.stringify(template), id);
    // Its section ids are labels kept in metadata; none would read as an old heading if it were ever printed.
    for (const section of template.sections) expect(section, `${id} section id`).not.toMatch(NEVER_A_HEADING);
    expect(template.itemLabel, `${id} item label`).not.toMatch(/claim/i);
  });

  it.each([...INTENTS, undefined])('the section plan for %s is the reader plan, with no old heading', (intentId) => {
    const plan = readerSections(intentId);
    expect(plan[0].title).toBe('Summary');
    expect(plan.map((section) => section.title).slice(-2)).toEqual(['References', 'About this report']);
    for (const section of plan) {
      expect(`${section.key} ${section.title}`, String(intentId)).not.toMatch(NEVER_A_HEADING);
      expectClean(section.title, `plan for ${String(intentId)}`);
    }
    // Whatever format the form asks for, what is added is not an old heading either.
    const withFormats = appendRequestedFormatSections(plan, ['ranked_options', 'narrative_briefing', 'step_by_step_guide', 'comparison_table', 'structured_report']);
    for (const section of withFormats) expect(`${section.key} ${section.title}`).not.toMatch(NEVER_A_HEADING);
  });

  it('the roles that write and check a report have one prompt each, and it carries none of the old layout', () => {
    expect([...REPORT_WRITING_ROLES].sort()).toEqual(['coherence_refiner', 'outline_architect', 'plain_language_synthesizer', 'section_drafter', 'synthesizer', 'verifier']);
    for (const role of REPORT_WRITING_ROLES) {
      expect(getSystemPrompt(role, true), role).toBe(getSystemPrompt(role, false));
      expect(SYSTEM_PROMPTS[role], role).toBe(STANDARD_SYSTEM_PROMPTS[role]);
      expectClean(getSystemPrompt(role, true), `prompt of ${role}`);
    }
    expectClean(OUTLINE_HEADING_INSTRUCTION, 'outline instruction');
    expectClean(CHALLENGE_PASS_WRITER_PROMPT, 'challenge pass writer');
    expectClean(SYSTEM_PROMPTS.contract_auditor, 'contract check');
    expectClean(SYSTEM_PROMPTS.final_revision_verifier, 'revision check');
    expectClean(SYSTEM_PROMPTS.section_rewriter, 'section rewriter');
  });

  it.each(INTENTS)('the check of a %s report asks for none of the old layout, under either method', (intentId) => {
    for (const challengeMethod of [true, false]) {
      expectClean(buildVerifierPromptForIntent(intentId, challengeMethod), `verifier for ${intentId}`);
    }
  });

  it('no research mode adds an old-layout instruction to a writing role', () => {
    for (const [mode, overlays] of Object.entries(MODE_OVERLAYS)) {
      for (const role of ['synthesizer', 'outline_architect', 'plain_language_synthesizer', 'verifier'] as const) {
        expectClean(overlays[role] ?? '', `${mode} ${role}`);
      }
    }
  });

  it.each(INTENTS.filter((intentId) => intentId !== 'legacy'))('what the writer of a %s report is actually sent carries none of the old layout', async (intentId) => {
    await writeReport(intentId, { isAdjudicative: true, requestedFormats: ['structured_report'] });
    const sent = calls().filter((call) => call.role !== 'internal_challenger');
    expect(sent.length).toBeGreaterThan(3);
    for (const call of sent) {
      for (const message of call.messages) expectClean(message.content, `${intentId} ${call.role} ${message.role} message`);
      // Written with the baseline handling, never as part of the challenge method.
      expect(call.isAdjudicative, `${intentId} ${call.role}`).toBe(false);
      expect(call.baselineLayer, `${intentId} ${call.role}`).toBe(true);
    }
    const outline = sent.find((call) => call.role === 'outline_architect');
    expect(outline?.messages[1].content).toContain(OUTLINE_HEADING_INSTRUCTION);
    const required = /Required sections:\n([\s\S]*?)\nTemplate narrative guidance:/.exec(outline?.messages[1].content ?? '')?.[1] ?? '';
    expect(required).toContain('- Summary');
    expect(required).not.toMatch(NEVER_A_HEADING);
  });
});

describe('(c) with every old switch set to "false", the plain layout is still what is written and sent', () => {
  const setEverySwitchOff = (): void => {
    for (const name of OLD_SWITCHES) vi.stubEnv(name, 'false');
  };

  it('the switches are gone: nothing reads them, and an override naming one is dropped', () => {
    for (const name of ['baselineLayerEnabled', 'citationLockEnabled', 'readerViewEnabled']) {
      expect(name in config, name).toBe(false);
    }
    for (const name of OLD_SWITCHES) {
      expect(HARNESS_FLAG_NAMES as readonly string[]).not.toContain(name);
      expect(RETIRED_FLAG_NAMES).toContain(name);
    }
    expect(acceptedFlagOverride('admin', { flagOverrides: ALL_OFF })).toBeNull();
    expect(acceptedFlagOverride('admin', { flagOverrides: { ...ALL_OFF, AUTHORITY_TIERS_ENABLED: true } })).toEqual({ AUTHORITY_TIERS_ENABLED: true });
  });

  it.each(['investigation', 'adjudication', 'story_verification', 'factual_report', 'survey', 'reference_lookup'])(
    'a %s report is written to the reader layout, cited by the lock',
    async (intentId) => {
      setEverySwitchOff();
      const report = await runWithFlags(ALL_OFF, () => writeReport(intentId, { isAdjudicative: true }));
      const headings = [...report.markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]);
      expect(report.markdown.startsWith('# Harbour contract records\n')).toBe(true);
      expect(headings.slice(0, 2)).toEqual(['Summary', 'Key findings']);
      expect(headings).toContain('Limits of this report');
      for (const heading of headings) expect(heading, intentId).not.toMatch(NEVER_A_HEADING);
      for (const word of NEVER_IN_AN_INSTRUCTION) expect(report.markdown, word).not.toContain(word);
      // The lock is on: the writer was shown the passage under its marker and cited by it.
      const drafter = calls().find((call) => call.role === 'section_drafter');
      expect(drafter?.messages[1].content).toContain('[P1]');
      expect(report.markdown).toContain('[P1]');
    }
  );

  it('a route still sends report text presented for a reader', () => {
    setEverySwitchOff();
    const stored = { title: 'A report', executive_summary: 'Costs rose [Strong_Evidence].', sections: [{ title: 'Framing', content: 'Framing\n\nCosts rose (strong_evidence).' }] };
    const sent = runWithFlags(ALL_OFF, () => forReader(stored));
    expect(sent).not.toBe(stored);
    expect(JSON.stringify(sent)).not.toMatch(/strong_evidence/i);
  });
});

describe('a report saved in the removed layout is sent under reader headings', () => {
  it('maps each old heading, prints it once, and marks old challenge sections for the Double-check tab', () => {
    const present = (title: string, content = `## ${title}\n\nText.`) => presentSectionForReader({ title, content, section_type: 'body' });
    expect(present('Framing')).toEqual({ title: 'Background', content: 'Text.', section_type: 'body' });
    expect(present('Primary Evidence').title).toBe('What the sources show');
    expect(present('Contested Zones').title).toBe('Where sources disagree');
    expect(present('Unresolved').title).toBe('Open questions');
    expect(present('Unresolved Questions', '**Unresolved Questions:**\nText.')).toEqual({ title: 'Open questions', content: 'Text.', section_type: 'body' });
    expect(present('Falsification Criteria')).toEqual({ title: 'What would change these findings', content: 'Text.', section_type: 'challenge' });
    expect(present('Challenges and Alternative Explanations').section_type).toBe('challenge');
    // A subject heading that merely uses one of the words is the report's own and is left alone.
    expect(present('Unresolved border disputes of the 1990s').title).toBe('Unresolved border disputes of the 1990s');
    expect(present('How the costs grew').title).toBe('How the costs grew');
  });

  it('takes the stock sentences and the cards out of what a reader is sent', () => {
    const summary =
      'This report synthesizes evidence from 7 sources and 26 evidence chunks to evaluate the core research question. Costs doubled. The current evidence set does not surface explicit contradiction pairs, but conclusions remain conditional on corpus coverage.';
    expect(stripInternalLabelsFromReport(summary).trim()).toBe('Costs doubled.');
    const metadata = cleanReaderMetadata({
      reader_front_matter: { overall_summary: summary, conclusions_nutshell: '', metric_glosses: [{ label: 'Contradictions', value: '0', narrative: 'No explicit claim conflicts were detected' }] },
    });
    expect(metadata.reader_front_matter.metric_glosses).toEqual([]);
    expect(metadata.reader_front_matter.overall_summary.trim()).toBe('Costs doubled.');
  });

  it('a new report gets no card and no sentence written by code', () => {
    expect(buildReaderFrontMatter({ executiveSummary: '', conclusion: '' })).toEqual({ overall_summary: '', conclusions_nutshell: '', metric_glosses: [] });
    expect(buildReaderFrontMatter({ executiveSummary: 'Costs doubled [1].', conclusion: '' })).toEqual({ overall_summary: 'Costs doubled [1].', conclusions_nutshell: '', metric_glosses: [] });
  });
});

describe('challenge material is one plain section named "Double-check"', () => {
  const PROSE = 'Two of the three findings rest on a single award notice. A published evaluation sheet would change the account of the award.';

  it('is written from the notes of the challenge stage, by a call that is not part of the challenge method', async () => {
    callRoleModelMock.mockReset();
    callRoleModelMock.mockResolvedValue({ content: `## Challenge pass\n\n${PROSE} [2]` });
    const result = await writeChallengePass({ query: 'q', reportMarkdown: '# T\n\n## Summary\nText [1].', challengeNotes: 'The claim rests on one notice.' });
    expect(result).toMatchObject({ prose: PROSE, reason: null });
    const call = calls()[0];
    expect(call.role).toBe('plain_language_synthesizer');
    expect(call.isAdjudicative).toBe(false);
    expect(call.baselineLayer).toBe(true);
    expect(call.messages[0].content).toBe(CHALLENGE_PASS_WRITER_PROMPT);
    const report = appendChallengePass('# T\n\n## Summary\nText [1].\n\n## About this report\n1 source was read.', PROSE);
    expect(report.endsWith(`## ${CHALLENGE_PASS_TITLE}\n\n${PROSE}\n`)).toBe(true);
    expect(CHALLENGE_PASS_TITLE).toBe('Double-check');
  });

  it('never reaches a reader as an argument between sides: banned wording is reworded or the section is not shown', async () => {
    expect(cleanChallengePass('The verdict was falsified by a later audit.')).toBe('The finding was disproved by a later audit.');
    expect(cleanChallengePass('### Weak points\nOne source [P3].')).toBe('**Weak points**\nOne source.');
    expect(cleanChallengePass('These claims rest on one notice.')).toBe('These statements rest on one notice.');
    // The two retired nicknames are put together from halves (RJ-017).
    for (const text of [`The ${'skep'}${'tic'} notes one source.`, 'A red-team review found gaps.', `The ${'steel'}${'man'} version holds.`, 'An adversarial reading differs.', '']) {
      expect(cleanChallengePass(text), text).toBeNull();
    }
    callRoleModelMock.mockReset();
    callRoleModelMock.mockResolvedValue({ content: `The ${'skep'}${'tic'} says the claims fail.` });
    const refused = await writeChallengePass({ query: 'q', reportMarkdown: 'r', challengeNotes: 'notes' });
    expect(refused).toMatchObject({ prose: null, reason: 'wording' });
    expect(callRoleModelMock).toHaveBeenCalledTimes(2);
  });

  it('a failure is contained: no section, a reason, and nothing thrown', async () => {
    callRoleModelMock.mockReset();
    callRoleModelMock.mockRejectedValue(new Error('both models failed'));
    await expect(writeChallengePass({ query: 'q', reportMarkdown: 'r', challengeNotes: 'notes' })).resolves.toMatchObject({ prose: null, reason: 'writer_failed' });
    await expect(writeChallengePass({ query: 'q', reportMarkdown: 'r', challengeNotes: '  ' })).resolves.toMatchObject({ prose: null, reason: 'no_notes' });
  });
});

describe('a status is plain words wherever a person reads it', () => {
  it('says each outcome in words and never prints the stored value', () => {
    expect(readerStatus({ reportStatus: 'finalized', gateStatus: 'completed' })).toEqual({ word: 'Ready', reason: null });
    expect(readerStatus({ reportStatus: 'under_review', gateStatus: 'completed_degraded' }).word).toBe('Finished with fewer sources than planned');
    expect(readerStatus({ reportStatus: 'under_review', gateStatus: 'contract_failed' }).word).toBe('Needs review');
    expect(readerStatus({ reportStatus: 'under_review' }).word).toBe('Needs review');
    const RAW = /under_review|completed_degraded|contract_failed|verification_failed|no_evidence|degraded|corpus|gate|synthesis|_/i;
    for (const gate of ['completed_degraded', 'contract_failed', 'verification_failed', 'no_evidence'] as const) {
      const status = readerStatus({ reportStatus: 'under_review', gateStatus: gate });
      expect(`${status.word} ${status.reason ?? ''}`, gate).not.toMatch(RAW);
      expect(describeGateFailure(gate), gate).not.toMatch(RAW);
    }
  });
});
