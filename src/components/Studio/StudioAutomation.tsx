import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Play, ChevronRight, FlaskConical, Sparkles, ScanText, Type, Loader2, AlertCircle, Check, Download, Trash2, Zap
} from "lucide-react";
import { VenvInfo, Script, ToolRunResult } from "../../types";
import { dbService } from "../../services/db";
import { waitForBackgroundJob } from "../../services/backgroundJobs";
import { packageService, needsElevation } from "../../services/packageManager";
import { cn } from "../../utils/cn";
import { isReadOnlyManager, readOnlyManagerLabel } from "../../utils/venvManagers";

interface StudioAutomationProps {
  venv: VenvInfo;
  scripts: Script[];
  refreshScripts: () => void;
  setMessage: (msg: string) => void;
}

interface QuickTool {
  id: string;
  label: string;
  binary: string;
  defaultArgs: string[];
  /** Package name to install when missing (often equal to `binary`). */
  installAs: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
}

const QUICK_TOOLS: QuickTool[] = [
  {
    id: "pytest",
    label: "Run pytest",
    binary: "pytest",
    defaultArgs: [],
    installAs: "pytest",
    Icon: FlaskConical,
    description: "Run the project's test suite."
  },
  {
    id: "ruff",
    label: "ruff check",
    binary: "ruff",
    defaultArgs: ["check", "."],
    installAs: "ruff",
    Icon: Sparkles,
    description: "Fast Python linter."
  },
  {
    id: "black",
    label: "black --check",
    binary: "black",
    defaultArgs: ["--check", "."],
    installAs: "black",
    Icon: Type,
    description: "Check formatting (does not write files)."
  },
  {
    id: "mypy",
    label: "mypy",
    binary: "mypy",
    defaultArgs: ["."],
    installAs: "mypy",
    Icon: ScanText,
    description: "Static type checker."
  }
];

interface ToolState {
  running: boolean;
  result: ToolRunResult | null;
  installing: boolean;
  installError: string | null;
  needsElevationFor: string | null;
  jobId: string | null;
  progress: string | null;
}

interface ScriptRunState {
  running: boolean;
  jobId: string | null;
  progress: string | null;
  output: string | null;
  error: string | null;
}

const initialToolState: ToolState = {
  running: false,
  result: null,
  installing: false,
  installError: null,
  needsElevationFor: null,
  jobId: null,
  progress: null
};

const initialScriptRunState: ScriptRunState = {
  running: false,
  jobId: null,
  progress: null,
  output: null,
  error: null
};

const pytestSummary = (output: string): string | null => {
  const line = output
    .split(/\r?\n/)
    .map(item => item.trim())
    .reverse()
    .find(item => /^=+ .* =+$/.test(item) && /(passed|failed|error|skipped|xfailed|xpassed)/i.test(item));
  if (!line) return null;
  return line.replace(/^=+\s*/, "").replace(/\s*=+$/, "");
};

const quickToolSummary = (toolId: string, output: string, success: boolean): string | null => {
  const compact = output
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
  const joined = compact.join("\n");

  if (toolId === "pytest") {
    const summary = pytestSummary(output);
    return summary ? `pytest: ${summary}` : null;
  }

  if (toolId === "ruff") {
    if (/all checks passed/i.test(joined)) return "ruff: all checks passed";
    const found = joined.match(/found\s+(\d+)\s+(?:error|errors)/i);
    if (found) return `ruff: ${found[1]} issue${found[1] === "1" ? "" : "s"} found`;
    return success ? "ruff: completed without reported issues" : "ruff: issues found";
  }

  if (toolId === "black") {
    const wouldReformat = joined.match(/(\d+)\s+file(?:s)?\s+would be reformatted/i);
    if (wouldReformat) return `black: ${wouldReformat[1]} file${wouldReformat[1] === "1" ? "" : "s"} need formatting`;
    if (/would be left unchanged|all done/i.test(joined)) return "black: formatting is clean";
    return success ? "black: formatting is clean" : "black: formatting changes needed";
  }

  if (toolId === "mypy") {
    const successLine = compact.find(line => /^success:/i.test(line));
    if (successLine) return `mypy: ${successLine.replace(/^success:\s*/i, "")}`;
    const found = joined.match(/found\s+(\d+)\s+error(?:s)?\s+in\s+(\d+)\s+file/i);
    if (found) return `mypy: ${found[1]} error${found[1] === "1" ? "" : "s"} in ${found[2]} file${found[2] === "1" ? "" : "s"}`;
    return success ? "mypy: completed without reported issues" : "mypy: type issues found";
  }

  return null;
};

