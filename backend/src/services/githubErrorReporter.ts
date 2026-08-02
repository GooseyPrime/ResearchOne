/**
 * githubErrorReporter.ts — fire-and-forget GitHub Issues reporter for terminal
 * research-run failures.
 *
 * When a run is marked `aborted` (terminal non-recoverable), this service opens
 * a GitHub Issue on the configured repository so on-call agents and engineers can
 * triage and respond. All calls are best-effort; a reporter failure must never
 * bubble up and affect the run's error path.
 *
 * Configuration (via environment variables — see .env.development.example):
 *   ERROR_REPORT_GITHUB_TOKEN  — Personal Access Token (or fine-grained token) with
 *                                 Issues: write on the target repo. Leave unset to
 *                                 disable reporting silently.
 *   ERROR_REPORT_GITHUB_OWNER  — Repository owner (default: GooseyPrime)
 *   ERROR_REPORT_GITHUB_REPO   — Repository name  (default: ResearchOne)
 */

import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface RunErrorReportArgs {
  runId: string;
  stage: string;
  errorMessage: string;
  failureMeta: Record<string, unknown>;
  query?: string;
  userId?: string | null;
  orgId?: string | null;
  timestamp?: string;
}

const GITHUB_API_BASE = 'https://api.github.com';

/** Labels that must exist in the target repo before we create an issue. */
const REQUIRED_LABELS: Array<{ name: string; color: string; description: string }> = [
  { name: 'auto-reported', color: 'e11d48', description: 'Opened automatically by the error reporter' },
  { name: 'run-error', color: 'f97316', description: 'Research-run terminal failure' },
];

/**
 * Ensures every label in REQUIRED_LABELS exists in the target repo.
 * Creates missing labels; ignores 422 (label already exists) silently.
 * Any other error is swallowed — label creation failures must not block issue creation.
 */
async function ensureRequiredLabels(
  owner: string,
  repo: string,
  headers: Record<string, string>
): Promise<void> {
  for (const label of REQUIRED_LABELS) {
    try {
      await axios.post(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/labels`,
        label,
        { headers, timeout: 10_000 }
      );
    } catch (err: unknown) {
      // 422 = label already exists — that is the happy path on subsequent calls.
      // Any other status is also swallowed; issue creation will be attempted regardless.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 422) {
        logger.warn('githubErrorReporter: could not ensure label', {
          label: label.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

function buildIssueTitle(args: RunErrorReportArgs): string {
  const stage = args.stage ?? 'unknown';
  const classification = String(args.failureMeta?.classification ?? 'unknown_error');
  return `[Auto] Run error: ${classification} at ${stage} (run ${args.runId.slice(0, 8)}…)`;
}

function buildIssueBody(args: RunErrorReportArgs): string {
  const ts = args.timestamp ?? new Date().toISOString();
  const metaBlock = JSON.stringify(args.failureMeta, null, 2);
  const querySnippet = args.query
    ? `\n**Query (first 200 chars):** \`${args.query.slice(0, 200).replace(/`/g, "'")}\``
    : '';
  const userLine = args.userId ? `\n**User ID:** \`${args.userId}\`` : '';
  const orgLine = args.orgId ? `\n**Org ID:** \`${args.orgId}\`` : '';

  return `## Automated Run Error Report

**Run ID:** \`${args.runId}\`
**Stage:** \`${args.stage}\`
**Timestamp:** ${ts}${userLine}${orgLine}${querySnippet}

### Error message

\`\`\`
${args.errorMessage}
\`\`\`

### Failure metadata

\`\`\`json
${metaBlock}
\`\`\`

---
*This issue was opened automatically by the ResearchOne error reporter. If this error is a known transient, close the issue and add the \`wontfix\` label. Otherwise, triage and assign.*
`;
}

/**
 * Reports a terminal run error to GitHub Issues. Best-effort: swallows all
 * errors so the caller's error path is never disturbed.
 */
export async function reportRunErrorToGitHub(args: RunErrorReportArgs): Promise<void> {
  const token = config.errorReportGithub.token.trim();
  if (!token) {
    // Silently skip when not configured — this is opt-in.
    return;
  }

  const owner = config.errorReportGithub.owner.trim();
  const repo = config.errorReportGithub.repo.trim();
  if (!owner || !repo) {
    logger.warn('githubErrorReporter: ERROR_REPORT_GITHUB_OWNER/REPO not set; skipping');
    return;
  }

  try {
    const title = buildIssueTitle(args);
    const body = buildIssueBody(args);
    const headers = {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    await ensureRequiredLabels(owner, repo, headers);

    await axios.post(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`,
      {
        title,
        body,
        labels: ['bug', 'auto-reported', 'run-error'],
      },
      {
        headers,
        timeout: 10_000,
      }
    );

    logger.info('githubErrorReporter: issue opened', { runId: args.runId, owner, repo });
  } catch (err: unknown) {
    // Never propagate — error reporting must not break the run's error path.
    logger.warn('githubErrorReporter: failed to open GitHub issue', {
      runId: args.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
