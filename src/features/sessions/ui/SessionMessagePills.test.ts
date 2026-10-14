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
