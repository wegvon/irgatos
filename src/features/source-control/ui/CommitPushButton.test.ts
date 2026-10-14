// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const git = vi.hoisted(() => ({
  gitCommitPushCheck: vi.fn(),
  gitCommitPushStage: vi.fn(),
  gitCommitPushCommit: vi.fn(),
  gitCommitPushPush: vi.fn(),
  gitCommitPushRebase: vi.fn(),
}));

vi.mock("../../../platform/tauri/fs", () => git);

import { CommitPushButton } from "./CommitPushButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let busy: string | null;
const onCommitted = vi.fn();
const onPushed = vi.fn();
const onSettled = vi.fn();

function render() {
  act(() => {
    root.render(
      createElement(StrictMode, null, createElement(CommitPushButton, {
        cwd: "/repo",
        message: "Ship it",
        target: "origin/main",
        busy,
        setBusy: (value: string | null) => {
          busy = value;
          render();
        },
        onCommitted,
        onPushed,
        onSettled,
      })),
    );
  });
}

const button = () =>
  host.querySelector<HTMLButtonElement>("[data-commit-push] > button")!;

beforeEach(() => {
  busy = null;
  vi.clearAllMocks();
  git.gitCommitPushCheck.mockResolvedValue({
    branch: "main",
    remote: "origin",
    upstream: "origin/main",
    stageAll: true,
  });
  git.gitCommitPushStage.mockResolvedValue({ paths: ["a.ts"], stagedAll: true });
  git.gitCommitPushCommit.mockResolvedValue({
    sha: "abc1234",
    message: "Ship it",
    paths: ["a.ts"],
  });
  git.gitCommitPushPush.mockResolvedValue({
    remote: "origin",
    branch: "main",
    setUpstream: false,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("CommitPushButton", () => {
  it("shows the push target, then the phase while running, then the result", async () => {
    expect(button().textContent).toBe("Commit & Pushorigin/main");
    let release!: () => void;
    git.gitCommitPushCommit.mockReturnValue(
      new Promise((resolve) => {
        release = () =>
          resolve({ sha: "abc1234", message: "Ship it", paths: ["a.ts"] });
      }),
    );
    await act(async () => button().click());
    await vi.waitFor(() => expect(button().textContent).toBe("Committing…"));
    expect(button().disabled).toBe(true);
    expect(host.querySelector('[aria-current="step"]')?.textContent).toBe("Commit");

    await act(async () => {
      button().click();
      release();
    });
    await vi.waitFor(() =>
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        "Committed abc1234 and pushed to origin/main",
      ),
    );
    expect(git.gitCommitPushCommit).toHaveBeenCalledTimes(1);
    expect(git.gitCommitPushCommit).toHaveBeenCalledWith("/repo", "Ship it");
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onPushed).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(busy).toBeNull();
  });

  it("shows a failing hook's stderr in the panel instead of swallowing it", async () => {
    git.gitCommitPushPush.mockRejectedValue({
      kind: "hookFailed",
      hook: "pre-push",
      detail: "npm test: 3 failing",
    });
    await act(async () => button().click());
    const alert = await vi.waitFor(() => {
      const element = host.querySelector('[role="alert"]');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(alert.textContent).toContain("pre-push hook failed");
    expect(alert.querySelector("pre")?.textContent).toBe("npm test: 3 failing");
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onPushed).not.toHaveBeenCalled();

    git.gitCommitPushPush.mockResolvedValue({
      remote: "origin",
      branch: "main",
      setUpstream: false,
    });
    const retry = [...alert.querySelectorAll("button")].find(
      (element) => element.textContent === "Try Again",
    )!;
    await act(async () => retry.click());
    await vi.waitFor(() => expect(onPushed).toHaveBeenCalledTimes(1));
    expect(git.gitCommitPushCommit).toHaveBeenCalledTimes(1);
  });

  it("waits while another git action owns the form", () => {
    busy = "commit";
    render();
    expect(button().disabled).toBe(true);
  });
});
