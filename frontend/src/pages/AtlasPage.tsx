import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Download, Plus, Map, AlertCircle, Eye } from 'lucide-react';
import { getAtlasExports, triggerAtlasExport, triggerNomicUpload } from '../utils/api';
import { formatDistanceToNow } from 'date-fns';
import { useStore } from '../store/useStore';

export default function AtlasPage() {
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [filterTags, setFilterTags] = useState('');

  const { data: exports = [] } = useQuery({
    queryKey: ['atlas-exports'],
    queryFn: getAtlasExports,
    refetchInterval: 10000,
  });

  const mutation = useMutation({
    mutationFn: triggerAtlasExport,
    onSuccess: () => {
      addNotification('info', 'Atlas export queued — this may take a few minutes.');
      qc.invalidateQueries({ queryKey: ['atlas-exports'] });
      setLabel('');
      setDescription('');
      setFilterTags('');
    },
    onError: () => {
      addNotification('error', 'Failed to queue Atlas export.');
    },
  });



  const nomicUploadMutation = useMutation({
    mutationFn: (exportId: string) => triggerNomicUpload(exportId),
    onSuccess: (data) => {
      addNotification('success', `Uploaded to Nomic Atlas (${data.datasetUrl}).`);
      qc.invalidateQueries({ queryKey: ['atlas-exports'] });
    },
    onError: (err: unknown) => {
      addNotification('error', err instanceof Error ? err.message : 'Failed to upload to Nomic Atlas.');
    },
  });

  const handleExport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    mutation.mutate({
      label: label.trim(),
      description: description.trim() || undefined,
      filterTags: filterTags ? filterTags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Layers className="text-accent" size={24} />
          Embedding Atlas
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Generate and download embedding exports for use with Nomic Embedding Atlas.
        </p>
      </div>

      {/* In-browser live viewer CTA. The Atlas page itself is for one-shot
          JSONL exports (Nomic, offline analysis, etc.). The continuous,
          tag-filterable, browser-rendered view of the live corpus —
          comparable to huggingface.co/docs/hub/datasets-embedding-atlas —
          lives on a separate page; this banner makes that obvious. */}
      <div className="card p-4 border-accent/30 bg-accent/5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Eye size={18} className="text-accent mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Browse the live corpus in-browser</div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              The Embedding Atlas page renders every embedded chunk of the
              ResearchOne corpus as an interactive 2D map (continuously
              refreshed, tag-filterable). Use it for ad-hoc exploration —
              this page below is for generating shareable JSONL exports.
            </p>
          </div>
        </div>
        <Link to="/embedding-viz" className="btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0">
          <Eye size={12} />
          Open Embedding Atlas
        </Link>
      </div>

      {/* Philosophy panel */}
      <div className="card p-5 border-indigo-900/30 space-y-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Map size={14} className="text-accent" />
          Investigation Map — Not an Oracle
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PhilosophyPoint
            color="text-research-blue"
            title="Dense Centers"
            desc="Dominant, repeated knowledge. Context, not final truth. Conventional consensus lives here."
          />
          <PhilosophyPoint
            color="text-amber-400"
            title="Outliers → Leads"
            desc="Small isolated clusters may represent suppressed, novel, or neglected information. Investigate — don't dismiss."
          />
          <PhilosophyPoint
            color="text-research-teal"
            title="Bridges → High Value"
            desc="Sparse pathways connecting separate regions indicate overlooked relationships. Trigger deeper retrieval."
          />
        </div>
        <div className="text-xs text-slate-500 border-t border-indigo-900/20 pt-3">
          Atlas helps locate investigation targets. It does not determine truth. Always reason from anomalies, not toward them.
        </div>
      </div>

      {/* Export form */}
      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-white">Create Export</h2>
        <form onSubmit={handleExport} className="space-y-3">
          <div>
            <label className="section-title block mb-1">Export Label</label>
            <input
              className="input"
              placeholder="e.g. cancer-metabolism-v1"
              value={label}
              onChange={e => setLabel(e.target.value)}
              disabled={mutation.isPending}
            />
          </div>
          <div>
            <label className="section-title block mb-1">Description</label>
            <input
              className="input"
              placeholder="Optional description of this snapshot"
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={mutation.isPending}
            />
          </div>
          <div>
            <label className="section-title block mb-1">Filter by Tags</label>
            <input
              className="input"
              placeholder="oncology, metabolism (comma-separated, leave empty for all)"
              value={filterTags}
              onChange={e => setFilterTags(e.target.value)}
              disabled={mutation.isPending}
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={!label.trim() || mutation.isPending}
          >
            <Plus size={14} />
            {mutation.isPending ? 'Queuing...' : 'Create Export'}
          </button>
        </form>
      </div>

      {/* Atlas workflow instructions */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-white mb-4">How to Use with Nomic Atlas</h2>
        <ol className="space-y-3">
          {[
            'Create an export above — the system will vectorize all corpus chunks into a JSONL file.',
            'Download the .jsonl file from your export below.',
            'Upload to Nomic Atlas at atlas.nomic.ai or use the Nomic Python SDK.',
            'In Atlas, look for: dense clusters (mainstream), isolated outliers (anomalies), sparse bridges (overlooked connections).',
            'Bring interesting points back to ResearchOne and run targeted research queries on those topics.',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* Exports list */}
      <div>
        <h2 className="section-title mb-3">Export History</h2>
        {exports.length === 0 ? (
          <div className="card p-8 text-center text-slate-500 text-sm">
            No exports yet. Create one above.
          </div>
        ) : (
          <div className="space-y-3">
            {exports.map(exp => (
              <div key={exp.id} className="card p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-white text-sm">{exp.label}</div>
                  {exp.description && (
                    <div className="text-xs text-slate-500">{exp.description}</div>
                  )}
                  <div className="text-xs text-slate-500 mt-1">
                    {exp.chunk_count > 0 ? `${exp.chunk_count.toLocaleString()} points` : 'Processing...'}
                    {' · '}
                    {formatDistanceToNow(new Date(exp.created_at), { addSuffix: true })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {exp.chunk_count > 0 ? (
                    <>
                      <a
                        href={`/api/atlas/exports/${exp.id}/download`}
                        className="btn-secondary text-xs"
                        download
                      >
                        <Download size={12} />
                        Download JSONL
                      </a>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => nomicUploadMutation.mutate(exp.id)}
                        disabled={nomicUploadMutation.isPending}
                      >
                        Upload to Nomic
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-amber-400">
                      <AlertCircle size={12} />
                      Processing
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PhilosophyPoint({ color, title, desc }: { color: string; title: string; desc: string }) {
  return (
    <div className="bg-surface-200 rounded-lg p-3">
      <div className={`text-xs font-semibold mb-1 ${color}`}>{title}</div>
      <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
    </div>
  );
}
