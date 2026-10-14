// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIrgat, removeIrgat, saveIrgatName } from "./irgat";
import {
  addIrgatGroupMember,
  appendIrgatGroupMessage,
  autoGroupName,
  createIrgatGroup,
  findIrgatGroup,
  GROUP_TRANSCRIPT_LIMIT,
  groupMembers,
  irgatGroupName,
  irgatGroupOfView,
  irgatGroupViewKey,
  listIrgatGroups,
  loadIrgatGroupMessages,
  removeIrgatGroup,
  removeIrgatGroupMember,
  renameIrgatGroup,
  subscribeIrgatGroups,
  updateIrgatGroup,
  updateIrgatGroupMessage,
} from "./irgatGroups";

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  // The roster's legacy migration reads these; there is nothing to move.
  stored.set("irgat:irgat-roster", "[]");
});
afterEach(() => vi.unstubAllGlobals());

function three() {
  const architect = createIrgat();
  saveIrgatName(architect.id, "Architect");
  const security = createIrgat();
  saveIrgatName(security.id, "Security");
  const frontend = createIrgat();
  saveIrgatName(frontend.id, "Frontend");
  return { architect, security, frontend };
}

describe("creating a group room", () => {
  it("takes two or more Irgats, once each, in the order picked", () => {
    const { architect, security, frontend } = three();
    const group = createIrgatGroup(
      [security.id, architect.id, security.id, frontend.id],
      "  Launch review  ",
      1000,
    );
    expect(group).toMatchObject({
      name: "Launch review",
      memberIds: [security.id, architect.id, frontend.id],
      mode: "round",
      autoHandoff: true,
      createdAt: 1000,
    });
    expect(listIrgatGroups()).toEqual([group]);
    expect(findIrgatGroup(group.id)).toEqual(group);
  });

  it("refuses a room of one", () => {
    const { architect } = three();
    expect(() => createIrgatGroup([architect.id, architect.id])).toThrow(
      /at least two/,
    );
    expect(listIrgatGroups()).toEqual([]);
  });

  it("names itself after its members until the user names it", () => {
    const { architect, security, frontend } = three();
    const group = createIrgatGroup([architect.id, security.id, frontend.id]);
    expect(group.name).toBeUndefined();
    expect(irgatGroupName(group)).toBe("Architect + Security + Frontend");
    renameIrgatGroup(group.id, "Platform");
    expect(irgatGroupName(findIrgatGroup(group.id)!)).toBe("Platform");
    renameIrgatGroup(group.id, "   ");
    expect(findIrgatGroup(group.id)!.name).toBeUndefined();
    expect(autoGroupName(["A", "B", "C", "D", "E"])).toBe("A + B + C +2");
    expect(autoGroupName([])).toBe("Group chat");
  });

  it("survives a restart: everything lives in storage", () => {
    const { architect, security } = three();
    const group = createIrgatGroup([architect.id, security.id]);
    appendIrgatGroupMessage(group.id, { role: "user", text: "hello room" });
    const saved = new Map(stored);
    stored.clear();
    for (const [key, value] of saved) stored.set(key, value);
    expect(findIrgatGroup(group.id)?.memberIds).toEqual([
      architect.id,
      security.id,
    ]);
    expect(loadIrgatGroupMessages(group.id).map((m) => m.text)).toEqual([
      "hello room",
    ]);
  });

  it("ignores corrupt entries", () => {
    stored.set("irgat:irgat-groups", '[{"id":"../x"},{"id":"ok","memberIds":["a",3,"a"],"mode":"weird"}]');
    expect(listIrgatGroups()).toEqual([
      { id: "ok", memberIds: ["a"], mode: "round", autoHandoff: true, createdAt: 0 },
    ]);
  });
});

