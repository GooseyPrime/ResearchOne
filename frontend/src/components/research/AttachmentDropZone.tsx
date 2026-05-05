import { useCallback, useId, useRef, useState } from 'react';
import { Paperclip, Upload, Trash2, X, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

/**
 * Shared drag/drop attachment picker used on:
 *   - ResearchPageV2 (research request supplemental files + URLs)
 *   - ReportDetailPage (revision request supplemental files + URLs)
 *
 * The parent owns the `files` and `urls` arrays and passes them in. This
 * component renders the drop zone, a URL input, the file/URL list with
 * remove buttons, and validates each dropped file against the same allow-list
 * the backend's multer config enforces (PDF / TXT / MD).
 *
 * Files and URLs end up in the supplemental ingest pipeline server-side
 * (`ingestSupplementalForRun` for a research run, the equivalent revision
 * helper for a revision request) which queues them onto the same ingestion
 * queue used by manual corpus uploads — so attachments become reviewable
 * corpus content the models retrieve from.
 */

const MAX_FILES = 25;
const MAX_FILE_SIZE_MB = 50;
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
]);
const ALLOWED_EXTS = ['.pdf', '.txt', '.md'];

function isAllowedFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTS.some((ext) => lower.endsWith(ext));

  if (ALLOWED_MIMES.has(file.type)) return true;
  if (file.type === 'application/octet-stream') return hasAllowedExtension;

  return hasAllowedExtension;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AttachmentDropZoneProps {
  files: File[];
  urls: string[];
  onChange: (next: { files: File[]; urls: string[] }) => void;
  disabled?: boolean;
  /** Caption above the drop zone. Defaults to a generic label. */
  label?: string;
  /** Help text under the URL input. */
  description?: string;
  /** Maximum files allowed. Defaults to 25 (matches backend multer limit). */
  maxFiles?: number;
}

export default function AttachmentDropZone({
  files,
  urls,
  onChange,
  disabled = false,
  label = 'Attach supporting files / URLs',
  description = 'PDF, TXT, or Markdown. Drag-and-drop or click to browse. URLs are fetched and ingested into the corpus alongside files.',
  maxFiles = MAX_FILES,
}: AttachmentDropZoneProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const acceptFiles = useCallback(
    (incoming: FileList | File[]) => {
      const next: File[] = [...files];
      const errs: string[] = [];
      const existingKeys = new Set(files.map((f) => `${f.name}|${f.size}`));
      for (const f of Array.from(incoming)) {
        if (next.length >= maxFiles) {
          errs.push(`Reached the ${maxFiles}-file limit; "${f.name}" was ignored.`);
          continue;
        }
        if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          errs.push(`"${f.name}" exceeds the ${MAX_FILE_SIZE_MB} MB limit.`);
          continue;
        }
        if (!isAllowedFile(f)) {
          errs.push(`"${f.name}" is not an accepted type (PDF / TXT / MD).`);
          continue;
        }
        const key = `${f.name}|${f.size}`;
        if (existingKeys.has(key)) {
          errs.push(`"${f.name}" is already attached.`);
          continue;
        }
        existingKeys.add(key);
        next.push(f);
      }
      setErrors(errs);
      if (next.length !== files.length) {
        onChange({ files: next, urls });
      }
    },
    [files, urls, onChange, maxFiles]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (disabled) return;
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        acceptFiles(e.dataTransfer.files);
      }
    },
    [acceptFiles, disabled]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      setDragActive(true);
    },
    [disabled]
  );

  const onDragLeave = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const removeFile = (idx: number) => {
    const next = files.filter((_, i) => i !== idx);
    onChange({ files: next, urls });
  };

  const removeUrl = (idx: number) => {
    const next = urls.filter((_, i) => i !== idx);
    onChange({ files, urls: next });
  };

  const addUrl = () => {
    const u = urlDraft.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      setErrors([`"${u}" must start with http:// or https://`]);
      return;
    }
    if (urls.includes(u)) {
      setErrors([`"${u}" is already in the list.`]);
      return;
    }
    setErrors([]);
    onChange({ files, urls: [...urls, u] });
    setUrlDraft('');
  };

  return (
    <div className="space-y-3">
      <label className="section-title block" htmlFor={inputId}>
        {label}
      </label>

      <label
        htmlFor={inputId}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={clsx(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 transition-colors cursor-pointer text-center',
          dragActive ? 'border-accent bg-accent/10 text-accent' : 'border-indigo-900/40 bg-surface-200 text-slate-400 hover:border-accent/40 hover:text-slate-300',
          disabled && 'opacity-60 cursor-not-allowed'
        )}
      >
        <Upload size={20} />
        <p className="text-sm">
          <span className="font-semibold">Drop files here</span> or click to browse
        </p>
        <p className="text-[11px] text-slate-500">
          PDF · TXT · Markdown · max {maxFiles} files · up to {MAX_FILE_SIZE_MB} MB each
        </p>
        <input
          id={inputId}
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,text/x-markdown"
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files) acceptFiles(e.target.files);
            // Reset so re-selecting the same file fires onChange.
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      </label>

      {/* URL input row */}
      <div className="flex flex-wrap items-stretch gap-2">
        <input
          type="url"
          inputMode="url"
          placeholder="Paste a URL to ingest (https://…)"
          className="input flex-1 min-w-[16rem]"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addUrl();
            }
          }}
        />
        <button
          type="button"
          className="btn-ghost text-xs px-3 border border-accent/30 text-accent rounded-lg"
          onClick={addUrl}
          disabled={disabled || !urlDraft.trim()}
        >
          Add URL
        </button>
      </div>
      {description && <p className="text-xs text-slate-500 -mt-1">{description}</p>}

      {/* Errors */}
      {errors.length > 0 && (
        <ul className="space-y-1">
          {errors.map((e, i) => (
            <li key={i} className="text-xs text-amber-300 flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Selected list */}
      {(files.length > 0 || urls.length > 0) && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              Attached ({files.length} file{files.length === 1 ? '' : 's'} · {urls.length} URL{urls.length === 1 ? '' : 's'})
            </span>
            {(files.length > 0 || urls.length > 0) && (
              <button
                type="button"
                className="text-[10px] text-slate-500 hover:text-slate-300"
                onClick={() => {
                  setErrors([]);
                  onChange({ files: [], urls: [] });
                }}
                disabled={disabled}
              >
                Clear all
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {files.map((f, i) => (
              <li
                key={`f-${f.name}-${f.size}-${i}`}
                className="flex items-center gap-2 rounded-md bg-surface-200/60 border border-surface-100/30 px-2 py-1.5 text-xs"
              >
                <Paperclip size={12} className="text-slate-500 flex-shrink-0" />
                <span className="text-slate-300 truncate flex-1 min-w-0" title={f.name}>{f.name}</span>
                <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  className="text-slate-500 hover:text-red-400 flex-shrink-0"
                  onClick={() => removeFile(i)}
                  disabled={disabled}
                  aria-label={`Remove ${f.name}`}
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
            {urls.map((u, i) => (
              <li
                key={`u-${u}-${i}`}
                className="flex items-center gap-2 rounded-md bg-surface-200/60 border border-surface-100/30 px-2 py-1.5 text-xs"
              >
                <span className="text-[10px] uppercase text-slate-500 font-mono flex-shrink-0">URL</span>
                <span className="text-slate-300 truncate flex-1 min-w-0" title={u}>{u}</span>
                <button
                  type="button"
                  className="text-slate-500 hover:text-red-400 flex-shrink-0"
                  onClick={() => removeUrl(i)}
                  disabled={disabled}
                  aria-label={`Remove ${u}`}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
