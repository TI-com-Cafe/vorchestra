import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface BackgroundJobSnapshot<T = unknown> {
  job_id?: string;
  status: "running" | "cancelling" | "cancelled" | "success" | "error" | string;
  result?: T | null;
  error?: string | null;
  message?: string | null;
  progress?: number | null;
  logs?: string[];
}

function finishFromSnapshot<T>(snapshot: BackgroundJobSnapshot<T>): { done: true; value?: T; error?: Error } | { done: false } {
  if (snapshot.status === "success") {
    if (snapshot.result == null) {
      return { done: true, error: new Error("Background job finished without a result.") };
    }
    return { done: true, value: snapshot.result };
  }

  if (snapshot.status === "cancelled") {
    return { done: true, error: new Error("Operation cancelled.") };
  }

  if (snapshot.status === "error") {
    return { done: true, error: new Error(snapshot.error || "Background job failed.") };
  }

  return { done: false };
}

export async function waitForBackgroundJob<T>(
  jobId: string,
  onUpdate?: (snapshot: BackgroundJobSnapshot<T>) => void,
  pollMs = 8000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | null = null;
    let fallbackTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const clearFallbackTimer = () => {
      if (fallbackTimer !== null) globalThis.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    };

    const cleanup = () => {
      settled = true;
      clearFallbackTimer();
      unlisten?.();
      unlisten = null;
    };

    const readSnapshot = async () => {
      if (settled) return;
      try {
        const snapshot = await invoke<BackgroundJobSnapshot<T>>("get_background_job", { jobId });
        consume(snapshot);
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      scheduleFallbackRead();
    };

    const scheduleFallbackRead = () => {
      if (settled) return;
      clearFallbackTimer();
      fallbackTimer = globalThis.setTimeout(readSnapshot, pollMs);
    };

    const consume = (snapshot: BackgroundJobSnapshot<T>, source: "event" | "snapshot" = "snapshot") => {
      if (settled) return;
      onUpdate?.(snapshot);
      const outcome = finishFromSnapshot(snapshot);
      if (!outcome.done) {
        if (source === "event") scheduleFallbackRead();
        return;
      }
      cleanup();
      if (outcome.error) {
        reject(outcome.error);
      } else {
        resolve(outcome.value as T);
      }
    };

    // Events are the primary update path. We read one initial snapshot after
    // subscribing, then poll only as an idle fallback if no event arrives.
    listen<BackgroundJobSnapshot<T>>("background-job-update", (event) => {
      if (event.payload.job_id === jobId) {
        consume(event.payload, "event");
      }
    })
      .then((unsubscribe) => {
        if (settled) {
          unsubscribe();
        } else {
          unlisten = unsubscribe;
          void readSnapshot();
        }
      })
      .catch(() => {
        // Compatibility fallback when events are unavailable.
        void readSnapshot();
      });
  });
}
