// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { newSession, type Session } from "../model/session";
import { publishLiveSessions } from "../data/sessionReferenceDirectory";
import { OPEN_REFERENCED_SESSION_EVENT } from "../model/sessionReferenceEvents";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

const CURRENT = "11111111-0000-4000-8000-000000000000";
const OTHER = "a1a1a1a1-0000-4000-8000-000000000000";

const other: Session = {
  ...newSession("codex", "/repo"),
  id: OTHER,
  title: "Fix login redirect",
  busy: true,
  blocks: [
    { id: "u1", role: "user", text: "Why does login redirect twice?" },
    { id: "a1", role: "assistant", text: "The guard runs on both routes." },
  ],
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  publishLiveSessions([
    { ...newSession("claude", "/repo"), id: CURRENT },
    other,
  ]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  publishLiveSessions([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderComposer(initialDraft = "") {
  const submit = vi.fn();
  const onDraftChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: true,
        sessionId: CURRENT,
        harness: "claude",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "/repo",
        initialDraft,
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: submit,
        onDraftChange,
      }),
    ),
  );
  return { submit, onDraftChange };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

it("picks another session from @session/ and shows a chip for it", async () => {
  const { submit } = await renderComposer();
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    textarea.focus();
    textarea.setRangeText("Compare with @session/", 0, 0, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();

  const row = container.querySelector(
    `[data-session-reference-row="${OTHER}"]`,
  );
  expect(row?.textContent).toContain("Fix login redirect");
  expect(row?.textContent).toContain("Running");
  expect(
    container.querySelector(`[data-session-reference-row="${CURRENT}"]`),
  ).toBeNull();

  await act(async () =>
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await settle();

  const label = "session/fix-login-redirect-a1a1a1a1";
  expect(textarea.value).toBe(`Compare with @${label} `);
  expect(container.querySelector("[data-session-reference-picker]")).toBeNull();
  const chip = container.querySelector(
    `[data-session-reference-chip="${label}"]`,
  );
  expect(chip?.textContent).toContain("Fix login redirect");
  expect(
    container.querySelector("[data-session-reference-tray]")?.textContent,
  ).toMatch(/tokens added on send/);

  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Send"]')!
      .click(),
  );
  expect(submit.mock.calls[0][0]).toBe(`Compare with @${label}`);
});

it("explains a chip on click and opens the source session", async () => {
  await renderComposer("See @session/fix-login-redirect-a1a1a1a1#2 ");
  await settle();
  const opened = vi.fn();
  window.addEventListener(OPEN_REFERENCED_SESSION_EVENT, (event) =>
    opened((event as CustomEvent).detail),
  );

  const chip = container.querySelector<HTMLElement>(
    '[data-session-reference-chip="session/fix-login-redirect-a1a1a1a1#2"]',
  )!;
  await act(async () => chip.querySelector("button")!.click());
  const details = container.querySelector("[data-session-reference-details]");
  expect(details?.textContent).toMatch(/still running/i);
  expect(details?.textContent).toMatch(/written by codex/i);

  const open = [...details!.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Open session"),
  )!;
  await act(async () => open.click());
  expect(opened).toHaveBeenCalledWith({ sessionId: OTHER, blockId: "a1" });
});

it("removes a reference from the draft with the chip's close button", async () => {
  const { onDraftChange } = await renderComposer(
    "See @session/fix-login-redirect-a1a1a1a1 please",
  );
  await settle();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Remove reference to Fix login redirect"]',
      )!
      .click(),
  );
  expect(container.querySelector("textarea")!.value).toBe("See please");
  expect(onDraftChange).toHaveBeenLastCalledWith("See please");
});
