// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createIrgat,
  findIrgat,
  updateIrgat,
} from "../../features/irgats/model/irgat";
import { IrgatRailSection } from "./IrgatRailSection";

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(props: Partial<Parameters<typeof IrgatRailSection>[0]> = {}) {
  const onCreate = vi.fn();
  act(() =>
    root.render(
      createElement(IrgatRailSection, {
        states: new Map(),
        onOpen: () => {},
        onCreate,
        onDelete: () => {},
        ...props,
      }),
    ),
  );
  return onCreate;
}

const intro = () => document.body.querySelector('[aria-label="Meet Irgats"]');
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  )!;

it("offers a new irgat in place of the list, and meets a new user beside it", () => {
  const onCreate = render({ introAvailable: true });
  const add = container.querySelector("[data-irgat-add]");
  expect(add?.getAttribute("aria-label")).toBe("New irgat");
  expect(add?.textContent).toBe("");
  expect(container.querySelectorAll('[aria-label="New irgat"]')).toHaveLength(
    1,
  );
  expect(intro()).not.toBeNull();

  act(() => button("Create your irgat").click());
  expect(onCreate).toHaveBeenCalledOnce();
  expect(intro()).toBeNull();
});

it("meets the user only once, whichever way they choose", () => {
  render({ introAvailable: true });
  act(() => button("Create your irgat").click());
  act(() => root.unmount());
  root = createRoot(container);
  render({ introAvailable: true });
  expect(intro()).toBeNull();
});

it("stops meeting the user once they pass on it", () => {
  render({ introAvailable: true });
  act(() => button("Not now").click());
  expect(intro()).toBeNull();
  act(() => root.unmount());
  root = createRoot(container);
  render({ introAvailable: true });
  expect(intro()).toBeNull();
  expect(container.querySelector("[data-irgat-add]")).not.toBeNull();
});

it("lists irgats once there are some, with the plus in the header", () => {
  createIrgat();
  render({ introAvailable: true });
  expect(intro()).toBeNull();
  expect(container.querySelector("[data-irgat-add]")).toBeNull();
  expect(container.querySelectorAll('[aria-label="New irgat"]')).toHaveLength(
    1,
  );
});

it("counts a irgat's unread replies, selected or not", () => {
  const irgat = createIrgat();
  const badge = () => container.querySelector("[data-irgat-unread]");
  render({ unseenCounts: new Map([[irgat.id, 3]]) });
  expect(badge()?.textContent).toBe("3");
  expect(
    container.querySelector(`[aria-label*="3 new replies"]`),
  ).not.toBeNull();

  render({ unseenCounts: new Map([[irgat.id, 120]]) });
  expect(badge()?.textContent).toBe("99+");

  // Another chat of the selected Irgat replied; the open one is not counted.
  render({ activeId: irgat.id, unseenCounts: new Map([[irgat.id, 3]]) });
  expect(badge()?.textContent).toBe("3");
});

it("opens and creates independent chats under the same Irgat", () => {
  const irgat = createIrgat();
  updateIrgat(irgat.id, (current) => ({
    ...current,
    sessionId: "main",
    childSessionIds: ["child-1", "child-2"],
    chatsCollapsed: false,
  }));
  const onOpenChat = vi.fn();
  const onCreateChat = vi.fn();
  render({
    activeSessionId: "child-2",
    chatTitles: new Map([
      ["child-1", "Research"],
      ["child-2", "Release"],
    ]),
    onOpenChat,
    onCreateChat,
  });
  const branch = container.querySelector(`[data-irgat-chats="${irgat.id}"]`)!;
  const rows = [...branch.querySelectorAll("button")];
  expect(rows.map((row) => row.textContent)).toEqual([
    "Research",
    "Release",
    " New chat",
  ]);
  expect(rows[1].getAttribute("aria-current")).toBe("page");
  act(() => rows[0].click());
  expect(onOpenChat).toHaveBeenCalledWith(irgat.id, "child-1");
  act(() => rows[2].click());
  expect(onCreateChat).toHaveBeenCalledWith(irgat.id);
});

