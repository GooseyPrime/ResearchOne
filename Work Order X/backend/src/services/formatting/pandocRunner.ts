/**
 * Pandoc runner — invokes pandoc as a subprocess with strict sandboxing.
 *
 * Per Cursor rule 28:
 *   I-2  Untrusted content goes through stdin / tempfiles, never argv.
 *   I-3  xelatex runs with `-no-shell-escape`.
 *   I-4  Every invocation has a wall-clock timeout.
 *   I-5  Per-job tempdir, cleaned in `finally`.
 *   I-6  `pandocAvailable()` gates the entire path; missing pandoc
 *        returns a structured error, not a 500.
 *
 * All these rules collapse into the contract below:
 *
 *   const result = await runPandoc({
 *     markdown:    untrustedReportBody,    // stdin
 *     cslJson:     bibliographyArray,      // tempfile
 *     format:      'docx',                 // enum-validated upstream
 *     style:       'mla',                  // enum-validated upstream
 *     timeoutMs:   30000,                  // wall clock
 *   });
 *
 * Anything else — extra args, command-line overrides, "trust me bro"
 * mode — is not exposed. The API surface is the security boundary.
 */
import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { logger } from '../../utils/logger';

export type ExportFormat = 'docx' | 'pdf' | 'md' | 'html';
export type ExportStyle =
  | 'mla'
  | 'apa'
  | 'chicago-author-date'
  | 'chicago-note'
  | 'ieee'
  | 'harvard';

export interface PandocRunArgs {
  /** Untrusted markdown — flows in via tempfile, never argv. */
  markdown: string;
  /** CSL-JSON bibliography array — written to tempfile and passed as
   *  --bibliography=<tempfile>. */
  cslJson: unknown[];
  format: ExportFormat;
  style: ExportStyle;
  /** Wall-clock timeout in ms. Default 30000 for DOCX/MD/HTML, 60000
   *  for PDF (xelatex is slower). */
  timeoutMs?: number;
}

export interface PandocRunResult {
  /** Path to the generated file inside the per-job tempdir. Caller
   *  must read & relocate before `tempdir` is cleaned. */
  outputPath: string;
  /** Bytes of the output file. */
  outputBytes: number;
  /** Subprocess wall-clock duration. */
  durationMs: number;
  /** Whatever pandoc wrote to stderr — included for diagnostics. */
  stderr: string;
}

export class PandocError extends Error {
  constructor(
    message: string,
    public readonly classification:
      | 'pandoc_not_installed'
      | 'timeout'
      | 'pandoc_error'
      | 'xelatex_error'
      | 'validation_error',
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'PandocError';
  }
}

// ─── Availability check (Rule 28 I-6) ────────────────────────────────

let cachedAvailability: { available: boolean; version: string | null } | null = null;

/**
 * One-shot availability probe. Runs `pandoc --version` and caches.
 * If pandoc is not installed, the result is `{available: false}`.
 * Subsequent calls return the cached result.
 *
 * Call once at startup; subsequent invocations are cache hits.
 */
export async function pandocAvailable(): Promise<{ available: boolean; version: string | null }> {
  if (cachedAvailability) return cachedAvailability;
  try {
    const stdout = await runPandocSubprocess(['--version'], '', 5000);
    const versionLine = stdout.split('\n')[0]?.trim() ?? null;
    cachedAvailability = { available: true, version: versionLine };
    return cachedAvailability;
  } catch (err) {
    logger.warn('formatting: pandoc not available', {
      err: err instanceof Error ? err.message : String(err),
    });
    cachedAvailability = { available: false, version: null };
    return cachedAvailability;
  }
}

/** Test helper — clears the availability cache. */
export function _resetAvailabilityCache(): void {
  cachedAvailability = null;
}

// ─── Main entry ──────────────────────────────────────────────────────

/**
 * Run pandoc for a single export job.
 *
 * Lifecycle:
 *   1. Probe availability — fail fast if pandoc is missing.
 *   2. Create per-job tempdir under /tmp/r1-export-<uuid>/.
 *   3. Write markdown.md and bibliography.json inside the tempdir.
 *   4. spawn pandoc with hardcoded safe flags.
 *   5. Wait with timeout; SIGKILL on overrun.
 *   6. Read output file path; return it.
 *   7. `finally`: remove tempdir.
 *
 * The caller is responsible for COPYING the output file out of the
 * tempdir BEFORE this function returns, or for reading its bytes
 * immediately. After this function returns, the tempdir is gone.
 */
