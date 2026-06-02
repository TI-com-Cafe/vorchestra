import React, { useMemo, useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ShieldAlert, AlertCircle, CheckCircle2, Loader2, RefreshCcw, ExternalLink, ShieldCheck, BadgeCheck, Download, Search, Terminal } from "lucide-react";
import { VenvInfo, OutdatedPackage, PackageMetadataAudit, PolicyDecision } from "../../types";
import { waitForBackgroundJob } from "../../services/backgroundJobs";
import { packageService, needsElevation, stripElevationPrefix } from "../../services/packageManager";
import { isReadOnlyManager, readOnlyManagerLabel } from "../../utils/venvManagers";

interface StudioDiagnosticsProps {
  venv: VenvInfo;
}

interface DiagnosticsJobResult {
  health: string;
  outdated: OutdatedPackage[];
}

interface SecurityVulnerability {
  id?: string;
  description?: string;
  fix_versions?: string[];
}

interface SecurityDependency {
  name?: string;
  version?: string;
  vulnerabilities?: SecurityVulnerability[];
}

interface SecurityReport {
  dependencies?: SecurityDependency[];
  _vorchestra_policy?: PolicyDecision;
}

interface SecurityFinding {
  packageName: string;
  packageVersion: string;
  vulnerability: SecurityVulnerability;
}

interface SupplyChainAction {
  title: string;
  description: string;
  tone: "red" | "amber" | "blue" | "green";
}

interface SupplyChainPosture {
  score: number | null;
  label: string;
  detail: string;
  tone: "red" | "amber" | "green" | "blue";
}

type MetadataReviewKind = "deprecated" | "suspicious" | "missing_license";
type MetadataReviewFilter = MetadataReviewKind | "all";

interface MetadataReviewItem {
  kind: MetadataReviewKind;
  packageName: string;
  reason: string;
  action: string;
}

const PolicyBanner: React.FC<{ policy?: PolicyDecision; compact?: boolean }> = ({ policy, compact = false }) => {
  if (!policy?.enabled || policy.findings.length === 0) return null;
  const blocked = !policy.allowed;
  return (
    <div className={`rounded-2xl border ${compact ? "p-3" : "p-4"} ${
      blocked
        ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-900/40 dark:text-red-200"
        : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-200"
    }`}>
      <p className="text-[10px] font-black uppercase tracking-widest">
        {blocked ? "Project policy has blocking findings" : "Project policy warnings"}
      </p>
      <div className="mt-2 space-y-1">
        {policy.findings.slice(0, 5).map((finding) => (
          <p key={`${finding.code}-${finding.package_name || ""}-${finding.message}`} className="text-[10px] font-bold leading-relaxed">
            {finding.package_name ? <span className="font-mono">{finding.package_name}: </span> : null}
            {finding.message}
            {finding.evidence ? <span className="opacity-70"> {finding.evidence}</span> : null}
          </p>
        ))}
        {policy.findings.length > 5 && (
          <p className="text-[9px] font-black uppercase tracking-widest opacity-70">
            +{policy.findings.length - 5} more policy finding{policy.findings.length - 5 === 1 ? "" : "s"}
          </p>
        )}
      </div>
    </div>
  );
};

function getSecurityToolInstallCommand(venv: VenvInfo, pythonPath: string): string {
  if (venv.manager_type === "uv") {
    return `uv pip install --python "${pythonPath}" pip-audit`;
  }
  if (venv.manager_type === "conda") {
    return "conda install -c conda-forge pip-audit";
  }
  if (venv.manager_type === "pixi") {
    return "pixi add pip-audit";
  }
  return "pip install pip-audit";
}

function nativeDiagnosticsCommands(manager: VenvInfo["manager_type"]): string[] {
  if (manager === "conda") {
    return ["conda list", "conda update --all --dry-run", "conda env export"];
  }
  if (manager === "pixi") {
    return ["pixi list", "pixi outdated", "pixi lock"];
  }
  return [];
}

