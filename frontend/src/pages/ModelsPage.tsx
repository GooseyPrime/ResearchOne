import { useState, useEffect } from 'react';
import { Settings, Save } from 'lucide-react';
import {
  getAdminModels,
  putAdminModels,
  type ModelOverrideEntry,
  type AdminModelsResponse,
} from '../utils/api';
import { modelRowsFromStoredOverrides } from '../utils/modelOverrides';
import { plainLabel } from '../lib/researchone/plainWords';

const REASONING_ROLES: { key: string; label: string }[] = [
  { key: 'planner', label: 'Planner' },
  { key: 'retriever', label: 'Retriever' },
  { key: 'source_class_classifier', label: 'Source class classifier' },
  { key: 'reasoner', label: 'Reasoner' },
  { key: 'strongest_form', label: plainLabel('strongest_form') },
  { key: 'double_check', label: plainLabel('double_check') },
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
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminModels();
      setData(res);
      setEmbedding(res.embeddingOverride ?? '');
      // Only each role's model. A backup model saved before RJ-025 is not
      // shown: no call uses one, and the server refuses to save one.
      setRows(modelRowsFromStoredOverrides(res.overrides));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setRole = (key: string, value: string) => {
    setRows(prev => ({
      ...prev,
      [key]: { ...prev[key], primary: value },
    }));
  };

  const roleToDefaultKey: Record<string, string> = {
    planner: 'planner',
    retriever: 'retriever',
    source_class_classifier: 'sourceClassClassifier',
    reasoner: 'reasoner',
    strongest_form: 'strongest_form',
    double_check: 'double_check',
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

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      for (const { key } of REASONING_ROLES) {
        const o = rows[key];
        if (o?.primary?.trim()) body[key] = { primary: o.primary.trim() };
      }
      if (embedding.trim()) body.embedding = embedding.trim();
      await putAdminModels(undefined, body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const defaults = data?.defaults as Record<string, unknown> | undefined;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Settings className="text-accent" size={24} />
          Model routing
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Overrides are stored on the server (not in .env). Empty fields use environment defaults. Requires an
          admin account (see ADMIN_USER_IDS on the backend). Each role uses only the model set here: there is no
          backup model. If that model&apos;s provider refuses, the same model is asked on another provider that
          serves it.
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
            <p className="text-xs text-slate-500 px-3 pt-3 pb-1">{REASONING_ROLES.length} agent roles</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-indigo-900/30 text-left text-slate-500">
                  <th className="p-2">Role</th>
                  <th className="p-2">Model override</th>
                  <th className="p-2 text-xs">Env default</th>
                </tr>
              </thead>
              <tbody>
                {REASONING_ROLES.map(({ key, label }) => {
                  const dk = roleToDefaultKey[key] ?? key;
                  const defPrimary = defaults?.[dk];
                  return (
                  <tr key={key} className="border-b border-indigo-900/10">
                    <td className="p-2 text-slate-300 whitespace-nowrap">{label}</td>
                    <td className="p-2">
                      <input
                        className="input text-xs w-full min-w-[180px]"
                        placeholder={defPrimary != null ? String(defPrimary) : ''}
                        value={rows[key]?.primary ?? ''}
                        onChange={e => setRole(key, e.target.value)}
                      />
                    </td>
                    <td className="p-2 text-xs text-slate-600 max-w-[200px] truncate" title={String(defPrimary ?? '')}>
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
