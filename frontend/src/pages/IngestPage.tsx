import { useState, useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import {
  Upload,
  Globe,
  FileText,
  File,
  CheckCircle2,
  Clock,
  AlertCircle,
  X,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  ingestUrl,
  ingestText,
  ingestFile,
  getIngestionJobs,
  getResearchRuns,
  clearCorpus,
  deleteCorpusByIngestionJobs,
  deleteCorpusByResearchRun,
  CORPUS_CLEAR_CONFIRM_PHRASE,
  ADMIN_SESSION_TOKEN_KEY,
  type IngestionJob,
} from '../utils/api';
import { useStore } from '../store/useStore';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

type IngestTab = 'url' | 'text' | 'file';

function provenanceLabel(job: IngestionJob): string {
  const run =
    job.discovered_by_run_id ??
    (typeof job.metadata?.discovery_run_id === 'string' ? job.metadata.discovery_run_id : null);
  if (job.imported_via === 'autonomous_discovery' || run) {
    return run ? `discovery · ${run.slice(0, 8)}…` : 'discovery';
  }
  if (job.imported_via) return job.imported_via;
  return '—';
}

export default function IngestPage() {
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const [tab, setTab] = useState<IngestTab>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [tags, setTags] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(() => new Set());
  const [clearAck, setClearAck] = useState(false);
  const [clearPhrase, setClearPhrase] = useState('');
  const [runToDelete, setRunToDelete] = useState('');
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [confirmRunOpen, setConfirmRunOpen] = useState(false);

  useEffect(() => {
    setAdminToken(sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY));
  }, []);

  const ensureAdminToken = useCallback(() => {
    let t = sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY);
    if (!t) {
      t = window.prompt('Enter admin token')?.trim() ?? '';
      if (t) sessionStorage.setItem(ADMIN_SESSION_TOKEN_KEY, t);
    }
    setAdminToken(t || null);
    return t || null;
  }, []);

  const invalidateCorpusQueries = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ingestion-jobs'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    window.dispatchEvent(new CustomEvent('corpus:updated'));
  }, [qc]);

  const { data: jobs = [] } = useQuery({
    queryKey: ['ingestion-jobs'],
    queryFn: getIngestionJobs,
    refetchInterval: 5000,
  });

  const { data: researchRuns = [] } = useQuery({
    queryKey: ['research-runs', 'ingest-admin'],
    queryFn: () => getResearchRuns(),
    enabled: Boolean(adminToken),
  });

  const jobsWithSource = useMemo(
    () => jobs.filter(j => Boolean(j.source_id)),
    [jobs]
  );

  const urlMutation = useMutation({
    mutationFn: ingestUrl,
    onSuccess: () => {
      addNotification('info', 'URL queued for ingestion.');
      setUrl('');
      qc.invalidateQueries({ queryKey: ['ingestion-jobs'] });
    },
    onError: () => addNotification('error', 'Failed to queue URL.'),
  });

  const textMutation = useMutation({
    mutationFn: ingestText,
    onSuccess: () => {
      addNotification('info', 'Text queued for ingestion.');
      setText('');
      setTextTitle('');
      qc.invalidateQueries({ queryKey: ['ingestion-jobs'] });
    },
    onError: () => addNotification('error', 'Failed to queue text.'),
  });

  const fileMutation = useMutation({
    mutationFn: ({ file, tags: t }: { file: File; tags: string[] }) => ingestFile(file, t),
    onSuccess: () => {
      addNotification('info', 'File queued for ingestion.');
      setPendingFiles([]);
      qc.invalidateQueries({ queryKey: ['ingestion-jobs'] });
    },
    onError: () => addNotification('error', 'Failed to queue file.'),
  });

  const clearCorpusMutation = useMutation({
    mutationFn: () => {
      const token = adminToken ?? ensureAdminToken();
      if (!token) throw new Error('No admin token');
      return clearCorpus(token, { confirmPhrase: CORPUS_CLEAR_CONFIRM_PHRASE });
    },
    onSuccess: res => {
      addNotification('info', `Corpus cleared (${res.deleted.sources} sources removed).`);
      setClearAck(false);
      setClearPhrase('');
      setSelectedJobIds(new Set());
      invalidateCorpusQueries();
    },
    onError: (e: unknown) => {
      const unauthorized = axios.isAxiosError(e) && e.response?.status === 401;
      addNotification('error', unauthorized ? 'Unauthorized — check admin token.' : 'Corpus clear failed.');
      if (unauthorized) sessionStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
    },
  });

  const deleteJobsMutation = useMutation({
    mutationFn: (jobIds: string[]) => {
      const token = adminToken ?? ensureAdminToken();
      if (!token) throw new Error('No admin token');
      return deleteCorpusByIngestionJobs(token, { jobIds });
    },
    onSuccess: res => {
      addNotification(
        'info',
        `Removed ${res.deletedSourcesCount} source(s). ${res.skippedJobIds.length ? `${res.skippedJobIds.length} job(s) had no corpus row (duplicate or failed).` : ''}`
      );
      setSelectedJobIds(new Set());
      setConfirmBulkOpen(false);
      invalidateCorpusQueries();
    },
    onError: (e: unknown) => {
      const unauthorized = axios.isAxiosError(e) && e.response?.status === 401;
      addNotification('error', unauthorized ? 'Unauthorized.' : 'Delete failed.');
      if (unauthorized) sessionStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
    },
  });

  const deleteRunMutation = useMutation({
    mutationFn: (runId: string) => {
      const token = adminToken ?? ensureAdminToken();
      if (!token) throw new Error('No admin token');
      return deleteCorpusByResearchRun(token, { runId });
    },
    onSuccess: res => {
      addNotification('info', `Removed ${res.deletedSourcesCount} source(s) for run.`);
      setRunToDelete('');
      setConfirmRunOpen(false);
      invalidateCorpusQueries();
    },
    onError: (e: unknown) => {
      const unauthorized = axios.isAxiosError(e) && e.response?.status === 401;
      addNotification('error', unauthorized ? 'Unauthorized.' : 'Delete failed.');
      if (unauthorized) sessionStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
    },
  });

  const parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    urlMutation.mutate({ url: url.trim(), tags: parsedTags });
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    textMutation.mutate({ text: text.trim(), title: textTitle.trim() || undefined, tags: parsedTags });
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setPendingFiles(prev => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'application/pdf': ['.pdf'],
    },
    maxSize: 50 * 1024 * 1024,
  });

  const handleFileUpload = () => {
    if (pendingFiles.length === 0) return;
    for (const file of pendingFiles) {
      fileMutation.mutate({ file, tags: parsedTags });
    }
  };

  const toggleJob = (id: string) => {
    setSelectedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllWithSource = () => {
    setSelectedJobIds(new Set(jobsWithSource.map(j => j.id)));
  };

  const clearSelection = () => setSelectedJobIds(new Set());

  const canClear =
    clearAck &&
    clearPhrase === CORPUS_CLEAR_CONFIRM_PHRASE &&
    !clearCorpusMutation.isPending;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Upload className="text-accent" size={24} />
          Ingest Sources
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Add URLs, documents, or text to the research corpus. All sources are chunked and embedded automatically.
        </p>
      </div>

      {adminToken ? (
        <div className="card p-6 border border-red-900/40 space-y-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="text-amber-400 flex-shrink-0 mt-0.5" size={22} />
            <div>
              <h2 className="text-lg font-semibold text-white">Administrative corpus controls</h2>
              <p className="text-slate-400 text-sm mt-1">
                Destructive actions remove evidence from the database. Reports are kept; citations may point to removed
                chunks or sources. Use an admin token (same as Models / runtime tools).
              </p>
            </div>
          </div>

          <div className="space-y-3 border-t border-indigo-900/30 pt-4">
            <h3 className="text-sm font-medium text-slate-300">Clear entire corpus</h3>
            <p className="text-xs text-slate-500">
              Deletes all sources, chunks, embeddings (via cascade), all claims, and all ingestion job history.
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={clearAck}
                onChange={e => setClearAck(e.target.checked)}
                className="rounded border-indigo-800"
              />
              I understand this cannot be undone.
            </label>
            <div>
              <label className="section-title block mb-1 text-xs">Type the phrase to confirm</label>
              <input
                className="input font-mono text-sm"
                placeholder={CORPUS_CLEAR_CONFIRM_PHRASE}
                value={clearPhrase}
                onChange={e => setClearPhrase(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-950/80 text-red-200 border border-red-800 hover:bg-red-900 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!canClear}
              onClick={() => clearCorpusMutation.mutate()}
            >
              <Trash2 size={14} />
              {clearCorpusMutation.isPending ? 'Clearing…' : 'Clear corpus'}
            </button>
          </div>

          <div className="space-y-2 border-t border-indigo-900/30 pt-4">
            <h3 className="text-sm font-medium text-slate-300">Remove sources by research run</h3>
            <p className="text-xs text-slate-500">
              Deletes corpus sources discovered during that run (<code className="text-slate-400">discovered_by_run_id</code>
              ).
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                className="input text-sm max-w-md flex-1 min-w-[12rem]"
                value={runToDelete}
                onChange={e => setRunToDelete(e.target.value)}
              >
                <option value="">Select a research run…</option>
                {researchRuns.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.title.slice(0, 60)}
                    {r.title.length > 60 ? '…' : ''} — {r.status}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-950/80 text-red-200 border border-red-800 hover:bg-red-900 disabled:opacity-40"
                disabled={!runToDelete || deleteRunMutation.isPending}
                onClick={() => setConfirmRunOpen(true)}
              >
                Delete sources for run
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-400">Admin token required for corpus reset and selective deletion.</p>
          <button type="button" className="btn-primary text-sm py-1.5" onClick={() => ensureAdminToken()}>
            Load administrative controls
          </button>
        </div>
      )}

      <div className="card p-6 space-y-5">
        <div className="flex gap-1 bg-surface-200 p-1 rounded-lg w-fit">
          {([
            { id: 'url', label: 'URL', icon: Globe },
            { id: 'text', label: 'Text', icon: FileText },
            { id: 'file', label: 'File', icon: File },
          ] as const).map(t => (
            <button
              key={t.id}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all',
                tab === t.id ? 'bg-surface-300 text-white border border-indigo-900/40' : 'text-slate-400 hover:text-white'
              )}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>

        <div>
          <label className="section-title block mb-1">Tags</label>
          <input
            className="input"
            placeholder="oncology, metabolism, anomaly (comma-separated)"
            value={tags}
            onChange={e => setTags(e.target.value)}
          />
        </div>

        {tab === 'url' && (
          <form onSubmit={handleUrlSubmit} className="space-y-3">
            <div>
              <label className="section-title block mb-1">URL</label>
              <input
                className="input"
                placeholder="https://..."
                value={url}
                onChange={e => setUrl(e.target.value)}
                disabled={urlMutation.isPending}
                type="url"
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={!url.trim() || urlMutation.isPending}
            >
              <Plus size={14} />
              {urlMutation.isPending ? 'Queuing...' : 'Ingest URL'}
            </button>
          </form>
        )}

        {tab === 'text' && (
          <form onSubmit={handleTextSubmit} className="space-y-3">
            <div>
              <label className="section-title block mb-1">Title</label>
              <input
                className="input"
                placeholder="Document title (optional)"
                value={textTitle}
                onChange={e => setTextTitle(e.target.value)}
                disabled={textMutation.isPending}
              />
            </div>
            <div>
              <label className="section-title block mb-1">Content</label>
              <textarea
                className="textarea min-h-40"
                placeholder="Paste text content here — abstracts, papers, notes, transcripts..."
                value={text}
                onChange={e => setText(e.target.value)}
                disabled={textMutation.isPending}
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={!text.trim() || textMutation.isPending}
            >
              <Plus size={14} />
              {textMutation.isPending ? 'Queuing...' : 'Ingest Text'}
            </button>
          </form>
        )}

        {tab === 'file' && (
          <div className="space-y-3">
            <div
              {...getRootProps()}
              className={clsx(
                'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
                isDragActive
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-indigo-900/40 text-slate-500 hover:border-accent/40 hover:text-slate-300'
              )}
            >
              <input {...getInputProps()} />
              <Upload size={24} className="mx-auto mb-3 opacity-60" />
              <p className="text-sm font-medium">
                {isDragActive ? 'Drop files here' : 'Drag & drop files, or click to select'}
              </p>
              <p className="text-xs mt-1 opacity-60">PDF and TXT files, up to 50MB each</p>
            </div>

            {pendingFiles.length > 0 && (
              <div className="space-y-2">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 bg-surface-200 rounded-lg">
                    <File size={14} className="text-accent flex-shrink-0" />
                    <span className="text-sm text-slate-300 flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-slate-500">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-white"
                      onClick={() => setPendingFiles(files => files.filter((_, j) => j !== i))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleFileUpload}
                  disabled={fileMutation.isPending}
                >
                  <Upload size={14} />
                  {fileMutation.isPending ? 'Uploading...' : `Upload ${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="section-title">Ingestion history</h2>
          {adminToken && jobs.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <button type="button" className="text-accent hover:underline" onClick={selectAllWithSource}>
                Select all with corpus row ({jobsWithSource.length})
              </button>
              <span className="text-slate-600">·</span>
              <button type="button" className="text-slate-400 hover:text-white" onClick={clearSelection}>
                Clear selection
              </button>
              <button
                type="button"
                className="ml-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-red-950/70 text-red-200 border border-red-800 disabled:opacity-40"
                disabled={selectedJobIds.size === 0 || deleteJobsMutation.isPending}
                onClick={() => setConfirmBulkOpen(true)}
              >
                <Trash2 size={12} />
                Delete selected ({selectedJobIds.size})
              </button>
            </div>
          )}
        </div>
        {jobs.length === 0 ? (
          <div className="card p-6 text-center text-slate-500 text-sm">
            No ingestion jobs yet.
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map(job => (
              <JobRow
                key={job.id}
                job={job}
                adminMode={Boolean(adminToken)}
                selected={selectedJobIds.has(job.id)}
                onToggle={() => toggleJob(job.id)}
              />
            ))}
          </div>
        )}
      </div>

      {confirmBulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-md w-full p-6 space-y-4 border border-red-900/50">
            <h3 className="text-lg font-semibold text-white">Remove selected sources?</h3>
            <p className="text-sm text-slate-400">
              This deletes the corpus rows for {selectedJobIds.size} selected job(s). Jobs without a stored source (failed
              ingest or duplicate content) are skipped.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm text-slate-400 hover:text-white" onClick={() => setConfirmBulkOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-sm bg-red-900 text-white hover:bg-red-800"
                onClick={() => deleteJobsMutation.mutate([...selectedJobIds])}
              >
                {deleteJobsMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmRunOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-md w-full p-6 space-y-4 border border-red-900/50">
            <h3 className="text-lg font-semibold text-white">Delete sources for this run?</h3>
            <p className="text-sm text-slate-400">
              All sources with <code className="text-slate-500">discovered_by_run_id</code> matching this run will be
              removed from the corpus.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm text-slate-400 hover:text-white" onClick={() => setConfirmRunOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-sm bg-red-900 text-white hover:bg-red-800"
                onClick={() => runToDelete && deleteRunMutation.mutate(runToDelete)}
              >
                {deleteRunMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JobRow({
  job,
  adminMode,
  selected,
  onToggle,
}: {
  job: IngestionJob;
  adminMode: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const icons = {
    queued: <Clock size={13} className="text-slate-400" />,
    running: <Upload size={13} className="text-accent animate-spin" />,
    completed: <CheckCircle2 size={13} className="text-green-400" />,
    failed: <AlertCircle size={13} className="text-red-400" />,
    cancelled: <AlertCircle size={13} className="text-slate-500" />,
  };

  const canSelect = Boolean(job.source_id);
  const label = job.url ?? job.file_name ?? 'Unknown';

  return (
    <div
      className={clsx(
        'card p-3 flex items-start gap-3',
        adminMode && selected && 'ring-1 ring-red-800/60'
      )}
    >
      {adminMode && (
        <input
          type="checkbox"
          className="mt-1 rounded border-indigo-800 flex-shrink-0"
          checked={selected}
          disabled={!canSelect}
          title={
            canSelect
              ? 'Select to remove this source from the corpus'
              : 'No corpus source for this job (failed, running, or duplicate skip)'
          }
          onChange={onToggle}
        />
      )}
      <div className="flex-shrink-0 pt-0.5">{icons[job.status]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-300 truncate">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {provenanceLabel(job)}
          {job.source_id ? (
            <span className="text-slate-600"> · source {job.source_id.slice(0, 8)}…</span>
          ) : null}
        </p>
        {job.error_message && <p className="text-xs text-red-400 truncate mt-1">{job.error_message}</p>}
      </div>
      <div className="flex-shrink-0 text-right">
        <span className="text-xs text-slate-500 block">{job.source_type}</span>
        <span className="text-xs text-slate-600">
          {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}
