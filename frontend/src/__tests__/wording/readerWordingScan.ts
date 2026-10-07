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
  { name: 'claim', pattern: /\bclaims?\b/i },
  { name: 'counter-claim', pattern: /\bcounter-?claims?\b/i },
  { name: 'tier number', pattern: /\btier[ -]?[1-4]\b/i },
  { name: 'grade label', pattern: /\b(established[_ ]fact|strong[_ ]evidence|testimony[- ]tier)\b/i },
  { name: 'raw status', pattern: /\b(under_review|plan_pending_confirmation|contract_failed|verification_failed|completed_degraded)\b/ },
];

/** A string literal a person reads: it has a space in it, or it is a capitalised word on its own (a label). */
function isProse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;
  if (/\s/.test(trimmed)) return !/^[a-z0-9_./:[\]#-]+(\s+[a-z0-9_./:[\]#-]+)*$/.test(trimmed) || /[.!?]$/.test(trimmed) || /[A-Z]/.test(trimmed);
  return /^[A-Z][a-z]+s?$/.test(trimmed);
}

/** Tailwind class lists, selectors and the like: spaces, but nobody reads them. */
function isMarkup(node: ts.Node, text: string): boolean {
  let parent: ts.Node | undefined = node.parent;
  if (parent && ts.isJsxAttribute(parent)) {
    const name = parent.name.getText();
    return !/^(aria-label|aria-description|title|alt|placeholder|label|description|narrative|caption|heading|subheading|tooltip|helperText|emptyText|text)$/.test(name);
  }
  // clsx('…'), cn('…'), className template pieces, querySelector('…'), test ids.
  while (parent && (ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent))) parent = parent.parent;
  if (parent && ts.isCallExpression(parent) && /^(clsx|cn|classNames|twMerge|querySelector|querySelectorAll|getElementById|invalidateQueries|setQueryData|getQueryData|navigate|subscribeToJob|emit|on|off|startsWith|endsWith|includes|test|match|replace|split|indexOf)$/.test(parent.expression.getText().split('.').pop() ?? '')) return true;
  if (parent && ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) return isMarkup(parent, text);
  // An object key, a comparison value, a type, an import path.
  if (parent && (ts.isImportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isCaseClause(parent))) return true;
  if (parent && ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (parent && ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText())) return true;
  return /^[a-z0-9:/[\]_.%-]+( [a-z0-9:/[\]_.%!-]+)+$/.test(text.trim()) && /(^| )(flex|grid|text-|bg-|border|px-|py-|mt-|mb-|rounded|hover:|w-|h-|gap-|items-|font-)/.test(text);
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

export function scanReaderWording(srcDir: string, skip: (file: string) => boolean = () => false): WordingHit[] {
  const hits: WordingHit[] = [];
  for (const path of filesUnder(srcDir)) {
    const file = relative(srcDir, path).replace(/\\/g, '/');
    if (skip(file)) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      let text: string | null = null;
      if (ts.isJsxText(node)) text = node.text;
      else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && !isMarkup(node, node.text) && isProse(node.text)) text = node.text;
      if (text) {
        for (const banned of BANNED) {
          const flat = text.replace(/\s+/g, ' ').trim();
          const found = banned.pattern.exec(flat);
          if (found) {
            // The words around the match, so a long paragraph is reported by the part that matters.
            const from = Math.max(0, found.index - 60);
            hits.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: flat.slice(from, found.index + found[0].length + 60), word: banned.name });
            break;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hits;
}
