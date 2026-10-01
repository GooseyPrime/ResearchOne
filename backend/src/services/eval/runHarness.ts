import { query } from '../../db/pool';
import { scoreStoredReport, type EvalScoreInput, type EvalScores } from './scoreReport';

export async function scoreAndStore(args: {
  runId: string;
  taskId: string;
  gitSha: string | null;
  input: EvalScoreInput;
}): Promise<EvalScores> {
  const scores = scoreStoredReport(args.input);
  await query(
    `INSERT INTO eval_results (run_id, task_id, scores, git_sha) VALUES ($1, $2, $3::jsonb, $4)`,
    [args.runId, args.taskId, JSON.stringify(scores), args.gitSha]
  );
  return scores;
}
