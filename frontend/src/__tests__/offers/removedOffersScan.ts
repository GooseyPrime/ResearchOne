/**
 * Finds text a visitor or customer can read that offers something ResearchOne
 * does not sell: a Team plan, seats, a Sovereign or Enterprise plan, a sales
 * contact, the Devil's Advocate review, or an address on intellme.com.
 *
 * The reading of the source follows the reader-wording gate
 * (`wording/readerWordingScan.ts`): JSX text and string literals that are
 * prose are read; identifiers, object keys, class names and comparison values
 * are not, so the tier keys `'team'` and `'sovereign'` that existing accounts
 * still carry are left alone. It is a separate file on purpose, so the two
 * gates can change without touching each other.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface OfferHit {
  file: string;
  line: number;
  text: string;
  word: string;
}

/** What may not be offered, with the name reported when it is found. */
export const REMOVED_OFFERS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'team seat', pattern: /\bteam[- ]seats?\b/gi },
  { name: 'per seat', pattern: /\bper[- ]seat\b/gi },
  { name: '/seat', pattern: /\/\s*seat\b/gi },
  { name: 'seats', pattern: /\bseats\b|\b\d+-seat\b/gi },
  // The plan: "Team" with a capital, or "team" beside a plan word.
  { name: 'Team plan', pattern: /\bTeam\b|\bteam (?:plan|tier|subscription|inquiry|library|pricing|account)s?\b/g },
  { name: 'Sovereign', pattern: /\bsovereign\b/gi },
  { name: 'Enterprise', pattern: /\benterprise\b/gi },
  { name: 'Talk to sales', pattern: /\btalk to sales\b|\bcontact sales\b/gi },
  { name: "Devil's Advocate", pattern: /\bdevil['’]?s[- ]advocate\b/gi },
  // intellmeai.com is ours; intellme.com is not.
  { name: 'intellme.com', pattern: /\bintellme\.com\b/gi },
];

/** A string literal a person reads: it has a space in it, or it is a capitalised word on its own (a label). */
function isProse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;
  if (/\s/.test(trimmed)) return !/^[a-z0-9_./:[\]#-]+(\s+[a-z0-9_./:[\]#-]+)*$/.test(trimmed) || /[.!?]$/.test(trimmed) || /[A-Z]/.test(trimmed);
  return /^[A-Z][a-z]+s?$/.test(trimmed);
}

/** Attributes that are never shown: structure, styling and wiring. Link targets are checked separately. */
const MARKUP_ATTRIBUTE = /^(className|class|style|id|key|src|srcSet|d|viewBox|fill|stroke|role|type|name|htmlFor|rel|target|method|action|variant|size|color|tone|mode|kind|as|lang|dir|autoComplete|inputMode|pattern|accept|data-.+|on[A-Z].*)$/;
/** Attributes that are always read, whatever their value looks like. A link target is one: it is where the visitor is sent. */
const DISPLAY_ATTRIBUTE = /^(aria-label|aria-description|title|alt|placeholder|label|description|narrative|caption|heading|subheading|tooltip|helperText|emptyText|text|details|cta|badge|href|to)$/;

type Context = 'rendered' | 'display' | 'maybe' | 'markup';

function contextOf(node: ts.Node, text: string): Context {
  let parent: ts.Node | undefined = node.parent;
  if (parent && ts.isJsxAttribute(parent)) {
    const name = parent.name.getText();
    if (DISPLAY_ATTRIBUTE.test(name)) return 'display';
    return MARKUP_ATTRIBUTE.test(name) ? 'markup' : 'maybe';
  }
  if (parent && ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText())) return 'markup';
  if (parent && (ts.isImportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isCaseClause(parent))) return 'markup';
  if (parent && ts.isPropertyAssignment(parent) && parent.name === node) return 'markup';
  if (parent && ts.isElementAccessExpression(parent)) return 'markup';
  // A link written as data (`{ to: '/sovereign' }`, `href: 'mailto:…'`) is read like one written as an attribute.
  if (parent && ts.isPropertyAssignment(parent) && /^(to|href|url|mailto|[a-zA-Z]*Mailto)$/.test(parent.name.getText())) return 'display';
  while (parent && (ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent))) {
    if (ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText())) return 'markup';
    parent = parent.parent;
  }
  if (parent && ts.isCallExpression(parent) && /^(clsx|cn|classNames|twMerge|querySelector|querySelectorAll|getElementById|invalidateQueries|setQueryData|getQueryData|subscribeToJob|emit|on|off|startsWith|endsWith|includes|test|match|replace|split|indexOf|get|has|set|append|setAttribute|getAttribute)$/.test(parent.expression.getText().split('.').pop() ?? '')) return 'markup';
  if (parent && ts.isJsxExpression(parent)) {
    const holder = parent.parent;
    if (holder && ts.isJsxAttribute(holder)) return contextOf(parent, text);
    if (holder && (ts.isJsxElement(holder) || ts.isJsxFragment(holder))) return 'rendered';
  }
  if (/^[a-z0-9:/[\]_.%-]+( [a-z0-9:/[\]_.%!-]+)+$/.test(text.trim()) && /(^| )(flex|grid|text-|bg-|border|px-|py-|mt-|mb-|rounded|hover:|w-|h-|gap-|items-|font-)/.test(text)) return 'markup';
  return 'maybe';
}

