// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionPane, type SessionPaneProps } from "./SessionPane";
import { clearComposerDraft } from "../model/draftCache";
import type { Block } from "../model/session";

const probes = vi.hoisted(() => ({
  pick: vi.fn(),
  transcript: vi.fn(),
  runs: [],
  childIds: ["chat"] as string[],
  title: vi.fn(),
}));
vi.mock("../../../integrations/harness", async (original) => ({
  ...(await original<typeof import("../../../integrations/harness")>()),
  generateHarnessTitle: probes.title,
}));
vi.mock("./Composer", () => ({ Composer: () => null }));
vi.mock("../hooks/useFileDrop", () => ({ useFileDrop: () => false }));
vi.mock("../model/attachments", async (original) => ({
  ...(await original<typeof import("../model/attachments")>()),
  pickAttachments: probes.pick,
}));
vi.mock("./AgentTranscript", () => ({
  AgentTranscript: (props: { onAddToChat: (text: string) => void }) => {
    probes.transcript(props);
    return createElement(
      "button",
      { onClick: () => props.onAddToChat("Selected response") },
      "Quote response",
    );
  },
}));
vi.mock("../../orchestration/model/orchestration", async (original) => ({
  ...(await original<
    typeof import("../../orchestration/model/orchestration")
  >()),
  orchestrator: {
    subscribe: () => () => {},
    snapshot: () => probes.runs,
    hydrate: async () => {},
  },
}));
vi.mock("../../irgats/model/irgat", async (original) => ({
  ...(await original<typeof import("../../irgats/model/irgat")>()),
  irgatForSession: () => ({
    id: "irgat",
    sessionId: "main",
    childSessionIds: probes.childIds,
    name: "Captain",
    mascot: "cat",
    color: "#6ba",
    projects: [],
  }),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  localStorage.clear();
  probes.transcript.mockClear();
  probes.childIds = ["chat"];
  probes.title.mockReset().mockResolvedValue(null);
  clearComposerDraft("chat");
  probes.pick.mockReset().mockResolvedValue([
    {
      id: "file",
      name: "note.txt",
      kind: "file",
      mimeType: "text/plain",
      size: 12,
      path: "/tmp/note.txt",
    },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearComposerDraft("chat");
  vi.unstubAllGlobals();
});
const noop = () => {};
const TWO_TURNS: Block[] = [
  { id: "u1", role: "user", text: "Fix the mail undo button" },
  { id: "a1", role: "assistant", text: "Done." },
  { id: "u2", role: "user", text: "And the archive one" },
  { id: "a2", role: "assistant", text: "Done too." },
];
function props(): SessionPaneProps {
  return {
    session: {
      id: "chat",
      title: "Chat 2",
      cwd: "/repo",
      harness: "codex",
      model: "",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: TWO_TURNS,
    },
    visible: true,
    focused: true,
    inSplit: false,
    composerFocused: false,
    recents: [],
    onFocus: noop,
    onClose: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: noop,
    onSaveDraft: noop,
    onRemoveDraft: noop,
    onStop: noop,
    onCompactContext: () => false,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onUsageLimitResume: noop,
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
  };
}
function render(pane: SessionPaneProps) {
  act(() => root.render(createElement(SessionPane, pane)));
}
const prompt = () => container.querySelector("[data-chat-name-prompt]");
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  )!;

it("asks to name a new Irgat chat after its second turn and renames it", async () => {
  const pane = props();
  pane.onRenameChat = vi.fn();
  render({
    ...pane,
    session: { ...pane.session, blocks: TWO_TURNS.slice(0, 2) },
  });
  expect(prompt()).toBeNull();
  render(pane);
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Chat name"]')!
      .value,
  ).toBe("Fix the mail undo button");
  await act(async () => button("Save").click());
  expect(pane.onRenameChat).toHaveBeenCalledWith(
    "chat",
    "Fix the mail undo button",
  );
  expect(prompt()).toBeNull();
});

it("stays until answered, even while the next reply runs", () => {
  const pane = props();
  pane.onRenameChat = vi.fn();
  render(pane);
  render({ ...pane, session: { ...pane.session, busy: true } });
  expect(prompt()).not.toBeNull();
});

it("never asks again once put off", async () => {
  const pane = props();
  pane.onRenameChat = vi.fn();
  render(pane);
  await act(async () => button("Later").click());
  expect(prompt()).toBeNull();
  act(() => root.unmount());
  root = createRoot(container);
  render(pane);
  expect(prompt()).toBeNull();
});

it("leaves named chats and the Irgat's own conversation alone", () => {
  const pane = props();
  pane.onRenameChat = vi.fn();
  render({ ...pane, session: { ...pane.session, title: "Codex · Mail" } });
  expect(prompt()).toBeNull();
  probes.childIds = [];
  render({ ...pane, session: { ...pane.session, id: "main" } });
  expect(prompt()).toBeNull();
});
