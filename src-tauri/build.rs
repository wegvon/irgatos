fn main() {
    // generate_context! embeds icons; cargo ignores them unless we watch here.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=macos/Assets.car");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let config =
        std::fs::read_to_string("tauri.conf.json").expect("read src-tauri/tauri.conf.json");
    let config = serde_json::from_str::<serde_json::Value>(&config)
        .expect("parse src-tauri/tauri.conf.json");
    let product_name = config
        .get("productName")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .expect("tauri.conf.json must define a non-empty productName");
    println!("cargo:rustc-env=TAURI_PRODUCT_NAME={product_name}");
    stamp_git_build();
    // GNU ld exports every symbol from the Tauri cdylib and blows past the
    // 65535 PE ordinal limit. Hide them; the desktop exe links the rlib.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
    {
        println!("cargo::rustc-link-arg-cdylib=-Wl,--exclude-libs=ALL,--exclude-all-symbols");
    }
    tauri_build::build()
}

/// Bakes the commit and branch into the binary so "Check for Updates" can
/// tell a rebuilt checkout apart from the running build. CI may pin both via
/// `IRGATOS_BUILD_COMMIT` / `IRGATOS_BUILD_BRANCH` (e.g. a detached tag build).
fn stamp_git_build() {
    println!("cargo:rerun-if-env-changed=IRGATOS_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=IRGATOS_BUILD_BRANCH");
    let git = |args: &[&str]| -> Option<String> {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir("..")
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8(output.stdout).ok()?.trim().to_string();
        (!text.is_empty()).then_some(text)
    };
    let commit = std::env::var("IRGATOS_BUILD_COMMIT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| git(&["rev-parse", "HEAD"]));
    let branch = std::env::var("IRGATOS_BUILD_BRANCH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| git(&["rev-parse", "--abbrev-ref", "HEAD"]))
        .filter(|branch| branch != "HEAD");
    if let Some(commit) = commit {
        println!("cargo:rustc-env=IRGATOS_BUILD_COMMIT={commit}");
    }
    if let Some(branch) = &branch {
        println!("cargo:rustc-env=IRGATOS_BUILD_BRANCH={branch}");
    }
    // A new commit on the same branch only touches the branch ref, not HEAD.
    for path in ["HEAD", "packed-refs"]
        .into_iter()
        .map(str::to_string)
        .chain(branch.map(|branch| format!("refs/heads/{branch}")))
    {
        // Cargo treats a missing path as always dirty, which would rebuild the
        // crate on every invocation.
        if let Some(resolved) = git(&["rev-parse", "--path-format=absolute", "--git-path", &path])
            .filter(|resolved| std::path::Path::new(resolved).exists())
        {
            println!("cargo:rerun-if-changed={resolved}");
        }
    }
}
