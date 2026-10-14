import { readFileSync } from 'node:fs';
import path from 'node:path';
import { callRoleModel } from '../openrouter/openrouterService';
import { REPORT_QUALITY_MODEL } from './reportQualityPrompt';

export const REFERENCE_COMPETITORS = ['chatgpt', 'perplexity'] as const;
export type ReferenceCompetitor = (typeof REFERENCE_COMPETITORS)[number];

export function referenceReportPath(dir: string, competitor: ReferenceCompetitor, taskId: string): string {
  return path.join(dir, competitor, `${taskId}.md`);
}

export function loadReferenceReport(dir: string, competitor: ReferenceCompetitor, taskId: string): string | null {
  try {
    const text = readFileSync(referenceReportPath(dir, competitor, taskId), 'utf8').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** Mean of the two blind orders. A missing reference is null for that competitor. The score is the lower of the two competitors. */
export function pairwiseScore(orders: {
  chatgpt: [number, number] | null;
  perplexity: [number, number] | null;
}): { chatgpt: number | null; perplexity: number | null; pairwise_vs_reference: number | null } {
  const chatgpt = meanOrders(orders.chatgpt);
  const perplexity = meanOrders(orders.perplexity);
  const present = [chatgpt, perplexity].filter((value): value is number => value !== null);
  return {
    chatgpt,
    perplexity,
    pairwise_vs_reference: present.length === 0 ? null : Math.min(...present),
  };
}

function meanOrders(orders: [number, number] | null): number | null {
  if (!orders) return null;
  return (orders[0] + orders[1]) / 2;
}

/**
 * The fixed blind judge for `pairwise_vs_reference` (section 8). It sees two
 * reports labelled A and B, never which one is ResearchOne's, and is asked in
 * both orders. A win or a tie for ResearchOne counts 1 for that order; a loss
 * counts 0. A judge that cannot be read gives no score for the task: an
 * unread judgment is never counted as a win or a loss.
 */
export const PAIRWISE_PROMPT = `You are comparing two research reports written for the same question. You are not told who wrote either one. Judge them on these points, as a reader would: the answer comes first; the structure is easy to follow; the prose is plain and neutral, with no wording meant for a system; citations are clear numbered references with a reference list; limits and disagreements are stated honestly; the length suits the question, without padding or repetition.

Reply with JSON only: {"better": "A"} or {"better": "B"} or {"better": "tie"}.`;

export const PAIRWISE_MODEL = REPORT_QUALITY_MODEL;

export type PairwiseCall = typeof callRoleModel;

export function parsePairwiseVerdict(content: string): 'A' | 'B' | 'tie' | null {
  const stripped = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    const better = (JSON.parse(stripped) as { better?: unknown }).better;
    if (better === 'A' || better === 'B' || better === 'tie') return better;
    return null;
  } catch {
    return null;
  }
}

async function askOnce(first: string, second: string, call: PairwiseCall): Promise<'A' | 'B' | 'tie' | null> {
  try {
    const result = await call({
      role: 'verifier',
      baselineLayer: false,
      messages: [
        { role: 'system', content: PAIRWISE_PROMPT },
        { role: 'user', content: `Report A:\n\n${first}\n\n---\n\nReport B:\n\n${second}` },
      ],
      temperature: 0,
      runtimeOverrides: { primary: PAIRWISE_MODEL },
    });
    return parsePairwiseVerdict(result.content);
  } catch {
    return null;
  }
}

/** Both blind orders. Null when either order could not be read. */
export async function judgePairwise(ours: string, reference: string, call: PairwiseCall = callRoleModel): Promise<[number, number] | null> {
  const oursFirst = await askOnce(ours, reference, call);
  const oursSecond = await askOnce(reference, ours, call);
  if (oursFirst === null || oursSecond === null) return null;
  return [oursFirst === 'B' ? 0 : 1, oursSecond === 'A' ? 0 : 1];
}

/**
 * The pairwise scores for one task. Only factual and survey tasks are compared
 * (section 8), and only against a reference file that exists. No directory, no
 * file, or no readable judgment: the score stays null and no model is asked.
 */
export async function scorePairwiseForTask(
  task: { id: string; kind: string },
  ours: string,
  referenceDir: string | undefined = process.env.EVAL_REFERENCE_DIR,
  call: PairwiseCall = callRoleModel
): Promise<{ pairwise_vs_reference: number | null; pairwise_chatgpt: number | null; pairwise_perplexity: number | null }> {
  const none = { pairwise_vs_reference: null, pairwise_chatgpt: null, pairwise_perplexity: null };
  if (!referenceDir || (task.kind !== 'factual' && task.kind !== 'survey')) return none;
  const orders: { chatgpt: [number, number] | null; perplexity: [number, number] | null } = { chatgpt: null, perplexity: null };
  for (const competitor of REFERENCE_COMPETITORS) {
    const reference = loadReferenceReport(referenceDir, competitor, task.id);
    if (reference) orders[competitor] = await judgePairwise(ours, reference, call);
  }
  const scored = pairwiseScore(orders);
  return { pairwise_vs_reference: scored.pairwise_vs_reference, pairwise_chatgpt: scored.chatgpt, pairwise_perplexity: scored.perplexity };
}
