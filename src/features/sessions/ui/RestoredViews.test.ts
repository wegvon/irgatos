// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "../model/session";
import { OPEN_REFERENCED_SESSION_EVENT } from "../model/sessionReferenceEvents";
import { AgentTabView } from "./AgentTabView";
import {
  ArtifactSurface,
  restoreArtifact,
} from "../../artifacts/ui/ArtifactSurface";
import { getRegisteredArtifact } from "../../artifacts/model/artifactRegistry";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) =>
    command === "notes_list" ? [] : null,
  ),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function opened(): string[] {
  const ids: string[] = [];
  window.addEventListener(OPEN_REFERENCED_SESSION_EVENT, (event) => {
    ids.push((event as CustomEvent<{ sessionId: string }>).detail.sessionId);
  });
  return ids;
}

const worker: Session = {
  ...newSession("codex", "/project"),
  id: "worker",
  blocks: [{ id: "p", role: "user", text: "Audit the engine" }],
};

describe("restored worker views", () => {
  it("say the transcript is saved and the agent is not running", () => {
    act(() =>
      root.render(
        createElement(AgentTabView, {
          title: "Audit",
          session: worker,
          visible: true,
          leadId: "lead",
          restored: true,
        }),
      ),
    );
    const banner = container.querySelector("[data-restored-view]");
    expect(banner?.textContent).toContain("The agent is not running");
    expect(container.textContent).toContain("Saved transcript · not running");
    const ids = opened();
    act(() => banner?.querySelector("button")?.click());
    expect(ids).toEqual(["lead"]);
  });

  it("look live again once the orchestrator resumes the worker", () => {
    act(() =>
      root.render(
        createElement(AgentTabView, {
          title: "Audit",
          session: { ...worker, busy: true },
          visible: true,
          leadId: "lead",
          restored: true,
        }),
      ),
    );
    expect(container.querySelector("[data-restored-view]")).toBeNull();
    expect(container.textContent).toContain("Run by the orchestrator");
  });

  it("explain a missing transcript and link to the orchestrator", () => {
    act(() =>
      root.render(
        createElement(AgentTabView, {
          title: "Audit",
          visible: true,
          leadId: "lead",
          restored: true,
        }),
      ),
    );
    expect(container.textContent).toContain("could not be found");
    const ids = opened();
    act(() => container.querySelector("button")?.click());
    expect(ids).toEqual(["lead"]);
  });
});

describe("restored artifact views", () => {
  const source = {
    id: "snippet:chat:missing",
    title: "Landing page",
    fileName: "landing.html",
    sessionId: "chat",
    sessionTitle: "Build the landing page",
  };

  it("read the artifact back from its stored conversation", async () => {
    const chat: Session = {
      ...newSession("claude", "/project"),
      id: "chat",
      title: "Build the landing page",
      blocks: [
        {
          id: "a1",
          role: "assistant",
          text: "```html title=landing.html\n" +
            Array.from({ length: 12 }, (_, i) => `<p>${i}</p>`).join("\n") +
            "\n```",
        },
      ],
    };
    const load = vi.fn(async () => chat);
    // An id that the conversation does not produce stays missing.
    expect(await restoreArtifact(source, load)).toBe(false);
    expect(load).toHaveBeenCalledWith("chat");
    expect(await restoreArtifact({ ...source, sessionId: undefined }, load)).toBe(
      false,
    );
  });

  it("finds an artifact the stored conversation does make", async () => {
    const chat: Session = {
      ...newSession("claude", "/project"),
      id: "chat-2",
      title: "Build",
      blocks: [
        {
          id: "a1",
          role: "assistant",
          text: "```ts\n" +
            Array.from({ length: 12 }, (_, i) => `const v${i} = ${i};`).join("\n") +
            "\n```",
        },
      ],
    };
    const { sessionArtifacts } = await import("../../artifacts/hooks/useArtifacts");
    const id = sessionArtifacts(chat)[0]?.id;
    expect(id).toBeTruthy();
    const found = await restoreArtifact(
      { id: id!, title: "Snippet", fileName: "x.ts", sessionId: "chat-2" },
      async () => chat,
    );
    expect(found).toBe(true);
    expect(getRegisteredArtifact(id!)).toBeTruthy();
  });

  it("explain why it could not come back and link to its conversation", async () => {
    await act(async () => {
      root.render(createElement(ArtifactSurface, { source, restored: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("could not be restored here");
    const button = container.querySelector<HTMLButtonElement>(
      "[data-open-artifact-conversation]",
    );
    expect(button?.textContent).toBe("Open “Build the landing page”");
    const ids = opened();
    act(() => button?.click());
    expect(ids).toEqual(["chat"]);
  });
});
