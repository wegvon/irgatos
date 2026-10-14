// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  loadAdhdState,
  saveAdhdSettings,
  setAdhdForChat,
} from "../model/adhdMode";
import { AdhdModeChip, type AdhdChipSession } from "./AdhdModeChip";

vi.mock("../../settings/model/sounds", () => ({ playCue: vi.fn() }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const chat = (blocks: Partial<Block>[], busy = false): AdhdChipSession => ({
  id: "chat",
  busy,
  blocks: blocks.map((block, index) => ({
    id: `b${index}`,
    text: "",
    role: "assistant",
    ...block,
  })) as Block[],
});

async function render(
  session?: AdhdChipSession,
  variant?: "footer" | "composer",
) {
  await act(async () =>
    root.render(createElement(AdhdModeChip, { session, variant })),
  );
}

const toggle = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label="ADHD mode"]')!;
const focus = () => container.querySelector('[data-testid="adhd-focus"]');

describe("AdhdModeChip", () => {
  it("turns ADHD mode on from the status bar and remembers it", async () => {
    await render();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().title).toContain("Turn on ADHD mode");
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(loadAdhdState().enabled).toBe(true);
    expect(container.querySelector("[data-adhd-mode]")?.getAttribute(
      "data-adhd-mode",
    )).toBe("on");
  });

  it("follows changes made elsewhere, such as Settings", async () => {
    await render();
    await act(async () => saveAdhdSettings({ enabled: true }));
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    await act(async () => saveAdhdSettings({ showInStatusBar: false }));
    expect(container.innerHTML).toBe("");
  });

  it("shows the latest next step only while the mode is on", async () => {
    const session = chat([
      { role: "user", text: "fix login" },
      { text: "Login works.\n\nNext: open `/login`" },
    ]);
    await render(session);
    expect(focus()).toBeNull();
    await act(async () => saveAdhdSettings({ enabled: true }));
    expect(focus()?.textContent).toBe("Next: open `/login`");
    expect(focus()?.getAttribute("title")).toBe("Next: open `/login`");
    await act(async () => saveAdhdSettings({ showFocus: false }));
    expect(focus()).toBeNull();
  });

  it("shows task progress while the agent works", async () => {
    saveAdhdSettings({ enabled: true });
    await render(
      chat(
        [
          { role: "user", text: "go" },
          {
            role: "tasks",
            taskList: {
              items: [
                { text: "Schema", status: "completed" },
                { text: "Backfill", status: "in_progress" },
              ],
            },
          },
        ],
        true,
      ),
      "composer",
    );
    expect(focus()?.textContent).toBe("Step 2 of 2: Backfill");
    expect(focus()?.className).toContain("max-w-56");
  });

  it("marks a chat that differs from the switch and resets it on click", async () => {
    saveAdhdSettings({ enabled: true });
    setAdhdForChat("chat", false);
    await render(chat([]));
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().textContent).toBe("ADHD paused");
    expect(toggle().title).toContain("off for this chat");
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().textContent).toBe("ADHD");
    expect(loadAdhdState().chats).toEqual({});

    await act(async () => saveAdhdSettings({ enabled: false }));
    await act(async () => setAdhdForChat("chat", true));
    expect(toggle().textContent).toBe("ADHD · this chat");
  });
});
