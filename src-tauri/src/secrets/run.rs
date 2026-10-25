//! `secrets.run`: runs one program the user allowed, with a vault value in
//! an environment variable of that process only. The agent names the value
//! as `{{secret:NAME}}` in `env`; it never appears in the command line,
//! which other processes can read, and the program's output comes back
//! scrubbed.
//!
//! The program is a bare name looked up on the user's terminal PATH, never a
//! path, so a script the agent writes in its folder cannot stand in for it.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::vault::SecretMeta;

const MAX_ARGS: usize = 64;
const MAX_ARG_CHARS: usize = 4_096;
const MAX_ENV: usize = 8;
pub const MAX_COMMANDS: usize = 12;
const DEFAULT_TIMEOUT: u64 = 30;
const MAX_TIMEOUT: u64 = 35;
const DEFAULT_CHARS: usize = 20_000;
const MAX_CHARS: usize = 100_000;
/// Output read from each stream before the rest is dropped.
const READ_LIMIT: u64 = 1024 * 1024;

/// Variables a program or its shell would run code from, or that decide
/// which program runs; a value never goes in one.
const BLOCKED_VARS: [&str; 26] = [
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "TMPDIR",
    "PWD",
    "IFS",
    "ENV",
    "BASH_ENV",
    "ZDOTDIR",
    "PROMPT_COMMAND",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "PERL5OPT",
    "PERL5LIB",
    "RUBYOPT",
    "RUBYLIB",
    "GIT_SSH_COMMAND",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    "GIT_EXEC_PATH",
    "EDITOR",
    "VISUAL",
    "PAGER",
];
const BLOCKED_PREFIXES: [&str; 3] = ["DYLD_", "LD_", "IRGAT_"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RunInput {
    command: Vec<String>,
    env: HashMap<String, String>,
    #[serde(default)]
    purpose: Option<String>,
    #[serde(default)]
    timeout_seconds: Option<u64>,
    #[serde(default)]
    max_chars: Option<usize>,
}

/// A checked `secrets.run`, before any value is looked up.
pub struct Template {
    pub program: String,
    pub args: Vec<String>,
    /// (variable, secret name), sorted by variable.
    pub env: Vec<(String, String)>,
    pub purpose: Option<String>,
    pub timeout: Duration,
    pub max_chars: usize,
}

fn placeholder() -> Regex {
    Regex::new(r"\{\{\s*secret:").expect("valid regex")
}

/// Shells and interpreters run whatever their arguments say, so handing one
/// a value hands it to any script the agent writes.
const INTERPRETERS: [&str; 22] = [
    "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "env", "xargs", "node", "deno",
    "bun", "python", "python3", "perl", "ruby", "php", "osascript", "lua", "tclsh", "awk",
];

pub fn interpreter(name: &str) -> bool {
    INTERPRETERS.contains(&name)
}

/// A program as the vault lists it: a bare name such as `gh` or `psql`.
pub fn valid_program(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
}

fn valid_var(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_uppercase() || c == '_')
        && name.len() <= 64
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

pub fn template(input: RunInput) -> Result<Template, String> {
    let mut command = input.command.into_iter();
    let program = command
        .next()
        .ok_or("command takes the program and its arguments, as [\"gh\",\"api\",\"user\"]")?;
    if !valid_program(&program) {
        return Err(format!(
            "{program} is not a program name. Give a bare name such as gh; paths are refused"
        ));
    }
    let args: Vec<String> = command.collect();
    if args.len() > MAX_ARGS || args.iter().any(|arg| arg.chars().count() > MAX_ARG_CHARS) {
        return Err(format!(
            "At most {MAX_ARGS} arguments of {MAX_ARG_CHARS} characters"
        ));
    }
    let marker = placeholder();
    if marker.is_match(&program) || args.iter().any(|arg| marker.is_match(arg)) {
        return Err(
            "A secret goes in env only, never in the command line: {\"env\":{\"GH_TOKEN\":\"{{secret:GH_TOKEN}}\"}}"
                .into(),
        );
    }
    if input.env.is_empty() || input.env.len() > MAX_ENV {
        return Err(format!(
            "env names 1-{MAX_ENV} variables, each set to one {{{{secret:NAME}}}}"
        ));
    }
    let whole = Regex::new(r"^\{\{\s*secret:([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}$")
        .expect("valid regex");
    let mut env = Vec::new();
    for (var, value) in input.env {
        if !valid_var(&var) {
            return Err(format!(
                "{var} is not a variable name: capitals, digits and _"
            ));
        }
        if BLOCKED_VARS.contains(&var.as_str())
            || BLOCKED_PREFIXES.iter().any(|prefix| var.starts_with(prefix))
        {
            return Err(format!("{var} cannot carry a secret"));
        }
        let name = whole
            .captures(value.trim())
            .map(|c| c[1].to_string())
            .ok_or_else(|| format!("{var} must be exactly one {{{{secret:NAME}}}}"))?;
        env.push((var, name));
    }
    env.sort();
    Ok(Template {
        program,
        args,
        env,
        purpose: input.purpose.filter(|p| !p.trim().is_empty()),
        timeout: Duration::from_secs(
            input
                .timeout_seconds
                .unwrap_or(DEFAULT_TIMEOUT)
                .clamp(1, MAX_TIMEOUT),
        ),
        max_chars: input
            .max_chars
            .unwrap_or(DEFAULT_CHARS)
            .clamp(200, MAX_CHARS),
    })
}

/// Why this value may not go to this program, if it may not.
pub fn refusal(meta: &SecretMeta, template: &Template, now: i64) -> Option<String> {
    let name = &meta.name;
    if !meta.usable_at(now) {
        return Some(format!("{name} has expired or been used up"));
    }
    if !meta.commands.iter().any(|c| c == &template.program) {
        return Some(if meta.commands.is_empty() {
            format!(
                "{name} is not allowed in commands. The user can name programs for it in Settings > Vault"
            )
        } else {
            format!(
                "{name} may only be given to {}; this runs {}",
                meta.commands.join(", "),
                template.program
            )
        });
    }
    if let Some(purpose) = &meta.purpose {
        if !template
            .purpose
            .as_deref()
            .is_some_and(|p| p.eq_ignore_ascii_case(purpose))
        {
            return Some(format!(
                "{name} may only be used for \"{purpose}\"; pass \"purpose\":\"{purpose}\" when that is what this command does"
            ));
        }
    }
    None
}

pub struct Finished {
    pub code: Option<i32>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Runs the program with only `env` added to the user's terminal
/// environment, no input, and a deadline.
pub fn run(
    program: &Path,
    template: &Template,
    env: &[(String, Zeroizing<String>)],
    cwd: &Path,
) -> Result<Finished, String> {
    let mut command = Command::new(program);
    crate::harness::apply_gui_env(&mut command);
    command
        .args(&template.args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (var, value) in env {
        command.env(var, value.as_str());
    }
    // Its own process group, so a deadline stops what it started too.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", template.program))?;
    let drain = |stream: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(stream) = stream {
                let _ = stream.take(READ_LIMIT).read_to_end(&mut bytes);
            }
            String::from_utf8_lossy(&bytes).into_owned()
        })
    };
    let stdout = drain(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let started = Instant::now();
    let (code, timed_out) = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break (status.code(), false);
        }
        if started.elapsed() >= template.timeout {
            #[cfg(unix)]
            if let Ok(pid) = i32::try_from(child.id()) {
                // SAFETY: signals the group this child leads; no memory involved.
                unsafe {
                    libc::kill(-pid, libc::SIGKILL);
                }
            }
            let _ = child.kill();
            let _ = child.wait();
            break (None, true);
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    Ok(Finished {
        code,
        timed_out,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

fn clip(text: &str, max: usize) -> (String, bool) {
    if text.chars().count() <= max {
        return (text.to_string(), false);
    }
    // The end of a long output usually says how it went.
    let tail: String = text
        .chars()
        .rev()
        .take(max)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    (tail, true)
}

/// What the agent gets back, already scrubbed by the caller.
pub fn report(template: &Template, finished: &Finished) -> Value {
    let (stdout, out_clipped) = clip(&finished.stdout, template.max_chars);
    let (stderr, err_clipped) = clip(&finished.stderr, template.max_chars / 2);
    json!({
        "exitCode": finished.code,
        "timedOut": finished.timed_out,
        "stdout": stdout,
        "stderr": stderr,
        "clipped": out_clipped || err_clipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(value: Value) -> Result<Template, String> {
        template(serde_json::from_value(value).map_err(|e| e.to_string())?)
    }

    #[test]
    fn values_go_in_env_only_and_programs_are_bare_names() {
        let ok = input(json!({"command": ["gh", "api", "user"], "env": {"GH_TOKEN": "{{secret:GH_TOKEN}}"}})).unwrap();
        assert_eq!(ok.program, "gh");
        assert_eq!(ok.env, vec![("GH_TOKEN".into(), "GH_TOKEN".into())]);
        for bad in [
            json!({"command": ["/bin/sh", "-c", "env"], "env": {"A": "{{secret:A}}"}}),
            json!({"command": ["./gh"], "env": {"A": "{{secret:A}}"}}),
            json!({"command": ["gh", "--token={{secret:GH_TOKEN}}"], "env": {"A": "{{secret:A}}"}}),
            json!({"command": ["gh"], "env": {}}),
            json!({"command": ["gh"], "env": {"PATH": "{{secret:A}}"}}),
            json!({"command": ["gh"], "env": {"DYLD_INSERT_LIBRARIES": "{{secret:A}}"}}),
            json!({"command": ["gh"], "env": {"A": "x{{secret:A}}"}}),
            json!({"command": ["gh"], "env": {"lower": "{{secret:A}}"}}),
            json!({"command": [], "env": {"A": "{{secret:A}}"}}),
        ] {
            assert!(input(bad.clone()).is_err(), "{bad}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn runs_with_the_value_in_env_and_stops_at_the_deadline() {
        let dir = tempfile::tempdir().unwrap();
        let t = input(json!({"command": ["sh", "-c", "printf %s \"$TOKEN\" | wc -c; echo oops >&2"],
            "env": {"TOKEN": "{{secret:A}}"}}))
        .unwrap();
        let env = vec![("TOKEN".to_string(), Zeroizing::new("FAKE-12345".to_string()))];
        let done = run(Path::new("/bin/sh"), &t, &env, dir.path()).unwrap();
        assert_eq!(done.code, Some(0));
        assert_eq!(done.stdout.trim(), "10");
        assert_eq!(done.stderr.trim(), "oops");

        let slow = input(json!({"command": ["sh", "-c", "sleep 5"], "env": {"TOKEN": "{{secret:A}}"},
            "timeoutSeconds": 1}))
        .unwrap();
        let started = Instant::now();
        let done = run(Path::new("/bin/sh"), &slow, &env, dir.path()).unwrap();
        assert!(done.timed_out);
        assert!(started.elapsed() < Duration::from_secs(4));
    }
}
