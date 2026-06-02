import { Dispatch, SetStateAction, useEffect } from "react";
import { ThemeMode } from "../../types";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export function useGlobalSearchShortcut(setIsSearchOpen: StateSetter<boolean>) {
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [setIsSearchOpen]);
}

export function useThemeAndZoom(theme: ThemeMode, zoomLevel: number) {
  useEffect(() => {
    const root = window.document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => root.classList.toggle("dark", theme === "system" ? media.matches : theme === "dark");
    apply();
    if (theme === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [theme]);

  useEffect(() => {
    const root = document.getElementById("root-container");
    if (root) {
      const scale = Math.max(0.5, zoomLevel / 100);
      root.style.transformOrigin = "top left";
      root.style.transform = `scale(${scale})`;
      root.style.width = `${100 / scale}vw`;
      root.style.height = `${100 / scale}vh`;
    }

    return () => {
      const rootEl = document.getElementById("root-container");
      if (!rootEl) return;
      rootEl.style.transform = "";
      rootEl.style.transformOrigin = "";
      rootEl.style.width = "";
      rootEl.style.height = "";
    };
  }, [zoomLevel]);
}
