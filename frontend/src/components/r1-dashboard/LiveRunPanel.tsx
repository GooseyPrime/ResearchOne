import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, AlertCircle, CheckCircle, Clock, FileText, XCircle } from 'lucide-react';
import { pipelineStages, evidenceTierMeta } from '@/content/researchoneUiData';
import type { AgentActivity, ResearchRun } from '@/lib/researchone/types';
import { getResearchRun, type ResearchProgressEvent } from '@/utils/api';
import { getSocket, subscribeToJob } from '@/utils/socket';
import { mapApiRunStage, mapApiRunStatus, mapApiRunToVaultRun } from '@/lib/researchone/runMappers';

function progressToActivity(evt: ResearchProgressEvent): AgentActivity {
  return {
    id: `${evt.timestamp ?? Date.now()}-${evt.stage}`,
    agent: evt.stage,
    action: evt.message || evt.stage,
    detail: evt.detail,
    timestamp: evt.timestamp ?? new Date().toISOString(),
  };
}

export function LiveRunPanel() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [liveProgress, setLiveProgress] = useState<ResearchProgressEvent | null>(null);
  const [activities, setActivities] = useState<AgentActivity[]>([]);

  const { data: apiRun, isLoading, isError } = useQuery({
    queryKey: ['research-run', runId],
    queryFn: () => getResearchRun(runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return false;
      return status === 'queued' || status === 'running' || status === 'plan_pending_confirmation'
        ? 5000
        : false;
    },
  });

  const run: ResearchRun | null = useMemo(() => {
    if (!apiRun) return null;
    const mapped = mapApiRunToVaultRun(apiRun);
    if (liveProgress) {
      mapped.currentStage = mapApiRunStage(liveProgress.stage);
      mapped.progress = liveProgress.percent ?? mapped.progress;
      mapped.status = mapApiRunStatus(apiRun.status);
    }
    return mapped;
  }, [apiRun, liveProgress]);

  useEffect(() => {
    if (!runId) return;
    subscribeToJob(runId);
    const socket = getSocket();

    const onProgress = (raw: ResearchProgressEvent) => {
      if (raw.runId && raw.runId !== runId) return;
      setLiveProgress(raw);
      setActivities((prev) => [progressToActivity(raw), ...prev].slice(0, 12));
    };

    const onCompleted = (result: { runId: string; reportId: string }) => {
      if (result.runId !== runId) return;
      queryClient.invalidateQueries({ queryKey: ['research-run', runId] });
      queryClient.invalidateQueries({ queryKey: ['research-runs'] });
      setTimeout(() => navigate('/app/dossiers'), 1500);
    };

    socket.on('research:progress', onProgress);
    socket.on('research:completed', onCompleted);

    return () => {
      socket.off('research:progress', onProgress);
      socket.off('research:completed', onCompleted);
    };
  }, [runId, navigate, queryClient]);

  if (!runId) {
    return (
      <div className="r1-panel p-8 text-center">
        <p className="text-r1-muted">No run selected.</p>
      </div>
    );
  }

  if (isLoading || !run) {
    return (
      <div className="r1-panel p-8 text-center">
        <Clock className="w-6 h-6 text-r1-cyan animate-spin mx-auto" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="r1-panel p-8 text-center">
        <AlertCircle className="w-8 h-8 text-r1-skeptic mx-auto mb-3" />
        <p className="text-r1-muted">Unable to load run {runId}.</p>
      </div>
    );
  }

  const currentStageIndex = pipelineStages.findIndex((s) => s.id === run.currentStage);
  const tierMeta = evidenceTierMeta[run.evidenceTier];

  return (
    <div data-ev-id="ev_cfa4914a0f" className="pb-12 bg-r1-canvas">
      <div data-ev-id="ev_1b7c4be3ff" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div data-ev-id="ev_a8d837ca3f" className="mb-8">
          <div data-ev-id="ev_3191dca8d0" className="flex items-center gap-3 mb-3">
            <span data-ev-id="ev_1c1bd93e12" className="r1-tag r1-tag-cyan">
              <span data-ev-id="ev_f379d3980b" className="w-1.5 h-1.5 rounded-full bg-r1-cyan animate-pulse" />
              LIVE_RUN
            </span>
            <span data-ev-id="ev_41fe32eb5f" className="r1-mono-label text-[10px] text-r1-dim">
              {run.id.toUpperCase()}
            </span>
          </div>
          <h1 data-ev-id="ev_47cb6b2322" className="text-xl sm:text-2xl font-bold text-r1-heading">
            {run.query}
          </h1>
        </div>

        <div data-ev-id="ev_9a93fd7d1d" className="grid lg:grid-cols-3 gap-6">
          <div data-ev-id="ev_ebec521a5b" className="lg:col-span-2 flex flex-col gap-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="r1-panel p-6">
              <div data-ev-id="ev_ccab3ab028" className="flex items-center justify-between mb-4">
                <span data-ev-id="ev_4c69514c03" className="r1-mono-label text-[10px]">
                  PIPELINE_PROGRESS
                </span>
                <span data-ev-id="ev_5677f8313f" className="text-lg font-semibold text-r1-cyan">
                  {run.progress}%
                </span>
              </div>

              <div data-ev-id="ev_05dae38f19" className="h-2 bg-r1-panel-lift rounded-full overflow-hidden mb-6">
                <motion.div
                  className="h-full bg-gradient-to-r from-r1-cyan to-r1-cyan/70 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${run.progress}%` }}
                  transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
                />
              </div>

              <div data-ev-id="ev_6faf40d4d7" className="grid grid-cols-5 sm:grid-cols-10 gap-3">
                {pipelineStages.map((stage, index) => {
                  const isComplete = index < currentStageIndex;
                  const isCurrent = index === currentStageIndex;
                  return (
                    <div key={stage.id} className="text-center">
                      <div
                        className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center text-[10px] font-mono mb-1 ${
                          isComplete
                            ? 'bg-r1-green/20 text-r1-green border border-r1-green/40'
                            : isCurrent
                              ? 'bg-r1-cyan/20 text-r1-cyan border border-r1-cyan/50 r1-glow-cyan'
                              : 'bg-r1-panel-lift text-r1-dim border border-r1-border'
                        }`}
                      >
                        {isComplete ? <CheckCircle className="w-3 h-3" /> : index + 1}
                      </div>
                      <span className="r1-mono-label text-[8px] hidden sm:block">{stage.name.split(' ')[0]}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>

            <div className="r1-panel p-6">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-r1-cyan" />
                <span className="r1-mono-label text-[10px]">AGENT_ACTIVITY</span>
              </div>
              <AnimatePresence mode="popLayout">
                {(activities.length > 0 ? activities : [{ id: 'boot', agent: 'System', action: liveProgress?.message || 'Awaiting pipeline events…', timestamp: run.updatedAt }]).map(
                  (activity) => (
                    <motion.div
                      key={activity.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="py-3 border-b border-r1-border last:border-b-0"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium text-r1-heading">{activity.agent}</span>
                        <span className="r1-mono-label text-[9px] text-r1-dim">
                          {new Date(activity.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-r1-muted">{activity.action}</p>
                      {activity.detail && <p className="text-xs text-r1-dim mt-1">{activity.detail}</p>}
                    </motion.div>
                  ),
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="r1-panel p-6">
              <span className="r1-mono-label text-[10px] mb-4 block">RUN_STATUS</span>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-r1-muted">Status</span>
                  <span className="text-r1-cyan capitalize">{run.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-r1-muted">Stage</span>
                  <span className="text-r1-text capitalize">{run.currentStage.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-r1-muted">Evidence tier</span>
                  <span className={`r1-tag text-[9px] ${tierMeta.color === 'green' ? 'r1-tag-green' : 'r1-tag-cyan'}`}>
                    {tierMeta.label.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {run.status === 'complete' && (
              <button
                type="button"
                onClick={() => navigate('/app/dossiers')}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-r1-cyan text-r1-canvas rounded hover:bg-r1-cyan/90 transition-colors r1-focus-ring"
              >
                <FileText className="w-4 h-4" />
                View Dossiers
              </button>
            )}

            {run.status === 'failed' && (
              <div className="r1-panel p-4 border-r1-skeptic/30">
                <div className="flex items-start gap-2">
                  <XCircle className="w-4 h-4 text-r1-skeptic flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-r1-skeptic">{run.error || 'Research run failed.'}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LiveRunPanel;
