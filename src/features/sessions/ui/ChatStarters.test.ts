// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStarters } from "./ChatStarters";
import { CHAT_STARTERS } from "../model/chatStarters";
import {
  clearComposerDraft,
  getComposerDraft,
  setComposerDraft,
} from "../model/draftCache";
import {
  INSERT_SESSION_MESSAGE_EVENT,
  type InsertSessionMessageRequest,
} from "../model/sessionReferenceEvents";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ChatStarters, { sessionId: "s1" })));
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  clearComposerDraft("s1");
  vi.unstubAllGlobals();
});

describe("ChatStarters", () => {
  it("shows the three starters and the file access hint", () => {
    const view = mount();
    const labels = [...view.host.querySelectorAll("button")].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(CHAT_STARTERS.map((starter) => starter.label));
    expect(view.host.textContent).toContain(
      "The agent can read files in your selected project as needed. Use @ to reference a specific file.",
    );
    view.unmount();
  });

  it("fills the mounted composer with an editable draft and focuses it", () => {
    const seen: InsertSessionMessageRequest[] = [];
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<InsertSessionMessageRequest>).detail;
      seen.push({ ...detail });
      detail.handled = true;
    };
    window.addEventListener(INSERT_SESSION_MESSAGE_EVENT, listen);
    const view = mount();
    act(() =>
      view.host
        .querySelector<HTMLButtonElement>('[data-chat-starter="fix"]')!
        .click(),
    );
    window.removeEventListener(INSERT_SESSION_MESSAGE_EVENT, listen);
    expect(seen).toEqual([
      {
        targetSessionId: "s1",
        text: CHAT_STARTERS[1].draft,
        replace: true,
        focus: true,
      },
    ]);
    view.unmount();
  });

  it("keeps the user's own text when no composer is mounted", () => {
    setComposerDraft("s1", "Check the export");
    const view = mount();
    act(() =>
      view.host
        .querySelector<HTMLButtonElement>('[data-chat-starter="build"]')!
        .click(),
    );
    expect(getComposerDraft("s1")).toBe(
      `Check the export\n\n${CHAT_STARTERS[2].draft}`,
    );
    view.unmount();
  });
});
