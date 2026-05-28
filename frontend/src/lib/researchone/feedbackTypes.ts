export type FeedbackCategory =
  | 'general_comment'
  | 'platform_complaint'
  | 'feature_suggestion'
  | 'bug_report'
  | 'integrity_report';

export interface FeedbackSubmission {
  category: FeedbackCategory;
  subject: string;
  message: string;
  attachments?: File[];
  metadata?: {
    currentPage?: string;
    userAgent?: string;
    timestamp?: string;
  };
}

export interface FeedbackResponse {
  success: boolean;
  ticketId?: string;
  message?: string;
}

export const feedbackCategories: { id: FeedbackCategory; label: string; description: string }[] = [
  {
    id: 'general_comment',
    label: 'General Comment',
    description: 'Share your thoughts or observations about the platform',
  },
  {
    id: 'platform_complaint',
    label: 'Platform Complaint',
    description: 'Report issues with platform behavior or service quality',
  },
  {
    id: 'feature_suggestion',
    label: 'Feature Suggestion',
    description: 'Propose new capabilities or improvements',
  },
  {
    id: 'bug_report',
    label: 'Bug / Technical Issue',
    description: 'Report unexpected behavior or errors',
  },
  {
    id: 'integrity_report',
    label: 'Integrity Report',
    description: 'Report concerns about research accuracy or citation integrity',
  },
];
