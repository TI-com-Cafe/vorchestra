import { describe, expect, it } from "vitest";
import { assessEnvironmentHealth } from "../envHealth";
import { VenvInfo } from "../../types";

const baseVenv: VenvInfo = {
  name: "api",
  path: "/workspace/api/.venv",
  version: "Python 3.12.4",
  status: "Healthy",
  issue: undefined,
  last_modified: 1,
  manager_type: "uv"
};

describe("assessEnvironmentHealth", () => {
  it("keeps healthy uv environments at a perfect score", () => {
    expect(assessEnvironmentHealth(baseVenv)).toEqual({
      score: 100,
      label: "Healthy",
      tone: "green",
      signals: [],
      primaryAction: "open_studio"
    });
  });

  it("marks externally changed environments as sync candidates", () => {
    const health = assessEnvironmentHealth({ ...baseVenv, is_outdated: true });

    expect(health.score).toBe(80);
    expect(health.label).toBe("Needs Sync");
    expect(health.tone).toBe("amber");
    expect(health.primaryAction).toBe("sync");
    expect(health.signals[0].label).toContain("sync recommended");
  });

  it("distinguishes stale missing folders from repairable broken environments", () => {
    expect(assessEnvironmentHealth({
      ...baseVenv,
      status: "Broken",
      issue: "Path does not exist"
    }).primaryAction).toBe("delete_stale");

    expect(assessEnvironmentHealth({
      ...baseVenv,
      status: "Broken",
      issue: "pyvenv.cfg is malformed"
    }).primaryAction).toBe("repair");
  });

  it("surfaces pip environments as lower priority improvement candidates", () => {
    const health = assessEnvironmentHealth({ ...baseVenv, manager_type: "pip" });

    expect(health.score).toBe(95);
    expect(health.label).toBe("Healthy");
    expect(health.signals).toHaveLength(1);
  });

  it("names missing pip as a specific repair signal", () => {
    const health = assessEnvironmentHealth({
      ...baseVenv,
      status: "Broken",
      issue: "/workspace/api/.venv/bin/python: No module named pip"
    });

    expect(health.label).toBe("Broken");
    expect(health.primaryAction).toBe("repair");
    expect(health.signals[0].label).toContain("pip is missing");
  });

  it("treats missing pip as acceptable for read-only native managers", () => {
    const health = assessEnvironmentHealth({
      ...baseVenv,
      manager_type: "conda",
      status: "Broken",
      issue: "/workspace/api/.venv/bin/python: No module named pip"
    });

    expect(health.score).toBe(100);
    expect(health.label).toBe("Healthy");
    expect(health.primaryAction).toBe("open_studio");
    expect(health.signals.map(signal => signal.label)).toEqual([
      "pip is missing, but native-manager inventory does not require pip",
      "Conda environment detected as read-only inventory",
      "pip-style lockfile restore is disabled; use native lock/sync commands"
    ]);
  });

  it("flags environments with unknown Python runtime metadata", () => {
    const health = assessEnvironmentHealth({
      ...baseVenv,
      version: "Unknown"
    });

    expect(health.score).toBe(90);
    expect(health.label).toBe("Needs Attention");
    expect(health.tone).toBe("amber");
    expect(health.signals[0].label).toContain("runtime version was not detected");
  });
});
