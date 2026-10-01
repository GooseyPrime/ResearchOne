import { query } from '../../db/pool';
import { judgeQuoteSupports } from './quoteSupportsJudge';
import { scoreStoredReport, type ContradictionLink, type EvalCitation, type EvalScoreInput, type EvalScores } from './scoreReport';
import { loadEvalTasks, type EvalTask, type FixtureDocument } from './taskSet';

export interface StoredRun {
  reportMarkdown: string;
  citations: EvalCitation[];
  contradictionLinks: ContradictionLink[];
  startedAt: string | null;
  completedAt: string | null;
  tokens: number | null;
}

export interface EvalTransport {
  start(task: EvalTask, files: FixtureDocument[]): Promise<{ runId: string }>;
  wait(runId: string): Promise<void>;
  load(runId: string): Promise<StoredRun>;
}

export function fixtureFiles(task: EvalTask): FixtureDocument[] {
  return task.fixtureDocuments ?? [];
}

export function buildScoreInput(task: EvalTask, stored: StoredRun, quoteSupports: number | null): EvalScoreInput {
  const sides = (task.fixtureDocuments ?? []).filter((doc) => doc.role === 'side_a' || doc.role === 'side_b');
  return {
    reportMarkdown: stored.reportMarkdown,
    citations: stored.citations,
    keyFacts: task.keyFacts,
    contradictionLinks: stored.contradictionLinks,
    fixtureSides: sides.length === 2 ? [sides[0].name, sides[1].name] : undefined,
    anomalyPhrase: task.anomalyPhrase,
    quoteSupports,
    seconds: secondsBetween(stored.startedAt, stored.completedAt),
    tokens: stored.tokens,
  };
}

export async function runHarness(transport: EvalTransport, tasks: EvalTask[] = loadEvalTasks()): Promise<Array<{ taskId: string; runId: string; scores: EvalScores }>> {
  const rows = [];
  for (const task of tasks) {
    const files = fixtureFiles(task);
    const started = await transport.start(task, files);
    await transport.wait(started.runId);
    const stored = await transport.load(started.runId);
    const quoteSupports = await judgeQuoteSupports(
      stored.citations
        .filter((row) => row.chunkQuote.trim().length > 0 && row.sentence)
        .map((row) => ({ sentence: row.sentence ?? '', quote: row.chunkQuote }))
    );
    const scores = scoreStoredReport(buildScoreInput(task, stored, quoteSupports));
    await query(
      `INSERT INTO eval_results (run_id, task_id, scores, git_sha) VALUES ($1, $2, $3::jsonb, $4)`,
      [started.runId, task.id, JSON.stringify(scores), process.env.GIT_SHA ?? null]
    );
    rows.push({ taskId: task.id, runId: started.runId, scores });
  }
  return rows;
}

export function adminStartBody(task: EvalTask, files: FixtureDocument[]): { query: string; files: FixtureDocument[] } {
  return { query: task.prompt, files };
}

function secondsBetween(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const seconds = (Date.parse(completedAt) - Date.parse(startedAt)) / 1000;
  return Number.isFinite(seconds) ? seconds : null;
}

export async function loadStoredRun(runId: string): Promise<StoredRun> {
  const report = await query<{ content: string }>(
    `SELECT s.content FROM report_sections s
     JOIN reports r ON r.id = s.report_id
     WHERE r.run_id = $1
     ORDER BY s.section_order`,
    [runId]
  );
  const citations = await query<EvalCitation>(
    `SELECT ea.alias, rc.chunk_quote AS "chunkQuote", c.content AS "chunkText",
            left(s.content, 400) AS sentence
     FROM report_citations rc
     JOIN reports r ON r.id = rc.report_id
     LEFT JOIN evidence_aliases ea ON ea.citation_id = rc.id
     LEFT JOIN chunks c ON c.id = rc.chunk_id
     LEFT JOIN report_sections s ON s.id = rc.section_id
     WHERE r.run_id = $1`,
    [runId]
  );
  const links = await query<ContradictionLink>(
    `SELECT ia.file_name AS "documentA", ib.file_name AS "documentB"
     FROM contradictions x
     JOIN claims ca ON ca.id = x.claim_a_id
     JOIN claims cb ON cb.id = x.claim_b_id
     JOIN chunks cha ON cha.id = ca.chunk_id
     JOIN chunks chb ON chb.id = cb.chunk_id
     JOIN documents da ON da.id = cha.document_id
     JOIN documents db ON db.id = chb.document_id
     JOIN ingestion_jobs ia ON ia.source_id = da.source_id
     JOIN ingestion_jobs ib ON ib.source_id = db.source_id
     WHERE x.run_id = $1`,
    [runId]
  );
  const timing = await query<{ started_at: string | null; completed_at: string | null }>(
    `SELECT started_at, completed_at FROM research_runs WHERE id = $1`,
    [runId]
  );
  const usage = await query<{ tokens: string | null }>(
    `SELECT SUM(total_tokens)::text AS tokens FROM agent_executions WHERE run_id = $1`,
    [runId]
  );
  return {
    reportMarkdown: report.map((row) => row.content).join('\n'),
    citations: citations.map((row) => ({
      alias: row.alias ?? '',
      chunkQuote: row.chunkQuote ?? '',
      chunkText: row.chunkText ?? '',
      sentence: row.sentence,
    })),
    contradictionLinks: links,
    startedAt: timing[0]?.started_at ?? null,
    completedAt: timing[0]?.completed_at ?? null,
    tokens: usage[0]?.tokens ? Number(usage[0].tokens) : null,
  };
}

export async function submitTaskThroughAdminRoute(
  apiBase: string,
  task: EvalTask,
  files: FixtureDocument[],
  authHeader: string
): Promise<{ runId: string }> {
  const form = new FormData();
  form.set('query', task.prompt);
  for (const file of files) {
    form.append('files', new Blob([file.text], { type: 'text/plain' }), file.name);
  }
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/research`, {
    method: 'POST',
    headers: { authorization: authHeader },
    body: form,
  });
  if (!response.ok) throw new Error(`admin start failed: ${response.status}`);
  const body = (await response.json()) as { runId: string };
  return { runId: body.runId };
}
