import { invoke } from "@tauri-apps/api/core";
import { VenvInfo } from "../types";
import { BackgroundJobSnapshot, waitForBackgroundJob } from "./backgroundJobs";
import { isReadOnlyManager, readOnlyManagerLabel } from "../utils/venvManagers";

export class PackageManagerService {
  private dependencyTreeCache = new Map<string, { data: unknown; ts: number }>();
  private dependencyTreeInFlight = new Map<string, Promise<unknown>>();
  private dependencyTreeJobIds = new Map<string, string>();
  private static readonly TREE_CACHE_TTL_MS = 60_000;

  private treeCacheKey(venv: VenvInfo): string {
    return `${venv.path}::${venv.manager_type}::${venv.last_modified}`;
  }

  private invalidateDependencyTreeCacheByPath(venvPath: string) {
    for (const key of this.dependencyTreeCache.keys()) {
      if (key.startsWith(`${venvPath}::`)) {
        this.dependencyTreeCache.delete(key);
      }
    }
    for (const key of this.dependencyTreeInFlight.keys()) {
      if (key.startsWith(`${venvPath}::`)) {
        this.dependencyTreeInFlight.delete(key);
      }
    }
    for (const key of this.dependencyTreeJobIds.keys()) {
      if (key.startsWith(`${venvPath}::`)) {
        this.dependencyTreeJobIds.delete(key);
      }
    }
  }

  private assertWritableManager(venv: VenvInfo, action: string) {
    if (!isReadOnlyManager(venv.manager_type)) return;

    const label = readOnlyManagerLabel(venv.manager_type);
    throw new Error(`${label} environments are read-only in VOrchestra. Use the native manager to ${action}.`);
  }

  /**
   * Instala um pacote no venv usando o motor correto. Aceita o conjunto
   * pequeno de origens que pip/uv suportam:
   *   - "name" ou "name==1.2.3" (PyPI default)
   *   - "git+https://github.com/user/repo.git@ref" (Git)
   *   - "https://example.com/wheel.whl" ou outra URL
   *   - "/abs/path/to/file.whl" / ".tar.gz" (arquivo local)
   *   - "/abs/path/to/project" (com `opts.editable: true` para `-e`)
   * Opcionais:
   *   - opts.indexUrl       -> --index-url (substitui o default PyPI)
   *   - opts.extraIndexUrl  -> --extra-index-url (adiciona um índice extra)
   *   - opts.editable       -> -e (instalação editável de um path local)
   */
  async install(
    venv: VenvInfo,
    pkgName: string,
    opts?: { indexUrl?: string; extraIndexUrl?: string; editable?: boolean },
    jobOptions?: { onJobStarted?: (jobId: string) => void; onUpdate?: (snapshot: BackgroundJobSnapshot<string>) => void }
  ): Promise<string> {
    const jobId = await this.startInstall(venv, pkgName, opts);
    jobOptions?.onJobStarted?.(jobId);
    const result = await waitForBackgroundJob<string>(jobId, jobOptions?.onUpdate);
    this.invalidateDependencyTreeCacheByPath(venv.path);
    return result;
  }

  async startInstall(
    venv: VenvInfo,
    pkgName: string,
    opts?: { indexUrl?: string; extraIndexUrl?: string; editable?: boolean }
  ): Promise<string> {
    this.assertWritableManager(venv, "install packages");
    return await invoke<string>("start_install_dependency_job", {
      venvPath: venv.path,
      package: pkgName,
      engine: venv.manager_type,
      indexUrl: opts?.indexUrl ?? null,
      extraIndexUrl: opts?.extraIndexUrl ?? null,
      editable: opts?.editable ?? null
    });
  }

  /**
   * Re-runs the install with OS-level elevation (UAC on Windows, terminal
   * with `sudo` on macOS/Linux). Call this only after a normal install
   * failed with a `NEEDS_ELEVATION:` error.
   */
  async installElevated(
    venv: VenvInfo,
    pkgName: string,
    opts?: { indexUrl?: string; extraIndexUrl?: string; editable?: boolean }
  ): Promise<string> {
    this.assertWritableManager(venv, "install packages with elevated privileges");
    const result = await invoke<string>("install_dependency_elevated", {
      venvPath: venv.path,
      package: pkgName,
      engine: venv.manager_type,
      indexUrl: opts?.indexUrl ?? null,
      extraIndexUrl: opts?.extraIndexUrl ?? null,
      editable: opts?.editable ?? null
    });
    this.invalidateDependencyTreeCacheByPath(venv.path);
    return result;
  }


