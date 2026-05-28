/**
 * FeedbackModal - Laboratory-style feedback interface
 * Captures feedback, complaints, and feature suggestions
 * Styled as internal communications channel, not generic helpdesk
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, AlertCircle, CheckCircle, Upload, Terminal } from 'lucide-react';
import { feedbackCategories, submitFeedback, type FeedbackCategory } from '@/lib/researchone/feedbackClient';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState<FeedbackCategory>('general_comment');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setCategory('general_comment');
      setSubject('');
      setMessage('');
      setStatus('idle');
      setErrorMessage('');
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Close when clicking outside
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    setStatus('submitting');
    setErrorMessage('');

    try {
      const response = await submitFeedback({
        category,
        subject: subject.trim(),
        message: message.trim()
      });

      if (response.success) {
        setStatus('success');
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setStatus('error');
        setErrorMessage(response.message || 'Transmission failed. Please try again.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Network error. Please check your connection.');
    }
  };

  const selectedCategory = feedbackCategories.find((c) => c.id === category);

  return (
    <AnimatePresence>
      {isOpen &&
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        onClick={handleBackdropClick}>

          <motion.div
          ref={modalRef}
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-lg bg-r1-panel border border-r1-border rounded-lg shadow-2xl overflow-hidden">

            {/* Header - Terminal style */}
            <div data-ev-id="ev_7eb8a7d89a" className="flex items-center justify-between px-4 py-3 bg-r1-panel-lift border-b border-r1-border">
              <div data-ev-id="ev_602c84c8b4" className="flex items-center gap-3">
                <Terminal className="w-4 h-4 text-r1-cyan" />
                <span data-ev-id="ev_a869edef11" className="r1-mono-label text-[10px]">COMMS_CHANNEL</span>
              </div>
              <button data-ev-id="ev_d07a974434"
            onClick={onClose}
            className="p-1 text-r1-muted hover:text-r1-text transition-colors r1-focus-ring rounded"
            aria-label="Close">

                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div data-ev-id="ev_618f5e09e3" className="p-6">
              {status === 'success' ?
            <div data-ev-id="ev_debeed06bd" className="text-center py-8">
                  <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                  <h3 data-ev-id="ev_75b5a6378a" className="text-lg font-semibold text-r1-heading mb-2">
                    Transmission Complete
                  </h3>
                  <p data-ev-id="ev_8fb638232f" className="text-sm text-r1-muted">
                    Your feedback has been logged and routed for review.
                  </p>
                </div> :

            <form data-ev-id="ev_0b6a8c91e1" onSubmit={handleSubmit} className="flex flex-col gap-5">
                  {/* Category selector */}
                  <div data-ev-id="ev_f9b4594f29">
                    <label data-ev-id="ev_6cfd7129a5" className="r1-mono-label text-[10px] mb-2 block">CATEGORY</label>
                    <div data-ev-id="ev_f546336b54" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {feedbackCategories.map((cat) =>
                  <button data-ev-id="ev_1d77268716"
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`px-3 py-2 text-xs font-medium rounded border transition-all ${
                  category === cat.id ?
                  'bg-r1-cyan/10 border-r1-cyan/40 text-r1-cyan' :
                  'bg-r1-panel border-r1-border text-r1-muted hover:border-r1-border-strong hover:text-r1-text'}`
                  }>

                          {cat.label}
                        </button>
                  )}
                    </div>
                    {selectedCategory &&
                <p data-ev-id="ev_15153ffe0c" className="mt-2 text-xs text-r1-muted/60">
                        {selectedCategory.description}
                      </p>
                }
                  </div>

                  {/* Subject */}
                  <div data-ev-id="ev_d8dccd81fc">
                    <label data-ev-id="ev_60525281d8" htmlFor="feedback-subject" className="r1-mono-label text-[10px] mb-2 block">
                      SUBJECT
                    </label>
                    <input data-ev-id="ev_2d594d9c18"
                id="feedback-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of your feedback"
                required
                className="w-full px-4 py-3 text-sm bg-r1-canvas border border-r1-border rounded text-r1-text placeholder-r1-muted/50 focus:border-r1-cyan focus:outline-none focus:ring-1 focus:ring-r1-cyan/30 transition-colors" />

                  </div>

                  {/* Message */}
                  <div data-ev-id="ev_cfe3542638">
                    <label data-ev-id="ev_384d2b07db" htmlFor="feedback-message" className="r1-mono-label text-[10px] mb-2 block">
                      MESSAGE
                    </label>
                    <textarea data-ev-id="ev_fd0807310f"
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Provide detailed information..."
                required
                rows={5}
                className="w-full px-4 py-3 text-sm bg-r1-canvas border border-r1-border rounded text-r1-text placeholder-r1-muted/50 focus:border-r1-cyan focus:outline-none focus:ring-1 focus:ring-r1-cyan/30 transition-colors resize-none" />

                  </div>

                  {/* Attachment placeholder */}
                  <div data-ev-id="ev_64c4b66b7a" className="flex items-center gap-2 px-3 py-2 border border-dashed border-r1-border rounded text-r1-muted/60">
                    <Upload className="w-4 h-4" />
                    <span data-ev-id="ev_b91619b63c" className="text-xs">Attachment support coming soon</span>
                  </div>

                  {/* Error message */}
                  {status === 'error' && errorMessage &&
              <div data-ev-id="ev_b648c1bc1a" className="flex items-center gap-2 px-3 py-2 bg-r1-red-margin border border-r1-skeptic/30 rounded">
                      <AlertCircle className="w-4 h-4 text-r1-skeptic" />
                      <span data-ev-id="ev_0169b7bf13" className="text-xs text-r1-skeptic">{errorMessage}</span>
                    </div>
              }

                  {/* Submit */}
                  <button data-ev-id="ev_a70033dbd7"
              type="submit"
              disabled={status === 'submitting' || !subject.trim() || !message.trim()}
              className="flex items-center justify-center gap-2 w-full px-4 py-3 text-sm font-semibold bg-r1-cyan text-r1-canvas rounded hover:bg-r1-cyan/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed r1-focus-ring">

                    {status === 'submitting' ?
                <>
                        <span data-ev-id="ev_1b1d2299cd" className="w-4 h-4 border-2 border-r1-canvas/30 border-t-r1-canvas rounded-full animate-spin" />
                        Transmitting...
                      </> :

                <>
                        <Send className="w-4 h-4" />
                        Submit Feedback
                      </>
                }
                  </button>
                </form>
            }
            </div>

            {/* Footer */}
            <div data-ev-id="ev_aa955c7b90" className="px-4 py-2 bg-r1-canvas border-t border-r1-border">
              <p data-ev-id="ev_f406e9e1e9" className="text-[9px] font-mono text-r1-muted/50 text-center">
                CHANNEL: FEEDBACK · ROUTING: BACKEND_DISPATCH · ENCRYPTION: TLS_1.3
              </p>
            </div>
          </motion.div>
        </motion.div>
      }
    </AnimatePresence>);

}

export default FeedbackModal;