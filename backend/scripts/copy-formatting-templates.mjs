/**
 * Copy vendored CSL + reference DOCX templates into dist/ after `tsc`.
 * `pandocRunner` resolves paths with `join(__dirname, 'templates', ...)`,
 * which points at dist/ when running `node dist/index.js`.
 */
import { cpSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const src = join(repoRoot, 'src/services/formatting/templates');
const dest = join(repoRoot, 'dist/services/formatting/templates');

if (!existsSync(src)) {
  console.error(`copy-formatting-templates: missing source dir: ${src}`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-formatting-templates: ${src} -> ${dest}`);
