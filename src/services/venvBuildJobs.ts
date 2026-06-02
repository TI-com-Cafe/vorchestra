import { invoke } from "@tauri-apps/api/core";
import { BackgroundJobSnapshot, waitForBackgroundJob } from "./backgroundJobs";

export interface TemplateVenvBuildInput {
  path: string;
  name: string;
  pythonBin: string;
  engine: "pip" | "uv";
  packages: string[];
}

export interface VenvSetupResult {
  venv_path: string;
  installed: string[];
}

export async function buildVenvFromTemplate(
  input: TemplateVenvBuildInput,
  onUpdate?: (snapshot: BackgroundJobSnapshot<VenvSetupResult>) => void,
  onJobStart?: (jobId: string) => void
): Promise<VenvSetupResult> {
  const jobId = await invoke<string>("start_create_venv_with_template_job", {
    path: input.path,
    name: input.name,
    pythonBin: input.pythonBin,
    engine: input.engine,
    packages: input.packages
  });
  onJobStart?.(jobId);

  return waitForBackgroundJob<VenvSetupResult>(jobId, onUpdate);
}
