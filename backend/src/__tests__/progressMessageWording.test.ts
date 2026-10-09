/**
 * The progress-wording gate (RJ-013).
 *
 * Every message the backend hands to a progress or status emitter is read by a
 * person on the live progress screen, in the run history and in the run
 * summary export. This test reads the source, collects each of those message
 * strings, and fails on one that uses a nickname for a pipeline role or shows
 * an internal step code.
 *
 * Only the message a person reads is checked. Identifiers, stage ids, substep
 * ids, model-role keys and prompts sent to models keep their names.
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { plainStepName, retrievalProgressLabel } from '../services/reasoning/traceDisplay';

const SRC = join(__dirname, '..');

/** The two retired role nicknames, put together from halves so the words are not spelled in the repository (RJ-017). */
const OLD_RESTATE = `${'Steel'}${'man'}`;
const OLD_CHECKER = `${'Skep'}${'tic'}`;

interface Rule {
  name: string;
  pattern: RegExp;
}

/** Words a progress message never uses, and the shapes of an internal code. */
const RULES: Rule[] = [
  {
    name: 'role nickname',
    pattern: /\b(steel[- ]?man\w*|straw[- ]?man\w*|s[kc]eptic\w*|devil'?s[- ]advocate\w*|red[- ]?team\w*|contrarian\w*|adversar\w*|gadfl\w*)\b/i,
  },
  // RJ-017: the step has one public name, "Double-check".
  { name: 'earlier step name', pattern: /\bchallenge pass\b/i },
  { name: 'internal role name', pattern: /\b(planner|retriever|sleuth|synthesi[sz]er|reasoner|verifier|orchestrator|epistemic)\b/i },
  { name: 'reader wording', pattern: /\bclaims?\b/i },
  // strongest_form_started, run_completed, discovery_round_2_complete, retriever_analysis.
  { name: 'raw step code', pattern: /\b[a-z][a-z0-9]*(_[a-z0-9]+)+\b/ },
];

interface Message {
  file: string;
  line: number;
  text: string;
}

/** Functions whose message argument is shown to a person, and where that argument sits. */
const EMITTERS: Record<string, number> = { progress: 2, emit: 2 };
/** Callbacks that take the message as their only argument, or an object carrying it. */
const MESSAGE_CALLBACKS = new Set(['onProgress', 'emitProgress']);
/** Properties that hold a message for a later emitter call. */
const MESSAGE_PROPERTIES = new Set(['progressMessage', 'progress_message']);

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === 'migrations') continue;
      out.push(...filesUnder(path));
    } else if (name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * The written text of an expression: a string, the fixed parts of a template,
 * both sides of a `?:` or a `+`. A `${value}` is left out, since what it holds
 * is not written here.
 */
function writtenText(node: ts.Node, out: string[]): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' … '));
    for (const span of node.templateSpans) writtenText(span.expression, out);
  } else if (ts.isConditionalExpression(node)) {
    writtenText(node.whenTrue, out);
    writtenText(node.whenFalse, out);
  } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    writtenText(node.left, out);
    writtenText(node.right, out);
  } else if (ts.isParenthesizedExpression(node)) writtenText(node.expression, out);
}

function calleeName(call: ts.CallExpression): string {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return '';
}

