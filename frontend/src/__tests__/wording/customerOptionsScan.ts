/**
 * Reads the frontend source for two faults the registry of customer-facing
 * names (`content/customerOptions.ts`) exists to prevent (RJ-017):
 *
 *  - an option written straight into a screen (`<option value="apa">APA</option>`),
 *    which the registry cannot name, describe or give an example for; and
 *  - a second, hand-typed copy of a name the registry already holds.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface ScanHit {
  file: string;
  line: number;
  text: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/**
 * `<option>` elements whose words are typed into the screen. An option that
 * renders an expression (`{option.name}`) is read from data and is fine; so is
 * the empty first row of a list ("Choose…", `value=""`), which selects nothing.
 */
export function hardCodedOptions(srcDir: string, inScope: (file: string) => boolean): ScanHit[] {
  const hits: ScanHit[] = [];
  for (const path of sourceFiles(srcDir)) {
    const file = relative(srcDir, path).replace(/\\/g, '/');
    if (!inScope(file) || !path.endsWith('x')) continue;
    const source = parse(path);
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'option') {
        const value = node.openingElement.attributes.properties.find(
          (attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'value'
        );
        const emptyValue = value?.initializer && ts.isStringLiteral(value.initializer) && value.initializer.text === '';
        const typed = node.children
          .filter((child): child is ts.JsxText => ts.isJsxText(child))
          .map((child) => child.text.trim())
          .filter(Boolean)
          .join(' ');
        // `{option.name} — {option.description}` is data with a dash between; only wholly typed words are a fault.
        const fromData = node.children.some((child) => ts.isJsxExpression(child) && child.expression);
        if (typed && !emptyValue && !fromData) {
          hits.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: typed });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hits;
}

/**
 * String literals and JSX text equal to one of `names`, anywhere but the
 * registry itself. Comparisons, object keys and import paths are code, not copy.
 */
export function retypedNames(srcDir: string, names: ReadonlySet<string>, registryFile: string): ScanHit[] {
  const hits: ScanHit[] = [];
  for (const path of sourceFiles(srcDir)) {
    const file = relative(srcDir, path).replace(/\\/g, '/');
    if (file === registryFile) continue;
    const source = parse(path);
    const visit = (node: ts.Node): void => {
      let text: string | null = null;
      if (ts.isJsxText(node)) text = node.text.trim();
      else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const parent = node.parent;
        const compared = ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText());
        const key = ts.isPropertyAssignment(parent) && parent.name === node;
        const structural = ts.isImportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isCaseClause(parent) || ts.isElementAccessExpression(parent);
        if (!compared && !key && !structural) text = node.text.trim();
      }
      if (text && names.has(text)) {
        hits.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hits;
}
