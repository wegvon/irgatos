# Changelog

All notable changes to Irgatos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Irgatos restarts version numbering at 0.1.0. The history of the MonoCode
releases it grew out of (0.1.0 through 0.13.0) is archived in
[docs/monocode-changelog.md](docs/monocode-changelog.md).

## [Unreleased]

### Added

- **Artifacts.** A new Artifacts tab sits beside Sessions, Explorer and Changes, with a count badge, and in every Irgat's overview. It gathers what the agents made: files written or edited by tool calls, HTML pages, SVG graphics, Mermaid diagrams, Markdown documents and plans, long or named code, JSON and SQL blocks, images and attachments (page-annotation screenshots included), plus anything you pin or create yourself.
  - The list narrows by session (this session or all of the project's sessions), by kind (Files, Previews, Docs, Code, Media) and by search, and is fully keyboard driven.
  - The viewer opens as a workspace tab with Preview and Source. HTML and SVG render in a sandboxed frame, Markdown is rendered, images zoom and fit, and written files are read live from disk with Open and Explorer buttons.
  - Copy, Add to Chat (the active chat or any open one), Save as Note (once, however fast the clicks), Save to File… and Pin work from every artifact.
  - Code blocks, diagrams and file-writing tool calls in a conversation have an Open in Artifacts button.

## [0.1.0] - 2026-10-14

### Added

- **Irgatos identity.** The app is named Irgatos, ships as `com.irgatos.desktop` with its own icon, and carries settings, sessions and Irgats over from the MonoCode-era app data on first launch.
- **One-click commit and push** from the source control panel, with progress that survives React StrictMode.
- **Dictation and voice mode in the Irgat chat box**, sharing one implementation with the session composer.
- **Attach folders** from the Irgat chat box and the session composer's plus menu, or by dropping them on the floating chat. The agent gets the folder's path and a summary of its top level, leaving out version control, dependency, build and gitignored entries.
- **The in-app browser beside an Irgat.** The browser panel stays open next to a full-view Irgat, and page annotations, screenshots, notes and Add to Chat go to the Irgat's chat instead of a hidden session.
- **Kanban boards that fill themselves.** Every project session gets a card in the column for its state and moves when that state changes. Sessions waiting on an approval or an AskUserQuestion answer move to Review with a badge, the board opens on the sidebar's project, and a strip lists other projects with active sessions. Cards you delete or unlink stay off until the session needs you again.
- **Version at a glance.** The running version appears beside Settings in the sidebar, in the Settings header, and under Settings › General › About together with the commit it was built from. `npm run version:bump -- <x.y.z|patch|minor|major>` updates every version file at once, and `npm run version:check` verifies they agree.
- **Check for Updates that works.** The macOS app menu, Settings and the sidebar share one Software Update window that shows the installed and available versions and walks through Checking, Up to date or Update available, Downloading, Installing and Relaunching.
  - **GitHub Releases:** Irgatos checks the latest release on `wegvon/irgatos` (falling back to `wegvon/monocode`, a configured repository or the checkout's `origin`), compares versions and commits, downloads the macOS `.app.tar.gz` or `.dmg` for your architecture, removes the quarantine flag, replaces `/Applications/Irgatos.app` (asking for an administrator password only when needed) and relaunches.
  - **Source checkout:** when Irgatos runs from a git checkout, newer commits on its branch are offered as **Rebuild & Relaunch**, which fast-forwards the checkout, rebuilds the app and installs it.
- The Release workflow runs for `v*` tags or by hand and publishes the macOS archives and disk images the updater consumes. Apple signing, notarization and Tauri updater signatures are used when their secrets exist; without them the workflow publishes ad-hoc signed builds.

### Fixed

- The macOS bundle uses the Irgatos `.icns` icon.
- Handing a session off to Claude Code, Codex or OpenCode through a MemoryProxy relay no longer stops on its Chinese "关联资产" (link team assets) question. Irgatos answers it with "don't link" automatically and shows any remaining prompt in English.

[Unreleased]: https://github.com/wegvon/irgatos/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/wegvon/irgatos/releases/tag/v0.1.0
