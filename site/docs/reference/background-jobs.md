# Background jobs

VOrchestra uses backend jobs for long-running work so the desktop UI remains responsive.

## Contract

1. Frontend invokes a `start_*_job` command.
2. Backend returns a `jobId` immediately.
3. Frontend observes the job through `waitForBackgroundJob(jobId, onUpdate)`.
4. Backend updates snapshots with status, progress, message, logs, result and error.
5. Frontend may call `cancel_background_job` for cancellable jobs.

## Statuses

| Status | Meaning |
|---|---|
| `running` | Job is active. |
| `cancelling` | Cancellation was requested. |
| `cancelled` | Job observed cancellation and stopped. |
| `success` | Job completed with a result. |
| `error` | Job failed with an error message. |

## UX rules

- Heavy jobs need visible progress or at least clear running state.
- Cancellable jobs need a visible cancel action.
- The UI must stay responsive while diagnostics, scans and package operations run.
- Polling can remain as a fallback, but Tauri events should be the primary path where available.
