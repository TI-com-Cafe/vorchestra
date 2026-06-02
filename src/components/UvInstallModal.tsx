import React, { useState } from "react";
import { Zap, X, Loader2, ShieldAlert, ExternalLink } from "lucide-react";

interface UvInstallModalProps {
  command: string;
  installing: boolean;
  onClose: () => void;
  onInstall: () => Promise<void>;
  onInstallElevated: () => Promise<void>;
}

const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);

export const UvInstallModal: React.FC<UvInstallModalProps> = ({
  command,
  installing,
  onClose,
  onInstall,
  onInstallElevated
}) => {
  const [needsElevation, setNeedsElevation] = useState(false);

  const tryInstall = async () => {
    setNeedsElevation(false);
    try {
      await onInstall();
    } catch (err) {
      const msg = String((err as { message?: string })?.message ?? err ?? "");
      if (msg.includes("NEEDS_ELEVATION:")) {
        setNeedsElevation(true);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[80] flex items-center justify-center p-8 animate-in fade-in duration-200">
      <div className="vo-surface w-full max-w-xl rounded-[2rem] border shadow-2xl overflow-hidden">
        <div className="vo-panel p-8 border-b flex items-center justify-between bg-amber-50/40 dark:bg-amber-900/10">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-500 text-white rounded-2xl shadow-lg shadow-amber-500/30">
              <Zap size={24} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest">Install uv</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Run installs and resolves up to 10× faster</p>
            </div>
          </div>
          <button onClick={onClose} disabled={installing} className="vo-icon-button p-2 disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        <div className="p-8 space-y-5">
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            <strong className="text-slate-900 dark:text-white">uv</strong> is a fast Python package and project manager from Astral. VOrchestra will automatically prefer it over pip when present.
          </p>

          <div className="p-4 bg-blue-50/60 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl">
            <p className="text-[9px] font-black uppercase tracking-widest text-blue-500 dark:text-blue-300 mb-1">Install impact</p>
            <p className="text-[11px] text-blue-700 dark:text-blue-200 leading-relaxed">
              This unlocks managed Python downloads, uv-native environment creation, project sync, lock workflows and faster package operations. Existing venvs are not converted automatically.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">This is what will run</p>
            <pre className="vo-subpanel p-3 rounded-xl border text-[10px] font-mono text-blue-600 dark:text-blue-400 whitespace-pre-wrap break-all">
              {command || "Detecting platform..."}
            </pre>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              The official Astral installer downloads the binary into your home directory ({isWindows ? "%USERPROFILE%\\.local\\bin" : "~/.local/bin"}). No global system files are modified.
            </p>
          </div>

          {needsElevation && (
            <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl flex items-start gap-3">
              <ShieldAlert size={16} className="text-red-500 shrink-0 mt-0.5" />
              <div className="text-[11px] text-red-700 dark:text-red-300">
                Permission denied. Your environment is blocking the installer (locked-down policy or antivirus). Retry with elevation or run the command manually in an admin terminal.
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={tryInstall}
              disabled={installing}
              className="vo-primary-action flex items-center gap-2 px-5 py-2 rounded-xl text-[11px] disabled:bg-slate-400"
            >
              {installing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {installing ? "Installing..." : "Install"}
            </button>

            {needsElevation && (
              <button
                onClick={onInstallElevated}
                disabled={installing}
                className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-400 text-white rounded-xl text-[11px] font-black uppercase tracking-wider shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
                title={isWindows ? "Triggers a UAC prompt" : "Opens a terminal with sudo"}
              >
                <ShieldAlert size={14} />
                {isWindows ? "Retry as Administrator" : "Retry with sudo"}
              </button>
            )}

            <a
              href="https://docs.astral.sh/uv/getting-started/installation/"
              target="_blank"
              rel="noreferrer"
              className="vo-secondary-action flex items-center gap-2 px-5 py-2 rounded-xl text-[11px]"
            >
              <ExternalLink size={14} />
              Manual Install Docs
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
