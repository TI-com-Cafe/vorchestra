import React, { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Sparkles, Folder, Zap, ArrowRight, Check, X, Boxes, ShieldCheck, Wrench } from "lucide-react";

interface FirstRunWizardProps {
  uvAvailable: boolean;
  systemPythonsCount: number;
  onPickWorkspace: (path: string) => Promise<void> | void;
  onInstallUv: () => void;
  onSkip: () => void;
}

export const FirstRunWizard: React.FC<FirstRunWizardProps> = ({
  uvAvailable, systemPythonsCount, onPickWorkspace, onInstallUv, onSkip
}) => {
  const [picking, setPicking] = useState(false);
  const readinessScore = (systemPythonsCount > 0 ? 45 : 0) + (uvAvailable ? 25 : 0);
  const readinessLabel = readinessScore >= 70 ? "Ready to scan" : systemPythonsCount === 0 ? "Needs Python" : "Workspace pending";
  const nextBestMove = systemPythonsCount === 0
    ? "Install or select a Python interpreter, then add your first workspace."
    : uvAvailable
      ? "Pick a workspace so VOrchestra can build your local environment inventory."
      : "Install uv for faster workflows, or pick a workspace now and add uv later.";

  const pickFolder = async () => {
    setPicking(true);
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked === "string") {
        await onPickWorkspace(picked);
      }
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-xl z-[90] flex items-center justify-center p-12 animate-in fade-in duration-300">
      <div className="vo-surface w-full max-w-2xl rounded-[3rem] border shadow-2xl overflow-hidden">
        <button onClick={onSkip} className="vo-icon-button absolute top-14 right-14" title="Skip">
          <X size={18} />
        </button>

        <div className="p-10 text-center bg-gradient-to-br from-blue-50 to-amber-50 dark:from-blue-900/10 dark:to-amber-900/10">
          <img src="/vorchestra-icon.png" alt="" className="w-20 h-20 mx-auto dark:invert dark:opacity-90" />
          <h2 className="text-2xl font-black uppercase tracking-widest mt-4">Welcome to VOrchestra</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-sm mx-auto">
            The local-first command center for Python virtual environments.
          </p>
        </div>

        <div className="p-8 space-y-5">
          <div className="vo-panel rounded-[2rem] border border-blue-100/80 dark:border-blue-900/30 bg-blue-50/70 dark:bg-blue-950/10 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">Setup readiness</p>
                <h3 className="mt-1 text-sm font-black text-slate-900 dark:text-white">{readinessLabel}</h3>
                <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-500 dark:text-slate-400">{nextBestMove}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-3xl font-black tabular-nums text-blue-600">{readinessScore}</p>
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">score</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <ReadinessPill done={systemPythonsCount > 0} label="Python" detail={`${systemPythonsCount} found`} />
              <ReadinessPill done={uvAvailable} label="uv" detail={uvAvailable ? "available" : "optional"} />
              <ReadinessPill done={false} label="Workspace" detail="pick next" />
            </div>
          </div>

          <Step
            done={true}
            title={`${systemPythonsCount} Python interpreter${systemPythonsCount === 1 ? "" : "s"} detected`}
            description="VOrchestra will create venvs from any of these. You can install more from the Python picker later."
          />

          {uvAvailable ? (
            <Step
              done={true}
              title="uv detected"
              description="Installs and resolves up to 10× faster than pip. Already wired in for new envs."
            />
          ) : (
            <Step
              done={false}
              title="uv not installed (optional)"
              description="uv makes everything faster and is the default Python installer in VOrchestra. You can install it any time from the engine selector."
              actionLabel="Install uv now"
              onAction={onInstallUv}
              actionIcon={Zap}
            />
          )}

          <Step
            done={false}
            title="Pick your first workspace"
            description="A workspace is just a folder VOrchestra scans for venvs. After you pick it, VOrchestra immediately scans it, sets it as default and opens your local inventory."
            actionLabel={picking ? "Opening..." : "Browse for folder..."}
            onAction={pickFolder}
            actionIcon={Folder}
            disabled={picking}
            primary
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <PathCard
              icon={Boxes}
              title="Create or import"
              description="Build from a template, scan an existing project, or adopt venvs already on disk."
            />
            <PathCard
              icon={Wrench}
              title="Repair first"
              description="Open Studio and use Repair when health is not green before changing packages."
            />
            <PathCard
              icon={ShieldCheck}
              title="Check health"
              description="Run diagnostics, security audit, metadata audit and lockfile drift only when needed."
            />
          </div>

          <div className="vo-panel rounded-2xl border p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">2-minute golden path</p>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
              <GoldenPathStep index={1} title="Pick workspace" description="Scan where your projects live." />
              <GoldenPathStep index={2} title="Review inventory" description="See existing venvs, broken entries and project groups." />
              <GoldenPathStep index={3} title="Open Studio" description="Repair first, then review packages, config and automation." />
              <GoldenPathStep index={4} title="Lock or audit" description="Freeze, check drift or run security checks only when needed." />
            </div>
          </div>
        </div>

        <div className="vo-panel p-4 border-t flex justify-between items-center">
          <p className="text-[10px] text-slate-400">No data leaves your machine. Skip whenever you want.</p>
          <button onClick={onSkip} className="vo-secondary-action px-4 py-1.5 rounded-lg text-[10px]">
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
};

