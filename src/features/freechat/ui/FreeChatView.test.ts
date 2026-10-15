// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreeChatRow } from "../model/freeChat";
import { FreeChatView } from "./FreeChatView";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
  }),
}));

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FreeChatView>;

function row(id: string, patch: Partial<FreeChatRow> = {}): FreeChatRow {
  return {
    id,
    title: `Chat ${id}`,
    harness: "claude",
    model: "",
    pinned: false,
    updatedAt: 1,
    state: "idle",
    blank: false,
    ...patch,
  };
}

function render(overrides: Partial<ComponentProps<typeof FreeChatView>> = {}) {
  props = { ...props, ...overrides };
  act(() => root.render(createElement(FreeChatView, props)));
}

const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    rows: [],
    shortcut: "⌘⇧H",
    besideRail: true,
    onClose: vi.fn(),
    onNewChat: vi.fn(),
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onPin: vi.fn(),
    onDelete: vi.fn(),
    onBoard: vi.fn(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("FreeChatView", () => {
  it("invites a first chat when there are none", () => {
    render();
    expect(container.querySelector("[data-app-chat]")).not.toBeNull();
    expect(container.querySelector("[data-free-chat-list]")).toBeNull();
    expect(container.textContent).toContain("Ask anything");
    expect(container.textContent).toContain("No project needed");
    act(() => button("New chat (⌘⇧H)")!.click());
    expect(props.onNewChat).toHaveBeenCalledTimes(1);
  });

  it("lists chats with their state and opens one on click", () => {
    render({
      rows: [
        row("a", { state: "needs-input", pinned: true }),
        row("b", { state: "running" }),
        row("c", { state: "unread" }),
      ],
    });
    const rows = [...container.querySelectorAll<HTMLElement>("[data-free-chat-row]")];
    expect(rows.map((item) => [item.dataset.freeChatRow, item.dataset.state])).toEqual([
      ["a", "needs-input"],
      ["b", "running"],
      ["c", "unread"],
    ]);
    expect(button("Chat a, Needs you")).not.toBeNull();
    expect(container.textContent).toContain("Pick a chat");
    act(() => button("Chat b, Running")!.click());
    expect(props.onSelect).toHaveBeenCalledWith("b");
  });

  it("shows the open chat's pane and footer", () => {
    render({
      rows: [row("a")],
      activeId: "a",
      pane: createElement("div", { "data-pane": "" }),
      footer: createElement("div", { "data-footer": "" }),
    });
    expect(container.querySelector("[data-pane]")).not.toBeNull();
    expect(container.querySelector("[data-footer]")).not.toBeNull();
    expect(container.querySelector('[aria-current="true"]')?.textContent).toBe("Chat a");
    expect(container.textContent).not.toContain("Pick a chat");
  });

  it("adds the open chat to the board, or shows its card once it has one", () => {
    render({ rows: [row("a")], activeId: "a" });
    act(() => button("Add to Board")!.click());
    expect(props.onBoard).toHaveBeenCalledWith("a");
    render({ boardIds: new Set(["a"]) });
    expect(button("Add to Board")).toBeNull();
    expect(button("Show on Board")).not.toBeNull();
  });

  it("keeps a blank chat off the board", () => {
    render({ rows: [row("a", { blank: true })], activeId: "a" });
    expect(button("Add to Board")).toBeNull();
    act(() => button("More actions for Chat a")!.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (element) => element.textContent?.includes("Add to Board"),
    )!;
    expect(item.disabled).toBe(true);
  });

  it("pins, deletes and renames from the row menu", () => {
    render({ rows: [row("a")] });
    const pick = (label: string) => {
      act(() => button("More actions for Chat a")!.click());
      const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (element) => element.textContent?.trim() === label,
      )!;
      act(() => item.click());
    };
    pick("Pin");
    expect(props.onPin).toHaveBeenCalledWith("a", true);
    pick("Delete");
    expect(props.onDelete).toHaveBeenCalledWith("a");
    pick("Rename");
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Chat title"]')!;
    input.value = "Monads";
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(props.onRename).toHaveBeenCalledWith("a", "Monads");
  });

  it("filters chats by title", () => {
    render({ rows: [row("a", { title: "Tax question" }), row("b", { title: "Recipe" })] });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Filter chats"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "tax");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-free-chat-row]")].map(
        (item) => item.dataset.freeChatRow,
      ),
    ).toEqual(["a"]);
  });

  it("reports a failed load with a retry", () => {
    const onRetry = vi.fn();
    render({ error: "Couldn’t load your chats.", onRetry });
    expect(container.textContent).toContain("Couldn’t load your chats.");
    const retry = [...container.querySelectorAll("button")].find(
      (element) => element.textContent === "Try again",
    )!;
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("puts the chat's terminal dock between the pane and the status bar", () => {
    render({
      rows: [row("a")],
      activeId: "a",
      pane: createElement("div", { "data-slot": "pane" }),
      dock: createElement("div", { "data-slot": "dock" }),
      footer: createElement("div", { "data-slot": "footer" }),
    });
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-slot]")].map(
        (item) => item.dataset.slot,
      ),
    ).toEqual(["pane", "dock", "footer"]);
  });
});
