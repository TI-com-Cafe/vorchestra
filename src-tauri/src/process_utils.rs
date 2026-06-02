//! Platform-aware process helpers shared across backend modules.

use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
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

pub fn run_command_with_timeout_cancel_and_output<F>(
    command: &mut Command,
    timeout_secs: u64,
    cancel: &AtomicBool,
    mut on_output_line: F,
) -> Result<Output, String>
where
    F: FnMut(&str, &str),
{
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture command stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture command stderr".to_string())?;
    let (tx, rx) = mpsc::channel::<StreamChunk>();
    let stdout_thread = spawn_stream_reader(stdout, StreamKind::Stdout, tx.clone());
    let stderr_thread = spawn_stream_reader(stderr, StreamKind::Stderr, tx);
    let started = Instant::now();
    let deadline = Duration::from_secs(timeout_secs);
    let mut stdout_bytes = Vec::new();
    let mut stderr_bytes = Vec::new();

    loop {
        drain_stream_chunks(
            &rx,
            &mut stdout_bytes,
            &mut stderr_bytes,
            &mut on_output_line,
        );

        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            return Err("Cancelled by user".to_string());
        }

        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                drain_stream_chunks(
                    &rx,
                    &mut stdout_bytes,
                    &mut stderr_bytes,
                    &mut on_output_line,
                );
                return Ok(Output {
                    status,
                    stdout: stdout_bytes,
                    stderr: stderr_bytes,
                });
            }
            None if started.elapsed() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
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

#[derive(Clone, Copy)]
enum StreamKind {
    Stdout,
    Stderr,
}

struct StreamChunk {
    kind: StreamKind,
    bytes: Vec<u8>,
}

fn spawn_stream_reader<R: Read + Send + 'static>(
    reader: R,
    kind: StreamKind,
    tx: mpsc::Sender<StreamChunk>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        loop {
            let mut bytes = Vec::new();
            match reader.read_until(b'\n', &mut bytes) {
                Ok(0) => break,
                Ok(_) => {
                    let _ = tx.send(StreamChunk { kind, bytes });
                }
                Err(_) => break,
            }
        }
    })
}

fn drain_stream_chunks<F>(
    rx: &mpsc::Receiver<StreamChunk>,
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
    on_output_line: &mut F,
) where
    F: FnMut(&str, &str),
{
    while let Ok(chunk) = rx.try_recv() {
        let stream = match chunk.kind {
            StreamKind::Stdout => "stdout",
            StreamKind::Stderr => "stderr",
        };
        match chunk.kind {
            StreamKind::Stdout => stdout.extend_from_slice(&chunk.bytes),
            StreamKind::Stderr => stderr.extend_from_slice(&chunk.bytes),
        }
        let line = String::from_utf8_lossy(&chunk.bytes).trim_end().to_string();
        if !line.is_empty() {
            on_output_line(stream, &line);
        }
    }
}
