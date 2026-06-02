import { ThemeMode, StatusFilter, StudioTabId } from "../types";
import { Sun, Moon, Monitor, Package, Play, FileText, ShieldCheck, Lock, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const THEME_OPTIONS: { mode: ThemeMode; icon: LucideIcon }[] = [
  { mode: "light", icon: Sun },
  { mode: "dark", icon: Moon },
  { mode: "system", icon: Monitor },
];

export const STATUS_FILTERS: StatusFilter[] = ["All", "Healthy", "Broken"];

export const STUDIO_TABS: { id: StudioTabId; label: string; icon: LucideIcon }[] = [
  { id: "packages", label: "Packages", icon: Package },
  { id: "automation", label: "Automation", icon: Play },
  { id: "config", label: "Config (.env)", icon: FileText },
  { id: "diagnostics", label: "Diagnostics", icon: ShieldCheck },
  { id: "lock", label: "Lock", icon: Lock },
  { id: "repair", label: "Repair", icon: Wrench },
];
