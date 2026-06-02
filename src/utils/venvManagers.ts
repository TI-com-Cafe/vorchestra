import { VenvInfo } from "../types";

export const READ_ONLY_MANAGERS = new Set<VenvInfo["manager_type"]>(["conda"]);

export function isReadOnlyManager(manager: VenvInfo["manager_type"]): boolean {
  return READ_ONLY_MANAGERS.has(manager);
}

export function readOnlyManagerLabel(manager: VenvInfo["manager_type"]): string {
  if (manager === "conda") return "Conda";
  if (manager === "pixi") return "Pixi";
  return manager;
}
