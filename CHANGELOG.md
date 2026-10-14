# Changelog

All notable changes to Irgatos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Irgatos restarts version numbering at 0.1.0. The history of the MonoCode
releases it grew out of (0.1.0 through 0.13.0) is archived in
[docs/monocode-changelog.md](docs/monocode-changelog.md).

## [Unreleased]

### Added

- **ADHD mode.** Built in from [i-have-adhd](https://github.com/ayghri/i-have-adhd) by Ayoub Ghriss (MIT). When it is on, every session and Irgat chat gets the upstream ruleset with its next message: lead with the next action, number multi-step work, end with one concrete next step, suppress tangents, restate state every turn, give estimates in minutes, make wins visible, state errors plainly, cap lists at five and drop the preamble, recaps and closers.
  - Turn it on from the **ADHD** switch in the status bar or under a Irgat's composer, or in **Settings › ADHD mode**. The choice survives restarts. Each conversation receives the rules once, again when its provider conversation is replaced, and a one-line notice when the mode is turned off.
  - `/i-have-adhd` (or `/adhd`) toggles the mode for one chat, `/i-have-adhd on` and `off` set it, and sending just "stop adhd mode" or "normal mode" turns it off there. Irgatos handles these itself, so they never reach the agent.
  - Beside the switch, the status bar keeps the step a working agent is on ("Step 2 of 5: …") or the `Next:` line its last reply ended with, and shows a finished task list as "5 of 5 done".
- **Live voice (Gemini).** Talk with an Irgat or a session's agent in real time, both ways at once, through the Gemini Multimodal Live API. Press the **Live** button in the composer; a floating pill shows Listening, Thinking, Speaking or Delegating task…, with **Mute** and **End live**.
  - The call opens with the Irgat's SOUL.md, MEMORY.md and the recent conversation, plus the ADHD rules when ADHD mode is on. Talking over the agent stops it at once, from the microphone or from Gemini's own voice detection.
  - Gemini can hand real work to the chat's agent (`delegate_to_irgat_session`) and tells you the result when it finishes. It can also save a note (`save_irgat_note`) and, for Irgats, remember a fact (`update_irgat_memory`).
  - What both sides said is added to the chat, and the next typed message carries it to the agent.
  - **Settings › Voice › Live voice (Gemini)** stores the API key, or picks up `GEMINI_API_KEY` / `GOOGLE_API_KEY` from your shell. It also sets the voice (Puck, Charon, Kore, Fenrir, Aoede), the model, interrupt-on-speech and whether calls are saved to the chat.
### Added

- **Coding agents in plain terminals.** A terminal tab or dock running Claude Code, Codex, Cursor Agent, Gemini CLI, OpenCode, GitHub Copilot CLI, Amp, Qwen Code or any other of the 24 agents in the catalog now shows which agent it is and whether it is working, waiting for you, idle or done, read from the screen the agent draws. The patterns are adapted from [herdr](https://github.com/herdrdev/herdr) (Apache-2.0).
  - A badge on the terminal's tab names the agent and its state, pulsing while it works and amber while it waits for you.
  - The Kanban board lists running terminal agents above the columns, and a click opens their terminal.
  - Notifications say when a terminal agent needs you or has finished in the background, and open the terminal when clicked.
- **Messages wait for a busy session.** A session message sent to a session that is waiting on a tool approval or a question is held as **Blocked** instead of being typed into the prompt. It goes out on its own once the session is free; the pill can open that session to approve or answer, or send the message anyway.
  - A message the target has not picked up, or stopped making progress on, is marked **Stalled** and can be sent again.
- **Group chats show who is stuck.** The room's status bar says when the member replying waits on an approval or a question (answer it right in the room) or has stalled, with **Answer** or **Review** to jump there, and **Retry** or **Skip** for a stalled turn.

### Fixed

- A running turn is saved every few seconds, so a crash or power loss mid-reply keeps what had already streamed in. Streams of changes no longer hold saves back.
- State files (Irgat index, checkpoints, turn reviews, remote machines) are written to a temporary file and renamed into place. A file that no longer parses is kept as `<name>.corrupt-<time>.bak` and its last good copy restored instead of starting empty.
- The session database keeps three rolling copies, taken at most every ten minutes while sessions are saved. A database that no longer opens is set aside and the newest good copy takes its place.
- A malformed Irgat roster, group room list or room transcript in local storage is kept aside instead of being overwritten by the next save, and the roster and rooms fall back to their last good copy.

## [0.3.0] - 2026-10-14

### Added

- **Quota auto-hold.** When a provider reports a usage limit, Irgatos reads its reset time (epoch, JSON, ISO, relative or wall-clock with zone) and puts that harness and account on hold, with a fallback window under **Plan limits** when no time is given.
  - Queued prompts, habit runs and scheduled automations wait with a **Paused until quota reset** label instead of failing or being skipped as missed, and pick up on their own when the hold ends. **Run anyway** overrides a hold.
  - Session and Irgat composers show a countdown banner with **Resume now**.
- **Session resume.** Sessions cut off by an agent exit, crash, dropped connection or app restart show an **Interrupted** banner with **Resume session** and a sidebar badge. Resume continues the provider thread where it can, or re-sends the unanswered prompt with a transcript recap when the thread is gone.
- **Worktree ports and setup.** Each linked worktree gets its own port from the project's range (default 4100–4199), avoiding sibling worktrees and busy ports. Agents, terminals and setup see it as `PORT` and `IRGATOS_PORT`, with `IRGATOS_WORKTREE` and `IRGATOS_MAIN_WORKTREE`.
  - A setup command from `.irgatos/worktree.json`, or this clone's override in **Settings > Worktrees**, runs in the background after a worktree is created. The composer shows its progress and output with a rerun action, plus a port badge that opens the dev server in the browser panel.
- **Fleet.** One view of every open session and Irgat chat across projects, sorted into **Needs you** (approvals with the exact command and agent questions, answerable inline), **Ready to review**, **Running** and **Idle**. The sidebar and both rails get a Fleet button with a live count of sessions waiting on you.
- **Lightpanda headless browser.** A **Lightpanda Headless Browser** card in MCP settings (and on the Irgats page) for a fast, low-memory headless browser agents can drive.
  - It finds `lightpanda` on `PATH`, Homebrew, `/usr/local/bin` or `~/.irgatos/bin`, or installs the official release binary into `~/.irgatos/bin` in one click. Lightpanda is AGPL-3.0, so Irgatos never bundles it and only runs it as a separate process, always with `LIGHTPANDA_DISABLE_TELEMETRY=true`.
  - One click adds `lightpanda mcp` to Claude Code, Codex, Cursor or OpenCode for all projects.
  - An optional background `lightpanda serve` on `127.0.0.1` gives agent sessions started while it runs, Irgats and Habits included, its CDP address in `IRGATOS_LIGHTPANDA_CDP_URL` and `LIGHTPANDA_CDP_URL`. It can start with Irgatos.

## [0.2.0] - 2026-10-14

### Added

- **Artifacts.** A new Artifacts tab sits beside Sessions, Explorer and Changes, with a count badge, and in every Irgat's overview. It gathers what the agents made: files written or edited by tool calls, HTML pages, SVG graphics, Mermaid diagrams, Markdown documents and plans, long or named code, JSON and SQL blocks, images and attachments (page-annotation screenshots included), plus anything you pin or create yourself.
  - The list narrows by session (this session or all of the project's sessions), by kind (Files, Previews, Docs, Code, Media) and by search, and is fully keyboard driven.
  - The viewer opens as a workspace tab with Preview and Source. HTML and SVG render in a sandboxed frame, Markdown is rendered, images zoom and fit, and written files are read live from disk with Open and Explorer buttons.
  - Copy, Add to Chat (the active chat or any open one), Save as Note (once, however fast the clicks), Save to File… and Pin work from every artifact.
  - Code blocks, diagrams and file-writing tool calls in a conversation have an Open in Artifacts button.
- **Irgat group chats.** Bring Irgats with different specialities into one room from the group button beside `+` in the Irgat rail. Pick two or more Irgats, set an optional name, and they reply in turn, each with its own soul, memory, harness and model, seeing the room's roster and what the others already said.
  - `@Name` sends a message only to the members it mentions. Otherwise the members toggled on in the reply bar answer in order, either everyone ("All in order") or only those you pick.
  - A reply that mentions another member hands it one follow-up turn when Follow-ups is on, or offers a "Let @Name reply" chip when it is off.
  - The room streams the live reply with Stop, approvals and an "Up next" line, shows failed turns with Retry, and keeps the Irgat composer's dictation, voice mode, attachments and an `@` member picker.
- **Add a saved note to an open chat.** Add to chat on a note lists the open chats (the Irgat in full view or the focused pane first, then the other panes and tabs) with a New chat entry last, and adds the note without touching what is typed.
- **Direct messages between sessions.** **Send to session…** on any message, or on selected reply text, lists the sessions open in tabs and panes, siblings in the same project first, with their agent, model and status. Pick **Queue in composer** to drop the text into that session's draft, or **Send & run** to start a turn there headed `[Message from session "<sender>"]`. A broadcast row reaches every sibling at once, and **Bring the reply back here** returns the answer as a new turn.
  - Each message is tracked from Queued to Delivered to Replied, with timestamps. Pills under the sending reply and under the receiving turn show the state, and clicking one opens the other session at the linked message. Messages still on their way show above the receiver's composer.
  - **Cooperative mode** (a switch in the same dialog) tells agents which sibling sessions exist. An agent can then hand off work with `@send:"<session>" <message>` or ask a question with `@ask:"<session>" <question>` on its own line, and the answer to an `@ask` comes back to it. Chains stop after four hops, and failed directives show why on the sender's pill.

### Fixed

- Saving a note, or opening a new page in an Irgat's overview, files it once however fast the clicks come.

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

[Unreleased]: https://github.com/wegvon/irgatos/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/wegvon/irgatos/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/wegvon/irgatos/releases/tag/v0.1.0
