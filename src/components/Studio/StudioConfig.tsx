import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FileText, Settings, Save, Plus, Trash2, Eye, EyeOff, AlertCircle, Loader2, RefreshCcw
} from "lucide-react";
import { VenvInfo, EnvEntry } from "../../types";

interface StudioConfigProps {
  venv: VenvInfo;
  /** Legacy plain-text env (still used as a fallback raw-edit toggle). */
  envContent: string;
  setEnvContent: (val: string) => void;
  pyvenvCfg: string;
  setMessage: (msg: string) => void;
}

const SECRET_HINTS = ["secret", "token", "password", "passwd", "key", "api"];

const looksSecret = (key: string): boolean => {
  const lower = key.toLowerCase();
  return SECRET_HINTS.some(h => lower.includes(h));
};

export const StudioConfig: React.FC<StudioConfigProps> = ({
  venv, envContent, setEnvContent, pyvenvCfg, setMessage
}) => {
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [rawMode, setRawMode] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await invoke<EnvEntry[]>("read_env_entries", { venvPath: venv.path });
      const raw = await invoke<string>("read_env_file", { venvPath: venv.path });
      setEntries(list);
      setEnvContent(raw);
    } catch (err) {
      setMessage(`Error reading .env: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venv.path]);

  const updateKey = (idx: number, key: string) => {
    setEntries(prev => prev.map((e, i) => (i === idx ? { ...e, key } : e)));
  };
  const updateValue = (idx: number, value: string) => {
    setEntries(prev => prev.map((e, i) => (i === idx ? { ...e, value, from_example: false } : e)));
  };
  const removeRow = (idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx));
  };
  const addRow = () => {
    setEntries(prev => [...prev, { key: "", value: "", from_example: false }]);
  };
  const toggleReveal = (key: string) => {
    setRevealed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const valid = entries.filter(e => e.key.trim() !== "");
      await invoke("save_env_entries", {
        venvPath: venv.path,
        entries: valid
      });
      setMessage(".env saved.");
      // Reload to pick up any .env.example diffs that depend on what was saved.
      await refresh();
    } catch (err) {
      setMessage(`Error saving .env: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const saveRaw = async () => {
    try {
      await invoke("save_env_file", { venvPath: venv.path, content: envContent });
      setMessage(".env saved (raw mode).");
      await refresh();
    } catch (err) { setMessage(`Error: ${err}`); }
  };

  const missingFromExampleCount = entries.filter(e => e.from_example).length;
  const missingFromExampleKeys = entries.filter(e => e.from_example).map(e => e.key).filter(Boolean);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 animate-in fade-in duration-300">
      <div className="space-y-4">
        <div className="flex items-center justify-between ml-2">
          <h4 className="font-black text-sm uppercase tracking-widest flex items-center gap-2">
            <FileText size={16} className="text-blue-500"/> Env Editor (.env)
          </h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRawMode(!rawMode)}
              className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              {rawMode ? "Form view" : "Raw mode"}
            </button>
            <button
              onClick={refresh}
              disabled={loading}
              className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg"
              title="Re-read .env"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            </button>
          </div>
        </div>

        {missingFromExampleCount > 0 && !rawMode && (
          <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-xl text-[10px] font-bold text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <AlertCircle size={12} />
              {missingFromExampleCount} variable{missingFromExampleCount === 1 ? "" : "s"} declared in .env.example {missingFromExampleCount === 1 ? "is" : "are"} not set yet.
            </div>
            <p className="mt-1 text-[9px] uppercase tracking-widest">
              Fill first: {missingFromExampleKeys.slice(0, 4).join(", ")}
              {missingFromExampleKeys.length > 4 ? "..." : ""}
            </p>
          </div>
        )}

        {rawMode ? (
          <>
            <textarea
              value={envContent}
              onChange={e => setEnvContent(e.target.value)}
              className="vo-control w-full h-[400px] border p-6 rounded-[2rem] font-mono text-sm shadow-inner select-text"
              placeholder="DB_HOST=localhost..."
            />
            <button onClick={saveRaw} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">
              <Save size={18}/> Update Project Env (raw)
            </button>
          </>
        ) : (
          <>
            <div className="max-h-[420px] overflow-y-auto pr-1 space-y-1.5">
              {loading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Loading...</span>
                </div>
              ) : entries.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic px-4">No environment variables yet. Click + Add to create one.</p>
              ) : (
                entries.map((e, i) => {
                  const isSecret = looksSecret(e.key);
                  const showValue = !isSecret || revealed.has(e.key);
                  return (
                    <div
                      key={`env-entry-${i}`}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
                        e.from_example
                          ? "bg-amber-50/40 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30"
                          : "vo-control"
                      }`}
                    >
                      <input
                        value={e.key}
                        onChange={(ev) => updateKey(i, ev.target.value)}
                        placeholder="KEY"
                        className="w-40 bg-transparent border-0 outline-none text-xs font-black font-mono"
                      />
                      <span className="text-slate-400">=</span>
                      <input
                        value={e.value}
                        onChange={(ev) => updateValue(i, ev.target.value)}
                        type={showValue ? "text" : "password"}
                        placeholder={e.from_example ? "(declared in .env.example - set me)" : "value"}
                        className="flex-1 bg-transparent border-0 outline-none text-xs font-mono"
                      />
                      {isSecret && (
                        <button
                          onClick={() => toggleReveal(e.key)}
                          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          title={showValue ? "Hide" : "Reveal"}
                        >
                          {showValue ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      )}
                      <button
                        onClick={() => removeRow(i)}
                        className="p-1 text-slate-400 hover:text-red-500"
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={addRow} className="vo-secondary-action flex items-center gap-1 px-4 py-2 rounded-xl text-[10px]">
                <Plus size={12} /> Add variable
              </button>
              <button
                onClick={save}
                disabled={saving || loading}
                className="vo-primary-action flex items-center gap-2 ml-auto px-5 py-2 disabled:bg-slate-400 rounded-xl text-[10px]"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {saving ? "Saving..." : "Save .env"}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="space-y-4">
        <h4 className="font-black text-sm uppercase tracking-widest flex items-center gap-2 ml-2">
          <Settings size={16} className="text-blue-500"/> System Config (pyvenv.cfg)
        </h4>
        <pre className="vo-subpanel w-full h-[400px] border p-6 rounded-[2rem] font-mono text-xs overflow-auto text-slate-500 select-text">
          {pyvenvCfg || "# No pyvenv.cfg found"}
        </pre>
        <p className="text-[10px] text-slate-400 italic px-4">Read-only configuration managed by the Python environment.</p>
      </div>
    </div>
  );
};
