import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

interface GitHubFileContent {
  sha?: string;
}

/**
 * Commit full report markdown to GooseyPrime/newontology (or configured repo) for
 * the thenewontology.life Featured Report workflow.
 */
export async function publishReportToFeaturedRepo(args: {
  pathInRepo: string;
  branch: string;
  markdown: string;
  commitMessage: string;
}): Promise<{ commitUrl?: string; updated: boolean }> {
  const token = config.featuredReportGithub.token.trim();
  if (!token) {
    throw new Error('FEATURED_REPORT_GITHUB_TOKEN is not configured');
  }

  const owner = config.featuredReportGithub.owner;
  const repo = config.featuredReportGithub.repo;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let existingSha: string | undefined;
  try {
    const getRes = await axios.get<GitHubFileContent>(`${apiBase}/contents/${encodeURIComponent(args.pathInRepo)}`, {
      headers,
      params: { ref: args.branch },
    });
    existingSha = getRes.data.sha;
  } catch (err: unknown) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status !== 404) {
      logger.warn('GitHub GET contents failed', err);
      throw err instanceof Error ? err : new Error('GitHub API error');
    }
  }

  const body = Buffer.from(args.markdown, 'utf8').toString('base64');
  const putPayload: Record<string, string> = {
    message: args.commitMessage,
    content: body,
    branch: args.branch,
  };
  if (existingSha) {
    putPayload.sha = existingSha;
  }

  const putRes = await axios.put<{ commit?: { html_url?: string } }>(
    `${apiBase}/contents/${encodeURIComponent(args.pathInRepo)}`,
    putPayload,
    { headers }
  );

  return {
    updated: true,
    commitUrl: putRes.data.commit?.html_url,
  };
}
