import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileCode, Copy, Server, Terminal, Save, Code2, Notebook, Loader2, Check, AlertCircle, GitCommit, PlayCircle, RefreshCw } from "lucide-react";
import { VenvInfo, VscodeInterpreterStatus } from "../../types";
import { waitForBackgroundJob } from "../../services/backgroundJobs";
import { isReadOnlyManager, readOnlyManagerLabel } from "../../utils/venvManagers";

interface StudioDeployProps {
  venv: VenvInfo;
  setMessage: (msg: string) => void;
}

export const StudioDeploy: React.FC<StudioDeployProps> = ({ venv, setMessage }) => {
  const [dockerFiles, setDockerFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState("Dockerfile");
  const [dockerGenerating, setDockerGenerating] = useState(false);
  const [dockerGenerateError, setDockerGenerateError] = useState<string | null>(null);
  const dockerGenerateRequestRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [vscodeBusy, setVscodeBusy] = useState(false);
  const [vscodeStatus, setVscodeStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [vscodeDoctor, setVscodeDoctor] = useState<VscodeInterpreterStatus | null>(null);
  const [vscodeDoctorLoading, setVscodeDoctorLoading] = useState(false);
  const [jupyterBusy, setJupyterBusy] = useState(false);
  const [jupyterDisplayName, setJupyterDisplayName] = useState("");
  const [jupyterStatus, setJupyterStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [precommitBusy, setPrecommitBusy] = useState(false);
  const [precommitStatus, setPrecommitStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [dockerBusy, setDockerBusy] = useState(false);
  const [dockerStatus, setDockerStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const vscodeJobRef = useRef<string | null>(null);
  const jupyterJobRef = useRef<string | null>(null);
  const precommitJobRef = useRef<string | null>(null);
  const readOnlyManager = isReadOnlyManager(venv.manager_type) || venv.manager_type === "pixi";
  const readOnlyManagerName = readOnlyManagerLabel(venv.manager_type);
  const ipykernelInstallHint = getIpykernelInstallHint(venv);

  const loadVsCodeDoctor = useCallback(async () => {
    setVscodeDoctorLoading(true);
    try {
      const status = await invoke<VscodeInterpreterStatus>("get_vscode_interpreter_status", { venvPath: venv.path });
      setVscodeDoctor(status);
    } catch (err) {
      setVscodeDoctor({
        settings_path: "",
        exists: false,
        expected_interpreter: "",
        configured_interpreter: null,
        terminal_activation: null,
        env_file: null,
        in_sync: false,
        issue: `${err}`
      });
    } finally {
      setVscodeDoctorLoading(false);
    }
  }, [venv.path]);

  const generateDockerFiles = useCallback(async () => {
    const requestId = dockerGenerateRequestRef.current + 1;
    dockerGenerateRequestRef.current = requestId;
    setDockerGenerating(true);
    setDockerGenerateError(null);
    try {
      const files: Record<string, string> = await invoke("generate_docker_files", {
        venvPath: venv.path,
        pythonVersion: venv.version
      });
      if (dockerGenerateRequestRef.current !== requestId) return;
      setDockerFiles(files);
      setActiveFile((current) => files[current] ? current : Object.keys(files)[0] || "Dockerfile");
    } catch (err) {
      if (dockerGenerateRequestRef.current !== requestId) return;
      const message = `Docker generation error: ${err}`;
      setDockerGenerateError(message);
      setMessage(message);
    } finally {
      if (dockerGenerateRequestRef.current === requestId) setDockerGenerating(false);
    }
  }, [setMessage, venv.path, venv.version]);

  useEffect(() => {
    generateDockerFiles();
    return () => {
      dockerGenerateRequestRef.current += 1;
    };
  }, [generateDockerFiles]);

  useEffect(() => {
    void loadVsCodeDoctor();
  }, [loadVsCodeDoctor]);

  const copyToClipboard = async (text: string) => {
    if (!text) {
      setMessage("Nothing to copy yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Content copied to clipboard!");
    } catch (err) {
      setMessage(`Clipboard copy failed: ${err}`);
    }
  };

  const cancelJob = async (
    jobRef: React.MutableRefObject<string | null>,
    setBusy: (busy: boolean) => void,
    setStatus: (status: { ok: boolean; msg: string } | null) => void,
    label: string
  ) => {
    const jobId = jobRef.current;
    if (!jobId) return;
    jobRef.current = null;
    try {
      await invoke<boolean>("cancel_background_job", { jobId });
      setStatus({ ok: false, msg: `${label} cancelled.` });
      setMessage(`${label} cancelled.`);
    } catch (err) {
      setStatus({ ok: false, msg: `Cancel failed: ${err}` });
    } finally {
      setBusy(false);
    }
  };

  const generateVsCode = async () => {
    setVscodeBusy(true);
    setVscodeStatus(null);
    try {
      const jobId = await invoke<string>("start_generate_vscode_config_job", { venvPath: venv.path });
      vscodeJobRef.current = jobId;
      const out = await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (snapshot.message) setVscodeStatus({ ok: true, msg: snapshot.message });
      });
      setVscodeStatus({ ok: true, msg: out });
      setMessage(out);
      await loadVsCodeDoctor();
    } catch (err) {
      setVscodeStatus({ ok: false, msg: `${err}` });
    } finally {
      vscodeJobRef.current = null;
      setVscodeBusy(false);
    }
  };

  const cancelVsCode = () => cancelJob(vscodeJobRef, setVscodeBusy, setVscodeStatus, "VS Code config generation");

  const registerKernel = async () => {
    setJupyterBusy(true);
    setJupyterStatus(null);
    try {
      const jobId = await invoke<string>("start_register_jupyter_kernel_job", {
        venvPath: venv.path,
        name: null,
        displayName: jupyterDisplayName.trim() || null,
      });
      jupyterJobRef.current = jobId;
      const out = await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (snapshot.message) setJupyterStatus({ ok: true, msg: snapshot.message });
      });
      setJupyterStatus({ ok: true, msg: out });
      setMessage(out);
    } catch (err) {
      setJupyterStatus({ ok: false, msg: `${err}` });
    } finally {
      jupyterJobRef.current = null;
      setJupyterBusy(false);
    }
  };

  const cancelJupyter = () => cancelJob(jupyterJobRef, setJupyterBusy, setJupyterStatus, "Jupyter kernel registration");

  const installPrecommit = async () => {
    setPrecommitBusy(true);
    setPrecommitStatus(null);
    try {
      const jobId = await invoke<string>("start_install_precommit_hooks_job", { venvPath: venv.path });
      precommitJobRef.current = jobId;
      const out = await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (snapshot.message) setPrecommitStatus({ ok: true, msg: snapshot.message });
      });
      setPrecommitStatus({ ok: true, msg: out });
      setMessage(out);
    } catch (err) {
      setPrecommitStatus({ ok: false, msg: `${err}` });
    } finally {
      precommitJobRef.current = null;
      setPrecommitBusy(false);
    }
  };

  const cancelPrecommit = () => cancelJob(precommitJobRef, setPrecommitBusy, setPrecommitStatus, "Pre-commit setup");

  const runDocker = async () => {
    setDockerBusy(true);
    setDockerStatus(null);
    try {
      await invoke("run_docker_for_venv", { path: venv.path, imageTag: "" });
      setDockerStatus({ ok: true, msg: "Opened a terminal running docker build + docker run." });
    } catch (err) {
      setDockerStatus({ ok: false, msg: `${err}` });
    } finally {
      setDockerBusy(false);
    }
  };

  const saveToFile = async () => {
    const content = dockerFiles[activeFile];
    if (!content) return;

    setSaving(true);
    setSaveStatus(null);
    try {
      // Usando comando do backend para evitar dependência de plugins de path/fs no frontend
      const result: string = await invoke("save_project_file", {
        venvPath: venv.path,
        file_name: activeFile,
        content: content
      });
      setSaveStatus({ ok: true, msg: result });
      setMessage(result);
    } catch (err) {
      console.error("Save error:", err);
      const msg = `Error saving file: ${err}`;
      setSaveStatus({ ok: false, msg });
      setMessage(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <section className="vo-panel rounded-[2rem] border border-blue-100/80 dark:border-blue-900/30 bg-blue-50/70 dark:bg-blue-950/10 p-5">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
          Project tools guidance
        </h3>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          <GuidanceStep index={1} title="Pin IDE" detail="Generate VS Code config before debugging or running tasks." />
          <GuidanceStep index={2} title="Save manifests" detail="Write Docker files to the project before Build & Run." />
          <GuidanceStep index={3} title="Add guardrails" detail="Install pre-commit once the project is a git repository." />
        </div>
      </section>

      <section className="vo-surface rounded-[2rem] border p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Code2 size={16} className={vscodeDoctor?.in_sync ? "text-green-600" : "text-amber-600"} />
              <h3 className="text-xs font-black uppercase tracking-widest">VS Code Interpreter Doctor</h3>
              {vscodeDoctorLoading && <Loader2 size={13} className="animate-spin text-blue-600" />}
            </div>
            <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
              Confirms that VS Code points at this environment before you run or debug the project.
            </p>
          </div>
          <button
            onClick={loadVsCodeDoctor}
            disabled={vscodeDoctorLoading || vscodeBusy}
            className="vo-secondary-action px-3 py-1.5 rounded-xl disabled:opacity-50 text-[9px]"
          >
            Refresh
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-2">
          <DoctorField label="Expected interpreter" value={vscodeDoctor?.expected_interpreter || "Loading..."} />
          <DoctorField label="Configured interpreter" value={vscodeDoctor?.configured_interpreter || "Not configured"} />
          <DoctorField label="Settings file" value={vscodeDoctor?.settings_path || "Not checked yet"} />
          <DoctorField label="Status" value={vscodeDoctor?.in_sync ? "Pinned to this environment" : (vscodeDoctor?.issue || "Needs review")} />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IntegrationCard
          Icon={Code2}
          title="VS Code config"
          description="Pin this venv as the default interpreter in .vscode/settings.json so VS Code picks it automatically. Existing keys are preserved."
          actionLabel={vscodeBusy ? "Writing..." : "Generate config"}
          onAction={generateVsCode}
          busy={vscodeBusy}
          status={vscodeStatus}
          onCancel={vscodeBusy ? cancelVsCode : undefined}
        />
        <IntegrationCard
          Icon={Notebook}
          title="Jupyter kernel"
          description={`Register this venv as a Jupyter kernel via \`ipykernel install --user\`, so it shows up in JupyterLab. If missing, install ipykernel first with: ${ipykernelInstallHint}`}
          actionLabel={jupyterBusy ? "Registering..." : "Register kernel"}
          onAction={registerKernel}
          busy={jupyterBusy}
          status={jupyterStatus}
          onCancel={jupyterBusy ? cancelJupyter : undefined}
          extra={
            <input
              value={jupyterDisplayName}
              onChange={(e) => setJupyterDisplayName(e.target.value)}
              placeholder={`Display name (default: Python (${venv.name}))`}
              className="vo-control w-full mt-2 border rounded-lg px-3 py-1.5 text-xs"
            />
          }
        />
        <IntegrationCard
          Icon={GitCommit}
          title="Pre-commit hooks"
          description={readOnlyManager
            ? `${readOnlyManagerName} environments are read-only in VOrchestra. Install pre-commit with the native manager, then run hooks from your project terminal.`
            : "Installs pre-commit in the venv, drops a starter .pre-commit-config.yaml at the project root (if absent), and runs `pre-commit install` to wire your git hooks. Requires the project to be a git repo."
          }
          actionLabel={readOnlyManager ? "Native manager only" : precommitBusy ? "Installing..." : "Install pre-commit"}
          onAction={installPrecommit}
          busy={precommitBusy}
          status={precommitStatus}
          onCancel={precommitBusy ? cancelPrecommit : undefined}
          disabled={readOnlyManager}
        />
        <IntegrationCard
          Icon={PlayCircle}
          title="Run in Docker"
          description="Opens a terminal and runs `docker build -t <name> . && docker run --rm -it <name>` in the project root. Save the manifests first if you haven't."
          actionLabel={dockerBusy ? "Launching..." : "Build & Run"}
          onAction={runDocker}
          busy={dockerBusy}
          status={dockerStatus}
        />
      </section>

      <div className="flex items-center justify-between gap-4 p-6 bg-blue-600 text-white rounded-[2rem] shadow-lg shadow-blue-500/20">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white/20 rounded-2xl"><Server size={32}/></div>
          <div>
            <h3 className="font-black text-xl uppercase tracking-tighter text-white">Docker Deployment</h3>
            <p className="text-xs font-bold opacity-80">One-click containerization for this environment</p>
          </div>
        </div>
        <button
          onClick={generateDockerFiles}
          disabled={dockerGenerating}
          className="flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 disabled:opacity-60 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
        >
          {dockerGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {dockerGenerating ? "Generating" : "Regenerate"}
        </button>
      </div>

      {dockerGenerateError && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 text-xs font-bold text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{dockerGenerateError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-slate-900 dark:text-slate-100">
        <div className="lg:col-span-1 space-y-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Manifests</p>
          {dockerGenerating && Object.keys(dockerFiles).length === 0 && (
            <div className="vo-panel flex items-center gap-2 px-4 py-3 rounded-2xl border text-slate-400 text-xs font-bold">
              <Loader2 size={14} className="animate-spin" /> Generating manifests...
            </div>
          )}
          {Object.keys(dockerFiles).map(file => (
            <button
              key={file}
              onClick={() => setActiveFile(file)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all border ${
                activeFile === file 
                ? "vo-surface border-blue-500 text-blue-600 shadow-md" 
                : "vo-secondary-action text-slate-400 hover:border-slate-300"
              }`}
            >
              <FileCode size={18}/>
              {file}
            </button>
          ))}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{activeFile} Preview</p>
            <div className="flex gap-4">
              <button 
                onClick={saveToFile}
                disabled={saving || dockerGenerating || !dockerFiles[activeFile]}
                className="flex items-center gap-2 text-xs font-black text-blue-600 hover:text-blue-700 bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full border border-blue-100 dark:border-blue-800 transition-all active:scale-95 disabled:opacity-50"
              >
                <Save size={14}/> {saving ? "Saving..." : "Save to Project"}
              </button>
              <button 
                onClick={() => copyToClipboard(dockerFiles[activeFile] || "")}
                disabled={!dockerFiles[activeFile]}
                className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-blue-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Copy size={14}/> Copy Code
              </button>
            </div>
          </div>
          {saveStatus && (
            <div className={`p-2 rounded-lg border flex items-start gap-2 text-[10px] ${
              saveStatus.ok
                ? "bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300"
                : "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-300"
            }`}>
              {saveStatus.ok ? <Check size={12} className="shrink-0 mt-0.5" /> : <AlertCircle size={12} className="shrink-0 mt-0.5" />}
              <span>{saveStatus.msg}</span>
            </div>
          )}
          <div className="relative group">
            <pre className="w-full h-[400px] bg-slate-900 text-blue-400 p-6 rounded-[2rem] font-mono text-xs overflow-auto border-2 border-slate-800 shadow-inner select-text">
              {dockerFiles[activeFile] || (dockerGenerating ? "# Generating files..." : "# No generated file selected")}
            </pre>
            <div className="absolute top-4 right-4 flex items-center gap-2 bg-slate-800 px-3 py-1 rounded-full border border-slate-700 text-[9px] font-bold text-slate-400 group-hover:border-blue-500 transition-all">
              <Terminal size={10}/> DOCKER ENGINE
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function getIpykernelInstallHint(venv: VenvInfo): string {
  if (venv.manager_type === "uv") return "uv pip install ipykernel";
  if (venv.manager_type === "conda") return "conda install -c conda-forge ipykernel";
  if (venv.manager_type === "pixi") return "pixi add ipykernel";
  return "pip install ipykernel";
}

const DoctorField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="vo-panel rounded-2xl border px-4 py-3 min-w-0">
    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    <p className="mt-1 text-[10px] font-mono text-slate-700 dark:text-slate-200 truncate">{value}</p>
  </div>
);

const GuidanceStep: React.FC<{ index: number; title: string; detail: string }> = ({ index, title, detail }) => (
  <div className="vo-subpanel rounded-2xl border border-blue-100/80 dark:border-blue-900/20 px-4 py-3">
    <p className="text-[9px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">
      {index}. {title}
    </p>
    <p className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">{detail}</p>
  </div>
);

interface IntegrationCardProps {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
  status: { ok: boolean; msg: string } | null;
  extra?: React.ReactNode;
  onCancel?: () => void;
  disabled?: boolean;
}

const IntegrationCard: React.FC<IntegrationCardProps> = ({
  Icon, title, description, actionLabel, onAction, busy, status, extra, onCancel, disabled = false
}) => (
  <div className="vo-surface border rounded-2xl p-5 space-y-3 shadow-sm">
    <div className="flex items-center gap-3">
      <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-xl"><Icon size={18} /></div>
      <h4 className="text-sm font-black uppercase tracking-widest">{title}</h4>
    </div>
    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{description}</p>
    {extra}
    <div className="flex flex-wrap gap-2">
      <button
        onClick={onAction}
        disabled={busy || disabled}
        className="vo-primary-action flex items-center gap-2 px-4 py-2 disabled:bg-slate-400 rounded-lg text-[10px]"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
        {actionLabel}
      </button>
      {onCancel && (
        <button
          onClick={onCancel}
          className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/10 dark:hover:bg-red-900/20 text-red-600 rounded-lg text-[10px] font-black uppercase tracking-wider border border-red-100 dark:border-red-900/30"
        >
          Cancel
        </button>
      )}
    </div>
    {status && (
      <div className={`p-2 rounded-lg border flex items-start gap-2 text-[10px] ${
        status.ok
          ? "bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300"
          : "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-300"
      }`}>
        {status.ok ? <Check size={12} className="shrink-0 mt-0.5" /> : <AlertCircle size={12} className="shrink-0 mt-0.5" />}
        <span>{status.msg}</span>
      </div>
    )}
  </div>
);
