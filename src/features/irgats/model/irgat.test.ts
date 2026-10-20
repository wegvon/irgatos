import { expect, it } from "vitest";
import {
  defaultIrgatName,
  hiddenFromSidebar,
  irgatMessagePage,
  irgatMessages,
  irgatReply,
  irgatState,
} from "./irgat";
import type { Block } from "../../sessions/model/session";
import type { Irgat } from "./irgat";

it("brings back a hidden session once its Irgat shows started sessions", () => {
  const irgat = (showStartedSessionsInSidebar?: boolean): Irgat => ({
    id: "local",
    sessionId: "irgat-main",
    childSessionIds: ["irgat-chat"],
    mascot: "owl",
    color: "#000",
    projects: [],
    ...(showStartedSessionsInSidebar === undefined
      ? {}
      : { showStartedSessionsInSidebar }),
  });
  const started = { id: "app-irgat-main-core-server", sidebarHidden: true };
  const fromChat = { id: "app-irgat-chat-req", sidebarHidden: true };
  expect(hiddenFromSidebar(started, [irgat()])).toBe(false);
  expect(hiddenFromSidebar(fromChat, [irgat(true)])).toBe(false);
  expect(hiddenFromSidebar(started, [irgat(false)])).toBe(true);
  // Nobody left to ask: the saved flag stands.
  expect(hiddenFromSidebar(started, [])).toBe(true);
  expect(hiddenFromSidebar({ id: "app-irgat-main-x" }, [irgat(false)])).toBe(false);
});

it("is idle between turns", () => {
  expect(irgatState({ blocks: [], busy: false })).toEqual({
    status: "idle",
  });
});

it("needs the user when a provider usage limit stops the conversation", () => {
  expect(irgatState({ blocks: [], busy: false, usageLimit: { resetsAt: 1000 } }))
    .toEqual({ status: "needs-you", activity: "Usage limit reached" });
  expect(irgatState({ blocks: [], busy: false, worktreeRemoved: true, usageLimit: {} }))
    .toEqual({ status: "idle" });
});

it("names the step it is on while working", () => {
  expect(
    irgatState({
      busy: true,
      blocks: [
        {
          id: "1",
          role: "assistant",
          text: "",
          tool: { title: "Read old.ts" },
        },
        { id: "2", role: "user", text: "check CI" },
        {
          id: "3",
          role: "assistant",
          text: "",
          tool: { title: "Bash: `gh pr checks`" },
        },
      ],
    }),
  ).toEqual({ status: "working", activity: "Bash: gh pr checks" });
});

it("is thinking before the current turn has a step", () => {
  expect(
    irgatState({
      busy: true,
      blocks: [
        {
          id: "1",
          role: "assistant",
          text: "",
          tool: { title: "Read old.ts" },
        },
        { id: "2", role: "user", text: "check CI" },
      ],
    }),
  ).toEqual({ status: "working", activity: "Thinking" });
});

it("says what it needs from you", () => {
  expect(
    irgatState({
      busy: true,
      blocks: [
        {
          id: "1",
          role: "assistant",
          text: "",
          tool: { title: "git push" },
          approval: { requestId: 1 },
        },
      ],
    }),
  ).toEqual({ status: "needs-you", activity: "Approve git push" });
});

it("is idle when no turn is running", () => {
  expect(irgatState({ blocks: [], busy: false })).toEqual({
    status: "idle",
  });
});

it("reports the current turn's step while working", () => {
  expect(
    irgatState({
      busy: true,
      blocks: [
        { id: "0", role: "assistant", text: "", tool: { title: "Old step" } },
        { id: "1", role: "user", text: "check CI" },
        {
          id: "2",
          role: "assistant",
          text: "",
          tool: { title: "`gh pr checks 688`" },
        },
      ],
    }),
  ).toEqual({ status: "working", activity: "gh pr checks 688" });
  expect(
    irgatState({
      busy: true,
      blocks: [
        { id: "0", role: "assistant", text: "", tool: { title: "Old step" } },
        { id: "1", role: "user", text: "hi" },
      ],
    }),
  ).toEqual({ status: "working", activity: "Thinking" });
});

it("says what it needs from you", () => {
  expect(
    irgatState({
      busy: true,
      blocks: [
        {
          id: "1",
          role: "assistant",
          text: "",
          tool: { title: "git push" },
          approval: { requestId: 1 },
        },
      ],
    }),
  ).toEqual({ status: "needs-you", activity: "Approve git push" });
});

it("names an unnamed Irgat after its mascot", () => {
  expect(defaultIrgatName("crab")).toBe("IrgatCrab");
  expect(defaultIrgatName("mushroom")).toBe("IrgatShroom");
});