/** Every message string passed to a progress or status emitter under `srcDir`. */
export function collectProgressMessages(srcDir: string): Message[] {
  const messages: Message[] = [];
  for (const path of filesUnder(srcDir)) {
    const file = relative(srcDir, path).replace(/\\/g, '/');
    const text = readFileSync(path, 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const add = (node: ts.Node): void => {
      const found: string[] = [];
      writtenText(node, found);
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      for (const one of found) messages.push({ file, line, text: one });
    };
    /** Local functions that pass one of their own parameters on as the message. */
    const forwarders = new Map<string, number>();
    const findForwarders = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        const fn = node.initializer;
        const params = fn.parameters.map((param) => (ts.isIdentifier(param.name) ? param.name.text : ''));
        const inner = (child: ts.Node): void => {
          if (ts.isCallExpression(child) && EMITTERS[calleeName(child)] !== undefined) {
            const arg = child.arguments[EMITTERS[calleeName(child)]];
            if (arg && ts.isIdentifier(arg) && params.includes(arg.text)) {
              forwarders.set(node.name.getText(), params.indexOf(arg.text));
            }
          }
          ts.forEachChild(child, inner);
        };
        inner(fn.body);
      }
      ts.forEachChild(node, findForwarders);
    };
    findForwarders(source);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node);
        // runStage('Analyzing…'), where runStage hands its parameter to progress(…).
        const forwarded = forwarders.get(name);
        if (forwarded !== undefined && node.arguments[forwarded]) add(node.arguments[forwarded]);
        // progress('reasoning', 62, 'message', …) and emit('intake', 5, 'message').
        if (EMITTERS[name] !== undefined && node.arguments.length > EMITTERS[name] && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
          add(node.arguments[EMITTERS[name]]);
        }
        // onProgress('message') and onProgress({ stage, percent, message: '…' }).
        if (MESSAGE_CALLBACKS.has(name) && node.arguments.length > 0) {
          const first = node.arguments[0];
          if (ts.isObjectLiteralExpression(first)) {
            for (const property of first.properties) {
              if (ts.isPropertyAssignment(property) && property.name.getText() === 'message') add(property.initializer);
            }
          } else add(first);
        }
      }
      // { stage: 'starting', percent: 1, message: '…' }: an event written straight to the run's history.
      if (ts.isObjectLiteralExpression(node)) {
        const names = node.properties.map((property) => (property.name ? property.name.getText() : ''));
        if (names.includes('stage') && names.includes('percent') && names.includes('message')) {
          for (const property of node.properties) {
            if (ts.isPropertyAssignment(property) && property.name.getText() === 'message') add(property.initializer);
          }
        }
      }
      // progressMessage: '…' on a plan that an emitter reads later.
      if (ts.isPropertyAssignment(node) && MESSAGE_PROPERTIES.has(node.name.getText())) add(node.initializer);
      ts.forEachChild(node, visit);
    };
    visit(source);

    // progress_message='…' written by a SQL statement.
    for (const match of text.matchAll(/progress_message\s*=\s*'([^']+)'/g)) {
      messages.push({ file, line: text.slice(0, match.index ?? 0).split('\n').length, text: match[1] });
    }
  }
  return messages;
}

/** The rules a message breaks, as `file:line [rule] text`. */
export function progressWordingProblems(messages: Message[]): string[] {
  const problems: string[] = [];
  for (const message of messages) {
    for (const rule of RULES) {
      if (rule.pattern.test(message.text)) problems.push(`${message.file}:${message.line} [${rule.name}] ${message.text}`);
    }
  }
  return problems;
}

