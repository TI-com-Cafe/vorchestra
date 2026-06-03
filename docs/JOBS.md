# Background Jobs

VOrchestra uses backend jobs for long-running work so the desktop UI remains responsive.

## Current Contract

1. Frontend invokes a `start_*_job` command.
2. Backend returns a `jobId` immediately.
3. Frontend calls `waitForBackgroundJob(jobId, onUpdate)`.
4. Backend updates snapshots with status, progress, message, logs, result, and error.
5. Frontend may call `cancel_background_job` for cancellable jobs.

## Job Statuses

- `running`: job is active.
- `cancelling`: cancellation was requested.
- `cancelled`: job observed cancellation and stopped.
- `success`: job finished with a result.
- `error`: job failed with an error message.

## Future Improvement

Replace polling with Tauri `emit`/`listen` events. Keep `get_background_job` as a compatibility fallback so slow or missed events can recover state.
