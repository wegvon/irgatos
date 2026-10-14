# Worktree ports and setup

Every linked Git worktree that Irgatos runs an agent or terminal in gets its own environment:

| Variable | Value |
| --- | --- |
| `PORT`, `IRGATOS_PORT` | A port reserved for this worktree, from the project's port range (default `4100–4199`). |
| `IRGATOS_WORKTREE` | The worktree folder. |
| `IRGATOS_MAIN_WORKTREE` | The project's main checkout, handy for copying untracked files such as `.env`. |

The main checkout gets none of these, so its existing setup is unchanged.

The composer shows the port as a `:4123` badge next to the branch. Click it to open `http://localhost:4123` in the browser panel, or ⌘/Ctrl-click to open it in your default browser.

## How ports are chosen

The first choice is derived from the worktree's path, so the same worktree lands on the same port across restarts. Irgatos then skips ports held by the project's other worktrees and ports something is already listening on. The choice is saved in the worktree's own Git directory (`.git/worktrees/<name>/irgatos-port`), so Git removes it together with the worktree. A worktree keeps its port while its own dev server is running. Changing the range moves only worktrees whose port falls outside it.

## Setup command

A setup command runs once, in the background, right after Irgatos creates a worktree, with the variables above set. Typical commands:

```sh
pnpm install --offline
cp "$IRGATOS_MAIN_WORKTREE/.env" .env
```

While it runs, the composer shows **Setting up**. If it fails, **Setup failed** opens the last lines of output and a **Run setup again** button. The full log is at `.git/worktrees/<name>/irgatos-setup.log`. A run is stopped after 15 minutes.

Setup runs for worktrees created from the composer, the worktree dialog and `/operator`. Orchestration worker checkouts copy the lead's files instead, so they get a port but no setup run.

## Configuration

Commit `.irgatos/worktree.json` at the project root to share settings with your team:

```json
{
  "portRange": "4100-4199",
  "setup": ["pnpm install --offline", "cp .env.example .env"]
}
```

- `portRange` accepts `"4100-4199"`, `[4100, 4199]` or `{ "start": 4100, "end": 4199 }`.
- `setup` is one command, or a list joined with `&&`.

**Settings › Worktrees › Worktree environment** edits the same two values for your clone only. Those overrides are stored in `.git/irgatos/worktree.json`, so they never appear as a change in the repository. Clearing the setup command there turns a committed one off for your clone.

The port and setup ideas follow the fan-out settings of [wmux](https://github.com/openwong2kim/wmux) (MIT).

Return to the [README](../README.md) for a quick start.