/** A throwaway source tree, for showing what the gate does and does not flag. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'progress-wording-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe('the progress-wording gate', () => {
  it('finds the messages the pipeline, the revision service, ingestion and the specialists emit', () => {
    const messages = collectProgressMessages(SRC);
    const inFile = (file: string): string[] => messages.filter((message) => message.file === file).map((message) => message.text);
    expect(inFile('services/reasoning/researchOrchestrator.ts').length).toBeGreaterThan(50);
    expect(inFile('services/reasoning/researchOrchestrator.ts')).toContain('Reasoning across sources...');
    expect(inFile('services/reasoning/researchOrchestrator.ts')).toContain('Restating each finding in its strongest form before checking it...');
    // Passed through a local helper, and written by SQL.
    expect(inFile('services/reasoning/researchOrchestrator.ts')).toContain('Analyzing retrieved evidence...');
    expect(inFile('services/reasoning/researchOrchestrator.ts')).toContain('Starting the run and preparing the research plan...');
    expect(inFile('services/reasoning/reportRevisionService.ts')).toContain('Checking the revised report');
    expect(inFile('services/reasoning/targetedRepair.ts')).toContain('Repairing report content (full pass).');
    expect(inFile('services/reasoning/specialistExecutionService.ts')).toContain('Running specialist analysis:  … ');
    expect(inFile('services/ingestion/ingestionService.ts')).toContain('Fetching source content...');
  });

  it('no message uses a role nickname, an internal role name or a raw step code', () => {
    expect(progressWordingProblems(collectProgressMessages(SRC))).toEqual([]);
  });

  it('the checking step is called "Double-check", and never by its earlier name', () => {
    const texts = collectProgressMessages(SRC).filter((message) => message.file === 'services/reasoning/researchOrchestrator.ts').map((message) => message.text);
    expect(texts.filter((text) => /double-check/i.test(text))).toEqual([
      'Double-check skipped for this run',
      'Double-check: testing the findings against other sources and noting what it finds...',
      'Double-check: testing the findings against other sources and the original records...',
    ]);
    expect(collectProgressMessages(SRC).filter((message) => /challenge pass/i.test(message.text))).toEqual([]);
  });

  it("fails on the messages that were on the live progress screen, and passes over the step's own id", () => {
    const dir = tree({
      'services/pipeline.ts': [
        'declare function progress(stage: string, percent: number, message: string, extra?: { substep: string }): Promise<void>;',
        'export async function run(onProgress: (message: string) => void, agent: string): Promise<void> {',
        "  await progress('reasoning', 50, 'Reasoning across sources...', { substep: 'reasoner_started' });",
        `  await progress('reasoning', 62, '${OLD_RESTATE} pass: strengthening formulations before critique...', { substep: 'strongest_form_started' });`,
        `  await progress('challenge', 65, '${OLD_CHECKER} is arguing against the draft', { substep: 'double_check_started' });`,
        "  await progress('challenge', 66, 'Red-team review (strongest_form_started)');",
        "  await progress('challenge', 67, `Devil\\'s advocate round ${agent} of the adversarial pass`);",
        "  onProgress('Executing specialist: market_scout');",
        "  const strongestFormMode = 'off'; void strongestFormMode;",
        '}',
      ].join('\n'),
    });
    expect(progressWordingProblems(collectProgressMessages(dir)).map((problem) => problem.replace(/^services\/pipeline\.ts:/, ''))).toEqual([
      `4 [role nickname] ${OLD_RESTATE} pass: strengthening formulations before critique...`,
      `5 [role nickname] ${OLD_CHECKER} is arguing against the draft`,
      '6 [role nickname] Red-team review (strongest_form_started)',
      '6 [raw step code] Red-team review (strongest_form_started)',
      "7 [role nickname] Devil's advocate round  …  of the adversarial pass",
      '8 [raw step code] Executing specialist: market_scout',
    ]);
  });

  it('a stage-label map, a stored message and a status write are read too', () => {
    const dir = tree({
      'services/labels.ts': [
        "export const plan = { progressMessage: 'Contrarian review of the plan' };",
        "export const event = { stage: 'starting', percent: 1, message: 'Worker picked up the run; preparing planner...' };",
        "export const sql = `UPDATE research_runs SET progress_message='Gadfly pass queued' WHERE id=$1`;",
        "export const notShown = { role: 'double_check', checkpointKey: 'double_check_output' };",
      ].join('\n'),
    });
    expect(progressWordingProblems(collectProgressMessages(dir)).map((problem) => problem.replace(/^services\/labels\.ts:/, ''))).toEqual([
      '1 [role nickname] Contrarian review of the plan',
      '2 [internal role name] Worker picked up the run; preparing planner...',
      '3 [role nickname] Gadfly pass queued',
    ]);
  });
});

describe('ids inside a progress message', () => {
  it('a step id goes in as words, never as written', () => {
    expect(plainStepName('market_scout')).toBe('market scout');
    expect(plainStepName('data_analysis_specialist')).toBe('data analysis specialist');
    expect(retrievalProgressLabel({ index: 1, total: 2, chunkCount: 3, pass: 'rediscovery' })).toBe('Search 1/2 of your library complete (second search) — 3 passages so far');
  });
});