  /**
   * Remove um pacote usando o motor correto do ambiente
   */
  async uninstall(
    venv: VenvInfo,
    pkgName: string,
    jobOptions?: { onJobStarted?: (jobId: string) => void; onUpdate?: (snapshot: BackgroundJobSnapshot<string>) => void }
  ): Promise<string> {
    const jobId = await this.startUninstall(venv, pkgName);
    jobOptions?.onJobStarted?.(jobId);
    const result = await waitForBackgroundJob<string>(jobId, jobOptions?.onUpdate);
    this.invalidateDependencyTreeCacheByPath(venv.path);
    return result;
  }

  async startUninstall(venv: VenvInfo, pkgName: string): Promise<string> {
    this.assertWritableManager(venv, "uninstall packages");
    return await invoke<string>("start_uninstall_package_job", {
      venvPath: venv.path, 
      package: pkgName, 
      engine: venv.manager_type 
    });
  }

  /**
   * Atualiza um pacote usando o motor correto do ambiente
   */
  async update(
    venv: VenvInfo,
    pkgName: string,
    jobOptions?: { onJobStarted?: (jobId: string) => void; onUpdate?: (snapshot: BackgroundJobSnapshot<string>) => void }
  ): Promise<string> {
    const jobId = await this.startUpdate(venv, pkgName);
    jobOptions?.onJobStarted?.(jobId);
    const result = await waitForBackgroundJob<string>(jobId, jobOptions?.onUpdate);
    this.invalidateDependencyTreeCacheByPath(venv.path);
    return result;
  }

  async startUpdate(venv: VenvInfo, pkgName: string): Promise<string> {
    this.assertWritableManager(venv, "update packages");
    return await invoke<string>("start_update_package_job", {
      venvPath: venv.path, 
      package: pkgName, 
      engine: venv.manager_type 
    });
  }

  /**
   * Obtém a árvore de dependências do ambiente
   */
  async getDependencyTree(
    venv: VenvInfo,
    options?: { force?: boolean; onUpdate?: (snapshot: BackgroundJobSnapshot<unknown>) => void }
  ): Promise<unknown> {
    const force = options?.force === true;
    const key = this.treeCacheKey(venv);
    const now = Date.now();
    const cached = this.dependencyTreeCache.get(key);

    if (!force && cached && now - cached.ts < PackageManagerService.TREE_CACHE_TTL_MS) {
      return cached.data;
    }

    const inFlight = this.dependencyTreeInFlight.get(key);
    if (!force && inFlight) {
      return inFlight;
    }

    const request = invoke<string>("start_get_dependency_tree_job", {
      venvPath: venv.path,
      engine: venv.manager_type
    }).then((jobId) => {
      this.dependencyTreeJobIds.set(key, jobId);
      return waitForBackgroundJob<unknown>(jobId, options?.onUpdate);
    }).then((data) => {
      this.dependencyTreeCache.set(key, { data, ts: Date.now() });
      this.dependencyTreeInFlight.delete(key);
      this.dependencyTreeJobIds.delete(key);
      return data;
    }).catch((err) => {
      this.dependencyTreeInFlight.delete(key);
      this.dependencyTreeJobIds.delete(key);
      throw err;
    });

    this.dependencyTreeInFlight.set(key, request);
    return request;
  }

  async cancelDependencyTree(venv: VenvInfo): Promise<boolean> {
    const key = this.treeCacheKey(venv);
    const jobId = this.dependencyTreeJobIds.get(key);
    if (!jobId) return false;
    return await invoke<boolean>("cancel_background_job", { jobId });
  }

  async cancelJob(jobId: string): Promise<boolean> {
    return await invoke<boolean>("cancel_background_job", { jobId });
  }

  async checkDependencyTreePrereq(venv: VenvInfo): Promise<{ ok: boolean; message?: string | null }> {
    return await invoke("check_dependency_tree_prereq", {
      venvPath: venv.path,
      engine: venv.manager_type
    });
  }

  /**
   * Exporta os requisitos (sempre gera requirements.txt para compatibilidade)
   */
  async exportRequirements(venvPath: string): Promise<string> {
    const jobId = await invoke<string>("start_export_requirements_job", { venvPath });
    return await waitForBackgroundJob<string>(jobId);
  }
}

export const packageService = new PackageManagerService();

/**
 * Sentinel emitted by the Rust backend when a pip / uv install (or
 * uninstall / update) fails because the OS denied write access. The
 * frontend uses this to prompt the user for elevation instead of just
 * surfacing the raw stderr.
 */
export const NEEDS_ELEVATION_PREFIX = "NEEDS_ELEVATION:";

/** Returns true when an install error indicates elevation is required. */
export function needsElevation(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? error ?? "");
  return msg.includes(NEEDS_ELEVATION_PREFIX);
}

/** Strips the elevation sentinel from an error message for display. */
export function stripElevationPrefix(error: unknown): string {
  const msg = String((error as { message?: string })?.message ?? error ?? "");
  return msg.replace(NEEDS_ELEVATION_PREFIX, "").trim();
}
