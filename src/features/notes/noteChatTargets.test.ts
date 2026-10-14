import { describe, expect, it } from "vitest";
import type { Session } from "../sessions/model/session";
import type { LayoutNode } from "../workspace/model/layout";
import { noteChatPlacement, openNoteChatTargets } from "./noteChatTargets";

type TargetSession = Parameters<
  typeof openNoteChatTargets
>[0]["sessions"][number];

function session(
  id: string,
  partial: Partial<TargetSession> = {},
): TargetSession {
  return {
    id,
    title: `claude · ${id}`,
    harness: "claude",
    model: "Opus 4.7",
    cwd: "/work/Edefyn",
    ...partial,
  };
}

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });
const split = (...ids: string[]): LayoutNode => ({
  type: "split",
  id: `split-${ids.join("-")}`,
  dir: "right",
  children: ids.map(leaf),
  sizes: ids.map(() => 1 / ids.length),
});

describe("openNoteChatTargets", () => {
  it("puts the focused pane of the active tab first, then its other panes, then other tabs", () => {
    const targets = openNoteChatTargets({
      sessions: [
        session("left"),
        session("right", {
          harness: "codex",
          model: "GPT-5.5",
          title: "Fix login",
        }),
        session("other", { cwd: "/work/portognjeeen" }),
      ],
      tabs: [
        { id: "tab-other", layout: leaf("other"), focusedId: "other" },
        { id: "tab-split", layout: split("left", "right"), focusedId: "right" },
      ],
      activeTabId: "tab-split",
    });

    expect(targets.map((target) => target.sessionId)).toEqual([
      "right",
      "left",
      "other",
    ]);
    expect(targets[0]).toEqual({
      sessionId: "right",
      title: "Fix login",
      harness: "codex",
      model: "GPT-5.5",
      project: "Edefyn",
      irgat: false,
      current: true,
    });
    expect(targets[1]).toMatchObject({ title: "left", current: false });
    expect(targets[2]).toMatchObject({
      project: "portognjeeen",
      current: false,
    });
  });

  it("leads with the Irgat in full view under its own name", () => {
    const targets = openNoteChatTargets({
      sessions: [session("chat", { title: "claude" }), session("tab")],
      tabs: [{ id: "t", layout: leaf("tab"), focusedId: "tab" }],
      activeTabId: "t",
      irgat: { sessionId: "chat", name: "Captain" },
    });

    expect(
      targets.map((target) => [
        target.sessionId,
        target.title,
        target.irgat,
        target.current,
      ]),
    ).toEqual([
      ["chat", "Captain", true, true],
      ["tab", "tab", false, false],
    ]);
  });

  it("falls back to the chat's title when the Irgat has no name yet", () => {
    const [target] = openNoteChatTargets({
      sessions: [session("chat", { title: "claude" })],
      tabs: [],
      activeTabId: "",
      irgat: { sessionId: "chat", name: "  " },
    });

    expect(target).toMatchObject({ title: "New session", irgat: true });
  });

  it("skips inbox asks, orchestration workers, editor panes and repeats", () => {
    const targets = openNoteChatTargets({
      sessions: [
        session("main"),
        session("ask", { inboxAsk: {} as Session["inboxAsk"] }),
        session("worker", { orchestrationLeadId: "main" }),
        session("home", { cwd: "~" }),
      ],
      tabs: [
        {
          id: "a",
          layout: split("main", "editor-pane", "ask"),
          focusedId: "main",
        },
        {
          id: "b",
          layout: split("worker", "main", "home"),
          focusedId: "worker",
        },
      ],
      activeTabId: "missing",
    });

    expect(targets.map((target) => target.sessionId)).toEqual(["main", "home"]);
    expect(targets[1]!.project).toBeNull();
  });

  it("is empty with nothing open", () => {
    expect(
      openNoteChatTargets({ sessions: [], tabs: [], activeTabId: "" }),
    ).toEqual([]);
  });
});

describe("noteChatPlacement", () => {
  const card = { id: "note-1" };

  it("uses the composer's note card slot when it is free or holds this note", () => {
    expect(noteChatPlacement({}, card, false)).toBe("card");
    expect(noteChatPlacement({ noteCard: { id: "note-1" } }, card, false)).toBe(
      "card",
    );
  });

  it("appends to the draft when the slot holds another note", () => {
    expect(noteChatPlacement({ noteCard: { id: "note-2" } }, card, false)).toBe(
      "text",
    );
  });

  it("always appends to an Irgat's chat box, which has no card slot", () => {
    expect(noteChatPlacement({}, card, true)).toBe("text");
  });
});
