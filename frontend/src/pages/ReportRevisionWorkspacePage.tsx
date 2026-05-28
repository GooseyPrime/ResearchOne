import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  createReportRevision,
  extractApiError,
  getReport,
  type ResearchProgressEvent,
} from '@/utils/api';
import LiveRevisionTraceLog from '@/components/research/LiveRevisionTraceLog';
import { appendKeepingNewestAtBottom } from '@/utils/traceEventWindow';
import { getSocket, subscribeToJob, subscribeToRevisionJob } from '@/utils/socket';
import {
  isReportRevisionRequestState,
  type ReportRevisionRequestState,
} from '@/types/reportRevisionNavigation';
import { useStore } from '@/store/useStore';

type RevisionProgressPayload = {
  reportId?: string;
  stage?: string;
  percent?: number;
  message?: string;
  timestamp?: string;
};

type RevisionCompletedPayload = {
  revisionId?: string;
  revisedReportId?: string;
};

function toTraceEvent(payload: RevisionProgressPayload): ResearchProgressEvent {
  return {
    stage: payload.stage || 'revision',
    percent: typeof payload.percent === 'number' ? payload.percent : 0,
    message: payload.message || payload.stage || 'Update',
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}

export default function ReportRevisionWorkspacePage() {
  const { baseReportId } = useParams<{ baseReportId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const requestState = isReportRevisionRequestState(location.state)
    ? (location.state as ReportRevisionRequestState)
    : null;
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  const [traceEvents, setTraceEvents] = useState<ResearchProgressEvent[]>([]);
  const [latestProgress, setLatestProgress] = useState<{
    stage: string;
    percent: number;
    message: string;
  } | null>(null);

  const { data: baseReport } = useQuery({
    queryKey: ['report', baseReportId],
    queryFn: () => getReport(baseReportId!),
    enabled: Boolean(baseReportId),
  });

  const finishRevision = useCallback(
    (revisedReportId: string) => {
      if (completedRef.current) return;
      completedRef.current = true;
      qc.invalidateQueries({ queryKey: ['report-revisions', baseReportId] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      addNotification('success', 'Revision complete — opening the new report version.');
      navigate(`/app/reports/${revisedReportId}`, { replace: true });
    },
    [addNotification, baseReportId, navigate, qc],
  );

  const revisionMutation = useMutation({
    mutationFn: () =>
      createReportRevision(baseReportId!, {
        requestText: requestState!.requestText.trim(),
        rationale: requestState!.rationale?.trim() || undefined,
        revisionFiles:
          requestState!.revisionFiles && requestState!.revisionFiles.length > 0
            ? requestState!.revisionFiles
            : undefined,
        revisionUrls:
          requestState!.revisionUrls && requestState!.revisionUrls.length > 0
            ? requestState!.revisionUrls
            : undefined,
      }),
    onSuccess: (data) => {
      if (data.revisedReportId) {
        finishRevision(data.revisedReportId);
      }
    },
    onError: (err: unknown) => {
      addNotification('error', extractApiError(err));
      navigate(`/app/reports/${baseReportId}`, { replace: true });
    },
  });

  useEffect(() => {
    if (!baseReportId) return;
    subscribeToJob(baseReportId);
    subscribeToRevisionJob(baseReportId);
    const sock = getSocket();

    const onProgress = (raw: unknown) => {
      const p = raw as RevisionProgressPayload;
      if (p.reportId && p.reportId !== baseReportId) return;
      const evt = toTraceEvent(p);
      setTraceEvents((prev) => appendKeepingNewestAtBottom(prev, evt, 150));
      setLatestProgress({
        stage: evt.stage,
        percent: evt.percent ?? 0,
        message: evt.message,
      });
    };

    const onCompleted = (raw: unknown) => {
      const p = raw as RevisionCompletedPayload;
      if (!p.revisedReportId) return;
      finishRevision(p.revisedReportId);
    };

    sock.on('revision:progress', onProgress);
    sock.on('revision:completed', onCompleted);
    return () => {
      sock.off('revision:progress', onProgress);
      sock.off('revision:completed', onCompleted);
    };
  }, [baseReportId, finishRevision]);

  useEffect(() => {
    if (!baseReportId || !requestState || startedRef.current) return;
    startedRef.current = true;
    setLatestProgress({ stage: 'queued', percent: 0, message: 'Starting revision pipeline…' });
    revisionMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when workspace opens with valid state
  }, [baseReportId, requestState]);

  useEffect(() => {
    if (!baseReportId) return;
    if (!requestState) {
      navigate(`/app/reports/${baseReportId}`, { replace: true });
    }
  }, [baseReportId, requestState, navigate]);

  const requestPreview = useMemo(() => {
    if (!requestState) return '';
    const text = requestState.requestText.trim();
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
  }, [requestState]);

  if (!baseReportId || !requestState) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/app/reports/${baseReportId}`}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft size={14} />
          Back to prior report version
        </Link>
        <span className="text-xs text-slate-500">
          This workspace tracks only the current revision — separate from the original report run.
        </span>
      </div>

      <div className="card p-5 space-y-2">
        <h1 className="text-lg font-semibold text-white">Revision in progress</h1>
        {baseReport?.title && (
          <p className="text-sm text-slate-400">
            Base report: <span className="text-slate-200">{baseReport.title}</span>
          </p>
        )}
        <p className="text-sm text-slate-300 border-l-2 border-indigo-500/50 pl-3">{requestPreview}</p>
      </div>

      <LiveRevisionTraceLog
        traceEvents={traceEvents}
        latestPercent={latestProgress?.percent}
        latestMessage={latestProgress?.message}
      />
    </div>
  );
}
