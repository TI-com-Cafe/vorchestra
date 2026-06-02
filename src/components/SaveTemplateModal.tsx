import React, { useState } from "react";
import { BookmarkPlus, Loader2, X } from "lucide-react";

interface SaveTemplateModalProps {
  venvName: string;
  saving: boolean;
  onClose: () => void;
  onSave: (templateName: string) => Promise<void>;
}

export const SaveTemplateModal: React.FC<SaveTemplateModalProps> = ({
  venvName,
  saving,
  onClose,
  onSave
}) => {
  const [name, setName] = useState(`${venvName} template`);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const templateName = name.trim();
    if (!templateName) return;
    await onSave(templateName);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-8 animate-in fade-in duration-200">
      <form onSubmit={submit} className="vo-surface w-full max-w-lg rounded-[2rem] border shadow-2xl overflow-hidden">
        <div className="vo-panel p-6 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-600/25">
              <BookmarkPlus size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white">Save Template</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Capture package names from {venvName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="vo-icon-button p-2 rounded-xl disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 bg-blue-50/60 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl">
            <p className="text-[9px] font-black uppercase tracking-widest text-blue-500 dark:text-blue-300 mb-1">Template scope</p>
            <p className="text-[11px] text-blue-700 dark:text-blue-200 leading-relaxed">
              This captures the dependency baseline from {venvName}. It is useful for creating similar environments, but it does not replace project lockfiles or copy application files.
            </p>
          </div>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Template name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="vo-control w-full px-4 py-3 rounded-2xl border text-sm font-bold"
              placeholder="FastAPI service baseline"
            />
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            VOrchestra stores only package names, not secrets or project files. Versions can still be managed through lockfiles.
          </p>
        </div>

        <div className="p-6 pt-0 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="vo-secondary-action px-5 py-3 rounded-2xl text-xs disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()} className="vo-primary-action px-5 py-3 rounded-2xl disabled:bg-slate-400 text-xs flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <BookmarkPlus size={14} />}
            {saving ? "Saving..." : "Save template"}
          </button>
        </div>
      </form>
    </div>
  );
};
