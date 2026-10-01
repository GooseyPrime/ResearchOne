import { readFileSync } from 'node:fs';
import path from 'node:path';

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
