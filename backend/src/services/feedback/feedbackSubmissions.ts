import { query } from '../../db/pool';
import { logger } from '../../utils/logger';

export const FEEDBACK_CATEGORIES = [
  'general_comment',
  'platform_complaint',
  'feature_suggestion',
  'bug_report',
  'integrity_report',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export type FeedbackStatus = 'received' | 'reviewed' | 'closed';

export interface FeedbackSubmissionRow {
  id: string;
  user_id: string;
  category: FeedbackCategory;
  subject: string;
  message: string;
  metadata: Record<string, unknown> | null;
  status: FeedbackStatus;
  created_at: string;
  updated_at: string;
}

function isMissingObjectError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42P01' || code === '42703';
}

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

export async function createFeedbackSubmission(args: {
  userId: string;
  category: FeedbackCategory;
  subject: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}): Promise<{ id: string; status: FeedbackStatus } | null> {
  try {
    const rows = await query<{ id: string; status: FeedbackStatus }>(
      `INSERT INTO feedback_submissions (user_id, category, subject, message, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, status`,
      [
        args.userId,
        args.category,
        args.subject.trim(),
        args.message.trim(),
        args.metadata ? JSON.stringify(args.metadata) : null,
      ],
    );
    const row = rows[0];
    if (!row) return null;
    logger.info('feedback_submission_created', {
      userId: args.userId,
      category: args.category,
      submissionId: row.id,
    });
    return row;
  } catch (err) {
    if (isMissingObjectError(err)) {
      logger.warn('feedback_submissions_table_missing', { userId: args.userId });
      return null;
    }
    throw err;
  }
}

export async function getFeedbackSubmissionForUser(
  userId: string,
  submissionId: string,
): Promise<Pick<FeedbackSubmissionRow, 'id' | 'status' | 'updated_at'> | null> {
  try {
    const rows = await query<Pick<FeedbackSubmissionRow, 'id' | 'status' | 'updated_at'>>(
      `SELECT id, status, updated_at
       FROM feedback_submissions
       WHERE id = $1 AND user_id = $2`,
      [submissionId, userId],
    );
    return rows[0] ?? null;
  } catch (err) {
    if (isMissingObjectError(err)) return null;
    throw err;
  }
}
