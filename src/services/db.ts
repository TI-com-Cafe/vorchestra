import Database from "@tauri-apps/plugin-sql";
import { VenvInfo, Script, Template } from "../types";

class DatabaseService {
  private db: Database | null = null;
  private initPromise: Promise<Database> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  private async withRetry<T>(fn: () => Promise<T>, attempts = 10): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message ?? err).toLowerCase();
        if (!msg.includes("database is locked") && !msg.includes("database locked")) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 120 * (i + 1)));
      }
    }
    throw lastError;
  }

  private async runWrite<T>(op: (db: Database) => Promise<T>): Promise<T> {
    const task = this.writeQueue.then(async () => {
      const db = await this.init();
      return this.withRetry(() => op(db));
    });
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async runRead<T>(op: (db: Database) => Promise<T>): Promise<T> {
    await this.writeQueue.catch(() => undefined);
    const db = await this.init();
    return this.withRetry(() => op(db));
  }

  private async transaction<T>(db: Database, op: () => Promise<T>): Promise<T> {
    await db.execute("BEGIN IMMEDIATE");
    try {
      const result = await op();
      await db.execute("COMMIT");
      return result;
    } catch (err) {
      try {
        await db.execute("ROLLBACK");
      } catch {
        // Best effort rollback: the original error is more useful to callers.
      }
      throw err;
    }
  }

  async init() {
    if (this.db) return this.db;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const db = await Database.load("sqlite:vorchestra.db");
        await db.execute("PRAGMA journal_mode = WAL");
        await db.execute("PRAGMA busy_timeout = 10000");
        await db.execute("PRAGMA synchronous = NORMAL");
        this.db = db;
        return db;
      })().finally(() => {
        this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  // --- Workspaces ---
  async getWorkspaces(): Promise<{ path: string, is_default: boolean }[]> {
    return this.runRead((db) => db.select("SELECT path, is_default FROM workspaces"));
  }

  async addWorkspace(path: string) {
    await this.runWrite((db) =>
      db.execute("INSERT OR IGNORE INTO workspaces (path, is_default) VALUES (?, 0)", [path])
    );
  }

  async setDefaultWorkspace(path: string) {
    await this.runWrite((db) => this.transaction(db, async () => {
      await db.execute("UPDATE workspaces SET is_default = 0");
      await db.execute("UPDATE workspaces SET is_default = 1 WHERE path = ?", [path]);
    }));
  }

  // ... (rest of methods)

  async addSingleVenv(workspacePath: string, v: VenvInfo) {
    await this.runWrite((db) =>
      db.execute(
        "INSERT OR REPLACE INTO venvs (workspace_path, name, path, version, status, issue, last_modified, manager_type, template_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [workspacePath, v.name, v.path, v.version, v.status, v.issue || null, v.last_modified, v.manager_type, v.template_name || null]
      )
    );
  }

  async removeWorkspace(path: string) {
    await this.runWrite(async (db) => {
      await db.execute("PRAGMA busy_timeout = 30000");
      await db.execute(
        "DELETE FROM scripts WHERE venv_path IN (SELECT path FROM venvs WHERE workspace_path = ?)",
        [path]
      );
      await db.execute("DELETE FROM venvs WHERE workspace_path = ?", [path]);
      await db.execute("DELETE FROM workspaces WHERE path = ?", [path]);
    });
  }

  async removeVenvByPath(path: string) {
    await this.runWrite((db) => db.execute("DELETE FROM venvs WHERE path = ?", [path]));
  }

  // --- Venvs Cache ---
  async getCachedVenvs(): Promise<Record<string, VenvInfo[]>> {
    const rows: any[] = await this.runRead((db) => db.select("SELECT * FROM venvs"));
    const cache: Record<string, VenvInfo[]> = {};
    
    rows.forEach(r => {
      if (!cache[r.workspace_path]) cache[r.workspace_path] = [];
      cache[r.workspace_path].push({
        name: r.name,
        path: r.path,
        version: r.version,
        status: r.status,
        issue: r.issue,
        last_modified: r.last_modified,
        manager_type: r.manager_type,
        template_name: r.template_name
      });
    });
    return cache;
  }

  async saveVenvCache(workspacePath: string, venvs: VenvInfo[]) {
    await this.runWrite((db) => this.transaction(db, async () => {
      const existingRows: any[] = await db.select(
        "SELECT path, template_name FROM venvs WHERE workspace_path = ?",
        [workspacePath]
      );
      const existingTemplateNames = new Map<string, string | null>(
        existingRows.map((row) => [row.path, row.template_name])
      );
      await db.execute("DELETE FROM venvs WHERE workspace_path = ?", [workspacePath]);
      for (const v of venvs) {
        const templateName = v.template_name ?? existingTemplateNames.get(v.path) ?? null;
        await db.execute(
          "INSERT OR REPLACE INTO venvs (workspace_path, name, path, version, status, issue, last_modified, manager_type, template_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [workspacePath, v.name, v.path, v.version, v.status, v.issue || null, v.last_modified, v.manager_type, templateName]
        );
      }
    }));
  }

  async updateSingleVenv(path: string, updated: VenvInfo) {
    await this.runWrite((db) =>
      db.execute(
        "UPDATE venvs SET version = ?, status = ?, issue = ?, last_modified = ?, manager_type = ?, template_name = COALESCE(?, template_name) WHERE path = ?",
        [updated.version, updated.status, updated.issue || null, updated.last_modified, updated.manager_type, updated.template_name || null, path]
      )
    );
  }

  // --- Scripts ---
  async getScripts(venvPath: string): Promise<Script[]> {
    return this.runRead((db) => db.select("SELECT * FROM scripts WHERE venv_path = ?", [venvPath]));
  }

  async addScript(venvPath: string, name: string, command: string) {
    await this.runWrite((db) =>
      db.execute("INSERT INTO scripts (venv_path, name, command) VALUES (?, ?, ?)", [venvPath, name, command])
    );
  }

  async deleteScript(id: number, venvPath: string) {
    await this.runWrite((db) =>
      db.execute("DELETE FROM scripts WHERE id = ? AND venv_path = ?", [id, venvPath])
    );
  }

  // --- Custom Templates ---
  async getCustomTemplates(): Promise<Template[]> {
    const rows: any[] = await this.runRead((db) => db.select("SELECT * FROM custom_templates"));
    return rows.map(r => ({
        id: `custom_${r.id}`,
        name: r.name,
        pkgs: JSON.parse(r.packages)
    }));
  }

  async saveCustomTemplate(name: string, packages: string[]) {
    await this.runWrite((db) =>
      db.execute("INSERT INTO custom_templates (name, packages) VALUES (?, ?)", [name, JSON.stringify(packages)])
    );
  }
}

export const dbService = new DatabaseService();