export const parseAutomationArgs = (raw: string): string[] => {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of raw.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (current) args.push(current);
  return args;
};

export const StudioAutomation: React.FC<StudioAutomationProps> = ({ venv, scripts, refreshScripts, setMessage }) => {
  const [scriptInput, setScriptInput] = useState({ name: "", command: "" });
  const [toolStates, setToolStates] = useState<Record<string, ToolState>>({});
  const [scriptRunStates, setScriptRunStates] = useState<Record<number, ScriptRunState>>({});
  const [pendingDeleteScript, setPendingDeleteScript] = useState<Script | null>(null);
  const [argsByTool, setArgsByTool] = useState<Record<string, string>>(
    Object.fromEntries(QUICK_TOOLS.map(t => [t.id, t.defaultArgs.join(" ")]))
  );
  const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
  const readOnlyManager = isReadOnlyManager(venv.manager_type);
  const readOnlyManagerName = readOnlyManagerLabel(venv.manager_type);

  const updateToolState = (id: string, patch: Partial<ToolState>) => {
    setToolStates(prev => ({
      ...prev,
      [id]: { ...initialToolState, ...prev[id], ...patch }
    }));
  };

  const updateScriptRunState = (id: number, patch: Partial<ScriptRunState>) => {
    setScriptRunStates(prev => ({
      ...prev,
      [id]: { ...initialScriptRunState, ...prev[id], ...patch }
    }));
  };

  const runTool = async (tool: QuickTool) => {
    updateToolState(tool.id, { running: true, result: null, installError: null, progress: "Starting..." });
    try {
      const args = parseAutomationArgs(argsByTool[tool.id] ?? "");
      const jobId = await invoke<string>("start_run_in_venv_job", {
        venvPath: venv.path,
        program: tool.binary,
        args,
        timeoutSecs: 600
      });
      updateToolState(tool.id, { jobId });
      const r = await waitForBackgroundJob<ToolRunResult>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number"
          ? ` ${Math.round(snapshot.progress * 100)}%`
          : "";
        updateToolState(tool.id, { progress: `${snapshot.message}${pct}` });
      });
      updateToolState(tool.id, { result: r, running: false, jobId: null, progress: null });
    } catch (err) {
      updateToolState(tool.id, {
        result: {
          stdout: "",
          stderr: `${err}`,
          exit_code: null,
          success: false,
          tool_missing: false
        },
        running: false,
        jobId: null,
        progress: null
      });
    }
  };

  const cancelTool = async (tool: QuickTool) => {
    const jobId = (toolStates[tool.id] ?? initialToolState).jobId;
    if (!jobId) return;
    updateToolState(tool.id, { progress: "Cancelling..." });
    try {
      await invoke<boolean>("cancel_background_job", { jobId });
      updateToolState(tool.id, {
        running: false,
        jobId: null,
        progress: null
      });
    } catch (err) {
      updateToolState(tool.id, { installError: `${err}` });
    }
  };

  const installTool = async (tool: QuickTool) => {
    updateToolState(tool.id, { installing: true, installError: null });
    try {
      await packageService.install(venv, tool.installAs);
      setMessage(`Installed ${tool.installAs}.`);
      updateToolState(tool.id, { installing: false });
      // Re-run the tool now that it's available.
      await runTool(tool);
    } catch (err) {
      if (needsElevation(err)) {
        updateToolState(tool.id, {
          installing: false,
          installError: `Permission denied installing ${tool.installAs}.`,
          needsElevationFor: tool.installAs
        });
      } else {
        updateToolState(tool.id, {
          installing: false,
          installError: `${err}`
        });
      }
    }
  };

  const installToolElevated = async (tool: QuickTool) => {
    updateToolState(tool.id, { installing: true });
    try {
      await packageService.installElevated(venv, tool.installAs);
      setMessage(`Installed ${tool.installAs} (elevated).`);
      updateToolState(tool.id, {
        installing: false,
        installError: null,
        needsElevationFor: null
      });
      await runTool(tool);
    } catch (err) {
      updateToolState(tool.id, {
        installing: false,
        installError: `${err}`
      });
    }
  };

  // --- Snippet runner (existing) ---
  const addScript = async () => {
    if (!scriptInput.name) return;
    try {
      await dbService.addScript(venv.path, scriptInput.name, scriptInput.command);
      setScriptInput({ name: "", command: "" });
      refreshScripts();
    } catch (err) { setMessage(`Error adding script: ${err}`); }
  };

  const runScript = async (script: Script) => {
    updateScriptRunState(script.id, {
      running: true,
      jobId: null,
      progress: "Starting...",
      output: null,
      error: null
    });
    try {
      const jobId = await invoke<string>("start_run_venv_script_job", { venvPath: venv.path, command: script.command });
      updateScriptRunState(script.id, { jobId });
      const out = await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number"
          ? ` ${Math.round(snapshot.progress * 100)}%`
          : "";
        updateScriptRunState(script.id, { progress: `${snapshot.message}${pct}` });
      });
      setMessage(`Output: ${out.substring(0, 100)}...`);
      updateScriptRunState(script.id, {
        running: false,
        jobId: null,
        progress: null,
        output: out,
        error: null
      });
    } catch (err) {
      const message = String(err).includes("Operation cancelled")
        ? "Script run cancelled."
        : `${err}`;
      setMessage(`Error: ${message}`);
      updateScriptRunState(script.id, {
        running: false,
        jobId: null,
        progress: null,
        error: message
      });
    } finally {
      updateScriptRunState(script.id, { jobId: null });
    }
  };

  const cancelScript = async (script: Script) => {
    const jobId = (scriptRunStates[script.id] ?? initialScriptRunState).jobId;
    if (!jobId) return;
    updateScriptRunState(script.id, { progress: "Cancelling..." });
    try {
      await invoke<boolean>("cancel_background_job", { jobId });
      updateScriptRunState(script.id, {
        running: false,
        jobId: null,
        progress: null,
        error: "Script cancellation requested."
      });
    } catch (err) {
      updateScriptRunState(script.id, { error: `${err}` });
    }
  };

  const deleteScript = async () => {
    if (!pendingDeleteScript) return;
    try {
      await dbService.deleteScript(pendingDeleteScript.id, venv.path);
      setMessage(`Deleted automation ${pendingDeleteScript.name}.`);
      setPendingDeleteScript(null);
      refreshScripts();
    } catch (err) {
      setMessage(`Error deleting script: ${err}`);
    }
  };

  return (
    <div className="space-y-10 animate-in slide-in-from-bottom-4 duration-300">
      {/* Quick Tools */}
      <section className="space-y-4">
        <div className="flex items-center justify-between ml-2">
          <h4 className="font-black text-sm uppercase tracking-widest flex items-center gap-2">
            <Zap size={14} className="text-amber-500" /> Quick Tools
          </h4>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Run from {venv.manager_type === "uv" ? "the venv" : "the venv's bin"}
          </span>
        </div>
        <div className="mx-2 rounded-2xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/70 dark:bg-amber-950/10 px-4 py-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">Automation scope</p>
          <p className="mt-1 text-[11px] font-bold leading-relaxed text-amber-700 dark:text-amber-200">
            Quick tools run inside this environment and report results only. Formatters here use check mode by default; saved scripts may mutate project state depending on the command you store.
          </p>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {QUICK_TOOLS.map(tool => {
            const state = toolStates[tool.id] ?? initialToolState;
            const r = state.result;
            return (
              <div key={tool.id} className="vo-surface border rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 rounded-lg"><tool.Icon size={16} /></div>
                    <div>
                      <p className="text-xs font-black">{tool.label}</p>
                      <p className="text-[10px] text-slate-400">{tool.description}</p>
                    </div>
                  </div>
                  {state.running ? (
                    <button
                      onClick={() => cancelTool(tool)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-200 rounded-lg text-[10px] font-black uppercase tracking-wider"
                    >
                      Stop Job
                    </button>
                  ) : (
                    <button
                      onClick={() => runTool(tool)}
                      disabled={state.installing}
                      className="vo-primary-action flex items-center gap-1.5 px-3 py-1.5 disabled:bg-slate-400 rounded-lg text-[10px]"
                    >
                      <Play size={12} />
                      Run
                    </button>
                  )}
                </div>
                <input
                  value={argsByTool[tool.id] ?? ""}
                  onChange={(e) => setArgsByTool(prev => ({ ...prev, [tool.id]: e.target.value }))}
                  placeholder="args (optional)"
                  className="vo-control w-full border rounded-lg px-3 py-1.5 text-[11px] font-mono"
                />

                {state.running && state.progress && (
                  <div className="flex items-center gap-2 text-[10px] font-bold text-blue-600">
                    <Loader2 size={11} className="animate-spin" />
                    <span>{state.progress}</span>
                  </div>
                )}

                {r?.tool_missing && (
                  <div className="p-2.5 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg text-[10px] text-amber-700 dark:text-amber-300 flex items-center justify-between gap-2">
                    <span>
                      <strong>{tool.binary}</strong> is not installed in this venv.
                      {readOnlyManager ? ` Install it with ${readOnlyManagerName}'s native tooling, then run again.` : ""}
                    </span>
                    {!readOnlyManager && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => installTool(tool)}
                          disabled={state.installing}
                          className="flex items-center gap-1 px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[9px] font-black uppercase"
                        >
                          {state.installing ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                          Install
                        </button>
                        {state.needsElevationFor && (
                          <button
                            onClick={() => installToolElevated(tool)}
                            disabled={state.installing}
                            className="flex items-center gap-1 px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-[9px] font-black uppercase"
                            title={isWindows ? "Triggers UAC prompt" : "Opens terminal with sudo"}
                          >
                            {isWindows ? "Admin" : "sudo"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {state.installError && !state.needsElevationFor && (
                  <div className="p-2 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-lg text-[10px] text-red-600 dark:text-red-400 flex items-start gap-2">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />
                    <span>{state.installError}</span>
                  </div>
                )}

                {r && !r.tool_missing && (
                  <div className="space-y-2">
                    {quickToolSummary(tool.id, `${r.stdout}\n${r.stderr}`, r.success) && (
                      <div className={cn(
                        "rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wider",
                        r.success
                          ? "bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300"
                          : "bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-300"
                      )}>
                        {quickToolSummary(tool.id, `${r.stdout}\n${r.stderr}`, r.success)}
                      </div>
                    )}
                    <div className={cn(
                      "flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider",
                      r.success ? "text-green-600" : "text-red-600"
                    )}>
                      {r.success ? <Check size={12} /> : <AlertCircle size={12} />}
                      {r.success ? "Success" : `Exit code ${r.exit_code ?? "?"}`}
                    </div>
                    {r.stdout && (
                      <pre className="vo-subpanel text-[10px] font-mono p-2 rounded border max-h-40 overflow-auto whitespace-pre-wrap">
                        {r.stdout}
                      </pre>
                    )}
                    {r.stderr && (
                      <pre className="text-[10px] font-mono p-2 bg-red-50/40 dark:bg-red-900/10 rounded border border-red-100 dark:border-red-900/20 max-h-40 overflow-auto whitespace-pre-wrap text-red-700 dark:text-red-300">
                        {r.stderr}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Snippets (existing) */}
      <section className="space-y-4">
        <h4 className="font-black text-sm uppercase tracking-widest ml-2">Add Automation Script</h4>
        <div className="vo-surface p-6 border rounded-[2rem] space-y-4 shadow-sm">
          <input
            value={scriptInput.name}
            onChange={e => setScriptInput({...scriptInput, name: e.target.value})}
            className="vo-control w-full border p-3 rounded-xl text-sm font-bold"
            placeholder="Script Label (e.g. Sync Database)"
          />
          <textarea
            value={scriptInput.command}
            onChange={e => setScriptInput({...scriptInput, command: e.target.value})}
            className="vo-control w-full h-32 border p-4 rounded-xl font-mono text-sm"
            placeholder="import my_app; my_app.init_db()"
          />
          <div className="flex justify-end">
            <button onClick={addScript} className="vo-primary-action px-5 py-2 rounded-xl text-[10px]">
              Save Script
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="ml-2">
          <h4 className="font-black text-sm uppercase tracking-widest">Saved Automations</h4>
          <p className="mt-1 text-[10px] font-bold text-slate-400">
            Store repeatable project commands here. Prefer idempotent commands and keep destructive maintenance behind explicit scripts.
          </p>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {scripts.map(s => {
            const state = scriptRunStates[s.id] ?? initialScriptRunState;
            return (
              <div
                key={s.id}
                className="vo-surface p-5 border rounded-2xl transition-all hover:border-blue-500 shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="vo-subpanel p-3 rounded-xl text-blue-600"><Play size={18}/></div>
                    <span className="font-bold text-sm">{s.name}</span>
                  </div>
                  {state.running ? (
                    <button
                      onClick={() => cancelScript(s)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-200 rounded-lg text-[10px] font-black uppercase tracking-wider"
                      aria-label={`Stop ${s.name}`}
                    >
                      Stop Job
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => runScript(s)}
                        className="vo-primary-action flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px]"
                        aria-label={`Run ${s.name}`}
                      >
                        <ChevronRight size={12} />
                        Run
                      </button>
                      <button
                        onClick={() => setPendingDeleteScript(s)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                        aria-label={`Delete ${s.name}`}
                        title={`Delete ${s.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {state.running && state.progress && (
                  <div className="flex items-center gap-2 text-[10px] font-bold text-blue-600">
                    <Loader2 size={11} className="animate-spin" />
                    <span>{state.progress}</span>
                  </div>
                )}
                {state.output && (
                  <pre className="vo-subpanel text-[10px] font-mono p-2 rounded border max-h-32 overflow-auto whitespace-pre-wrap">
                    {state.output}
                  </pre>
                )}
                {state.error && (
                  <div className="p-2 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-lg text-[10px] text-red-600 dark:text-red-400 flex items-start gap-2">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />
                    <span>{state.error}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {pendingDeleteScript && (
        <div className="fixed inset-0 z-[90] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="vo-surface w-full max-w-md rounded-[2rem] border border-red-100 dark:border-red-900/40 shadow-2xl overflow-hidden">
            <div className="p-6 bg-red-50 dark:bg-red-950/20 border-b border-red-100 dark:border-red-900/40">
              <h3 className="text-sm font-black uppercase tracking-widest text-red-700 dark:text-red-300">
                Delete automation?
              </h3>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                This removes <span className="font-mono font-black text-slate-800 dark:text-slate-100">{pendingDeleteScript.name}</span> from this environment. It does not change project files.
              </p>
            </div>
            <div className="p-5 flex justify-end gap-2">
              <button
                onClick={() => setPendingDeleteScript(null)}
                className="vo-secondary-action px-4 py-2 rounded-xl text-[10px]"
              >
                Cancel
              </button>
              <button
                onClick={deleteScript}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
