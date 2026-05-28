/**
 * Feedback client — routes through Emma backend via authenticated API.
 */

import api, { extractApiError } from '../../utils/api';
import type { FeedbackResponse, FeedbackSubmission } from './feedbackTypes';

export type { FeedbackCategory, FeedbackResponse, FeedbackSubmission } from './feedbackTypes';

export { feedbackCategories } from './feedbackTypes';

export async function submitFeedback(submission: FeedbackSubmission): Promise<FeedbackResponse> {
  const enrichedSubmission: FeedbackSubmission = {
    ...submission,
    metadata: {
      currentPage: typeof window !== 'undefined' ? window.location.pathname : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      timestamp: new Date().toISOString(),
      ...submission.metadata,
    },
  };

  try {
    const { data } = await api.post<FeedbackResponse>('/feedback', {
      category: enrichedSubmission.category,
      subject: enrichedSubmission.subject,
      message: enrichedSubmission.message,
      metadata: enrichedSubmission.metadata,
    });
    return data ?? { success: true };
  } catch (err) {
    return { success: false, message: extractApiError(err) };
  }
}

export async function getFeedbackStatus(
  ticketId: string,
): Promise<{ status: string; updatedAt: string } | null> {
  try {
    const { data } = await api.get<{ status: string; updatedAt: string }>(`/feedback/${ticketId}`);
    return data ?? null;
  } catch {
    return null;
  }
}

export default {
  submitFeedback,
  getFeedbackStatus,
};