/** Every removed offer named in a text, after the allowed phrases are set aside. */
export function removedOffersIn(text: string, allowed: readonly RegExp[] = []): Array<{ word: string; index: number; length: number }> {
  let rest = text;
  for (const phrase of allowed) rest = rest.replace(new RegExp(phrase.source, phrase.flags.includes('g') ? phrase.flags : `${phrase.flags}g`), (found) => ' '.repeat(found.length));
  const found: Array<{ word: string; index: number; length: number }> = [];
  for (const offer of REMOVED_OFFERS) {
    for (const match of rest.matchAll(new RegExp(offer.pattern.source, offer.pattern.flags))) {
      const at = match.index ?? 0;
      // "team seats" is one use, not a team seat, seats and a Team plan.
      if (!found.some((earlier) => at < earlier.index + earlier.length && at + match[0].length > earlier.index)) found.push({ word: offer.name, index: at, length: match[0].length });
    }
  }
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

/** A link target that is a route or an address, which `isProse` would pass over. */
function isLinkTarget(text: string): boolean {
  return /^(\/|mailto:|https?:)/.test(text.trim());
}

/**
 * Scan the source tree. `allowed` names, per file, phrases that use one of the
 * words in a sense that is not an offer; only that phrase is excused.
 */
export function scanRemovedOffers(srcDir: string, allowed: (file: string) => readonly RegExp[] = () => []): OfferHit[] {
  const hits: OfferHit[] = [];
  for (const path of filesUnder(srcDir)) {
    const file = relative(srcDir, path).replace(/\\/g, '/');
    const excused = allowed(file);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      let text: string | null = null;
      if (ts.isJsxText(node)) text = node.text;
      else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const context = contextOf(node, node.text);
        if (context === 'rendered' || context === 'display' || (context === 'maybe' && (isProse(node.text) || isLinkTarget(node.text)))) text = node.text;
      }
      if (text) {
        const flat = text.replace(/\s+/g, ' ').trim();
        for (const found of removedOffersIn(flat, excused)) {
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

/**
 * Files that are served or built as they are (the sitemap the prerender list
 * is read from, the page shell, hosting rewrites): read whole, since all of
 * their text reaches a visitor or a crawler.
 */
export function scanPublishedFiles(paths: readonly string[], allowed: readonly RegExp[] = []): OfferHit[] {
  const hits: OfferHit[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
      for (const found of removedOffersIn(line, allowed)) hits.push({ file: path, line: index + 1, text: line.trim().slice(0, 160), word: found.word });
    });
  }
  return hits;
}
