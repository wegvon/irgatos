// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionMessageStore } from "../data/sessionMessageStore";
import { OPEN_REFERENCED_SESSION_EVENT } from "../model/sessionReferenceEvents";
import type { InterSessionMessage } from "../model/sessionMessaging";
import { SessionReferenceSourceContext } from "./SendToSessionButton";
import {
  PendingSessionMessages,
  SessionMessagePills,
} from "./SessionMessagePills";

function message(patch: Partial<InterSessionMessage> = {}): InterSessionMessage {
  return {
    id: "m1",
    fromSessionId: "lead",
    fromTitle: "Lead",
    toSessionId: "docs",
    toTitle: "Docs",
    text: "Update the README",
    mode: "run",
    origin: "user",
    status: "delivered",
    createdAt: 1_000,
    deliveredAt: Date.UTC(2026, 9, 14, 9, 30),
    sourceBlockId: "lead-r1",
    deliveredBlockId: "docs-u1",
    hop: 0,
    ...patch,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionMessageStore.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderPills(sessionId: string, blockIds: string[]) {
  act(() =>
    root.render(
      createElement(
        SessionReferenceSourceContext.Provider,
        { value: sessionId },
        createElement(SessionMessagePills, { blockIds }),
      ),
    ),
  );
}

const pill = () =>
  container.querySelector<HTMLElement>("[data-session-message-pill]");

describe("SessionMessagePills", () => {
  it("shows an outgoing receipt that opens the receiving session", () => {
    sessionMessageStore.add(message());
    renderPills("lead", ["lead-r1"]);
    expect(pill()?.dataset.direction).toBe("outgoing");
    expect(pill()?.textContent).toContain("To “Docs”");
    expect(pill()?.textContent).toContain("Delivered");
    const opened = vi.fn();
    window.addEventListener(OPEN_REFERENCED_SESSION_EVENT, opened);
    act(() => pill()?.querySelector("button")?.click());
    window.removeEventListener(OPEN_REFERENCED_SESSION_EVENT, opened);
    expect((opened.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      sessionId: "docs",
      blockId: "docs-u1",
    });
  });

  it("shows the same message as incoming in the receiver", () => {
    sessionMessageStore.add(message({ status: "replied", repliedAt: 2_000 }));
    renderPills("docs", ["docs-u1"]);
    expect(pill()?.dataset.direction).toBe("incoming");
    expect(pill()?.textContent).toContain("From “Lead”");
    expect(pill()?.dataset.status).toBe("replied");
  });

  it("updates live and offers a retry when delivery fails", () => {
    renderPills("lead", ["lead-r1"]);
    expect(pill()).toBeNull();
    act(() =>
      sessionMessageStore.add(
        message({ status: "failed", error: "Docs didn't accept the message." }),
      ),
    );
    expect(pill()?.textContent).toContain("Not delivered");
    expect(pill()?.querySelector('[aria-label="Send again"]')).not.toBeNull();
    act(() =>
      (pill()?.querySelector('[aria-label="Dismiss"]') as HTMLElement).click(),
    );
    expect(sessionMessageStore.snapshot()).toEqual([]);
  });

  it("marks messages an agent sent", () => {
    sessionMessageStore.add(message({ origin: "agent" }));
    renderPills("lead", ["lead-r1"]);
    expect(pill()?.querySelector('[aria-label="Sent by an agent"]')).not.toBeNull();
  });
});

describe("PendingSessionMessages", () => {
  it("lists messages on their way into a session", () => {
    sessionMessageStore.add(
      message({ status: "queued", deliveredBlockId: undefined, deliveredAt: undefined }),
    );
    act(() =>
      root.render(createElement(PendingSessionMessages, { sessionId: "docs" })),
    );
    expect(pill()?.textContent).toContain("From “Lead”");
    expect(pill()?.textContent).toContain("Queued");
  });
});

describe("SessionMessagePills delivery guards", () => {
  const held = (patch: Partial<InterSessionMessage> = {}) =>
    message({
      status: "blocked",
      blockedBy: "approval",
      deliveredAt: undefined,
      deliveredBlockId: undefined,
      ...patch,
    });

  it("labels a held message and jumps to the blocked session", () => {
    sessionMessageStore.add(held());
    renderPills("lead", ["lead-r1"]);
    expect(pill()?.dataset.status).toBe("blocked");
    expect(pill()?.textContent).toContain("Waiting for approval");
    expect(pill()?.title).toContain("Held until a tool call in \"Docs\" is approved");
    const opened = vi.fn();
    window.addEventListener(OPEN_REFERENCED_SESSION_EVENT, opened);
    act(() =>
      pill()
        ?.querySelector<HTMLButtonElement>('[data-session-message-action="open-blocker"]')
        ?.click(),
    );
    window.removeEventListener(OPEN_REFERENCED_SESSION_EVENT, opened);
    expect((opened.mock.calls[0]![0] as CustomEvent).detail).toEqual({ sessionId: "docs" });
  });

  it("names a question the target is waiting on", () => {
    sessionMessageStore.add(held({ blockedBy: "question" }));
    renderPills("lead", ["lead-r1"]);
    expect(pill()?.textContent).toContain("Waiting for an answer");
    expect(
      pill()?.querySelector('[data-session-message-action="open-blocker"]')?.getAttribute(
        "aria-label",
      ),
    ).toBe("Open “Docs” to answer");
  });

  it("offers force-send for a held message and retry for a stalled one", () => {
    sessionMessageStore.add(held());
    sessionMessageStore.add(
      held({ id: "m2", status: "stalled", blockedBy: undefined, stalledAt: 5_000, sourceBlockId: "lead-r2" }),
    );
    renderPills("lead", ["lead-r1", "lead-r2"]);
    const pills = container.querySelectorAll<HTMLElement>("[data-session-message-pill]");
    expect(pills[0]?.querySelector('[data-session-message-action="force-send"]')).not.toBeNull();
    expect(pills[1]?.dataset.status).toBe("stalled");
    expect(pills[1]?.textContent).toContain("Stalled");
    expect(pills[1]?.querySelector('[data-session-message-action="retry"]')).not.toBeNull();
    expect(pills[1]?.querySelector('[data-session-message-action="force-send"]')).toBeNull();
  });

  it("lists held messages among the target's pending incoming ones", () => {
    sessionMessageStore.add(held());
    act(() => root.render(createElement(PendingSessionMessages, { sessionId: "docs" })));
    const incoming = pill();
    expect(incoming?.dataset.direction).toBe("incoming");
    expect(incoming?.textContent).toContain("Waiting for approval");
    expect(incoming?.querySelector('[data-session-message-action="open-blocker"]')).toBeNull();
    expect(incoming?.querySelector('[data-session-message-action="force-send"]')).not.toBeNull();
  });
});