export async function runPandoc(args: PandocRunArgs): Promise<PandocRunResult> {
  validateArgs(args);

  const avail = await pandocAvailable();
  if (!avail.available) {
    throw new PandocError(
      'pandoc is not installed on this server',
      'pandoc_not_installed',
      'Install with: apt-get install pandoc texlive-xetex (or use a Docker image with these baked in)'
    );
  }

  const timeoutMs = args.timeoutMs ?? (args.format === 'pdf' ? 60_000 : 30_000);

  // Per Rule 28 I-5: per-job scratch dir.
  const scratchDir = await mkdtemp(join(tmpdir(), 'r1-export-'));
  const markdownPath = join(scratchDir, 'input.md');
  const bibliographyPath = join(scratchDir, 'bibliography.json');
  const outputPath = join(scratchDir, `output.${args.format}`);

  try {
    // Per Rule 28 I-2: untrusted content into files, never argv.
    await writeFile(markdownPath, args.markdown, 'utf-8');
    await writeFile(bibliographyPath, JSON.stringify(args.cslJson), 'utf-8');

    // Resolve the CSL stylesheet path. These are committed under
    // backend/src/services/formatting/templates/citation-styles/.
    // The path here is computed relative to the running module via
    // __dirname so dev/prod both work.
    const cslPath = resolveCslPath(args.style);

    const pandocArgs = [
      markdownPath,
      '-o', outputPath,
      '--from=markdown',
      `--to=${pandocOutputFlag(args.format)}`,
      '--citeproc',
      `--bibliography=${bibliographyPath}`,
      `--csl=${cslPath}`,
      '--metadata=link-citations=true',
      '--standalone',
    ];

    // DOCX-specific: reference template.
    if (args.format === 'docx') {
      const refPath = resolveDocxReferencePath(args.style);
      pandocArgs.push(`--reference-doc=${refPath}`);
    }

    // PDF-specific: xelatex with no-shell-escape (Rule 28 I-3).
    if (args.format === 'pdf') {
      pandocArgs.push('--pdf-engine=xelatex');
      pandocArgs.push('--pdf-engine-opt=-no-shell-escape');
      pandocArgs.push('--pdf-engine-opt=-halt-on-error');
    }

    const start = Date.now();
    let stderr = '';
    try {
      stderr = await runPandocSubprocess(pandocArgs, '', timeoutMs);
    } catch (err) {
      if (err instanceof PandocError) throw err;
      // Classify common failure shapes.
      const msg = err instanceof Error ? err.message : String(err);
      if (/^TIMEOUT/.test(msg)) {
        throw new PandocError(`pandoc timed out after ${timeoutMs}ms`, 'timeout', msg);
      }
      if (/xelatex|pdflatex|LaTeX/i.test(msg)) {
        throw new PandocError('xelatex failed', 'xelatex_error', msg);
      }
      throw new PandocError('pandoc failed', 'pandoc_error', msg);
    }

    const durationMs = Date.now() - start;
    const outputBytes = (await readFile(outputPath)).length;

    return { outputPath, outputBytes, durationMs, stderr };
  } finally {
    // Always clean the tempdir. We intentionally do NOT await before
    // a potential throw above — the `finally` here runs after either
    // a successful return or a thrown error.
    await rm(scratchDir, { recursive: true, force: true }).catch((err) => {
      logger.warn('formatting: failed to clean scratch dir', {
        scratchDir,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function validateArgs(args: PandocRunArgs): void {
  // Rule 28 I-9: enum validation. The route already enforces these but
  // we re-check defensively — defense in depth.
  const validFormats: ExportFormat[] = ['docx', 'pdf', 'md', 'html'];
  const validStyles: ExportStyle[] = [
    'mla', 'apa', 'chicago-author-date', 'chicago-note', 'ieee', 'harvard',
  ];
  if (!validFormats.includes(args.format)) {
    throw new PandocError(`invalid format: ${args.format}`, 'validation_error');
  }
  if (!validStyles.includes(args.style)) {
    throw new PandocError(`invalid style: ${args.style}`, 'validation_error');
  }
  if (typeof args.markdown !== 'string') {
    throw new PandocError('markdown must be a string', 'validation_error');
  }
  if (!Array.isArray(args.cslJson)) {
    throw new PandocError('cslJson must be an array', 'validation_error');
  }
}

function pandocOutputFlag(format: ExportFormat): string {
  switch (format) {
    case 'docx': return 'docx';
    case 'pdf':  return 'pdf';
    case 'md':   return 'markdown';
    case 'html': return 'html5';
  }
}

function resolveCslPath(style: ExportStyle): string {
  // __dirname at runtime is .../backend/dist/services/formatting/ or
  // .../backend/src/services/formatting/ depending on the build. Both
  // resolve to a `templates/citation-styles/` sibling.
  return join(__dirname, 'templates', 'citation-styles', `${style}.csl`);
}

function resolveDocxReferencePath(style: ExportStyle): string {
  return join(__dirname, 'templates', `${style}-reference.docx`);
}

/**
 * Spawn pandoc with the given args, send stdin (if any), enforce the
 * wall-clock timeout. Returns stdout + stderr concatenated for the
 * `--version` use case; for export jobs, the output is written by
 * pandoc to a file and stdout is unused.
 */
function runPandocSubprocess(
  args: string[],
  stdin: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pandoc', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Per Rule 28 I-5: a clean env. We intentionally do NOT inherit
      // the parent process's env to avoid leaking secrets into the
      // subprocess. PATH is set explicitly so pandoc can find xelatex.
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? '/tmp',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`TIMEOUT after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // `ENOENT` here means pandoc itself isn't on $PATH.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new PandocError(
          'pandoc binary not found on $PATH',
          'pandoc_not_installed',
          err.message
        ));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        // Combine stdout (e.g. --version output) and stderr (pandoc
        // writes some informational messages there even on success).
        resolve(stdout || stderr);
        return;
      }
      reject(new Error(`pandoc exited code=${code}: ${stderr.slice(0, 2000)}`));
    });

    if (stdin) {
      child.stdin.end(stdin, 'utf-8');
    } else {
      child.stdin.end();
    }
  });
}