export const StudioDiagnostics: React.FC<StudioDiagnosticsProps> = ({ venv }) => {
  const [health, setHealth] = useState<string>("");
  const [outdatedPkgs, setOutdatedPkgs] = useState<OutdatedPackage[]>([]);
  const [securityReport, setSecurityReport] = useState<SecurityReport | null>(null);
  const [metadataAudit, setMetadataAudit] = useState<PackageMetadataAudit | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingSecurity, setLoadingSecurity] = useState(false);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securityQuery, setSecurityQuery] = useState("");
  const [securityFilter, setSecurityFilter] = useState<"all" | "fixable" | "blocked">("all");
  const [metadataQuery, setMetadataQuery] = useState("");
  const [metadataFilter, setMetadataFilter] = useState<MetadataReviewFilter>("all");
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataStatus, setMetadataStatus] = useState<string | null>(null);
  const [exportingSbom, setExportingSbom] = useState(false);
  const [runningAllChecks, setRunningAllChecks] = useState(false);
  const [installingSecurityTool, setInstallingSecurityTool] = useState(false);
  const [openingSecurityTerminal, setOpeningSecurityTerminal] = useState(false);
  const [installingSecurityElevated, setInstallingSecurityElevated] = useState(false);
  const [securityElevationRequired, setSecurityElevationRequired] = useState(false);
  const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
  const [hasRunDiagnostics, setHasRunDiagnostics] = useState(false);
  const [diagnosticsJobId, setDiagnosticsJobId] = useState<string | null>(null);
  const [securityJobId, setSecurityJobId] = useState<string | null>(null);
  const [metadataJobId, setMetadataJobId] = useState<string | null>(null);
  const diagnosticsJobIdRef = useRef<string | null>(null);
  const securityJobIdRef = useRef<string | null>(null);
  const metadataJobIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const securityPythonPath = isWindows
    ? `${venv.path}\\Scripts\\python.exe`
    : `${venv.path}/bin/python`;
  const readOnlySecurityManager = isReadOnlyManager(venv.manager_type);
  const readOnlySecurityLabel = readOnlyManagerLabel(venv.manager_type);
  const securityInstallCmd = getSecurityToolInstallCommand(venv, securityPythonPath);
  const nativeCommands = nativeDiagnosticsCommands(venv.manager_type);
  const showMissingSecurityToolHelp =
    /pip-audit not installed|no module named pip_audit/i.test(securityError || "");

  const sortedOutdatedPkgs = useMemo(
    () => [...outdatedPkgs].sort((a, b) => a.name.localeCompare(b.name)),
    [outdatedPkgs]
  );

  const securityFindings = useMemo<SecurityFinding[]>(() => {
    return (securityReport?.dependencies || [])
      .flatMap(dep => (dep.vulnerabilities || []).map(vulnerability => ({
        packageName: dep.name || "unknown",
        packageVersion: dep.version || "unknown",
        vulnerability
      })))
      .sort((a, b) => {
        const aFixable = (a.vulnerability.fix_versions?.length ?? 0) > 0 ? 0 : 1;
        const bFixable = (b.vulnerability.fix_versions?.length ?? 0) > 0 ? 0 : 1;
        return aFixable - bFixable || a.packageName.localeCompare(b.packageName);
      });
  }, [securityReport]);

  const vulnerablePackageCount = useMemo(
    () => new Set(securityFindings.map(finding => finding.packageName)).size,
    [securityFindings]
  );

  const fixableFindingCount = securityFindings.filter(
    finding => (finding.vulnerability.fix_versions?.length ?? 0) > 0
  ).length;

  const visibleSecurityFindings = useMemo(() => {
    const normalizedQuery = securityQuery.trim().toLowerCase();
    return securityFindings.filter(finding => {
      const fixable = (finding.vulnerability.fix_versions?.length ?? 0) > 0;
      if (securityFilter === "fixable" && !fixable) return false;
      if (securityFilter === "blocked" && fixable) return false;
      if (!normalizedQuery) return true;
      return [
        finding.packageName,
        finding.packageVersion,
        finding.vulnerability.id,
        finding.vulnerability.description,
        ...(finding.vulnerability.fix_versions || [])
      ].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery);
    });
  }, [securityFilter, securityFindings, securityQuery]);

  const supplyChainActions = useMemo<SupplyChainAction[]>(() => {
    const actions: SupplyChainAction[] = [];
    const blockedFindingCount = securityFindings.length - fixableFindingCount;
    const suspiciousCount = metadataAudit?.suspicious_packages?.length ?? 0;
    const deprecatedCount = metadataAudit?.deprecated_packages?.length ?? 0;
    const missingLicenseCount = metadataAudit?.missing_license.length ?? 0;

    if (fixableFindingCount > 0) {
      actions.push({
        title: "Upgrade fixable vulnerable packages first",
        description: `${fixableFindingCount} advisory${fixableFindingCount === 1 ? " has" : "ies have"} fixed versions reported by pip-audit.`,
        tone: "red"
      });
    }
    if (blockedFindingCount > 0) {
      actions.push({
        title: "Review advisories without fixed versions",
        description: `${blockedFindingCount} advisory${blockedFindingCount === 1 ? " does" : "ies do"} not report a safe upgrade target yet.`,
        tone: "amber"
      });
    }
    if (suspiciousCount > 0) {
      actions.push({
        title: "Review suspicious package names",
        description: `${suspiciousCount} installed package${suspiciousCount === 1 ? " matches" : "s match"} supply-chain naming heuristics.`,
        tone: "amber"
      });
    }
    if (deprecatedCount > 0) {
      actions.push({
        title: "Plan replacements for deprecated packages",
        description: `${deprecatedCount} installed package${deprecatedCount === 1 ? " is" : "s are"} marked deprecated or inactive by package metadata.`,
        tone: "amber"
      });
    }
    if (missingLicenseCount > 0) {
      actions.push({
        title: "Resolve missing license metadata",
        description: `${missingLicenseCount} package${missingLicenseCount === 1 ? " is" : "s are"} missing license metadata for compliance review.`,
        tone: "blue"
      });
    }
    if ((securityReport || metadataAudit) && !metadataStatus) {
      actions.push({
        title: "Export CycloneDX SBOM",
        description: "Generate a portable dependency inventory for audits, support and release evidence.",
        tone: "green"
      });
    }

    return actions;
  }, [fixableFindingCount, metadataAudit, metadataStatus, securityFindings.length, securityReport]);

  const supplyChainPosture = useMemo<SupplyChainPosture>(() => {
    if (!securityReport && !metadataAudit) {
      return {
        score: null,
        label: "Not checked",
        detail: "Run Security Scan and Metadata Audit to calculate posture.",
        tone: "blue"
      };
    }

    const blockedFindingCount = securityFindings.length - fixableFindingCount;
    const suspiciousCount = metadataAudit?.suspicious_packages?.length ?? 0;
    const deprecatedCount = metadataAudit?.deprecated_packages?.length ?? 0;
    const missingLicenseCount = metadataAudit?.missing_license.length ?? 0;
    const penalty =
      fixableFindingCount * 15 +
      blockedFindingCount * 10 +
      suspiciousCount * 8 +
      deprecatedCount * 8 +
      missingLicenseCount * 3;
    const score = Math.max(0, 100 - penalty);
    const label = score < 60 ? "High risk" : score < 85 ? "Needs review" : "Release-ready";
    const tone = score < 60 ? "red" : score < 85 ? "amber" : "green";

    return {
      score,
      label,
      detail: `${securityFindings.length} advisories, ${suspiciousCount + deprecatedCount} metadata warnings, ${missingLicenseCount} missing licenses.`,
      tone
    };
  }, [fixableFindingCount, metadataAudit, securityFindings.length, securityReport]);

  const metadataReviewItems = useMemo<MetadataReviewItem[]>(() => {
    if (!metadataAudit) return [];
    return [
      ...(metadataAudit.deprecated_packages || []).map(pkg => ({
        kind: "deprecated" as const,
        packageName: pkg.name,
        reason: pkg.reason,
        action: "Plan replacement before the next project upgrade."
      })),
      ...(metadataAudit.suspicious_packages || []).map(pkg => ({
        kind: "suspicious" as const,
        packageName: pkg.name,
        reason: pkg.reason,
        action: "Verify the package name and source before upgrading or pinning."
      })),
      ...metadataAudit.missing_license.map(name => ({
        kind: "missing_license" as const,
        packageName: name,
        reason: "No license metadata was reported by installed package metadata.",
        action: "Check upstream metadata or internal policy before release."
      }))
    ];
  }, [metadataAudit]);

  const visibleMetadataReviewItems = useMemo(() => {
    const normalizedQuery = metadataQuery.trim().toLowerCase();
    return metadataReviewItems.filter(item => {
      if (metadataFilter !== "all" && item.kind !== metadataFilter) return false;
      if (!normalizedQuery) return true;
      return [item.kind, item.packageName, item.reason, item.action]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [metadataFilter, metadataQuery, metadataReviewItems]);

  const runFullDiagnostics = async () => {
    let jobId: string | null = null;
    try {
      setLoadingHealth(true);
      setHasRunDiagnostics(true);
      jobId = await invoke<string>("start_diagnostics_job", { venvPath: venv.path });
      diagnosticsJobIdRef.current = jobId;
      setDiagnosticsJobId(jobId);
      const result = await waitForBackgroundJob<DiagnosticsJobResult>(jobId);
      if (!mountedRef.current || diagnosticsJobIdRef.current !== jobId) return;
      setHealth(result.health || "");
      setOutdatedPkgs(result.outdated || []);
    } catch (err) {
      if (!mountedRef.current || (jobId && diagnosticsJobIdRef.current !== jobId)) return;
      const message = err instanceof Error ? err.message : String(err);
      setHealth(message === "Operation cancelled." ? "Diagnostics cancelled." : message);
      setOutdatedPkgs([]);
    } finally {
      if (mountedRef.current && (!jobId || diagnosticsJobIdRef.current === jobId)) {
        setLoadingHealth(false);
        setDiagnosticsJobId(null);
        diagnosticsJobIdRef.current = null;
      }
    }
  };

  const runSecurityAudit = async () => {
    let jobId: string | null = null;
    try {
      setLoadingSecurity(true);
      setSecurityError(null);
      setSecurityQuery("");
      setSecurityFilter("all");
      jobId = await invoke<string>("start_security_audit_job", { venvPath: venv.path });
      securityJobIdRef.current = jobId;
      setSecurityJobId(jobId);
      const result = await waitForBackgroundJob<SecurityReport>(jobId);
      if (!mountedRef.current || securityJobIdRef.current !== jobId) return;
      setSecurityReport(result);
    } catch (err) {
      if (!mountedRef.current || (jobId && securityJobIdRef.current !== jobId)) return;
      const message = err instanceof Error ? err.message : String(err);
      setSecurityError(message === "Operation cancelled." ? "Security audit cancelled." : message);
    } finally {
      if (mountedRef.current && (!jobId || securityJobIdRef.current === jobId)) {
        setLoadingSecurity(false);
        setSecurityJobId(null);
        securityJobIdRef.current = null;
      }
    }
  };

  const cancelJob = async (jobId: string | null) => {
    if (!jobId) return;
    try {
      await invoke<boolean>("cancel_background_job", { jobId });
    } catch (err) {
      console.error("Cancel failed:", err);
    }
  };

  const runMetadataAudit = async () => {
    let jobId: string | null = null;
    try {
      setLoadingMetadata(true);
      setMetadataError(null);
      setMetadataStatus(null);
      setMetadataQuery("");
      setMetadataFilter("all");
      jobId = await invoke<string>("start_package_metadata_audit_job", { venvPath: venv.path });
      metadataJobIdRef.current = jobId;
      setMetadataJobId(jobId);
      const result = await waitForBackgroundJob<PackageMetadataAudit>(jobId);
      if (!mountedRef.current || metadataJobIdRef.current !== jobId) return;
      setMetadataAudit(result);
    } catch (err) {
      if (!mountedRef.current || (jobId && metadataJobIdRef.current !== jobId)) return;
      const message = err instanceof Error ? err.message : String(err);
      setMetadataError(message === "Operation cancelled." ? "Package metadata audit cancelled." : message);
    } finally {
      if (mountedRef.current && (!jobId || metadataJobIdRef.current === jobId)) {
        setLoadingMetadata(false);
        setMetadataJobId(null);
        metadataJobIdRef.current = null;
      }
    }
  };

  const runAllChecks = async () => {
    setRunningAllChecks(true);
    try {
      await runFullDiagnostics();
      if (!mountedRef.current) return;
      await runSecurityAudit();
      if (!mountedRef.current) return;
      await runMetadataAudit();
    } finally {
      if (mountedRef.current) setRunningAllChecks(false);
    }
  };

  const exportSbom = async () => {
    const path = await saveDialog({
      defaultPath: `${venv.name}-sbom.cdx.json`,
      filters: [{ name: "CycloneDX SBOM", extensions: ["json"] }]
    });
    if (typeof path !== "string") return;

    setExportingSbom(true);
    setMetadataError(null);
    setMetadataStatus(null);
    try {
      const out = await invoke<string>("export_package_sbom", {
        venvPath: venv.path,
        outputPath: path
      });
      setMetadataStatus(out);
    } catch (err) {
      setMetadataError(String(err || "Failed to export SBOM."));
    } finally {
      setExportingSbom(false);
    }
  };

  useEffect(() => {
    // Ensure we do not leave heavy jobs running after switching environments.
    void cancelJob(diagnosticsJobIdRef.current);
    void cancelJob(securityJobIdRef.current);
    void cancelJob(metadataJobIdRef.current);
    diagnosticsJobIdRef.current = null;
    securityJobIdRef.current = null;
    metadataJobIdRef.current = null;

    setHealth("");
    setOutdatedPkgs([]);
    setSecurityReport(null);
    setSecurityQuery("");
    setSecurityFilter("all");
    setMetadataAudit(null);
    setMetadataQuery("");
    setMetadataFilter("all");
    setSecurityError(null);
    setMetadataError(null);
    setMetadataStatus(null);
    setHasRunDiagnostics(false);
    setLoadingHealth(false);
    setLoadingSecurity(false);
    setLoadingMetadata(false);
    setRunningAllChecks(false);
    setDiagnosticsJobId(null);
    setSecurityJobId(null);
    setMetadataJobId(null);
  }, [venv.path]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void cancelJob(diagnosticsJobIdRef.current);
      void cancelJob(securityJobIdRef.current);
      void cancelJob(metadataJobIdRef.current);
    };
  }, []);

  return (
    <div className="space-y-10 animate-in fade-in duration-500 text-slate-900 dark:text-slate-100">
      <div className="vo-panel rounded-[2rem] border border-blue-100/80 dark:border-blue-900/30 bg-blue-50/70 dark:bg-blue-950/10 px-6 py-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">Diagnostics scope</p>
            <p className="mt-1 text-xs font-bold leading-relaxed text-blue-700 dark:text-blue-200">
              Diagnostics are explicit, cancellable checks. Consistency looks for outdated packages, Security uses pip-audit advisories, and Metadata reviews licenses, suspicious names and SBOM export.
            </p>
          </div>
          <button
            onClick={runAllChecks}
            disabled={runningAllChecks || loadingHealth || loadingSecurity || loadingMetadata}
            className="vo-primary-action shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl text-[10px] disabled:opacity-50"
          >
            {runningAllChecks ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {runningAllChecks ? "Running all..." : "Run all checks"}
          </button>
        </div>
      </div>

      {nativeCommands.length > 0 && (
        <div className="vo-surface rounded-[2rem] border border-blue-100/80 dark:border-blue-900/30 px-6 py-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-600 p-2 text-white">
              <Terminal size={18} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">{readOnlySecurityLabel} native diagnostics</p>
              <p className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                VOrchestra runs safe read-only checks here. For manager-native update, lock and export analysis, run these commands in the project terminal.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
            {nativeCommands.map(command => (
              <code key={command} className="rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                {command}
              </code>
            ))}
          </div>
        </div>
      )}

      <div className="vo-surface rounded-[2rem] border px-6 py-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Supply-chain action plan</p>
            <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
              Run Security Scan and Metadata Audit to convert raw package findings into prioritized remediation steps.
            </p>
          </div>
          <div className={`shrink-0 rounded-2xl border px-4 py-3 text-right ${
            supplyChainPosture.tone === "red"
              ? "border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-950/10"
              : supplyChainPosture.tone === "amber"
                ? "border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/10"
                : supplyChainPosture.tone === "green"
                  ? "border-emerald-100 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-950/10"
                  : "border-blue-100 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-950/10"
          }`}>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Posture score</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-white">
              {supplyChainPosture.score == null ? "—" : supplyChainPosture.score}
            </p>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">
              {supplyChainPosture.label}
            </p>
          </div>
        </div>
        <div className="vo-panel mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-2xl border px-4 py-3">
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{supplyChainPosture.detail}</p>
          <span className="vo-surface rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
            {supplyChainActions.length || "No"} action{supplyChainActions.length === 1 ? "" : "s"}
          </span>
        </div>
        {supplyChainActions.length > 0 && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {supplyChainActions.map(action => (
              <div
                key={action.title}
                className={`rounded-2xl border px-4 py-3 ${
                  action.tone === "red"
                    ? "border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-950/10"
                    : action.tone === "amber"
                      ? "border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/10"
                      : action.tone === "green"
                        ? "border-emerald-100 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-950/10"
                        : "border-blue-100 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-950/10"
                }`}
              >
                <p className="text-[10px] font-black uppercase tracking-widest">{action.title}</p>
                <p className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400 leading-relaxed">{action.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 1: Health & Updates */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="vo-surface p-8 border rounded-[2.5rem] shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
              <CheckCircle2 size={16} className="text-green-500"/> Consistency Check
            </h3>
            <div className="flex items-center gap-2">
              <button onClick={runFullDiagnostics} disabled={loadingHealth || runningAllChecks} className="vo-primary-action flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] disabled:opacity-50">
                <RefreshCcw size={12} className={loadingHealth ? "animate-spin" : ""}/>
                {loadingHealth ? "Running..." : "Run Diagnostics"}
              </button>
              {loadingHealth && (
                <button
                  onClick={() => cancelJob(diagnosticsJobId)}
                  className="vo-secondary-action px-3 py-1.5 rounded-xl text-[10px]"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          <pre className="vo-subpanel text-[10px] font-mono p-4 rounded-2xl border overflow-auto max-h-32">
            {loadingHealth ? "Running check..." : hasRunDiagnostics ? (health || "No output") : "Click 'Run Diagnostics' to start."}
          </pre>
        </div>

        <div className="vo-surface p-8 border rounded-[2.5rem] shadow-sm">
          <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2 mb-6">
            <AlertCircle size={16} className="text-orange-500"/> Outdated Packages
          </h3>
          {hasRunDiagnostics && outdatedPkgs.length > 0 && (
            <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-amber-600">
              {outdatedPkgs.length} package{outdatedPkgs.length === 1 ? "" : "s"} need update
            </p>
          )}
          <div className="space-y-2 max-h-32 overflow-y-auto pr-2 scrollbar-thin">
            {!hasRunDiagnostics && !loadingHealth && <p className="text-center text-[10px] text-slate-400 italic py-4">Run diagnostics to load outdated packages.</p>}
            {hasRunDiagnostics && sortedOutdatedPkgs.map(pkg => (
              <div key={pkg.name} className="vo-subpanel flex justify-between items-center p-3 rounded-xl border">
                <span className="text-[10px] font-black">{pkg.name}</span>
                <span className="text-[9px] font-mono text-slate-400">{pkg.version} → <span className="text-blue-500">{pkg.latest_version}</span></span>
              </div>
            ))}
            {hasRunDiagnostics && !loadingHealth && outdatedPkgs.length === 0 && <p className="text-center text-[10px] text-slate-400 italic py-4">All packages are up to date.</p>}
          </div>
        </div>
      </div>

      {/* Section 2: Security Audit */}
      <div className="vo-surface p-8 border rounded-[3rem] shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="font-black text-sm uppercase tracking-widest flex items-center gap-2">
              <ShieldAlert size={20} className="text-blue-600"/> Security Vulnerability Audit
            </h3>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-1">Deep inspection via PyPA Advisory Database</p>
          </div>
          <button 
            onClick={runSecurityAudit}
            disabled={loadingSecurity || runningAllChecks}
            className="vo-primary-action flex items-center gap-2 px-6 py-2.5 rounded-2xl text-[10px] shadow-lg shadow-blue-500/20 disabled:opacity-50"
          >
            {loadingSecurity ? <Loader2 size={14} className="animate-spin"/> : <ShieldAlert size={14}/>}
            {loadingSecurity ? "Auditing..." : "Run Security Scan"}
          </button>
          {loadingSecurity && (
            <button
              onClick={() => cancelJob(securityJobId)}
              className="vo-secondary-action px-6 py-2.5 rounded-2xl text-[10px]"
            >
              Cancel
            </button>
          )}
        </div>

        {securityError ? (
          <div className="p-6 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-[2rem] text-center">
            <p className="text-xs text-red-600 font-bold mb-4">{securityError}</p>
            {showMissingSecurityToolHelp && (
              <div className="vo-surface p-4 rounded-2xl text-left border border-red-100 dark:border-red-900/20 shadow-sm">
                {readOnlySecurityManager && (
                  <p className="mb-3 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    {readOnlySecurityLabel} environments are read-only in VOrchestra. Install pip-audit with the native manager, then run the scan again.
                  </p>
                )}
                <code className="vo-subpanel text-[10px] font-mono text-blue-600 dark:text-blue-400 block p-3 rounded-xl border border-red-100 dark:border-red-900/20">
                  {securityInstallCmd}
                </code>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!readOnlySecurityManager && (
                    <button
                      onClick={async () => {
                        setInstallingSecurityTool(true);
                        setSecurityElevationRequired(false);
                        try {
                          await packageService.install(venv, "pip-audit");
                          setSecurityError(null);
                          await runSecurityAudit();
                        } catch (installErr) {
                          if (needsElevation(installErr)) {
                            setSecurityElevationRequired(true);
                            setSecurityError("Permission denied. pip-audit needs to be installed with elevated privileges.");
                          } else {
                            setSecurityError(String(installErr || "Failed to install pip-audit."));
                          }
                        } finally {
                          setInstallingSecurityTool(false);
                        }
                      }}
                      disabled={installingSecurityTool || openingSecurityTerminal || loadingSecurity || installingSecurityElevated}
                      className="vo-primary-action px-3 py-1.5 rounded-lg text-[10px] disabled:opacity-50"
                    >
                      {installingSecurityTool ? "Installing..." : "Install Now"}
                    </button>
                  )}
                  {!readOnlySecurityManager && securityElevationRequired && (
                    <button
                      onClick={async () => {
                        setInstallingSecurityElevated(true);
                        try {
                          await packageService.installElevated(venv, "pip-audit");
                          setSecurityElevationRequired(false);
                          setSecurityError(null);
                          await runSecurityAudit();
                        } catch (elevErr) {
                          setSecurityError(stripElevationPrefix(elevErr) || "Elevated install failed.");
                        } finally {
                          setInstallingSecurityElevated(false);
                        }
                      }}
                      disabled={installingSecurityElevated || installingSecurityTool || loadingSecurity}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[10px] font-black uppercase disabled:opacity-50"
                      title={isWindows ? "Triggers a UAC prompt" : "Opens a terminal with sudo"}
                    >
                      {installingSecurityElevated
                        ? (isWindows ? "Waiting UAC..." : "Opening sudo...")
                        : (isWindows ? "Retry as Administrator" : "Retry with sudo")}
                    </button>
                  )}
                  {!readOnlySecurityManager && (
                    <button
                      onClick={async () => {
                        setOpeningSecurityTerminal(true);
                        try {
                          await invoke("open_terminal_with_venv_command", { path: venv.path, command: securityInstallCmd });
                        } catch (openErr) {
                          setSecurityError(String(openErr || "Failed to open terminal with command."));
                        } finally {
                          setOpeningSecurityTerminal(false);
                        }
                      }}
                      disabled={openingSecurityTerminal || installingSecurityTool || loadingSecurity || installingSecurityElevated}
                      className="vo-secondary-action px-3 py-1.5 rounded-lg text-[10px] disabled:opacity-50"
                    >
                      {openingSecurityTerminal ? "Opening..." : "Open Install Command"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : securityReport ? (
          <div className="space-y-4">
            <PolicyBanner policy={securityReport._vorchestra_policy} />
            {securityFindings.length > 0 ? (
              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-[2rem] border border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-950/10 p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-red-600 dark:text-red-300">Security summary</p>
                  <p className="mt-1 text-sm font-black text-red-700 dark:text-red-200">
                    {securityFindings.length} {securityFindings.length === 1 ? "advisory" : "advisories"} across {vulnerablePackageCount} package{vulnerablePackageCount === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-[10px] font-bold text-red-500 dark:text-red-300">
                    {fixableFindingCount > 0
                      ? `${fixableFindingCount} finding${fixableFindingCount === 1 ? " lists" : "s list"} fixed versions. Upgrade those first.`
                      : "No fixed versions were reported by pip-audit. Review advisories before changing packages."}
                  </p>
                </div>
                <div className="vo-panel flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                  <label className="vo-control flex items-center gap-2 rounded-xl border px-3 py-2">
                    <Search size={13} className="text-slate-400" />
                    <input
                      value={securityQuery}
                      onChange={(event) => setSecurityQuery(event.target.value)}
                      placeholder="Search advisories..."
                      className="w-56 bg-transparent outline-none text-[10px] font-bold text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Filter security findings"
                      value={securityFilter}
                      onChange={(event) => setSecurityFilter(event.target.value as "all" | "fixable" | "blocked")}
                      className="vo-control rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-200"
                    >
                      <option value="all">All findings</option>
                      <option value="fixable">Fixable first</option>
                      <option value="blocked">No fixed version</option>
                    </select>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {visibleSecurityFindings.length}/{securityFindings.length} shown
                    </span>
                  </div>
                </div>
                {visibleSecurityFindings.length === 0 ? (
                  <div className="vo-panel py-8 text-center rounded-2xl border">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">No advisories match this filter</p>
                  </div>
                ) : visibleSecurityFindings.map(({ packageName, packageVersion, vulnerability }) => (
                  <div key={`${packageName}-${vulnerability.id || vulnerability.description}`} className="flex flex-col p-5 bg-red-50/50 dark:bg-red-900/5 border border-red-100 dark:border-red-900/20 rounded-[2rem] transition-all hover:bg-red-50 dark:hover:bg-red-900/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="px-3 py-1 bg-red-600 text-white text-[9px] font-black rounded-full uppercase">High Risk</span>
                        <span className="font-black text-xs text-slate-800 dark:text-slate-200">{packageName}=={packageVersion}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">{vulnerability.id}</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mb-3">{vulnerability.description || "No detailed description provided."}</p>
                    <div className="flex items-center justify-between border-t border-red-100 dark:border-red-900/20 pt-3 mt-1">
                      <span className="text-[9px] font-bold text-red-500 uppercase">Fixed in: {vulnerability.fix_versions?.join(", ") || "N/A"}</span>
                      {vulnerability.id && (
                        <a href={`https://github.com/advisories/${vulnerability.id}`} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1">
                          View Advisory <ExternalLink size={10}/>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 gap-4 bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/20 rounded-[3rem]">
                <ShieldCheck size={48} className="text-green-500 opacity-50"/>
                <p className="font-black text-green-600 uppercase tracking-widest text-xs">No vulnerabilities found</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[3rem]">
            <ShieldAlert size={32} className="opacity-20 mb-4"/>
            <p className="text-[10px] font-bold uppercase tracking-widest">Click the button above to start the audit</p>
          </div>
        )}
      </div>

      {/* Section 3: Package Metadata / Licenses */}
      <div className="vo-surface p-8 border rounded-[3rem] shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="font-black text-sm uppercase tracking-widest flex items-center gap-2">
              <BadgeCheck size={20} className="text-emerald-600"/> Package Metadata Audit
            </h3>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-1">License coverage and supply-chain hygiene from installed package metadata</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runMetadataAudit}
              disabled={loadingMetadata || runningAllChecks}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
            >
              {loadingMetadata ? <Loader2 size={14} className="animate-spin"/> : <BadgeCheck size={14}/>}
              {loadingMetadata ? "Auditing..." : "Run Metadata Audit"}
            </button>
            <button
              onClick={exportSbom}
              disabled={loadingMetadata || exportingSbom || runningAllChecks}
              className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-2xl text-[10px] font-black uppercase hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
            >
              {exportingSbom ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>}
              {exportingSbom ? "Exporting..." : "Export SBOM"}
            </button>
            {loadingMetadata && (
              <button
                onClick={() => cancelJob(metadataJobId)}
                className="vo-secondary-action px-6 py-2.5 rounded-2xl text-[10px]"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {metadataError ? (
          <div className="p-5 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-[2rem] text-xs font-bold text-red-600">
            {metadataError}
          </div>
        ) : metadataStatus ? (
          <div className="mb-5 p-5 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-[2rem] text-xs font-bold text-emerald-700 dark:text-emerald-300">
            {metadataStatus}
          </div>
        ) : null}

        {metadataAudit ? (
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
            <div className="rounded-[2rem] bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-5">
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Coverage</p>
              <p className="mt-2 text-3xl font-black text-emerald-700 dark:text-emerald-300">{metadataAudit.total_packages}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">installed packages inspected</p>
              <p className="mt-4 text-xs font-black text-amber-600">{metadataAudit.missing_license.length} missing license</p>
              <p className="mt-1 text-xs font-black text-red-600">
                {(metadataAudit.suspicious_packages?.length ?? 0) + (metadataAudit.deprecated_packages?.length ?? 0)} review hint
              </p>
            </div>
            <div className="space-y-4">
              <PolicyBanner policy={metadataAudit.policy} compact />
              <div className="vo-panel rounded-2xl border p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">Metadata review queue</h4>
                    <p className="mt-1 text-[10px] font-bold text-slate-400">
                      {visibleMetadataReviewItems.length}/{metadataReviewItems.length} package finding{metadataReviewItems.length === 1 ? "" : "s"} shown
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label className="vo-control flex items-center gap-2 rounded-xl border px-3 py-2">
                      <Search size={13} className="text-slate-400" />
                      <input
                        value={metadataQuery}
                        onChange={(event) => setMetadataQuery(event.target.value)}
                        placeholder="Search metadata findings..."
                        className="w-52 bg-transparent outline-none text-[10px] font-bold text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                      />
                    </label>
                    <select
                      aria-label="Filter metadata findings"
                      value={metadataFilter}
                      onChange={(event) => setMetadataFilter(event.target.value as MetadataReviewFilter)}
                      className="vo-control rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-200"
                    >
                      <option value="all">All findings</option>
                      <option value="deprecated">Deprecated</option>
                      <option value="suspicious">Suspicious</option>
                      <option value="missing_license">Missing license</option>
                    </select>
                  </div>
                </div>
                {metadataReviewItems.length === 0 ? (
                  <p className="mt-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    No metadata review findings were detected.
                  </p>
                ) : visibleMetadataReviewItems.length === 0 ? (
                  <p className="vo-subpanel mt-4 rounded-xl px-4 py-3 text-[10px] font-bold text-slate-400">
                    No metadata findings match this filter.
                  </p>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-2">
                    {visibleMetadataReviewItems.slice(0, 12).map(item => (
                      <div key={`${item.kind}-${item.packageName}`} className="vo-subpanel rounded-xl border px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[10px] font-black font-mono text-slate-800 dark:text-slate-200">{item.packageName}</p>
                          <span className="rounded-full bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-slate-500">
                            {item.kind.replace("_", " ")}
                          </span>
                        </div>
                        <p className="mt-1 text-[9px] font-bold text-slate-500 dark:text-slate-400">{item.reason}</p>
                        <p className="mt-1 text-[9px] font-black text-blue-600 dark:text-blue-300">{item.action}</p>
                      </div>
                    ))}
                    {visibleMetadataReviewItems.length > 12 && (
                      <p className="text-[9px] font-bold text-slate-400">
                        {visibleMetadataReviewItems.length - 12} additional finding{visibleMetadataReviewItems.length - 12 === 1 ? "" : "s"} hidden to keep the panel responsive.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {(metadataAudit.deprecated_packages?.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/10 p-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-300 mb-2">Deprecated or inactive packages</h4>
                  <div className="space-y-2">
                    {metadataAudit.deprecated_packages?.slice(0, 8).map(pkg => (
                      <div key={pkg.name} className="rounded-xl bg-white/70 dark:bg-slate-950/50 border border-amber-100 dark:border-amber-900/30 px-3 py-2">
                        <p className="text-[10px] font-black font-mono text-amber-700 dark:text-amber-300">{pkg.name}</p>
                        <p className="text-[9px] text-slate-500 dark:text-slate-400">{pkg.reason}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] text-amber-600 dark:text-amber-300">
                    Treat this as planning input, not an automatic removal signal.
                  </p>
                </div>
              )}
              {(metadataAudit.suspicious_packages?.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-950/10 p-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-300 mb-2">Package names to review</h4>
                  <div className="space-y-2">
                    {metadataAudit.suspicious_packages?.slice(0, 8).map(pkg => (
                      <div key={pkg.name} className="rounded-xl bg-white/70 dark:bg-slate-950/50 border border-red-100 dark:border-red-900/30 px-3 py-2">
                        <p className="text-[10px] font-black font-mono text-red-700 dark:text-red-300">{pkg.name}</p>
                        <p className="text-[9px] text-slate-500 dark:text-slate-400">{pkg.reason}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] text-red-500 dark:text-red-300">
                    These are heuristics only. Review before taking action.
                  </p>
                </div>
              )}
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Top licenses</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {metadataAudit.licenses.slice(0, 8).map(bucket => (
                    <div key={bucket.license} className="vo-subpanel flex items-center justify-between rounded-xl border px-3 py-2">
                      <span className="text-[10px] font-mono truncate">{bucket.license}</span>
                      <span className="text-[10px] font-black text-emerald-600">{bucket.count}</span>
                    </div>
                  ))}
                  {metadataAudit.licenses.length === 0 && <p className="text-[10px] italic text-slate-400">No license metadata found.</p>}
                </div>
              </div>
              {metadataAudit.missing_license.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Missing license metadata</h4>
                  <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 line-clamp-3">
                    {metadataAudit.missing_license.slice(0, 20).join(", ")}
                    {metadataAudit.missing_license.length > 20 ? "..." : ""}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[3rem]">
            <BadgeCheck size={32} className="opacity-20 mb-4"/>
            <p className="text-[10px] font-bold uppercase tracking-widest">Run metadata audit to inspect license coverage</p>
          </div>
        )}
      </div>
    </div>
  );
};
