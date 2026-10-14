import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { updateActionLabel, updateHeadline } from "../model/updateStatus";
import type { UpdaterSnapshot } from "../model/updater";
import { UpdateDialogBody } from "./UpdateDialog";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
  getBundleType: vi.fn(),
  BundleType: {},
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const COMMIT = "89b88053a1966eae8b984d21441372041f5a7b63";

function render(snapshot: UpdaterSnapshot) {
  return renderToStaticMarkup(createElement(UpdateDialogBody, { snapshot }));
}

describe("update status copy", () => {
  it.each<[UpdaterSnapshot, string]>([
    [{ phase: "checking", currentVersion: "0.1.0" }, "Checking for updates…"],
    [{ phase: "current", currentVersion: "0.1.0" }, "Irgatos is up to date at v0.1.0"],
    [
      { phase: "available", channel: "release", currentVersion: "0.1.0", availableVersion: "0.2.0" },
      "Irgatos v0.2.0 is available",
    ],
    [
      {
        phase: "available",
        channel: "source",
        currentVersion: "0.1.0",
        availableVersion: "0.2.0",
        newCommits: 1,
        branch: "main",
      },
      "1 new commit on main (v0.2.0)",
    ],
    [
      { phase: "downloading", currentVersion: "0.1.0", availableVersion: "0.2.0", progress: 40 },
      "Downloading v0.2.0 40%",
    ],
    [{ phase: "building", currentVersion: "0.1.0" }, "Building from source…"],
    [{ phase: "relaunching", currentVersion: "0.1.0" }, "Relaunching…"],
    [{ phase: "error", currentVersion: "0.1.0" }, "Couldn't check for updates"],
  ])("%j", (snapshot, headline) => {
    expect(updateHeadline(snapshot)).toBe(headline);
  });

  it("labels the one-click action by channel", () => {
    const available = { phase: "available", currentVersion: "0.1.0" } as const;
    expect(updateActionLabel({ ...available, channel: "release" })).toBe("Update & Relaunch");
    expect(updateActionLabel({ ...available, channel: "source" })).toBe("Rebuild & Relaunch");
    expect(updateActionLabel({ ...available, channel: "release", installable: false })).toBe(
      "Open release page",
    );
    expect(updateActionLabel({ ...available, channel: "source", installable: false })).toBeNull();
    expect(updateActionLabel({ phase: "current", currentVersion: "0.1.0" })).toBeNull();
  });
});

describe("UpdateDialogBody", () => {
  it("shows the installed build when up to date", () => {
    const markup = render({
      phase: "current",
      currentVersion: "0.1.0",
      currentCommit: COMMIT,
      branch: "main",
      note: "No releases published on wegvon/irgatos yet.",
    });
    expect(markup).toContain("Irgatos is up to date at v0.1.0");
    expect(markup).toContain("89b8805");
    expect(markup).toContain("No releases published on wegvon/irgatos");
    expect(markup).toContain("Check again");
  });

  it("offers Update &amp; Relaunch with both versions", () => {
    const markup = render({
      phase: "available",
      channel: "release",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      repo: "wegvon/irgatos",
      notes: "Faster startup.",
      installable: true,
    });
    expect(markup).toContain("Update &amp; Relaunch");
    expect(markup).toContain("v0.2.0");
    expect(markup).toContain("on wegvon/irgatos");
    expect(markup).toContain("Faster startup.");
  });

  it("shows download progress and hides actions while busy", () => {
    const markup = render({
      phase: "downloading",
      channel: "release",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      progress: 40,
      detail: "Downloading Irgatos_0.2.0_aarch64.app.tar.gz",
    });
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain("width:40%");
    expect(markup).toContain("Irgatos_0.2.0_aarch64.app.tar.gz");
    expect(markup).not.toContain("Update &amp; Relaunch");
    expect(markup).toContain("Hide");
  });

  it("prints the build log line while rebuilding from source", () => {
    const markup = render({
      phase: "building",
      channel: "source",
      currentVersion: "0.1.0",
      availableVersion: "0.1.0",
      detail: "Compiling irgat v0.1.0",
    });
    expect(markup).toContain("Building from source…");
    expect(markup).toContain("Compiling irgat v0.1.0");
    expect(markup).toContain("relaunches when the build is installed");
  });
});
