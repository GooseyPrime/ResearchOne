import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import {
  createFeedbackSubmission,
  getFeedbackSubmissionForUser,
  isFeedbackCategory,
} from '../../services/feedback/feedbackSubmissions';

const router = Router();
router.use(requireAuth);

const MAX_SUBJECT_LEN = 200;
const MAX_MESSAGE_LEN = 10_000;

router.post('/', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { category, subject, message, metadata } = req.body ?? {};

    if (!isFeedbackCategory(category)) {
      res.status(400).json({ error: 'Invalid feedback category' });
      return;
    }
    if (typeof subject !== 'string' || !subject.trim()) {
      res.status(400).json({ error: 'Subject is required' });
      return;
    }
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }
    if (subject.trim().length > MAX_SUBJECT_LEN) {
      res.status(400).json({ error: `Subject must be at most ${MAX_SUBJECT_LEN} characters` });
      return;
    }
    if (message.trim().length > MAX_MESSAGE_LEN) {
      res.status(400).json({ error: `Message must be at most ${MAX_MESSAGE_LEN} characters` });
      return;
    }

    const meta =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : null;

    const created = await createFeedbackSubmission({
      userId,
      category,
      subject,
      message,
      metadata: meta,
    });

    if (!created) {
      res.status(503).json({
        success: false,
        message: 'Feedback storage is not available on this deployment yet.',
      });
      return;
    }

    res.status(201).json({
      success: true,
      ticketId: created.id,
      message: 'Feedback received. Thank you.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:ticketId', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const row = await getFeedbackSubmissionForUser(userId, req.params.ticketId);
    if (!row) {
      res.status(404).json({ error: 'Feedback submission not found' });
      return;
    }

    res.json({
      status: row.status,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
