// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
const openUrl = vi.fn(async () => {});
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const { WorktreePortBadge } = await import("./WorktreePortBadge");
const { OPEN_BROWSER_URL_EVENT, rememberSetupEvent } = await import(
  "../model/worktreeEnv"
);

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  invoke.mockReset();
  openUrl.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(cwd: string) {
  await act(async () => {
    root.render(createElement(WorktreePortBadge, { cwd }));
  });
}

it("shows the worktree's port and opens it in the browser panel", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "worktree_port" ? 4123 : null,
  );
  await render("/repo-worktrees/badge");
  expect(invoke).toHaveBeenCalledWith("worktree_port", {
    cwd: "/repo-worktrees/badge",
  });
  const button = container.querySelector<HTMLButtonElement>(
    "[data-worktree-port]",
  )!;
  expect(button.textContent).toBe(":4123");

  const opened: string[] = [];
  const onOpen = (e: Event) => opened.push((e as CustomEvent<string>).detail);
  window.addEventListener(OPEN_BROWSER_URL_EVENT, onOpen);
  act(() => button.click());
  act(() =>
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    ),
  );
  window.removeEventListener(OPEN_BROWSER_URL_EVENT, onOpen);
  expect(opened).toEqual(["http://localhost:4123"]);
  expect(openUrl).toHaveBeenCalledWith("http://localhost:4123");
});

it("renders nothing outside a linked worktree", async () => {
  invoke.mockResolvedValue(null);
  await render("/repo");
  expect(container.innerHTML).toBe("");
});

it("surfaces a failed setup and lets the user rerun it", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "worktree_port" ? 4150 : null,
  );
  await render("/repo-worktrees/failing");
  act(() =>
    rememberSetupEvent({
      path: "/repo-worktrees/failing",
      command: "pnpm install --offline",
      status: "failed",
      exitCode: 1,
      output: "ERR_PNPM_NO_OFFLINE_TARBALL",
      logPath: "/repo/.git/worktrees/failing/irgatos-setup.log",
      port: 4150,
      startedAt: 5,
      finishedAt: 6,
    }),
  );
  const chip = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Setup failed"]',
  )!;
  expect(chip.textContent).toBe("Setup failed");
  act(() => chip.click());
  expect(document.body.textContent).toContain("ERR_PNPM_NO_OFFLINE_TARBALL");
  const retry = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Run setup again",
  )!;
  await act(async () => retry.click());
  expect(invoke).toHaveBeenCalledWith("worktree_setup_run", {
    path: "/repo-worktrees/failing",
  });
});
