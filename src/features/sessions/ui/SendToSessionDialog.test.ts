// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishLiveSessions } from "../data/sessionReferenceDirectory";
import {
  loadCooperativeMode,
  resetCooperativeModeCache,
  sessionMessageStore,
} from "../data/sessionMessageStore";
import { connectSessionMessageTransport } from "../model/sessionMessageRouter";
import type { Session } from "../model/session";
import { SendToSessionDialog } from "./SendToSessionDialog";

vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ title, children }: { title: string; children: ReactNode }) =>
    createElement("div", { role: "dialog", "aria-label": title }, children),
}));

function session(id: string, title: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    harness: "claude",
    model: "claude:opus",
    modelSettings: {},
    runtimeMode: "default" as Session["runtimeMode"],
    title,
    cwd: "/repo/app",
    blocks: [],
    ...patch,
  };
}

const lead = session("aaaaaaaa-lead", "Lead", {
  blocks: [
    { id: "u1", role: "user", text: "Plan the release" },
    { id: "r1", role: "assistant", text: "Here is the release plan." },
  ],
});
const docs = session("bbbbbbbb-docs", "Docs", { harness: "codex", model: "gpt-5" });
const tests = session("cccccccc-test", "Tests", { busy: true });
const other = session("dddddddd-else", "Elsewhere", { cwd: "/repo/other" });

let container: HTMLDivElement;
let root: Root;
let submit: ReturnType<typeof vi.fn<(id: string, text: string) => boolean>>;
let insert: ReturnType<typeof vi.fn<(id: string, text: string) => void>>;
let disconnect: () => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetCooperativeModeCache();
  sessionMessageStore.clear();
  const live = [lead, docs, tests, other];
  publishLiveSessions(live);
  submit = vi.fn<(id: string, text: string) => boolean>(() => true);
  insert = vi.fn<(id: string, text: string) => void>();
  disconnect = connectSessionMessageTransport({
    sessions: () => live,
    submit,
    insertIntoComposer: insert,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  disconnect();
  publishLiveSessions([]);
  vi.unstubAllGlobals();
});

function render(text?: string) {
  const onSent = vi.fn();
  act(() =>
    root.render(
      createElement(SendToSessionDialog, {
        request: {
          sourceSessionId: lead.id,
          blockId: "r1",
          ...(text ? { text } : {}),
        },
        onClose: vi.fn(),
        onSent,
      }),
    ),
  );
  return onSent;
}

const targetRows = () =>
  [...container.querySelectorAll<HTMLElement>("[data-session-message-target]")].map(
    (row) => row.dataset.sessionMessageTarget,
  );

function click(element: Element | null) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("SendToSessionDialog", () => {
  it("lists open sessions with siblings, harness, model and status", () => {
    render();
    expect(targetRows()).toEqual(["siblings", tests.id, docs.id, other.id]);
    const docsRow = container.querySelector(`[data-session-message-target="${docs.id}"]`);
    expect(docsRow?.textContent).toContain("Docs");
    expect(docsRow?.textContent).toContain("Codex");
    expect(docsRow?.textContent).toContain("Idle");
    expect(
      container
        .querySelector(`[data-session-message-target="${tests.id}"]`)
        ?.textContent,
    ).toContain("Running");
    expect(container.textContent).toContain("This project");
    expect(container.textContent).toContain("Other open sessions");
    expect(
      container.querySelector<HTMLTextAreaElement>("[data-session-message-text]")
        ?.value,
    ).toBe("Here is the release plan.");
  });

  it("sends and runs the message in the picked session", () => {
    const onSent = render();
    click(container.querySelector(`[data-session-message-target="${docs.id}"]`));
    click(container.querySelector('[data-session-message-action="run"]'));
    expect(submit).toHaveBeenCalledWith(
      docs.id,
      '[Message from session "Lead"]\n\nHere is the release plan.',
    );
    expect(onSent).toHaveBeenCalledWith({ mode: "run", targetIds: [docs.id] });
    expect(sessionMessageStore.snapshot()).toEqual([
      expect.objectContaining({
        fromSessionId: lead.id,
        toSessionId: docs.id,
        sourceBlockId: "r1",
        origin: "user",
        status: "queued",
      }),
    ]);
  });

  it("queues a selection in a composer from the keyboard", () => {
    const onSent = render("release plan");
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search sessions"]',
    )!;
    act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(insert).toHaveBeenCalledWith(
      tests.id,
      '[Message from session "Lead"]\n\nrelease plan',
    );
    expect(submit).not.toHaveBeenCalled();
    expect(onSent).toHaveBeenCalledWith({ mode: "composer", targetIds: [tests.id] });
  });

  it("broadcasts to every sibling and can ask for replies", () => {
    render();
    click(container.querySelector("[data-session-message-expect-reply]"));
    click(container.querySelector('[data-session-message-action="run"]'));
    expect(submit.mock.calls.map(([id]) => id)).toEqual([tests.id, docs.id]);
    expect(submit.mock.calls[0]![1]).toContain('your reply is sent back to "Lead"');
  });

  it("turns cooperative mode on", () => {
    render();
    click(container.querySelector("[data-cooperative-mode]"));
    expect(loadCooperativeMode().enabled).toBe(true);
  });
});
