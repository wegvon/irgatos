// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("../../sessions/hooks/useFileDrop", () => ({
  useFileDrop: () => false,
}));

import { createIrgat, saveIrgatName } from "../model/irgat";
import type { GroupRunState, IrgatGroupRunner } from "../model/irgatGroupRunner";
import {
  appendIrgatGroupMessage,
  createIrgatGroup,
  findIrgatGroup,
  irgatGroupViewKey,
} from "../model/irgatGroups";
import type { Session } from "../../sessions/model/session";
import { clearComposerDraft } from "../../sessions/model/draftCache";
import { IrgatGroupView } from "./IrgatGroupView";

let stored: Map<string, string>;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  stored = new Map([["irgat:irgat-roster", "[]"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  invoke.mockReset().mockImplementation(async (command: string, args: { irgat?: string }) => {
    if (command !== "irgat_load") return undefined;
    const name = souls.get(args?.irgat ?? "") ?? "";
    return {
      id: args?.irgat,
      dir: "/a",
      soul: name ? `You are the ${name} specialist.` : null,
      soulHash: "s",
      memory: "",
      memoryHash: "m",
      memoryPath: "/a/MEMORY.md",
      topics: [],
    };
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

const souls = new Map<string, string>();

function setup(names = ["Architect", "Security", "Frontend"]) {
  const ids = names.map((name) => {
    const irgat = createIrgat();
    saveIrgatName(irgat.id, name);
    souls.set(irgat.id, name);
    return irgat.id;
  });
  const group = createIrgatGroup(ids);
  clearComposerDraft(irgatGroupViewKey(group.id));
  const idOf = (name: string) => ids[names.indexOf(name)];
  return { group, ids, idOf };
}

function fakeRunner(state: GroupRunState = { queue: [] }) {
  const runner = {
    current: state,
    subscribe: () => () => undefined,
    snapshot: () => 0,
    state: () => runner.current,
    send: vi.fn((groupId: string, text: string) =>
      appendIrgatGroupMessage(groupId, { role: "user", text }),
    ),
    ask: vi.fn(),
    stop: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    skip: vi.fn(async () => undefined),
  };
  return runner;
}

async function render(
  groupId: string,
  runner: ReturnType<typeof fakeRunner>,
  liveSeat?: Session,
  extra: Partial<Parameters<typeof IrgatGroupView>[0]> = {},
) {
  await act(async () => {
    root.render(
      createElement(IrgatGroupView, {
        groupId,
        runner: runner as unknown as IrgatGroupRunner,
        liveSeat,
        ...extra,
      }),
    );
    // Lets the members' SOUL.md roles load inside act.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const q = <T extends Element = HTMLElement>(selector: string) =>
  container.querySelector<T>(selector);
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const field = () => q<HTMLTextAreaElement>("textarea")!;
function type(text: string) {
  const input = field();
  const props = Object.entries(input).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    props.onChange({ target: input, currentTarget: input });
  });
}
function submit() {
  act(() => {
    q("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("an empty room", () => {
  it("introduces the members in reply order with their roles from SOUL.md", async () => {
    const { group } = setup();
    await render(group.id, fakeRunner());
    expect(q("h2")!.textContent).toBe("Architect + Security + Frontend");
    expect(q("[data-group-intro]")!.textContent).toContain("Everyone replies in order");
    await vi.waitFor(() =>
      expect(q("[data-group-intro]")!.textContent).toContain("You are the Security specialist."),
    );
    expect(
      all("[data-group-intro] li").map(
        (li) =>
          `${li.querySelector(".tabular-nums")!.textContent} ${li.querySelector(".font-medium")!.textContent}`,
      ),
    ).toEqual(["1 Architect", "2 Security", "3 Frontend"]);
  });

  it("says so when the room was deleted", async () => {
    await render("gone", fakeRunner());
    expect(container.textContent).toContain("This group chat was deleted.");
  });
});

describe("the transcript", () => {
  it("shows who spoke, with which model, under each reply", async () => {
    const { group, idOf } = setup();
    appendIrgatGroupMessage(group.id, { role: "user", text: "Ship it?" });
    appendIrgatGroupMessage(group.id, {
      role: "irgat",
      irgatId: idOf("Architect"),
      name: "Architect",
      harness: "claude",
      model: "sonnet",
      text: "The boundary is clean.",
    });
    appendIrgatGroupMessage(group.id, {
      role: "irgat",
      irgatId: idOf("Security"),
      name: "Security",
      harness: "codex",
      text: "Agree, but rotate keys.",
    });
    await render(group.id, fakeRunner());
    expect(q('[data-group-message="user"]')!.textContent).toBe("Ship it?");
    const replies = all('[data-group-message="irgat"]');
    expect(replies.map((row) => row.querySelector("[data-speaker]")!.textContent)).toEqual([
      "Architect",
      "Security",
    ]);
    expect(replies[0].querySelector("[data-model-pill]")!.textContent).toMatch(/Sonnet|sonnet/);
    expect(replies[1].querySelector("[data-model-pill]")!.textContent).not.toBe("");
    expect(replies[1].textContent).toContain("Agree, but rotate keys.");
  });

  it("offers Let @Name reply for a handoff nobody has answered yet", async () => {
    const { group, idOf } = setup();
    const runner = fakeRunner();
    const reply = appendIrgatGroupMessage(group.id, {
      role: "irgat",
      irgatId: idOf("Architect"),
      name: "Architect",
      text: "@Frontend how does the nav look?",
      handoffs: [idOf("Frontend")],
    });
    await render(group.id, runner);
    const chip = q<HTMLButtonElement>(`[data-let-reply="${idOf("Frontend")}"]`)!;
    expect(chip.textContent).toBe("Let @Frontend reply");
    act(() => chip.click());
    expect(runner.ask).toHaveBeenCalledWith(group.id, idOf("Frontend"), reply.id, "handoff");

    await act(async () => {
      appendIrgatGroupMessage(group.id, {
        role: "irgat",
        irgatId: idOf("Frontend"),
        name: "Frontend",
        text: "Looks good.",
        trigger: { kind: "handoff", messageId: reply.id },
      });
    });
    expect(q(`[data-let-reply="${idOf("Frontend")}"]`)).toBeNull();
    expect(all('[data-group-message="irgat"]')[1].textContent).toContain("answering @Architect");
  });

  it("asks any other member to review a reply", async () => {
    const { group, idOf } = setup();
    const runner = fakeRunner();
    const reply = appendIrgatGroupMessage(group.id, {
      role: "irgat",
      irgatId: idOf("Architect"),
      name: "Architect",
      text: "Plan A.",
    });
    await render(group.id, runner);
    const asks = all("[data-ask-review]");
    expect(asks.map((b) => b.textContent)).toEqual([
      "Ask @Security to review",
      "Ask @Frontend to review",
    ]);
    act(() => asks[0].click());
    expect(runner.ask).toHaveBeenCalledWith(group.id, idOf("Security"), reply.id, "review");
  });

  it("shows a failed turn as a notice with Retry", async () => {
    const { group, idOf } = setup();
    const runner = fakeRunner();
    const user = appendIrgatGroupMessage(group.id, { role: "user", text: "go" });
    appendIrgatGroupMessage(group.id, {
      role: "notice",
      irgatId: idOf("Security"),
      name: "Security",
      text: "",
      error: "Usage limit reached",
    });
    await render(group.id, runner);
    const notice = q('[data-group-message="notice"]')!;
    expect(notice.textContent).toContain("Security could not reply: Usage limit reached");
    act(() => notice.querySelector("button")!.click());
    expect(runner.ask).toHaveBeenCalledWith(group.id, idOf("Security"), user.id, "handoff");
  });
});

describe("a round in progress", () => {
  it("streams the speaker's reply, lists who is next, and stops", async () => {
    const { group, idOf } = setup();
    appendIrgatGroupMessage(group.id, { role: "user", text: "go" });
    const runner = fakeRunner({
      speaking: { irgatId: idOf("Architect"), seatId: "seat-1" },
      queue: [idOf("Security"), idOf("Frontend")],
    });
    const seat = {
      id: "seat-1",
      harness: "claude",
      model: "sonnet",
      busy: true,
      blocks: [
        { id: "u", role: "user", text: "prompt" },
        { id: "a", role: "assistant", text: "Streaming thoughts", streaming: true },
      ],
    } as unknown as Session;
    await render(group.id, runner, seat);
    const live = q("[data-group-live]")!;
    expect(live.querySelector("[data-speaker]")!.textContent).toBe("Architect");
    // Streaming markdown reveals the text gradually.
    expect(live.textContent).toContain("Streaming");
    expect(live.textContent).not.toContain("Getting ready");
    expect(live.textContent).toContain("Up next: @Security, @Frontend");
    act(() => [...live.querySelectorAll("button")].find((b) => b.textContent === "Stop")!.click());
    expect(runner.stop).toHaveBeenCalledWith(group.id);
    const stopRound = all("button").find((b) => b.textContent === "Stop round")!;
    act(() => stopRound.click());
    expect(runner.stop).toHaveBeenCalledTimes(2);
  });
});

describe("the header", () => {
  it("adds and removes members and switches who replies", async () => {
    const { group, ids, idOf } = setup(["Architect", "Security", "Frontend"]);
    const extra = createIrgat();
    saveIrgatName(extra.id, "Data");
    await render(group.id, fakeRunner());

    act(() => q<HTMLButtonElement>('[aria-label="Add an Irgat to the group"]')!.click());
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(option.map((b) => b.textContent)).toEqual(["Data"]);
    await act(async () => option[0].click());
    expect(findIrgatGroup(group.id)!.memberIds).toEqual([...ids, extra.id]);
    expect(q("h2")!.textContent).toBe("Architect + Security + Frontend +1");

    await act(async () =>
      q<HTMLButtonElement>('[aria-label="Remove Security from the group"]')!.click(),
    );
    expect(findIrgatGroup(group.id)!.memberIds).not.toContain(idOf("Security"));

    const pick = all('[role="radio"]').find((b) => b.textContent === "Pick or @mention")!;
    await act(async () => pick.click());
    expect(findIrgatGroup(group.id)!.mode).toBe("pick");

    const follow = q<HTMLButtonElement>('[role="switch"]')!;
    expect(follow.textContent).toBe("Follow-ups on");
    await act(async () => follow.click());
    expect(findIrgatGroup(group.id)!.autoHandoff).toBe(false);
  });

  it("never lets a room drop below two members", async () => {
    const { group } = setup(["Architect", "Security"]);
    await render(group.id, fakeRunner());
    for (const button of all('[aria-label^="Remove "]'))
      expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("sending", () => {
  it("sends to everyone in order by default, or to the picked members", async () => {
    const { group, ids, idOf } = setup();
    const runner = fakeRunner();
    await render(group.id, runner);
    expect(all("[data-reply-chip]").map((c) => c.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
      "true",
    ]);
    type("What do you all think?");
    submit();
    expect(runner.send).toHaveBeenLastCalledWith(group.id, "What do you all think?", [], ids);

    act(() => q<HTMLButtonElement>(`[data-reply-chip="${idOf("Security")}"]`)!.click());
    expect(q(`[data-reply-chip="${idOf("Security")}"]`)!.getAttribute("aria-pressed")).toBe("false");
    type("Skip security");
    submit();
    expect(runner.send).toHaveBeenLastCalledWith(group.id, "Skip security", [], [
      idOf("Architect"),
      idOf("Frontend"),
    ]);
  });

  it("follows the @mentions in the draft", async () => {
    const { group, idOf } = setup();
    await render(group.id, fakeRunner());
    type("@Frontend and @Architect, thoughts?");
    expect(q("[data-reply-chips]")!.textContent).toContain("Only mentioned reply:");
    const on = all("[data-reply-chip]").filter((c) => c.getAttribute("aria-pressed") === "true");
    expect(on.map((c) => c.getAttribute("data-reply-chip"))).toEqual([
      idOf("Architect"),
      idOf("Frontend"),
    ]);
    expect(q(`[data-reply-chip="${idOf("Frontend")}"]`)!.textContent).toBe("Frontend1");
  });

  it("holds the message when nobody would reply", async () => {
    const { group } = setup();
    const runner = fakeRunner();
    await render(group.id, runner);
    await act(async () => all('[role="radio"]').find((b) => b.textContent === "Pick or @mention")!.click());
    type("Anyone?");
    expect(container.textContent).toContain("Pick who replies above, or address someone with @.");
    submit();
    expect(runner.send).not.toHaveBeenCalled();
  });

  it("suggests members after @ and writes the picked handle", async () => {
    const { group } = setup(["Architect", "Security Bot"]);
    await render(group.id, fakeRunner());
    type("Hey @sec");
    const options = all('[data-irgat-mention-picker] [role="option"]');
    expect(options.map((o) => o.querySelector(".font-medium")!.textContent)).toEqual([
      "@SecurityBot",
    ]);
    await vi.waitFor(() =>
      expect(options[0].textContent).toContain("You are the Security Bot specialist."),
    );
    act(() => options[0].click());
    expect(field().value).toBe("Hey @SecurityBot ");
    expect(q("[data-irgat-mention-picker]")).toBeNull();
  });

  it("picks a suggestion with the keyboard", async () => {
    const { group } = setup();
    await render(group.id, fakeRunner());
    type("@");
    expect(all('[data-irgat-mention-picker] [role="option"]')).toHaveLength(3);
    act(() => {
      field().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    act(() => {
      field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(field().value).toBe("@Security ");
  });
});

describe("the status bar", () => {
  const seat = (patch: Partial<Session> = {}) =>
    ({
      id: "seat-1",
      harness: "claude",
      model: "sonnet",
      busy: true,
      blocks: [{ id: "u", role: "user", text: "prompt" }],
      ...patch,
    }) as unknown as Session;

  it("says who waits on an approval and jumps to it", async () => {
    const { group, idOf } = setup();
    appendIrgatGroupMessage(group.id, { role: "user", text: "go" });
    const runner = fakeRunner({
      speaking: { irgatId: idOf("Architect"), seatId: "seat-1" },
      queue: [idOf("Security"), idOf("Frontend")],
      hold: { kind: "blocked", reason: "approval", irgatId: idOf("Architect"), seatId: "seat-1" },
    });
    const onApproval = vi.fn();
    await render(
      group.id,
      runner,
      seat({
        blocks: [
          { id: "u", role: "user", text: "prompt" },
          {
            id: "t",
            role: "tool",
            text: "",
            tool: { title: "run npm test" },
            approval: { requestId: 3 },
          },
        ],
      }),
      { onApproval },
    );
    const bar = q('[data-group-status="blocked"]')!;
    expect(bar.dataset.groupBlockedBy).toBe("approval");
    expect(bar.textContent).toContain("Architect is waiting for your approval to run npm test.");
    expect(bar.textContent).toContain("2 replies wait behind it.");
    const jump = bar.querySelector<HTMLButtonElement>('[data-group-status-action="jump"]')!;
    expect(jump.textContent).toBe("Review");
    act(() => jump.click());
    expect(document.activeElement?.textContent).toBe("Allow");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(onApproval).toHaveBeenCalledWith("seat-1", 3, "allow");
  });

  it("answers a question the speaker asked, right in the room", async () => {
    const { group, idOf } = setup();
    const runner = fakeRunner({
      speaking: { irgatId: idOf("Security"), seatId: "seat-1" },
      queue: [],
      hold: { kind: "blocked", reason: "question", irgatId: idOf("Security"), seatId: "seat-1" },
    });
    await render(
      group.id,
      runner,
      seat({
        pendingQuestion: {
          requestId: 8,
          questions: [
            {
              id: "q1",
              header: "Scope",
              prompt: "Audit only the API?",
              multiSelect: false,
              allowCustom: false,
              options: [
                { id: "o1", label: "Yes" },
                { id: "o2", label: "No" },
              ],
            },
          ],
        } as unknown as Session["pendingQuestion"],
      }),
    );
    const bar = q('[data-group-status="blocked"]')!;
    expect(bar.textContent).toContain("Security asked you a question.");
    expect(bar.querySelector('[data-group-status-action="jump"]')!.textContent).toBe("Answer");
    expect(q("[data-group-question]")!.textContent).toContain("Audit only the API?");
  });

  it("offers retry and skip for a stalled speaker", async () => {
    const { group, idOf } = setup();
    const runner = fakeRunner({
      speaking: { irgatId: idOf("Frontend"), seatId: "seat-1" },
      queue: [idOf("Architect")],
      hold: { kind: "stalled", irgatId: idOf("Frontend"), seatId: "seat-1", since: Date.UTC(2026, 9, 14, 9, 5) },
    });
    await render(group.id, runner, seat());
    const bar = q('[data-group-status="stalled"]')!;
    expect(bar.textContent).toContain("Frontend has shown no progress since");
    expect(bar.textContent).toContain("One reply waits behind it.");
    act(() => bar.querySelector<HTMLButtonElement>('[data-group-status-action="retry"]')!.click());
    expect(runner.retry).toHaveBeenCalledWith(group.id);
    act(() => bar.querySelector<HTMLButtonElement>('[data-group-status-action="skip"]')!.click());
    expect(runner.skip).toHaveBeenCalledWith(group.id);
  });

  it("stays hidden while the room moves", async () => {
    const { group, idOf } = setup();
    await render(
      group.id,
      fakeRunner({ speaking: { irgatId: idOf("Architect"), seatId: "seat-1" }, queue: [] }),
      seat(),
    );
    expect(q("[data-group-status]")).toBeNull();
  });
});
