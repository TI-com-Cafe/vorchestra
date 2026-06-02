//! Platform-aware process helpers shared across backend modules.

use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

/// Append the platform's executable suffix ("" on Unix, ".exe" on Windows).
pub fn exe_name(name: &str) -> String {
    format!("{}{}", name, std::env::consts::EXE_SUFFIX)
}

/// Default `python` executable name when the user did not pick one.
pub fn default_python_command() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

/// Build a `Command` that does not allocate a console window on Windows.
pub fn new_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

pub fn run_command_with_timeout(
    command: &mut Command,
    timeout_secs: u64,
) -> Result<Output, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    let deadline = Duration::from_secs(timeout_secs);

    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(_) => return child.wait_with_output().map_err(|e| e.to_string()),
            None if started.elapsed() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Command timed out after {} seconds", timeout_secs));
            }
            None => thread::sleep(Duration::from_millis(120)),
        }
    }
}

pub fn run_command_with_timeout_and_cancel(
    command: &mut Command,
    timeout_secs: u64,
    cancel: &AtomicBool,
) -> Result<Output, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    let deadline = Duration::from_secs(timeout_secs);

    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Cancelled by user".to_string());
        }

        match child.try_wait().map_err(|e| e.to_string())? {
            Some(_) => return child.wait_with_output().map_err(|e| e.to_string()),
            None if started.elapsed() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Command timed out after {} seconds", timeout_secs));
            }
            None => thread::sleep(Duration::from_millis(120)),
        }
    }
}

pub fn stdout_or_stderr(out: &Output) -> String {
    if !out.stdout.is_empty() {
        String::from_utf8_lossy(&out.stdout).to_string()
    } else {
        String::from_utf8_lossy(&out.stderr).to_string()
    }
}
