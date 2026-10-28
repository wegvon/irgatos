//! Whether a project's development environment is running.
//!
//! Restored terminal tabs are new shells: whatever ran in them before the
//! restart is gone. The project's `dev` command (worktree settings) says what
//! "the development environment" is, so the app can check for it and offer to
//! start it, instead of replaying old terminal commands.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::fs::{expand_home, path_to_js};
use crate::worktree_lifecycle::{assigned_port, dev_command, port_in_use};

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevEnvironmentStatus {
    /// The configured command; absent when the project has none.
    pub command: Option<String>,
    /// The checkout the command runs in.
    pub root: Option<String>,
    pub running: bool,
    /// A process running the command inside the checkout.
    pub pid: Option<u32>,
    /// The linked worktree's port, when something is serving on it.
    pub port: Option<u16>,
}

/// The program and arguments that identify the command in a process list:
/// the last step of a `a && b` chain, without leading `VAR=value` settings.
pub(crate) fn command_signature(command: &str) -> Vec<String> {
    let last = command
        .split("&&")
        .flat_map(|part| part.split("||"))
        .flat_map(|part| part.split(';'))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .last()
        .unwrap_or("");
    last.split_whitespace()
        .map(|token| token.trim_matches(|c| c == '"' || c == '\''))
        .skip_while(|token| {
            token
                .split_once('=')
                .is_some_and(|(name, _)| !name.is_empty() && !name.contains('/'))
        })
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .collect()
}

fn program_name(token: &str) -> &str {
    token.rsplit('/').next().unwrap_or(token)
}

/// `node /opt/homebrew/bin/pnpm dev` runs `pnpm dev`; so does `pnpm dev --open`.
pub(crate) fn command_line_runs(signature: &[String], command_line: &str) -> bool {
    let Some((program, args)) = signature.split_first() else {
        return false;
    };
    let tokens: Vec<&str> = command_line.split_whitespace().collect();
    (0..tokens.len()).any(|start| {
        program_name(tokens[start]) == program_name(program)
            && tokens.len() > start + args.len()
            && tokens[start + 1..=start + args.len()]
                .iter()
                .zip(args)
                .all(|(token, arg)| *token == arg)
    })
}

/// `pid command…` for every process, from `ps`.
fn process_list() -> Vec<(u32, String)> {
    let Ok(output) = Command::new("ps").args(["-axo", "pid=,command="]).output() else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, command) = line.split_once(char::is_whitespace)?;
            Some((pid.parse().ok()?, command.trim().to_owned()))
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn process_cwd(pid: u32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/cwd")).ok()
}

#[cfg(not(target_os = "linux"))]
fn process_cwd(pid: u32) -> Option<PathBuf> {
    let output = Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n').map(PathBuf::from))
}

fn running_in(root: &Path, command: &str) -> Option<u32> {
    let signature = command_signature(command);
    let own = std::process::id();
    process_list()
        .into_iter()
        .filter(|(pid, line)| *pid != own && command_line_runs(&signature, line))
        .find_map(|(pid, _)| {
            let cwd = process_cwd(pid)?;
            let cwd = cwd.canonicalize().unwrap_or(cwd);
            cwd.starts_with(root).then_some(pid)
        })
}

#[tauri::command(async)]
pub fn dev_environment_status(cwd: String) -> DevEnvironmentStatus {
    let path = expand_home(&cwd);
    let Some((root, command)) = dev_command(&path) else {
        return DevEnvironmentStatus::default();
    };
    let pid = running_in(&root, &command);
    let port = assigned_port(&root).filter(|port| port_in_use(*port));
    DevEnvironmentStatus {
        running: pid.is_some() || port.is_some(),
        root: Some(path_to_js(&root)),
        command: Some(command),
        pid,
        port,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signature(command: &str) -> Vec<String> {
        command_signature(command)
    }

    #[test]
    fn signature_is_the_last_step_without_env_settings() {
        assert_eq!(signature("npm run dev"), ["npm", "run", "dev"]);
        assert_eq!(
            signature("cp .env.example .env && PORT=4100 pnpm dev"),
            ["pnpm", "dev"]
        );
        assert_eq!(signature("cd app; 'yarn' start"), ["yarn", "start"]);
        assert!(signature("  ").is_empty());
    }

    #[test]
    fn finds_the_command_in_a_process_command_line() {
        let dev = signature("pnpm dev");
        assert!(command_line_runs(&dev, "node /opt/homebrew/bin/pnpm dev"));
        assert!(command_line_runs(&dev, "pnpm dev --open"));
        assert!(!command_line_runs(&dev, "pnpm install"));
        assert!(!command_line_runs(&dev, "pnpm"));
        assert!(!command_line_runs(&dev, "vim pnpm-dev.md"));

        let npm = signature("npm run tauri dev");
        assert!(command_line_runs(&npm, "npm run tauri dev"));
        assert!(!command_line_runs(&npm, "npm run tauri build"));
        assert!(!command_line_runs(&[], "npm run dev"));
    }

    #[test]
    fn a_project_without_a_dev_command_reports_nothing() {
        let dir = std::env::temp_dir().join(format!("irgatos-dev-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(
            dev_environment_status(path_to_js(&dir)),
            DevEnvironmentStatus::default()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
