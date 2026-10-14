# Build from source

Irgatos supports macOS, Linux, and Windows. You need Node.js 20+ and a current stable Rust toolchain. Install and sign in to at least one agent CLI using [provider setup](providers.md).

## Platform prerequisites

On Linux, install the standard Tauri prerequisites, including `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, and `libjavascriptcoregtk-4.1-dev` on Debian/Ubuntu. The setup helpers below install the native dependencies and packaging tools for their distributions.

On Windows, the packaging script uses `stable-x86_64-pc-windows-msvc`. The installer bootstraps the [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) runtime when it is missing.

## Run locally

From the repository root:

```bash
npm install
npm run tauri dev
```

## Ubuntu / Debian packages

On an Ubuntu/Debian workstation, the repository can install the native Tauri prerequisites and build distributable Linux packages directly:

```bash
npm run setup:linux:deb
npm ci
npm run build:linux
```

The Linux build emits `.deb` and AppImage bundles under `target/release/bundle/`, in the `deb/` and `appimage/` directories. `build:linux` repacks the AppImage so it uses the host WebKitGTK 4.1 stack instead of bundled Ubuntu libraries. See [Linux installation](install.md) for runtime dependencies and package instructions.

## Fedora / Enterprise Linux packages

On Fedora or Enterprise Linux 10 (registered RHEL, Rocky, Alma, CentOS Stream, Oracle):

```bash
npm run setup:linux:fedora
npm ci
npm run build:fedora
```

On EL 10, the setup helper enables EPEL 10 and CRB automatically, since the development packages need CRB. On Oracle Linux it enables `ol10_codeready_builder` and `ol10_developer_EPEL`. Fedora does not need these extra repositories.

The build emits a `.rpm` under `target/release/bundle/rpm/`, installable with:

```bash
sudo dnf install ./target/release/bundle/rpm/Irgatos-*.rpm
```

EL 9 and older are unsupported (`webkit2gtk4.1-devel` only exists in EPEL 10). The published release `.rpm` is built on Enterprise Linux 10 so it loads on Fedora and EL 10. See [Linux installation](install.md#fedora--enterprise-linux-packages) for release package installation and runtime repository setup.

## Windows packages

```bash
npm ci
npm run build:windows
```

The Windows build emits an NSIS installer under `target/release/bundle/nsis/`.

## Tauri configuration

- [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) contains the shared application and bundle configuration.
- [src-tauri/tauri.linux.conf.json](../src-tauri/tauri.linux.conf.json) loads automatically for Linux development and builds.
- [src-tauri/tauri.windows.conf.json](../src-tauri/tauri.windows.conf.json) loads automatically for Windows development and builds.

## macOS app

```bash
npm ci
npm run tauri -- build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

The app lands in `target/release/bundle/macos/Irgatos.app`. The `--config` override is needed unless `TAURI_SIGNING_PRIVATE_KEY` is set: `createUpdaterArtifacts` is on in `tauri.conf.json`, and Tauri refuses to build updater archives it cannot sign.

## Versioning and updates

Irgatos follows [semantic versioning](https://semver.org) starting at `0.1.0`. The version lives in `package.json`, `src-tauri/tauri.conf.json` and the root `Cargo.toml` (`[workspace.package]`), and the app shows it beside Settings in the sidebar, in the Settings header and under **Settings › General › About**, together with the commit it was built from.

```bash
npm run version:bump -- 0.2.0     # or patch / minor / major; add --dry-run to preview
npm run version:check             # fails if the files disagree
```

`version:bump` rewrites every version file in one step, including the lockfiles' own version entries, and opens a `## [x.y.z]` section in [CHANGELOG.md](../CHANGELOG.md) from whatever sits under `[Unreleased]`. To release, commit, tag `vX.Y.Z`, and push the tag. You can also run the [release workflow](../.github/workflows/release.yml) by hand from the Actions tab. It checks that the tag matches the version files and changelog, builds Apple Silicon and Intel apps, and publishes a GitHub Release with:

| Asset | Used by |
| --- | --- |
| `Irgatos_<version>_aarch64.app.tar.gz`, `Irgatos_<version>_x64.app.tar.gz` | In-app **Update & Relaunch** |
| `Irgatos_<version>_aarch64.dmg`, `Irgatos_<version>_x64.dmg` | Manual installs, and the in-app updater when no archive exists |
| `latest.json`, `*.sig` | The Tauri updater, only when updater signing keys are configured |

The release notes end with `Commit: <sha>` so installed apps can compare commits as well as versions. Linux, Windows and standalone host packages are built when the workflow runs with **all platforms** checked, or when the `RELEASE_ALL_PLATFORMS` repository variable is `true`.

### How Check for Updates works

**Irgatos › Check for Updates…** in the macOS menu, the version badge, and **Settings › General › About** all open the same Software Update window. It shows the installed version and commit, the newest available version, and progress through Checking, Up to date or Update available, Downloading, Installing and Relaunching. It checks, in order:

1. **The Tauri updater**, when the build was configured with a public key and an endpoint. The default `tauri.conf.json` has neither, so this step is skipped instead of failing with "does not have any endpoints set". Tauri's updater only accepts archives signed with the matching private key and described by a `latest.json` feed, which is why it cannot work without `TAURI_SIGNING_PRIVATE_KEY` and a published `latest.json`.
2. **GitHub Releases**, with no keys needed. The repository is the one set in **Settings › General › Update source**, or `IRGATOS_UPDATE_REPO`, or `wegvon/irgatos`, or the checkout's `origin` remote. Upstream MonoCode repositories (`cretou/*`, `hardbeat920/*`) are never used. A release counts as newer when its version is higher, or when the version matches and GitHub reports that its commit is ahead of the running build. **Update & Relaunch** downloads the archive for your architecture (or the DMG), checks the bundle identifier, removes the `com.apple.quarantine` attribute, verifies or ad-hoc re-signs the bundle, and swaps it into place, rolling back if the swap fails. An app running from `/Applications` or `~/Applications` is replaced in place; otherwise the update installs to `/Applications/Irgatos.app`. macOS asks for an administrator password only when that folder is not writable. Irgatos then quits and reopens.
3. **The source checkout**, when the app was built from a git clone (or one is set under **Update source**). Irgatos fetches the branch's upstream and reports how many new commits it has. **Rebuild & Relaunch** fast-forwards the checkout (stashing local edits), runs `npm ci` if `package-lock.json` changed, builds the `.app` as shown above, installs it the same way, and relaunches. A diverged branch is reported instead of being merged.

GitHub's anonymous API allows 60 requests an hour. Set `IRGATOS_GITHUB_TOKEN` (or `GITHUB_TOKEN`/`GH_TOKEN`, or sign in with `gh`) for private repositories or heavier use.

Builds made outside the release workflow embed the checkout's commit and branch automatically. Set `IRGATOS_BUILD_COMMIT` and `IRGATOS_BUILD_BRANCH` to override them.

## Beta releases and updates

Prerelease tags such as `v0.9.1-beta.1` publish to `beta/latest.json`, and beta builds use that feed even when a stable updater endpoint is configured. Beta releases leave the stable feed and macOS download links unchanged.

To trial AppImage updates, install a beta AppImage in a writable directory, publish a newer beta, and verify the update downloads, installs, and relaunches successfully before publishing a stable version.

The [release workflow](../.github/workflows/release.yml) packages the platform builds and publishes the updater feed. [scripts/release-channel.cjs](../scripts/release-channel.cjs) selects the stable or beta feed.

Read [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines and checks. The experimental remote host has its own [build and packaging instructions](remote-access.md#release-packaging).
