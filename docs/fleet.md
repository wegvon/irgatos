# Fleet

**Fleet** in the sidebar lists every open session and Irgat chat across all your projects, sorted by what needs you:

| Section | What lands there |
| --- | --- |
| **Needs you** | Agents waiting for a tool approval or an answer to a question. The exact command or path is shown, with **Allow** and **Deny** buttons, and questions can be answered in place. Oldest requests come first. |
| **Ready to review** | Turns that finished with file edits or saved artifacts, while you have not looked at them yet or for two hours after they finished. Each row shows how many files changed. |
| **Running** | Agents still working, with the tool they are running now. |
| **Idle** | Everything else. Folded by default. |

The amber number on the Fleet button counts the sessions in **Needs you**, so you can see from any project that an agent is blocked. Click a row to jump to its session; an orchestration worker opens inside its lead's panel. Worktree sessions show their branch and a `worktree` tag.

The filter box matches session titles, project names, branches, commands and question text.

The "needs you" view follows the attention view of [wmux](https://github.com/openwong2kim/wmux) (MIT).

Return to the [README](../README.md) for a quick start.