describe("membership", () => {
  it("adds and removes members from the header at any time", () => {
    const { architect, security, frontend } = three();
    const group = createIrgatGroup([architect.id, security.id]);
    const changes = vi.fn();
    const stop = subscribeIrgatGroups(changes);
    addIrgatGroupMember(group.id, frontend.id);
    addIrgatGroupMember(group.id, frontend.id);
    expect(findIrgatGroup(group.id)!.memberIds).toEqual([
      architect.id,
      security.id,
      frontend.id,
    ]);
    removeIrgatGroupMember(group.id, architect.id);
    expect(findIrgatGroup(group.id)!.memberIds).toEqual([
      security.id,
      frontend.id,
    ]);
    expect(changes).toHaveBeenCalledTimes(3);
    stop();
  });

  it("drops a deleted Irgat from the room without forgetting what it said", () => {
    const { architect, security, frontend } = three();
    const group = createIrgatGroup([architect.id, security.id, frontend.id]);
    appendIrgatGroupMessage(group.id, {
      role: "irgat",
      irgatId: security.id,
      name: "Security",
      text: "Rotate the keys.",
    });
    removeIrgat(security.id);
    expect(groupMembers(findIrgatGroup(group.id)!).map((m) => m.id)).toEqual([
      architect.id,
      frontend.id,
    ]);
    expect(loadIrgatGroupMessages(group.id)[0]).toMatchObject({
      name: "Security",
      text: "Rotate the keys.",
    });
  });

  it("switches who replies and whether replies hand off", () => {
    const { architect, security } = three();
    const group = createIrgatGroup([architect.id, security.id]);
    updateIrgatGroup(group.id, (g) => ({ ...g, mode: "pick", autoHandoff: false }));
    expect(findIrgatGroup(group.id)).toMatchObject({ mode: "pick", autoHandoff: false });
  });
});

describe("the shared transcript", () => {
  it("appends and updates labeled messages, keeping attachments by path only", () => {
    const { architect, security } = three();
    const group = createIrgatGroup([architect.id, security.id]);
    const user = appendIrgatGroupMessage(group.id, {
      role: "user",
      text: "Review this",
      attachments: [
        {
          id: "f",
          name: "plan.md",
          kind: "file",
          mimeType: "text/markdown",
          size: 4,
          path: "/w/plan.md",
          data: "AAAA",
          previewUrl: "blob:x",
        },
      ],
    });
    expect(loadIrgatGroupMessages(group.id)[0].attachments).toEqual([
      { id: "f", name: "plan.md", kind: "file", mimeType: "text/markdown", size: 4, path: "/w/plan.md" },
    ]);
    updateIrgatGroupMessage(group.id, user.id, (m) => ({ ...m, text: "Review this plan" }));
    expect(loadIrgatGroupMessages(group.id)[0].text).toBe("Review this plan");
  });

  it("keeps only the newest messages", () => {
    const { architect, security } = three();
    const group = createIrgatGroup([architect.id, security.id]);
    for (let i = 0; i < GROUP_TRANSCRIPT_LIMIT + 5; i++)
      appendIrgatGroupMessage(group.id, { role: "user", text: `m${i}` });
    const messages = loadIrgatGroupMessages(group.id);
    expect(messages).toHaveLength(GROUP_TRANSCRIPT_LIMIT);
    expect(messages[0].text).toBe("m5");
  });

  it("deleting the room deletes its transcript, not its members", () => {
    const { architect, security } = three();
    const group = createIrgatGroup([architect.id, security.id]);
    appendIrgatGroupMessage(group.id, { role: "user", text: "bye" });
    removeIrgatGroup(group.id);
    expect(findIrgatGroup(group.id)).toBeUndefined();
    expect(loadIrgatGroupMessages(group.id)).toEqual([]);
    expect(groupMembers({ memberIds: [architect.id, security.id] })).toHaveLength(2);
  });
});

it("opens in the view slot under a key that is never a session id", () => {
  const key = irgatGroupViewKey("abc-1");
  expect(irgatGroupOfView(key)).toBe("abc-1");
  expect(irgatGroupOfView("6f2b3c1a-session")).toBeUndefined();
  expect(irgatGroupOfView(null)).toBeUndefined();
});