interface StepProps {
  done: boolean;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: React.ComponentType<{ size?: number }>;
  disabled?: boolean;
  primary?: boolean;
}

const Step: React.FC<StepProps> = ({
  done, title, description, actionLabel, onAction, actionIcon: ActionIcon, disabled, primary
}) => (
  <div className={`flex items-start gap-4 p-4 rounded-2xl border ${
    done
      ? "bg-green-50/40 dark:bg-green-900/10 border-green-200 dark:border-green-800/30"
      : "vo-surface"
  }`}>
    <div className={`p-2 rounded-xl ${
      done ? "bg-green-500 text-white" : primary ? "bg-blue-600 text-white" : "bg-amber-500 text-white"
    }`}>
      {done ? <Check size={14} /> : <Sparkles size={14} />}
    </div>
    <div className="flex-1">
      <h3 className="text-sm font-black">{title}</h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          disabled={disabled}
          className={`mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 ${
            primary
              ? "vo-primary-action"
              : "bg-amber-500 hover:bg-amber-600 text-white"
          }`}
        >
          {ActionIcon && <ActionIcon size={12} />}
          {actionLabel}
          <ArrowRight size={12} />
        </button>
      )}
    </div>
  </div>
);

const ReadinessPill: React.FC<{ done: boolean; label: string; detail: string }> = ({ done, label, detail }) => (
  <div className={`rounded-2xl border px-3 py-2 ${
    done
      ? "border-green-100 dark:border-green-900/30 bg-green-50 dark:bg-green-950/20"
      : "vo-subpanel"
  }`}>
    <p className={`text-[9px] font-black uppercase tracking-widest ${done ? "text-green-700 dark:text-green-300" : "text-slate-400"}`}>{label}</p>
    <p className="mt-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">{detail}</p>
  </div>
);

const PathCard: React.FC<{
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  description: string;
}> = ({ icon: Icon, title, description }) => (
  <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-950/10 p-4">
    <div className="flex items-center gap-2">
      <div className="p-1.5 rounded-lg bg-blue-600 text-white">
        <Icon size={13} />
      </div>
      <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">{title}</h3>
    </div>
    <p className="mt-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
  </div>
);

const GoldenPathStep: React.FC<{ index: number; title: string; description: string }> = ({ index, title, description }) => (
  <div className="vo-surface rounded-xl border p-3">
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[9px] font-black text-white">
        {index}
      </span>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{title}</p>
    </div>
    <p className="mt-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
  </div>
);
