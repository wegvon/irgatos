# Changelog

All notable changes to Irgatos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Semantic code search for agents.** Point **Settings › Providers › Semantic search** at an EmbeddingGemma server, save its key and index a project. Indexing runs in the background and only re-embeds changed files. Agents then run `app code.search` to find code by meaning and by name: results from the index are merged with `git grep` on the query's identifiers. It is read-only, works in any agent turn without `/operator`, and falls back to grep alone while a project is unindexed or still indexing.

- **Mail.** A new Mail page in the sidebar shows Gmail through your [Executor](https://executor.sh): paste its URL and an API key on the page, and Irgatos never holds a Google credential. Every Gmail account connected in Executor shows up: one newest-first list across all of them, or one account at a time. Read threads, archive them, and write or edit replies. **Start chat** opens an agent chat about a thread in the project you pick; that chat's agent can run `app mail.read` and `app mail.draft` to read the thread and save a reply as its Gmail draft, but it cannot send. A reply goes out only when you press **Send** and confirm.

### Changed

- **Voice mode reads a short summary.** Instead of the whole reply, voice mode now says in a sentence or three what the agent did, what it changed and any question it asks you, in the selected speech model's voice. With a Live voice (Gemini) key the summary comes from Gemini Flash-Lite in the reply's own language. Without one, or when that call fails, it reads the reply's opening paragraph, its questions, its `Next:` lines and a closing offer, and leaves code, tables and file lists on screen. Turn off **Settings › Voice › Read a short summary** to hear the whole reply again.

### Fixed

- Voice mode in an Irgat chat no longer turns itself off while a message is sending, so the Irgat's reply is read aloud again.
- Chats in the sidebar show whether each one is working (spinner), waiting on you (amber dot) or has a new reply, and can be renamed, pinned, added to the board or deleted from right-click or the row's **…** menu.
- Deleting a session always asks first, from the Delete key, the context menu, a one-session tab or **Settings › Archive**, like chats and Irgats do. Removing an Irgat habit and deleting a note ask first too.
- Irgat chats in the sidebar show the same working, waiting and new-reply states and can be renamed from their menu.
- Session cards on an Irgat's overview rename, archive and delete like the sidebar's, and show **Done** and **Interrupted**.
- **Fleet** lists sessions that stopped mid-turn under their own **Interrupted** group instead of hiding them in Idle, and its rows offer open, stop, add to board, archive and delete.
- Right-clicking an Irgat on the compact rail opens its menu, as on the full rail.
- The project picker shows when an Irgat is working or waiting, its unread replies, and which projects have an agent at work.
- The floating Irgat chat reads the reply aloud even when a message is queued, and offers **Retry** for a message that was not delivered.
- A failed reading no longer stays on screen after voice mode is turned off or the next reply is read.
- Group chats handle `/i-have-adhd` and "stop adhd mode" themselves and give each turn the ADHD rules while the mode is on. A restored draft that @mentions a member sends on Enter, and voice mode stops while a terminal has focus.
- The Irgat composer keeps the caret while a message sends.
- The composer's ADHD chip matches the size of the quota and model name beside it, and the Pi refresh button matches the other refresh buttons.
- **Settings › Voice** shows a speech preview error and a transcription key error each in its own row, and Settings search finds **Menu bar icon**.

### Removed

- **All chats** from the sidebar's Chats section; the chats are listed right there.
- The next step beside the ADHD switch. The status bar shows only the switch, and **Settings › ADHD mode › Next step in status bar** is gone.

## [0.5.3] - 2026-10-15

### Added

- Choose Drama, EMA Lightning or Kahya TTS in Voice settings. The saved choice applies to previews and spoken replies.
- Collapse each Irgat's child chats and delete an individual child chat with confirmation while keeping the Irgat's identity, memory and other chats.

### Changed

- Chats appear directly below Projects in the sidebar.

### Fixed

- Irgats can list and read their own primary and child chats without requesting project access. Other projects still require approval.
- Project access requests remain visible in chat until the user allows or denies them, including after an assistant reply, a failed turn or an app restart.

## [0.5.2] - 2026-10-14

### Changed

- **chore(rebrand): drop remaining /mono alias and mc/ worktree prefixes.** New worktree branches are created as `irgat/<id>` (orchestration workers as `irgat/orch-<id>`), and the remote host accepts only `irgat/` names for automatically created branches. Existing `mc/` branches stay as they are, but are now treated like any other branch: rename them with git, and delete old `mc/orch-` branches by hand.
- **HTML artifacts are served from `irgatartifact://`.** Nothing to do: artifact links are built when they are shown.

### Removed

- **The `/mono` command alias.** Use `/operator` (or `/irgat`).

### Fixed

- **The remote host no longer rewrites the git index while reading.** Status and diff reads ran with optional locks, so they could refresh `.git/index` behind your back and collide with your own git commands.

## [0.5.1] - 2026-10-14

### Changed

- **chore(rebrand): scrub remaining references to the former name.** Irgatos is the only name left in the app, its settings keys, its folders, its docs and its tests.
- **Updates come only from `wegvon/irgatos`** (or a configured repository, or the checkout's `origin`). The fallback to the former repository is gone.

### Removed

- **One-time import of pre-Irgatos app data.** The app no longer looks for data folders, the database file, browser settings or host data left by the app it grew out of. Nothing on disk is deleted; data already carried over by an earlier version stays where it is.
- **Old command and tag aliases** that existed only under the former name. `/irgat` and `/operator` still work.

## [0.5.0] - 2026-10-14

### Added

- **Chat.** Ask about anything, with no project and no Irgat. A new **Chat** entry under Inbox in the menu (and on the compact rail) opens a list of your chats beside the open conversation. It works even when no project is open.
  - Chats run in a private scratch folder (`~/.irgatos/scratch`, or the system temp folder when the home folder can't be used). There is no git, no worktree, and the folder never shows up in recent projects.
  - A chat is a full session: streaming, approvals, questions, stop and resume, usage limits, the model and harness picker, attachments, the microphone and the ADHD switch all work as in a project chat. The branch and worktree controls are hidden.
  - **New chat** (`⌘⇧H` / `Ctrl+Shift+H`) starts one and reuses an empty chat rather than piling them up. `⌘⇧N` stays **New Window**.
  - Chats are titled automatically and can be renamed, pinned and deleted (with a confirmation). They persist across restarts, and the chat that was open comes back where you left it.
  - The list shows which chats are running, which need you, and which have a reply you haven't read. The menu badge counts chats that need you first, then unread replies.
- **Chats on the Board.** Chats get cards on their own **Chats** board, which a new **Chats** button on the Board header switches to. Cards move between In progress, Review and Done as the chat works, waits on you or finishes, and show a **Chat** badge.
  - **Add to Board** in the chat header and the row menu files a chat, or shows its card once it has one. Starting a card from the Chats board opens a new chat with the card's text ready to send.
  - Clicking a card's chat opens it in the Chat view. When a chat or session is waiting on a tool permission, **Allow** and **Deny** sit right on its card and in the card's dialog.
  - The "Other projects" strip names the Chats board when chats are working or waiting on you.
- **Fleet lists chats** under a **Chat** label, with their approvals and questions answered from Fleet as for any session.

### Changed

- **Artifacts moved into the menu.** It is no longer a tab in the project sidebar header (now Sessions, Explorer and Changes). It sits in the menu right under Board and Fleet, with the same live count, and opens the same Artifacts panel for the current project. Links that open an artifact still land on the panel, and the Irgat Overview keeps its own Artifacts tab.

## [0.4.0] - 2026-10-14

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
- **Redline batch review.** Collect review notes while you read and send them to the agent as one turn, following the guided review flow of [hermes-redline](https://github.com/silentpr0/hermes-redline) (MIT).
  - **Add to Review** sits beside **Add to chat** on editor selections, diff line comments, transcript replies and plans, Artifacts and Irgat documents, Markdown previews and plan tabs. Each note is a change, a question or a comment and keeps the quoted lines it is about.
  - The review tray above the composer lists the open notes to inspect, edit, delete, resolve or reopen. **Submit Review** sends them as one numbered turn, or inserts them into the draft.
  - The title bar badge shows how many notes are open for the project or Irgat in front and opens the tray. Notes are kept per project or Irgat in the app, never as files in the working tree.
- **Coding agents in plain terminals.** A terminal tab or dock running Claude Code, Codex, Cursor Agent, Gemini CLI, OpenCode, GitHub Copilot CLI, Amp, Qwen Code or any other of the 24 agents in the catalog now shows which agent it is and whether it is working, waiting for you, idle or done, read from the screen the agent draws. The patterns are adapted from [herdr](https://github.com/herdrdev/herdr) (Apache-2.0).
  - A badge on the terminal's tab names the agent and its state, pulsing while it works and amber while it waits for you.
  - The Kanban board lists running terminal agents above the columns, and a click opens their terminal.
  - Notifications say when a terminal agent needs you or has finished in the background, and open the terminal when clicked.
- **Messages wait for a busy session.** A session message sent to a session that is waiting on a tool approval or a question is held as **Blocked** instead of being typed into the prompt. It goes out on its own once the session is free; the pill can open that session to approve or answer, or send the message anyway.
  - A message the target has not picked up, or stopped making progress on, is marked **Stalled** and can be sent again.
- **Group chats show who is stuck.** The room's status bar says when the member replying waits on an approval or a question (answer it right in the room) or has stalled, with **Answer** or **Review** to jump there, and **Retry** or **Skip** for a stalled turn.
- **Inbox snooze and triage.** Snooze any Inbox item for an hour, until later today, tomorrow morning, next week or a custom time. Snoozes survive restarts and the item comes back with a **Back in your Inbox** toast and a badge when the time is up.
  - Triage pills **All**, **Needs action**, **Agent activity**, **Drafts** and **Snoozed**, each with a live count, and the last pill is remembered.
  - Replies you start on an Inbox item are kept as drafts per item until sent.
- **Completion Gate.** A validator that runs after each agent turn: `npx tsc --noEmit`, `npm test`, `cargo check` or your own command, switched on per project (**Settings > Worktrees**) or per session (the bar above the composer).
  - Exit 0, or a run that times out, marks the turn **Verified ✓**. A failing check sends its output back to the agent as a follow-up so it fixes its own errors, up to 3 times per message you send, with **Stop retries**.
  - The command runs in its own process group with `CI=1` and `IRGATOS_CHECK=1` and is stopped on timeout or cancel.
- **Habit guards and triggers.** On a habit's page:
  - **Ask before each run** puts the run in Fleet's **Needs you** and on the habit's card with **Approve** and **Skip**. An approval nobody answers lapses after 12 hours.
  - **Only run if** a command passes (exit 0, 60 second limit) or an expression is true, such as `now.weekday != 0 && trigger.json.branch == "main"`. A false condition skips the run without starting an agent and records why.
  - **Wait before running** delays a due or triggered run by up to a day.
  - **Trigger** gives the habit a secret local URL (`curl -X POST http://127.0.0.1:47615/habits/<token>`) that only this computer can reach, so scripts and CI can start it. The request body reaches the run as quoted data and as `trigger.payload` / `trigger.json`.
  - Irgats can set the same guards through `app habits.add` / `habits.update`, but only you can turn approval off.

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

- **Irgatos identity.** The app is named Irgatos, ships as `com.irgatos.desktop` with its own icon.
- **One-click commit and push** from the source control panel, with progress that survives React StrictMode.
- **Dictation and voice mode in the Irgat chat box**, sharing one implementation with the session composer.
- **Attach folders** from the Irgat chat box and the session composer's plus menu, or by dropping them on the floating chat. The agent gets the folder's path and a summary of its top level, leaving out version control, dependency, build and gitignored entries.
- **The in-app browser beside an Irgat.** The browser panel stays open next to a full-view Irgat, and page annotations, screenshots, notes and Add to Chat go to the Irgat's chat instead of a hidden session.
- **Kanban boards that fill themselves.** Every project session gets a card in the column for its state and moves when that state changes. Sessions waiting on an approval or an AskUserQuestion answer move to Review with a badge, the board opens on the sidebar's project, and a strip lists other projects with active sessions. Cards you delete or unlink stay off until the session needs you again.
- **Version at a glance.** The running version appears beside Settings in the sidebar, in the Settings header, and under Settings › General › About together with the commit it was built from. `npm run version:bump -- <x.y.z|patch|minor|major>` updates every version file at once, and `npm run version:check` verifies they agree.
- **Check for Updates that works.** The macOS app menu, Settings and the sidebar share one Software Update window that shows the installed and available versions and walks through Checking, Up to date or Update available, Downloading, Installing and Relaunching.
  - **GitHub Releases:** Irgatos checks the latest release on `wegvon/irgatos` (or a configured repository, or the checkout's `origin`), compares versions and commits, downloads the macOS `.app.tar.gz` or `.dmg` for your architecture, removes the quarantine flag, replaces `/Applications/Irgatos.app` (asking for an administrator password only when needed) and relaunches.
  - **Source checkout:** when Irgatos runs from a git checkout, newer commits on its branch are offered as **Rebuild & Relaunch**, which fast-forwards the checkout, rebuilds the app and installs it.
- The Release workflow runs for `v*` tags or by hand and publishes the macOS archives and disk images the updater consumes. Apple signing, notarization and Tauri updater signatures are used when their secrets exist; without them the workflow publishes ad-hoc signed builds.

### Fixed

- The macOS bundle uses the Irgatos `.icns` icon.
- Handing a session off to Claude Code, Codex or OpenCode through a MemoryProxy relay no longer stops on its Chinese "关联资产" (link team assets) question. Irgatos answers it with "don't link" automatically and shows any remaining prompt in English.

[Unreleased]: https://github.com/wegvon/irgatos/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/wegvon/irgatos/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/wegvon/irgatos/releases/tag/v0.1.0
