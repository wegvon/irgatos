// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxTriagePills, inboxTriageEmptyText } from "./InboxTriagePills";
import { InboxCommentForm } from "./InboxComments";
import { InboxSnoozeControl, inboxSnoozeMenuItems } from "./InboxSnoozeControl";
import {
  InboxResurfaceNotices,
  mergeResurfaceNotices,
} from "./InboxResurfaceNotices";
import { inboxItemKey, type InboxItem } from "../model/githubTasks";
import { loadInboxSnoozes, saveInboxSnoozes } from "../model/inboxSnooze";
import { inboxDraft } from "../model/inboxDrafts";
import { loadInboxTriageFilter } from "../model/inboxTriage";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const item: InboxItem = {
  kind: "issue",
  title: "Flaky checkout test",
  url: "https://github.com/acme/web/issues/12",
  state: "open",
  updatedAt: "2026-10-01T08:00:00Z",
  labels: [],
  assignees: [],
  draft: false,
  repo: "acme/web",
  number: 12,
  projectPath: "/tmp/web",
  provider: "github",
};
const key = inboxItemKey(item);

let container: HTMLDivElement;
let root: Root;

function render(element: ReturnType<typeof createElement>) {
  act(() => root.render(element));
}

function setText(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("InboxTriagePills", () => {
  it("shows every pill with its count and reports a pick", () => {
    const onChange = vi.fn();
    render(
      createElement(InboxTriagePills, {
        value: "needs_action",
        counts: {
          all: 9,
          needs_action: 3,
          agent_activity: 2,
          drafts: 1,
          snoozed: 4,
        },
        onChange,
      }),
    );
    const pills = [...container.querySelectorAll('[role="radio"]')];
    expect(pills.map((pill) => pill.textContent)).toEqual([
      "All9",
      "Needs action3",
      "Agent activity2",
      "Drafts1",
      "Snoozed4",
    ]);
    expect(
      pills.map((pill) => pill.getAttribute("aria-checked")),
    ).toEqual(["false", "true", "false", "false", "false"]);
    act(() => (pills[4] as HTMLButtonElement).click());
    expect(onChange).toHaveBeenCalledWith("snoozed");
  });

  it("has an empty message for every narrowed view", () => {
    expect(inboxTriageEmptyText("all")).toBeNull();
    expect(inboxTriageEmptyText("snoozed")).toBe("Nothing snoozed");
    expect(inboxTriageEmptyText("drafts")).toBe("No unsent replies");
  });
});

describe("InboxCommentForm drafts", () => {
  it("restores, keeps, and clears an unsent reply", async () => {
    vi.useFakeTimers();
    localStorage.setItem(
      "irgat.inboxDrafts",
      JSON.stringify({ [key]: { body: "Half a thought", updatedAt: 1 } }),
    );
    const onSubmit = vi.fn(async () => {});
    const props = {
      draftKey: key,
      replyTo: null,
      posting: false,
      error: null,
      onCancelReply: () => {},
      onSubmit,
    };
    render(createElement(InboxCommentForm, props));
    const field = container.querySelector("textarea")!;
    expect(field.value).toBe("Half a thought");
    expect(container.textContent).toContain("Draft kept until you post it");

    setText(field, "Half a thought, finished");
    expect(inboxDraft(key)).toBe("Half a thought");
    act(() => vi.advanceTimersByTime(500));
    expect(inboxDraft(key)).toBe("Half a thought, finished");

    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith("Half a thought, finished");
    expect(field.value).toBe("");
    expect(inboxDraft(key)).toBe("");
  });

  it("saves a pending draft when the item closes", () => {
    vi.useFakeTimers();
    render(
      createElement(InboxCommentForm, {
        draftKey: key,
        replyTo: null,
        posting: false,
        error: null,
        onCancelReply: () => {},
        onSubmit: async () => {},
      }),
    );
    setText(container.querySelector("textarea")!, "Quick note");
    act(() => root.render(null));
    expect(inboxDraft(key)).toBe("Quick note");
  });

  it("keeps nothing without a draft key", () => {
    render(
      createElement(InboxCommentForm, {
        replyTo: null,
        posting: false,
        error: null,
        onCancelReply: () => {},
        onSubmit: async () => {},
      }),
    );
    setText(container.querySelector("textarea")!, "Ephemeral");
    expect(localStorage.getItem("irgat.inboxDrafts")).toBeNull();
  });
});

describe("InboxSnoozeControl", () => {
  it("lists presets, a custom time, and Unsnooze only when snoozed", () => {
    const now = new Date(2026, 9, 14, 10, 0);
    const ids = (snoozed: boolean) =>
      inboxSnoozeMenuItems(now, snoozed).map((entry) =>
        entry.kind === "item" ? entry.id : "-",
      );
    expect(ids(false)).toEqual([
      "snooze:1h",
      "snooze:later-today",
      "snooze:tomorrow",
      "snooze:next-week",
      "-",
      "snooze:custom",
    ]);
    expect(ids(true).slice(-2)).toEqual(["-", "snooze:clear"]);
  });

  it("snoozes from the menu and shows when the item returns", () => {
    const onSnoozed = vi.fn();
    render(createElement(InboxSnoozeControl, { item, onSnoozed }));
    const trigger = container.querySelector("button")!;
    expect(trigger.textContent).toBe("Snooze");
    act(() => trigger.click());
    const option = [...document.querySelectorAll('[role="menuitem"]')].find(
      (entry) => entry.textContent?.startsWith("In 1 hour"),
    ) as HTMLElement | undefined;
    expect(option).toBeDefined();
    act(() => option!.click());
    const entry = loadInboxSnoozes().snoozed[key];
    expect(entry).toMatchObject({ title: item.title, ref: "acme/web#12" });
    expect(entry!.until - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect(onSnoozed).toHaveBeenCalledTimes(1);
    expect(container.querySelector("button")!.textContent).toMatch(/^Until /);
  });
});

describe("InboxResurfaceNotices", () => {
  it("merges repeats and keeps the newest last", () => {
    expect(
      mergeResurfaceNotices(
        [
          { key: "a", at: 1 },
          { key: "b", at: 2 },
        ],
        [{ key: "a", at: 3 }],
      ).map((notice) => `${notice.key}${notice.at}`),
    ).toEqual(["b2", "a3"]);
  });

  it("announces an item whose snooze ran out and opens Needs action", () => {
    saveInboxSnoozes({
      snoozed: {
        [key]: {
          until: Date.now() - 1000,
          snoozedAt: 0,
          title: item.title,
          ref: "acme/web#12",
        },
      },
      resurfaced: {},
    });
    const onOpenInbox = vi.fn();
    render(createElement(InboxResurfaceNotices, { onOpenInbox }));
    const panel = document.querySelector('[aria-label="Back in your Inbox"]');
    expect(panel?.textContent).toContain("Flaky checkout test");
    expect(panel?.textContent).toContain("acme/web#12");
    expect(loadInboxSnoozes().resurfaced[key]).toBeDefined();
    const open = [...panel!.querySelectorAll("button")].find(
      (button) => button.textContent === "Open Inbox",
    )!;
    act(() => open.click());
    expect(onOpenInbox).toHaveBeenCalledTimes(1);
    expect(loadInboxTriageFilter()).toBe("needs_action");
    expect(document.querySelector('[aria-label="Back in your Inbox"]')).toBeNull();
  });
});
