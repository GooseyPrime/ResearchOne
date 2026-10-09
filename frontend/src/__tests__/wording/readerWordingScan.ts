/**
 * Finds reader-facing text in the frontend source that uses a word the report
 * standard keeps away from readers (upgrade plan, section 2a and slice 5 item 8).
 *
 * Only text a person can see is read: JSX text and string literals that are
 * prose. Identifiers, object keys, API field names, routes, class names and
 * test ids are never read, so `claim_count` and `evidence_tier` are untouched.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface WordingHit {
  file: string;
  line: number;
  text: string;
  word: string;
}

/** Words a reader never sees, with the reason in the name. */
export const BANNED: Array<{ name: string; pattern: RegExp }> = [
  { name: 'counter-claim', pattern: /\bcounter-?claims?\b/gi },
  { name: 'claim', pattern: /\bclaims?\b/gi },
  // "Tier 2", "Tier-1", "Tier 1–4", "tier (1–4)".
  { name: 'tier number', pattern: /\btiers?[ -]?\(?[1-4]\b/gi },
  { name: 'grade label', pattern: /\b(established[_ ]fact|strong[_ ]evidence|testimony[- ]tier)\b/gi },
  // RJ-013: no nickname for a pipeline role or pass. The step is "Double-check" (RJ-017).
  { name: 'role nickname', pattern: /\b(steel[- ]?man\w*|straw[- ]?m[ae]n\w*|s[kc]eptic\w*|devil['’]?s[- ]advocate\w*|red[- ]?team\w*|contrarian\w*|adversar\w*|gadfl\w*)\b/gi },
  // RJ-018: the searching step was shown under a slang nickname on the run page. It is "Search".
  { name: 'slang step name', pattern: /\bsleuth\w*\b/gi },
  // RJ-017: the checking step has one public name, "Double-check". Its earlier name is not shown.
  { name: 'earlier step name', pattern: /\bchallenge pass\b/gi },
  // RJ-013: an internal step code ("strongest_form_started", "stage_skipped", "query_done") is never text.
  // The codes end in what the step did; a column name or a class name ("discovered_by_run_id") is not one.
  { name: 'raw step code', pattern: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(started|completed|complete|done|running|skipped|ready|waiting|fallback|generated|parsed|merged|adjusted|exhausted|annotate)\b/g },
  { name: 'raw status', pattern: /\b(under_review|plan_pending_confirmation|contract_failed|verification_failed|completed_degraded)\b/g },
];

/**
 * A grade word used as a label: the whole text, or the tag after a dash or a
 * dot ("Finding 3: … — Speculation"). In a sentence these are ordinary words
 * ("an inference from the data") and are not read as labels.
 */
const GRADE_LABEL = /^(?:.*[—–·:|-]\s*)?(Testimony|Inference|Speculation)$/;

/** A string literal a person reads: it has a space in it, or it is a capitalised word on its own (a label). */
function isProse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;
  if (/\s/.test(trimmed)) return !/^[a-z0-9_./:[\]#-]+(\s+[a-z0-9_./:[\]#-]+)*$/.test(trimmed) || /[.!?]$/.test(trimmed) || /[A-Z]/.test(trimmed);
  return /^[A-Z][a-z]+s?$/.test(trimmed);
}

/** Attributes that are never shown: structure, styling and wiring. */
const MARKUP_ATTRIBUTE = /^(className|class|style|id|key|href|to|src|srcSet|d|viewBox|fill|stroke|role|type|name|htmlFor|rel|target|method|action|variant|size|color|tone|mode|kind|as|lang|dir|autoComplete|inputMode|pattern|accept|data-.+|on[A-Z].*)$/;
/** Attributes that are always shown, whatever their value looks like. */
const DISPLAY_ATTRIBUTE = /^(aria-label|aria-description|title|alt|placeholder|label|description|narrative|caption|heading|subheading|tooltip|helperText|emptyText|text)$/;

type Context = 'rendered' | 'display' | 'maybe' | 'markup';

/**
 * Where a string literal sits.
 *  - rendered: a child of an element (`{'claims'}`), shown exactly as written.
 *  - display: an attribute that is always shown (`aria-label`, `label`).
 *  - maybe: another attribute or an ordinary value; shown only if it reads as prose (`value="Claims"`).
 *  - markup: a class list, a key, a comparison, a route: never shown.
 */
function contextOf(node: ts.Node, text: string): Context {
  let parent: ts.Node | undefined = node.parent;
  if (parent && ts.isJsxAttribute(parent)) {
    const name = parent.name.getText();
    if (DISPLAY_ATTRIBUTE.test(name)) return 'display';
    return MARKUP_ATTRIBUTE.test(name) ? 'markup' : 'maybe';
  }
  // A comparison value, a type, an import path, an object key: read by code, not by people.
  if (parent && ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText())) return 'markup';
  if (parent && (ts.isImportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isCaseClause(parent))) return 'markup';
  if (parent && ts.isPropertyAssignment(parent) && parent.name === node) return 'markup';
  if (parent && ts.isElementAccessExpression(parent)) return 'markup';
  // Through the expressions a value passes on its way to the page.
  while (parent && (ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent))) {
    if (ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText())) return 'markup';
    parent = parent.parent;
  }
  // clsx('…'), querySelector('…'), string tests: arguments nobody reads.
  if (parent && ts.isCallExpression(parent) && /^(clsx|cn|classNames|twMerge|querySelector|querySelectorAll|getElementById|invalidateQueries|setQueryData|getQueryData|navigate|subscribeToJob|emit|on|off|startsWith|endsWith|includes|test|match|replace|split|indexOf|get|has|set|append|setAttribute|getAttribute)$/.test(parent.expression.getText().split('.').pop() ?? '')) return 'markup';
  if (parent && ts.isJsxExpression(parent)) {
    const holder = parent.parent;
    if (holder && ts.isJsxAttribute(holder)) return contextOf(parent, text);
    // `{'claims'}` between tags.
    if (holder && (ts.isJsxElement(holder) || ts.isJsxFragment(holder))) return 'rendered';
  }
  if (/^[a-z0-9:/[\]_.%-]+( [a-z0-9:/[\]_.%!-]+)+$/.test(text.trim()) && /(^| )(flex|grid|text-|bg-|border|px-|py-|mt-|mb-|rounded|hover:|w-|h-|gap-|items-|font-)/.test(text)) return 'markup';
  return 'maybe';
}

/** Every banned use in a text, after the allowed phrases are set aside. */
function bannedIn(text: string, allowed: readonly RegExp[]): Array<{ word: string; index: number; length: number }> {
  let rest = text;
  // An allowed phrase is blanked in place, so what stands beside it is still read.
  for (const phrase of allowed) rest = rest.replace(new RegExp(phrase.source, phrase.flags.includes('g') ? phrase.flags : `${phrase.flags}g`), (found) => ' '.repeat(found.length));
  const found: Array<{ word: string; index: number; length: number }> = [];
  for (const banned of BANNED) {
    for (const match of rest.matchAll(new RegExp(banned.pattern.source, banned.pattern.flags))) {
      const at = match.index ?? 0;
      // "counter-claims" is one use, not a counter-claim and a claim.
      if (!found.some((earlier) => at >= earlier.index && at < earlier.index + earlier.length)) found.push({ word: banned.name, index: at, length: match[0].length });
    }
  }
  const label = GRADE_LABEL.exec(rest.trim());
  if (label) found.push({ word: 'grade label', index: rest.lastIndexOf(label[1]), length: label[1].length });
  return found.sort((a, b) => a.index - b.index);
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...filesUnder(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Scan the source tree. `allowed` names, per file, phrases that use a banned
 * word in a sense the rule is not about; only that phrase is excused, and the
 * rest of the text it sits in is still read.
 */
export function scanReaderWording(srcDir: string, allowed: (file: string) => readonly RegExp[] = () => []): WordingHit[] {
  const hits: WordingHit[] = [];
  for (const path of filesUnder(srcDir)) {
    const file = relative(srcDir, path).replace(/\\/g, '/');
    const excused = allowed(file);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      let text: string | null = null;
      if (ts.isJsxText(node)) text = node.text;
      else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const context = contextOf(node, node.text);
        if (context === 'rendered' || context === 'display' || (context === 'maybe' && isProse(node.text))) text = node.text;
      }
      if (text) {
        const flat = text.replace(/\s+/g, ' ').trim();
        for (const found of bannedIn(flat, excused)) {
          // The words around the match, so a long paragraph is reported by the part that matters.
          const from = Math.max(0, found.index - 60);
          hits.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: flat.slice(from, found.index + found.length + 60), word: found.word });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hits;
}
