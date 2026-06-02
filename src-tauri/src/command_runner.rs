//! Minimal command runner abstraction for deterministic backend tests.
//!
//! This intentionally wraps only command-builder outputs first. Broadly
//! abstracting every process call would add indirection without immediate
//! product value.

use crate::package_managers::PackageCommand;
use crate::process_utils::{run_command_with_timeout, run_command_with_timeout_and_cancel};
use std::sync::atomic::AtomicBool;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl CommandOutput {
    pub fn success(stdout: impl Into<Vec<u8>>) -> Self {
        Self {
            success: true,
            stdout: stdout.into(),
            stderr: Vec::new(),
        }
    }

    pub fn failure(stderr: impl Into<Vec<u8>>) -> Self {
        Self {
            success: false,
            stdout: Vec::new(),
            stderr: stderr.into(),
        }
    }

    pub fn combined_text(&self) -> String {
        format!(
            "{}{}",
            String::from_utf8_lossy(&self.stderr),
            String::from_utf8_lossy(&self.stdout)
        )
    }
}

pub trait CommandRunner {
    fn run_package_command(
        &self,
        command: &PackageCommand,
        timeout_secs: u64,
        cancel: Option<&AtomicBool>,
    ) -> Result<CommandOutput, String>;
}

#[derive(Default)]
pub struct RealCommandRunner;

impl CommandRunner for RealCommandRunner {
    fn run_package_command(
        &self,
        command: &PackageCommand,
        timeout_secs: u64,
        cancel: Option<&AtomicBool>,
    ) -> Result<CommandOutput, String> {
        let mut cmd = command.to_command();
        let out = match cancel {
            Some(cancel) => run_command_with_timeout_and_cancel(&mut cmd, timeout_secs, cancel)?,
            None => run_command_with_timeout(&mut cmd, timeout_secs)?,
        };
        Ok(CommandOutput {
            success: out.status.success(),
            stdout: out.stdout,
            stderr: out.stderr,
        })
    }
}

#[cfg(test)]
pub mod tests_support {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    pub struct FakeCommandRunner {
        pub calls: RefCell<Vec<PackageCommand>>,
        responses: RefCell<Vec<Result<CommandOutput, String>>>,
    }

    impl FakeCommandRunner {
        pub fn new(responses: Vec<Result<CommandOutput, String>>) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                responses: RefCell::new(responses),
            }
        }
    }

    impl CommandRunner for FakeCommandRunner {
        fn run_package_command(
            &self,
            command: &PackageCommand,
            _timeout_secs: u64,
            _cancel: Option<&AtomicBool>,
        ) -> Result<CommandOutput, String> {
            self.calls.borrow_mut().push(command.clone());
            let mut responses = self.responses.borrow_mut();
            if responses.is_empty() {
                return Err("fake command runner has no response queued".to_string());
            }
            responses.remove(0)
        }
    }
}
