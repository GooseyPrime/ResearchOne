import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
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
} from 'lucide-react';
import { ingestUrl, ingestText, ingestFile, getIngestionJobs, IngestionJob } from '../utils/api';
import { useStore } from '../store/useStore';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

type IngestTab = 'url' | 'text' | 'file';

export default function IngestPage() {
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const [tab, setTab] = useState<IngestTab>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [tags, setTags] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const { data: jobs = [] } = useQuery({
    queryKey: ['ingestion-jobs'],
    queryFn: getIngestionJobs,
    refetchInterval: 5000,
  });

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
    mutationFn: ({ file, tags }: { file: File; tags: string[] }) => ingestFile(file, tags),
    onSuccess: () => {
      addNotification('info', 'File queued for ingestion.');
      setPendingFiles([]);
      qc.invalidateQueries({ queryKey: ['ingestion-jobs'] });
    },
    onError: () => addNotification('error', 'Failed to queue file.'),
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

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Upload className="text-accent" size={24} />
          Ingest Sources
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Add URLs, documents, or text to the research corpus. All sources are chunked and embedded automatically.
        </p>
      </div>

      {/* Tabs */}
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

        {/* Tags (shared) */}
        <div>
          <label className="section-title block mb-1">Tags</label>
          <input
            className="input"
            placeholder="oncology, metabolism, anomaly (comma-separated)"
            value={tags}
            onChange={e => setTags(e.target.value)}
          />
        </div>

        {/* URL tab */}
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

        {/* Text tab */}
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

        {/* File tab */}
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
                      className="text-slate-500 hover:text-white"
                      onClick={() => setPendingFiles(files => files.filter((_, j) => j !== i))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
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

      {/* Job history */}
      <div>
        <h2 className="section-title mb-3">Ingestion Queue</h2>
        {jobs.length === 0 ? (
          <div className="card p-6 text-center text-slate-500 text-sm">
            No ingestion jobs yet.
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map(job => <JobRow key={job.id} job={job} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function JobRow({ job }: { job: IngestionJob }) {
  const icons = {
    queued: <Clock size={13} className="text-slate-400" />,
    running: <Upload size={13} className="text-accent animate-spin" />,
    completed: <CheckCircle2 size={13} className="text-green-400" />,
    failed: <AlertCircle size={13} className="text-red-400" />,
    cancelled: <AlertCircle size={13} className="text-slate-500" />,
  };

  return (
    <div className="card p-3 flex items-center gap-3">
      {icons[job.status]}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-300 truncate">{job.url ?? job.file_name ?? 'Unknown'}</p>
        {job.error_message && (
          <p className="text-xs text-red-400 truncate">{job.error_message}</p>
        )}
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
