<p align="center">
  <img src="public/irgat.png" alt="Irgatos" width="88" />
</p>

<h1 align="center">Irgatos</h1>

<p align="center">
  <strong>A GUI for your coding agents.</strong>
</p>

<p align="center">
  <img width="1680" height="1050" alt="Irgatos with agent sessions open side by side" src="https://github.com/user-attachments/assets/2cd4a6ec-eb1e-4b45-8627-a76442ea3874" />
</p>

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, Antigravity, Pi, omp, fx, Hermes Agent, and Devin. If they’re installed and logged in, Irgatos can run them. Tabs are sessions. The composer is the input. Irgatos does not sell tokens.

## Install

Install and sign in to at least one supported agent first. See [provider setup](docs/providers.md) for instructions.

| Platform | Download |
| --- | --- |
| macOS, Apple Silicon | [Apple Silicon DMG](https://github.com/wegvon/irgatos/releases/latest) |
| macOS, Intel | [Intel DMG](https://github.com/wegvon/irgatos/releases/latest) |
| Linux, x86_64 | [.deb, .rpm, or AppImage](https://github.com/wegvon/irgatos/releases/latest) |
| Windows, x86_64 | [Installer](https://github.com/wegvon/irgatos/releases/latest) |

On macOS, open the DMG and drag Irgatos to Applications. After that, **Irgatos › Check for Updates…** installs new releases in one click; see [versioning and updates](docs/building.md#versioning-and-updates). On Windows, run the installer. See [Linux setup](docs/install.md) for dependencies and package instructions.

## Get started

Open a project folder, choose an agent, and send a message. Each tab is a session. Split panes to work with sessions side by side.

- Keep conversations organized by project.
- Use separate Git worktrees for parallel tasks, each with its own `PORT` and an optional setup command.
- Edit files and review changes in the app.
- Start a message with `/operator` to let an agent open sessions and manage worktrees and notes.

Irgats are experimental agents that work across your projects. They keep a memory and can run scheduled tasks you set up with them.

Irgatos is still early. If something breaks, [report a bug](https://github.com/wegvon/irgatos/issues).

## Guides

- [Provider setup](docs/providers.md)
- [Linux installation](docs/install.md)
- [Agent access with /operator](docs/agent-access.md)
- [Worktree ports and setup](docs/worktrees.md)
- [Remote sessions, experimental](docs/remote-access.md)

## Build from source

You’ll need Node.js 20+ and a stable Rust toolchain. See [build setup](docs/building.md) for platform dependencies and packaging.

```bash
npm install
npm run tauri dev
```

Small, focused contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Contributors

Thanks to everyone who contributes to Irgatos!

[![Irgatos contributors](https://contrib.rocks/image?repo=wegvon/irgatos)](https://github.com/wegvon/irgatos/graphs/contributors)

Contributor image by [contrib.rocks](https://contrib.rocks).

## License

[MIT](LICENSE). Provider names and logos are trademarks of their owners. See [NOTICE](NOTICE).
