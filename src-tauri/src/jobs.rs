//! Background job infrastructure for long-running Tauri commands
//! (full diagnostics, security audit). Tracks status, results, and
//! cancellation per job-id. The backend emits job snapshots through Tauri
//! events and keeps `get_background_job` as a fallback for missed events.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

#[derive(Clone)]
pub struct BackgroundJobHandle {
    pub id: String,
    pub cancel: Arc<AtomicBool>,
    pub snapshot: Arc<Mutex<JobSnapshot>>,
    app: Option<tauri::AppHandle>,
}

#[derive(Clone)]
pub struct JobSnapshot {
    pub status: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub message: Option<String>,
    pub progress: Option<f64>,
    pub logs: Vec<String>,
    pub finished_at_ms: Option<u64>,
}

impl JobSnapshot {
    pub fn running() -> Self {
        Self {
            status: "running".to_string(),
            result: None,
            error: None,
            message: None,
            progress: Some(0.0),
            logs: Vec::new(),
            finished_at_ms: None,
        }
    }
}

#[derive(Default)]
pub struct AppState {
    pub jobs: Mutex<HashMap<String, BackgroundJobHandle>>,
    pub job_seq: AtomicU64,
    pub app: Mutex<Option<tauri::AppHandle>>,
}

pub fn attach_app_handle(state: &tauri::State<'_, AppState>, app: tauri::AppHandle) {
    if let Ok(mut target) = state.app.lock() {
        *target = Some(app);
    }
}

pub fn create_background_job(
    state: &tauri::State<'_, AppState>,
) -> Result<(String, BackgroundJobHandle), String> {
    cleanup_finished_jobs(state, 10 * 60 * 1000)?;
    let job_id = format!("job-{}", state.job_seq.fetch_add(1, Ordering::Relaxed) + 1);
    let app = state.app.lock().ok().and_then(|app| app.clone());
    let handle = BackgroundJobHandle {
        id: job_id.clone(),
        cancel: Arc::new(AtomicBool::new(false)),
        snapshot: Arc::new(Mutex::new(JobSnapshot::running())),
        app,
    };
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|_| "Failed to lock job store".to_string())?;
    jobs.insert(job_id.clone(), handle.clone());
    emit_job_update(&handle);
    Ok((job_id, handle))
}

pub fn set_job_status(
    handle: &BackgroundJobHandle,
    status: &str,
    result: Option<serde_json::Value>,
    error: Option<String>,
) {
    if let Ok(mut snapshot) = handle.snapshot.lock() {
        snapshot.status = status.to_string();
        snapshot.result = result;
        snapshot.error = error;
        if status == "success" {
            snapshot.progress = Some(1.0);
        }
        snapshot.finished_at_ms = match status {
            "success" | "error" | "cancelled" => Some(now_ms()),
            _ => None,
        };
    }
    emit_job_update(handle);
}

pub fn set_job_progress(
    handle: &BackgroundJobHandle,
    message: impl Into<String>,
    progress: Option<f64>,
) {
    let message = message.into();
    if let Ok(mut snapshot) = handle.snapshot.lock() {
        snapshot.message = Some(message.clone());
        if let Some(progress) = progress {
            snapshot.progress = Some(progress.clamp(0.0, 1.0));
        }
        snapshot.logs.push(message);
        if snapshot.logs.len() > 200 {
            let overflow = snapshot.logs.len() - 200;
            snapshot.logs.drain(0..overflow);
        }
    }
    emit_job_update(handle);
}

pub fn append_job_log(handle: &BackgroundJobHandle, stream: &str, line: impl AsRef<str>) {
    let line = line.as_ref().trim();
    if line.is_empty() {
        return;
    }
    if let Ok(mut snapshot) = handle.snapshot.lock() {
        snapshot.logs.push(format!("[{}] {}", stream, line));
        if snapshot.logs.len() > 200 {
            let overflow = snapshot.logs.len() - 200;
            snapshot.logs.drain(0..overflow);
        }
    }
    emit_job_update(handle);
}

pub fn snapshot_json(handle: &BackgroundJobHandle) -> Result<serde_json::Value, String> {
    let snapshot = handle
        .snapshot
        .lock()
        .map_err(|_| "Failed to lock job snapshot".to_string())?;
    Ok(serde_json::json!({
        "job_id": handle.id,
        "status": snapshot.status.clone(),
        "result": snapshot.result.clone(),
        "error": snapshot.error.clone(),
        "message": snapshot.message.clone(),
        "progress": snapshot.progress,
        "logs": snapshot.logs.clone(),
    }))
}

fn emit_job_update(handle: &BackgroundJobHandle) {
    let Some(app) = &handle.app else {
        return;
    };
    if let Ok(payload) = snapshot_json(handle) {
        let _ = app.emit("background-job-update", payload);
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn cleanup_finished_jobs(
    state: &tauri::State<'_, AppState>,
    keep_ms: u64,
) -> Result<(), String> {
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|_| "Failed to lock job store".to_string())?;
    let cutoff = now_ms().saturating_sub(keep_ms);
    let mut to_remove = Vec::new();
    for (job_id, handle) in jobs.iter() {
        if let Ok(snapshot) = handle.snapshot.lock() {
            if let Some(done_at) = snapshot.finished_at_ms {
                if done_at <= cutoff {
                    to_remove.push(job_id.clone());
                }
            }
        }
    }
    for job_id in to_remove {
        jobs.remove(&job_id);
    }
    Ok(())
}
