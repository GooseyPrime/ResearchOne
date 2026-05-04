import { useState, useEffect } from 'react';
import { Settings, Save, CheckSquare } from 'lucide-react';
import {
  getAdminModels,
  putAdminModels,
  ADMIN_SESSION_TOKEN_KEY,
  type ModelOverrideEntry,
  type AdminModelsResponse,
} from '../utils/api';

const REASONING_ROLES: { key: string; label: string }[] = [
  { key: 'planner', label: 'Planner' },
  { key: 'retriever', label: 'Retriever' },
  { key: 'reasoner', label: 'Reasoner' },
  { key: 'skeptic', label: 'Skeptic' },
  { key: 'synthesizer', label: 'Synthesizer' },
  { key: 'verifier', label: 'Verifier' },
  { key: 'plain_language_synthesizer', label: 'Plain language' },
  { key: 'outline_architect', label: 'Outline architect' },
  { key: 'section_drafter', label: 'Section drafter' },
  { key: 'internal_challenger', label: 'Internal challenger' },
  { key: 'coherence_refiner', label: 'Coherence refiner' },
  { key: 'revision_intake', label: 'Revision intake' },
  { key: 'report_locator', label: 'Report locator' },
  { key: 'change_planner', label: 'Change planner' },
  { key: 'section_rewriter', label: 'Section rewriter' },
  { key: 'citation_integrity_checker', label: 'Citation integrity' },
  { key: 'final_revision_verifier', label: 'Final revision verifier' },
];

export default function ModelsPage() {
  const [data, setData] = useState<AdminModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [embedding, setEmbedding] = useState('');
  const [rows, setRows] = useState<Record<string, ModelOverrideEntry>>({});

  const load = async () => {
    let token = sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY);
    if (!token) {
      token = window.prompt('Enter admin token to load model settings')?.trim() ?? '';
      if (!token) {
        setLoading(false);
        setError('Admin token required');
        return;
      }
      sessionStorage.setItem(ADMIN_SESSION_TOKEN_KEY, token);
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminModels(token);
      setData(res);
      setEmbedding(res.embeddingOverride ?? '');
      setRows({ ...res.overrides });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load';
      setError(msg);
      if (msg.includes('401')) sessionStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setRole = (key: string, field: 'primary' | 'fallback', value: string) => {
    setRows(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const roleToDefaultKey: Record<string, string> = {
    planner: 'planner',
    retriever: 'retriever',
    reasoner: 'reasoner',
    skeptic: 'skeptic',
    synthesizer: 'synthesizer',
    verifier: 'verifier',
    plain_language_synthesizer: 'plainLanguageSynthesizer',
    outline_architect: 'outlineArchitect',
    section_drafter: 'sectionDrafter',
    internal_challenger: 'internalChallenger',
    coherence_refiner: 'coherenceRefiner',
    revision_intake: 'revisionIntake',
    report_locator: 'reportLocator',
    change_planner: 'changePlanner',
    section_rewriter: 'sectionRewriter',
    citation_integrity_checker: 'citationIntegrityChecker',
    final_revision_verifier: 'finalRevisionVerifier',
  };

  /**
   * "Select all fallbacks" — copy each role's environment-default fallback
   * into the editable fallback field. Skips rows whose fallback is already
   * filled in (so a user-entered override is never silently overwritten).
   */
  const selectAllFallbacks = () => {
    const fbMap = (data?.defaults as Record<string, unknown> | undefined)?.fallbacks as
      | Record<string, string>
      | undefined;
    if (!fbMap) return;
    setRows(prev => {
      const next = { ...prev };
      for (const { key } of REASONING_ROLES) {
        const dk = roleToDefaultKey[key] ?? key;
        const defFb = fbMap[dk];
        if (defFb && !next[key]?.fallback?.trim()) {
          next[key] = { ...next[key], fallback: String(defFb) };
        }
      }
      return next;
    });
  };

  const clearAllFallbacks = () => {
    setRows(prev => {
      const next = { ...prev };
      for (const { key } of REASONING_ROLES) {
        if (next[key]?.fallback) {
          next[key] = { ...next[key], fallback: '' };
        }
      }
      return next;
    });
  };

  const handleSave = async () => {
    const token = sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY);
    if (!token) {
      setError('No admin token — reload page and enter token');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      for (const { key } of REASONING_ROLES) {
        const o = rows[key];
        if (o?.primary?.trim() || o?.fallback?.trim()) {
          body[key] = {
            primary: o?.primary?.trim() || undefined,
            fallback: o?.fallback?.trim() || undefined,
          };
        }
      }
      if (embedding.trim()) body.embedding = embedding.trim();
      await putAdminModels(token, body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const defaults = data?.defaults as Record<string, unknown> | undefined;
  const fb = defaults?.fallbacks as Record<string, string> | undefined;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Settings className="text-accent" size={24} />
          Model routing
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Overrides are stored on the server (not in .env). Empty fields use environment defaults. Requires admin token.
        </p>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {data && !loading && (
        <div className="space-y-6">
          <div className="card p-4 space-y-2">
            <label className="section-title">Embedding model override</label>
            <input
              className="input w-full max-w-xl"
              placeholder={String(defaults?.embedding ?? '')}
              value={embedding}
              onChange={e => setEmbedding(e.target.value)}
            />
            <p className="text-xs text-slate-500">Default: {String(defaults?.embedding ?? '')}</p>
          </div>

          <div className="card overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3 pb-1">
              <p className="text-xs text-slate-500">
                {REASONING_ROLES.length} agent roles · click <span className="text-slate-300">Select all fallbacks</span> to populate every empty fallback with the environment default.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs flex items-center gap-1.5 border border-accent/30 text-accent px-3 py-1.5 rounded-lg"
                  onClick={selectAllFallbacks}
                  disabled={saving}
                  title="Copy each role's environment-default fallback into the editable field. Existing fallback values are preserved."
                >
                  <CheckSquare size={13} />
                  Select all fallbacks
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={clearAllFallbacks}
                  disabled={saving}
                >
                  Clear all
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-indigo-900/30 text-left text-slate-500">
                  <th className="p-2">Role</th>
                  <th className="p-2">Primary override</th>
                  <th className="p-2">Fallback override</th>
                  <th className="p-2 text-xs">Env default</th>
                </tr>
              </thead>
              <tbody>
                {REASONING_ROLES.map(({ key, label }) => {
                  const dk = roleToDefaultKey[key] ?? key;
                  const defPrimary = defaults?.[dk];
                  const defFb = fb?.[dk];
                  return (
                  <tr key={key} className="border-b border-indigo-900/10">
                    <td className="p-2 text-slate-300 whitespace-nowrap">{label}</td>
                    <td className="p-2">
                      <input
                        className="input text-xs w-full min-w-[180px]"
                        placeholder={defPrimary != null ? String(defPrimary) : ''}
                        value={rows[key]?.primary ?? ''}
                        onChange={e => setRole(key, 'primary', e.target.value)}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        className="input text-xs w-full min-w-[180px]"
                        placeholder={defFb != null ? String(defFb) : ''}
                        value={rows[key]?.fallback ?? ''}
                        onChange={e => setRole(key, 'fallback', e.target.value)}
                      />
                    </td>
                    <td className="p-2 text-xs text-slate-600 max-w-[200px] truncate" title={`${String(defPrimary ?? '')} / ${String(defFb ?? '')}`}>
                      {String(defPrimary ?? '')}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void handleSave()}>
              <Save size={14} />
              {saving ? 'Saving…' : 'Save overrides'}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => void load()}>
              Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
