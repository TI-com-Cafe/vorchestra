import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpCircle, FileQuestion, Info, Search, SlidersHorizontal, Trash2 } from "lucide-react";

interface PackageListProps {
  packages: string[];
  packageSizes: Record<string, number>;
  packageActionActive: boolean;
  insightActionActive: boolean;
  readOnly?: boolean;
  onPreviewUpgrade: (name: string) => void;
  onWhyInstalled: (name: string) => void;
  onUpdate: (name: string) => void;
  onUninstall: (name: string) => void;
}

type PackageSort = "name" | "size_desc" | "size_asc";
type PackageFilter = "all" | "large" | "known_size" | "unknown_size";

const LARGE_PACKAGE_MB = 25;
const INITIAL_RENDER_LIMIT = 180;
const RENDER_INCREMENT = 180;

export const PackageList: React.FC<PackageListProps> = ({
  packages,
  packageSizes,
  packageActionActive,
  insightActionActive,
  readOnly = false,
  onPreviewUpgrade,
  onWhyInstalled,
  onUpdate,
  onUninstall
}) => {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PackageSort>("name");
  const [filter, setFilter] = useState<PackageFilter>("all");
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);

  const visiblePackages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return packages
      .map((pkg, i) => {
        const [name, version] = pkg.split("==");
        return {
          id: `${name}-${i}`,
          name,
          version: version || "stable",
          size: packageSizes[name.toLowerCase()]
        };
      })
      .filter(pkg => !normalizedQuery || pkg.name.toLowerCase().includes(normalizedQuery))
      .filter(pkg => {
        if (filter === "large") return (pkg.size ?? 0) >= LARGE_PACKAGE_MB;
        if (filter === "known_size") return pkg.size !== undefined;
        if (filter === "unknown_size") return pkg.size === undefined;
        return true;
      })
      .sort((a, b) => {
        if (sort === "size_desc") return (b.size ?? -1) - (a.size ?? -1) || a.name.localeCompare(b.name);
        if (sort === "size_asc") return (a.size ?? Number.MAX_SAFE_INTEGER) - (b.size ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });
  }, [filter, packageSizes, packages, query, sort]);

  useEffect(() => {
    setRenderLimit(INITIAL_RENDER_LIMIT);
  }, [filter, packages, query, sort]);

  const renderedPackages = useMemo(
    () => visiblePackages.slice(0, renderLimit),
    [renderLimit, visiblePackages]
  );

  const packageSummary = useMemo(() => {
    const knownSizes = visiblePackages
      .map(pkg => pkg.size)
      .filter((size): size is number => size !== undefined);
    const visibleSizeMb = knownSizes.reduce((total, size) => total + size, 0);
    const unknownCount = visiblePackages.length - knownSizes.length;

    return {
      visibleSizeMb,
      unknownCount,
      totalUnknownCount: packages.filter(pkg => {
        const [name] = pkg.split("==");
        return packageSizes[name.toLowerCase()] === undefined;
      }).length,
      largeCount: packages.filter(pkg => {
        const [name] = pkg.split("==");
        return (packageSizes[name.toLowerCase()] ?? 0) >= LARGE_PACKAGE_MB;
      }).length
    };
  }, [packageSizes, packages, visiblePackages]);

  return (
    <div className="space-y-4">
      <div className="vo-surface flex flex-col md:flex-row md:items-center gap-3 rounded-[1.5rem] border p-3">
        <label className="vo-control flex flex-1 items-center gap-2 rounded-xl border px-3 py-2">
          <Search size={14} className="text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search installed packages..."
            className="w-full bg-transparent outline-none text-xs font-bold text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
          />
        </label>
        <label className="vo-control flex items-center gap-2 rounded-xl border px-3 py-2">
          <SlidersHorizontal size={14} className="text-slate-400" />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as PackageSort)}
            className="bg-transparent outline-none text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300"
            aria-label="Sort packages"
          >
            <option value="name">Name</option>
            <option value="size_desc">Largest first</option>
            <option value="size_asc">Smallest first</option>
          </select>
        </label>
        <label className="vo-control flex items-center gap-2 rounded-xl border px-3 py-2">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as PackageFilter)}
            className="bg-transparent outline-none text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300"
            aria-label="Filter packages"
          >
            <option value="all">All packages</option>
            <option value="large">Large only</option>
            <option value="known_size">Size known</option>
            <option value="unknown_size">Size unknown</option>
          </select>
        </label>
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 md:min-w-40 md:text-right leading-relaxed">
          <div>{visiblePackages.length}/{packages.length} shown</div>
          {visiblePackages.length > renderedPackages.length && (
            <div>{renderedPackages.length} rendered</div>
          )}
          <div>
            {packageSummary.visibleSizeMb.toFixed(1)} MB visible
            {packageSummary.unknownCount > 0 ? `, ${packageSummary.unknownCount} unknown` : ""}
          </div>
        </div>
      </div>

      {packageSummary.largeCount > 0 && filter !== "large" && (
        <button
          onClick={() => {
            setFilter("large");
            setSort("size_desc");
          }}
          className="w-full rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/30 transition-colors"
        >
          {packageSummary.largeCount} large package{packageSummary.largeCount === 1 ? "" : "s"} detected. Show cleanup candidates.
        </button>
      )}

      {packageSummary.totalUnknownCount > 0 && filter !== "unknown_size" && (
        <button
          onClick={() => {
            setFilter("unknown_size");
            setSort("name");
          }}
          className="w-full rounded-2xl border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/20 px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/30 transition-colors"
        >
          {packageSummary.totalUnknownCount} package{packageSummary.totalUnknownCount === 1 ? "" : "s"} missing size data. Show unknown-size packages.
        </button>
      )}

      {visiblePackages.length === 0 ? (
        <div className="vo-panel rounded-[2rem] border border-dashed py-12 text-center">
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">No packages match this filter</p>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-2.5">
          {renderedPackages.map((pkg) => {
            const { name, version, size } = pkg;

            return (
              <div key={pkg.id} className="vo-surface flex justify-between items-center gap-3 p-3 border rounded-2xl transition-all hover:border-blue-500/40 group">
                <div className="flex min-w-0 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-black text-slate-800 dark:text-slate-200">{name}</span>
                    {size !== undefined && <span className="shrink-0 text-[9px] font-black bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500">{size.toFixed(1)} MB</span>}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{version}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => onPreviewUpgrade(name)} disabled={insightActionActive || readOnly} className="vo-icon-button text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-40" title={readOnly ? "Preview upgrade is unavailable for read-only managers" : "Preview upgrade (dry-run)"}>
                    <FileQuestion size={16} />
                  </button>
                  <button onClick={() => onWhyInstalled(name)} disabled={insightActionActive} className="vo-icon-button text-slate-400 hover:text-amber-600 transition-colors disabled:opacity-40" title="Why is this installed?">
                    <Info size={16} />
                  </button>
                  <button onClick={() => onUpdate(name)} disabled={packageActionActive || readOnly} className="vo-icon-button text-slate-400 hover:text-green-600 transition-colors disabled:opacity-40" title={readOnly ? "Use the native manager to upgrade packages" : "Upgrade"}>
                    <ArrowUpCircle size={16} />
                  </button>
                  <button onClick={() => onUninstall(name)} disabled={packageActionActive || readOnly} className="vo-icon-button text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40" title={readOnly ? "Use the native manager to uninstall packages" : "Uninstall"}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {visiblePackages.length > renderedPackages.length && (
          <button
            onClick={() => setRenderLimit(prev => prev + RENDER_INCREMENT)}
            className="vo-secondary-action w-full rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-widest"
          >
            Render {Math.min(RENDER_INCREMENT, visiblePackages.length - renderedPackages.length)} more package{Math.min(RENDER_INCREMENT, visiblePackages.length - renderedPackages.length) === 1 ? "" : "s"}
            {" "}({visiblePackages.length - renderedPackages.length} remaining)
          </button>
        )}
        </>
      )}
    </div>
  );
};
