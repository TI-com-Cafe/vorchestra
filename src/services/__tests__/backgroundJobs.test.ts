import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitForBackgroundJob, BackgroundJobSnapshot } from "../backgroundJobs";

const invokeMock = vi.fn();
let listener: ((event: { payload: BackgroundJobSnapshot<string> }) => void) | null = null;
const unsubscribeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, cb: (event: { payload: BackgroundJobSnapshot<string> }) => void) => {
    listener = cb;
    return Promise.resolve(unsubscribeMock);
  })
}));

describe("waitForBackgroundJob", () => {
  beforeEach(() => {
    vi.useRealTimers();
    invokeMock.mockReset();
    unsubscribeMock.mockReset();
    listener = null;
  });

  it("resolves from Tauri job events and unsubscribes", async () => {
    invokeMock.mockResolvedValue({ job_id: "job-1", status: "running", result: null });
    const onUpdate = vi.fn();
    const promise = waitForBackgroundJob<string>("job-1", onUpdate, 10_000);

    await vi.waitFor(() => expect(listener).toBeTruthy());
    listener?.({ payload: { job_id: "job-1", status: "success", result: "done" } });

    await expect(promise).resolves.toBe("done");
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "success", result: "done" }));
    expect(unsubscribeMock).toHaveBeenCalledOnce();
  });

  it("ignores events for other jobs", async () => {
    invokeMock.mockResolvedValue({ job_id: "job-1", status: "running", result: null });
    const promise = waitForBackgroundJob<string>("job-1", undefined, 10_000);

    await vi.waitFor(() => expect(listener).toBeTruthy());
    listener?.({ payload: { job_id: "job-2", status: "success", result: "wrong" } });
    listener?.({ payload: { job_id: "job-1", status: "success", result: "right" } });

    await expect(promise).resolves.toBe("right");
  });

  it("rejects failed jobs with backend error text", async () => {
    invokeMock.mockResolvedValue({ job_id: "job-1", status: "running", result: null });
    const promise = waitForBackgroundJob<string>("job-1", undefined, 10_000);

    await vi.waitFor(() => expect(listener).toBeTruthy());
    listener?.({ payload: { job_id: "job-1", status: "error", error: "boom" } });

    await expect(promise).rejects.toThrow("boom");
  });

  it("uses polling only as an idle fallback between events", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue({ job_id: "job-1", status: "running", result: null });
    const promise = waitForBackgroundJob<string>("job-1", undefined, 1000);

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    listener?.({ payload: { job_id: "job-1", status: "running", result: null, message: "Halfway" } });
    await vi.advanceTimersByTimeAsync(999);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));

    listener?.({ payload: { job_id: "job-1", status: "success", result: "done" } });
    await expect(promise).resolves.toBe("done");
    expect(unsubscribeMock).toHaveBeenCalledOnce();
  });
});