it("collapses each Irgat independently and remembers it after reopening the rail", () => {
  const first = createIrgat();
  const second = createIrgat();
  const onOpen = vi.fn();
  const props = { onOpen, onCreateChat: vi.fn() };
  render(props);
  const toggle = (id: string) =>
    container.querySelector<HTMLButtonElement>(
      `[aria-controls="irgat-chats-${id}"]`,
    )!;
  const chats = (id: string) =>
    container.querySelector(`[data-irgat-chats="${id}"]`);
  expect(toggle(first.id).getAttribute("aria-expanded")).toBe("false");
  expect(chats(first.id)).toBeNull();
  act(() => toggle(first.id).click());
  expect(chats(first.id)).not.toBeNull();
  expect(chats(second.id)).toBeNull();
  expect(onOpen).toHaveBeenCalledWith(first.id);
  act(() => root.unmount());
  root = createRoot(container);
  render(props);
  expect(chats(first.id)).not.toBeNull();
  act(() => toggle(first.id).click());
  expect(chats(first.id)).toBeNull();
  expect(findIrgat(first.id)?.chatsCollapsed).toBe(true);
});

it("offers deletion for just the selected child without opening it", () => {
  const irgat = createIrgat();
  updateIrgat(irgat.id, (entry) => ({
    ...entry,
    childSessionIds: ["child"],
    chatsCollapsed: false,
  }));
  const onDeleteChat = vi.fn();
  const onOpenChat = vi.fn();
  render({
    onCreateChat: vi.fn(),
    onDeleteChat,
    onOpenChat,
    chatTitles: new Map([["child", "Research"]]),
  });
  const options = container.querySelector<HTMLButtonElement>(
    '[aria-label="Research options"]',
  )!;
  act(() => options.click());
  const remove =
    document.body.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(remove.textContent).toContain("Delete chat");
  act(() => remove.click());
  expect(onDeleteChat).toHaveBeenCalledExactlyOnceWith(irgat.id, "child");
  expect(onOpenChat).not.toHaveBeenCalled();
});

it("shows each child chat's state and renames it from its menu", () => {
  const irgat = createIrgat();
  updateIrgat(irgat.id, (entry) => ({
    ...entry,
    childSessionIds: ["busy", "asks", "quiet"],
    chatsCollapsed: false,
  }));
  const onRenameChat = vi.fn();
  render({
    onCreateChat: vi.fn(),
    onRenameChat,
    chatTitles: new Map([
      ["busy", "Busy"],
      ["asks", "Asks"],
      ["quiet", "Quiet"],
    ]),
    chatStates: new Map([
      ["busy", "running"],
      ["asks", "needs-input"],
    ]),
  });
  const row = (id: string) =>
    container.querySelector<HTMLElement>(`[data-irgat-chat="${id}"]`)!;
  expect(row("busy").dataset.state).toBe("running");
  expect(row("busy").querySelector(".animate-spin")).not.toBeNull();
  expect(row("asks").querySelector("button")!.getAttribute("aria-label")).toBe(
    "Asks, Needs you",
  );
  expect(row("quiet").dataset.state).toBe("idle");

  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Quiet options"]')!
      .click(),
  );
  const rename = [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.includes("Rename"))!;
  act(() => rename.click());
  const input = row("quiet").querySelector<HTMLInputElement>("input")!;
  expect(input.value).toBe("Quiet");
  act(() => {
    input.value = "Release notes";
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(onRenameChat).toHaveBeenCalledWith("quiet", "Release notes");
  expect(row("quiet").querySelector("input")).toBeNull();
});

it("starts a new chat under the Irgat beside the open one", () => {
  const irgat = createIrgat();
  updateIrgat(irgat.id, (current) => ({
    ...current,
    sessionId: "main",
    childSessionIds: [],
    chatsCollapsed: false,
  }));
  const onCreateChat = vi.fn();
  const onCreateChatBeside = vi.fn();
  render({ activeSessionId: "main", onCreateChat, onCreateChatBeside });
  const branch = container.querySelector(`[data-irgat-chats="${irgat.id}"]`)!;
  const beside = branch.querySelector<HTMLButtonElement>(
    '[title="New chat beside (⌥-click)"]',
  )!;
  act(() => beside.click());
  expect(onCreateChatBeside).toHaveBeenCalledWith(irgat.id);
  // Option-click on New chat opens it beside too.
  const newChat = [...branch.querySelectorAll("button")].find(
    (button) => button.textContent === " New chat",
  )!;
  act(() => {
    newChat.dispatchEvent(
      new MouseEvent("click", { bubbles: true, altKey: true }),
    );
  });
  expect(onCreateChatBeside).toHaveBeenCalledTimes(2);
  expect(onCreateChat).not.toHaveBeenCalled();
});
