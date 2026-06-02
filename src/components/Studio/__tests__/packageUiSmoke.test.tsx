import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PackageStatsCards } from "../PackageStatsCards";
import { JobActionBanner } from "../JobActionBanner";
import { PackageCatalogLoading } from "../PackageCatalogLoading";
import { PackageList } from "../PackageList";
import { filterGraphDataForQuery, layoutDependencyGraph } from "../StudioDependencyGraph";

describe("Studio package UI smoke tests", () => {
  it("renders package stats and opens add package action", async () => {
    const onAddPackage = vi.fn();
    render(
      <PackageStatsCards
        sizeMb={12.34}
        packageCount={7}
        loadingEnvSize={false}
        onAddPackage={onAddPackage}
      />
    );

    expect(screen.getByText("12.3 MB")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /add package/i }));
    expect(onAddPackage).toHaveBeenCalledOnce();
  });

  it("shows unknown disk allocation when packages exist but size scan has no data", () => {
    render(
      <PackageStatsCards
        sizeMb={0}
        packageCount={3}
        loadingEnvSize={false}
        onAddPackage={vi.fn()}
      />
    );

    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText(/Size scan did not return data/i)).toBeInTheDocument();
  });

  it("renders cancellable job banner", async () => {
    const onCancel = vi.fn();
    render(<JobActionBanner label="Updating django" logs={["[stdout] downloading django", "[stderr] warning"]} tone="amber" onCancel={onCancel} />);

    expect(screen.getByText(/updating django/i)).toBeInTheDocument();
    expect(screen.getByText(/\[stdout\] downloading django/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders catalog loading cancel affordance", async () => {
    const onCancel = vi.fn();
    render(<PackageCatalogLoading onCancel={onCancel} />);

    expect(screen.getByText(/cataloging environment/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("filters and sorts installed packages", async () => {
    render(
      <PackageList
        packages={["fastapi==0.115.0", "django==5.0.0", "pytest==8.0.0", "local-lib==0.1.0"]}
        packageSizes={{ fastapi: 12, django: 55, pytest: 8 }}
        packageActionActive={false}
        insightActionActive={false}
        onPreviewUpgrade={vi.fn()}
        onWhyInstalled={vi.fn()}
        onUpdate={vi.fn()}
        onUninstall={vi.fn()}
      />
    );

    expect(screen.getByText("4/4 shown")).toBeInTheDocument();
    expect(screen.getByText(/75.0 MB visible/)).toBeInTheDocument();
    expect(screen.getByText(/1 unknown/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/search installed packages/i), "py");
    expect(screen.getByText("1/4 shown")).toBeInTheDocument();
    expect(screen.getByText("pytest")).toBeInTheDocument();
    expect(screen.queryByText("django")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByPlaceholderText(/search installed packages/i));
    await userEvent.selectOptions(screen.getByLabelText(/sort packages/i), "size_desc");
    const packageNames = screen.getAllByText(/^(django|fastapi|pytest)$/).map(node => node.textContent);
    expect(packageNames).toEqual(["django", "fastapi", "pytest"]);

    await userEvent.click(screen.getByRole("button", { name: /missing size data/i }));
    expect(screen.getByText("1/4 shown")).toBeInTheDocument();
    expect(screen.getByText("local-lib")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/filter packages/i), "all");
    await userEvent.selectOptions(screen.getByLabelText(/filter packages/i), "large");
    expect(screen.getByText("1/4 shown")).toBeInTheDocument();
    expect(screen.getByText("django")).toBeInTheDocument();
    expect(screen.queryByText("fastapi")).not.toBeInTheDocument();
  });

  it("progressively renders very large package lists", async () => {
    const packages = Array.from({ length: 220 }, (_, index) => `pkg-${String(index + 1).padStart(3, "0")}==1.0.0`);
    render(
      <PackageList
        packages={packages}
        packageSizes={{}}
        packageActionActive={false}
        insightActionActive={false}
        onPreviewUpgrade={vi.fn()}
        onWhyInstalled={vi.fn()}
        onUpdate={vi.fn()}
        onUninstall={vi.fn()}
      />
    );

    expect(screen.getByText("220/220 shown")).toBeInTheDocument();
    expect(screen.getByText("180 rendered")).toBeInTheDocument();
    expect(screen.getByText("pkg-001")).toBeInTheDocument();
    expect(screen.queryByText("pkg-220")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /render 40 more packages/i }));
    expect(screen.getByText("pkg-220")).toBeInTheDocument();
  });

  it("filters dependency graph data while preserving matched ancestry", () => {
    const graph = [
      {
        package_name: "fastapi",
        installed_version: "0.115.0",
        dependencies: [
          { package_name: "starlette", installed_version: "0.40.0", dependencies: [] },
          {
            package_name: "pydantic",
            installed_version: "2.10.0",
            dependencies: [{ package_name: "typing-extensions", installed_version: "4.12.0", dependencies: [] }]
          }
        ]
      },
      { package_name: "pytest", installed_version: "8.0.0", dependencies: [] }
    ];

    const filtered = filterGraphDataForQuery(graph, "typing");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].package_name).toBe("fastapi");
    expect(filtered[0].dependencies).toHaveLength(1);
    expect(filtered[0].dependencies[0].package_name).toBe("pydantic");
    expect(filtered[0].dependencies[0].dependencies[0].package_name).toBe("typing-extensions");
  });

  it("lays out dependency graph leaves without horizontal overlap", () => {
    const graph = [
      {
        package_name: "fastapi",
        installed_version: "0.115.0",
        dependencies: [
          { package_name: "starlette", installed_version: "0.40.0", dependencies: [] },
          { package_name: "pydantic", installed_version: "2.10.0", dependencies: [] }
        ]
      },
      {
        package_name: "pytest",
        installed_version: "8.0.0",
        dependencies: [
          { package_name: "pluggy", installed_version: "1.5.0", dependencies: [] },
          { package_name: "iniconfig", installed_version: "2.0.0", dependencies: [] }
        ]
      }
    ];

    const layout = layoutDependencyGraph(graph, 1);
    const levelOneXs = layout.nodes
      .filter((node) => node.level === 1)
      .map((node) => node.x)
      .sort((a, b) => a - b);

    expect(layout.truncated).toBe(false);
    expect(levelOneXs).toHaveLength(4);
    for (let i = 1; i < levelOneXs.length; i += 1) {
      expect(levelOneXs[i] - levelOneXs[i - 1]).toBeGreaterThanOrEqual(180);
    }
  });
});
