// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  announceSessionFinished,
  notifyHabitApproval,
  notifySession,
  retireDecisionNotification,
  saveNotificationsEnabled,
  setWindowFocused,
} from "./notifications";
import { updateNotificationPreferences } from "./notificationPreferences";
import { newSession } from "../../sessions/model/session";
import { createIrgat, saveIrgatSessionId } from "../../irgats/model/irgat";

const { invoke, play } = vi.hoisted(() => ({ invoke: vi.fn(), play: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("cuelume", () => ({ play, setEnabled: vi.fn(), setVolume: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  play.mockClear();
  invoke.mockResolvedValue(undefined);
  saveNotificationsEnabled(true);
  setWindowFocused(false);
});

it("returns false without a banner or sound for a non-project path", async () => {
  const sent = await notifySession(
    newSession("claude", "/"),
    "finished",
    false,
  );

  expect(sent).toBe(false);
  expect(
    invoke.mock.calls.filter(([command]) => command === "show_notification"),
  ).toEqual([]);
  expect(play).not.toHaveBeenCalled();
});

it("finishes without a banner or sound for a non-project path", async () => {
  await expect(
    announceSessionFinished(
      newSession("claude", "/"),
      false,
    ),
  ).resolves.toBeUndefined();

  expect(
    invoke.mock.calls.filter(([command]) => command === "show_notification"),
  ).toEqual([]);
  expect(play).not.toHaveBeenCalled();
});

it("blocks every project banner, including approvals and questions, while muted", async () => {
  updateNotificationPreferences(["local:/private"], {
    mutedUntil: null,
  });
  const session = newSession("claude", "/private");
  expect(await notifySession(session, "finished", false)).toBe(false);
  expect(
    await notifySession(session, { kind: "approval", requestId: 1 }, false),
  ).toBe(false);
  expect(
    await notifySession(session, { kind: "question", requestId: 2 }, false),
  ).toBe(false);
  expect(
    invoke.mock.calls.filter(([command]) => command === "show_notification"),
  ).toEqual([]);
});

it("does not deliver an input event observed during a mute after expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  try {
    updateNotificationPreferences(["local:/private"], {
      mutedUntil: 2000,
    });
    const sent = notifySession(
      newSession("claude", "/private"),
      { kind: "question", requestId: 1 },
      false,
    );
    vi.setSystemTime(3000);
    expect(await sent).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("pushes to subscribed devices while the Mac is not looking at the chat", async () => {
  const session = newSession("claude", "/work/app");
  await notifySession(session, "finished", false);
  const pushes = invoke.mock.calls.filter(
    ([command]) => command === "web_push_send",
  );
  expect(pushes).toHaveLength(1);
  expect(pushes[0][1]).toMatchObject({
    url: `/#/chat/${session.id}`,
    tag: session.id,
  });
});

it("does not push the chat the Mac is showing", async () => {
  setWindowFocused(true);
  await notifySession(newSession("claude", "/work/app"), "finished", true);
  expect(
    invoke.mock.calls.filter(([command]) => command === "web_push_send"),
  ).toEqual([]);
});

it("tags a decision banner with its request and takes it back once settled", async () => {
  const session = newSession("claude", "/work/app");
  session.title = "Fix login";
  session.blocks = [
    {
      id: "p1",
      role: "tool",
      text: "Run npm test",
      tool: { title: "Run npm test" },
      approval: { requestId: 7 },
    },
  ];
  expect(
    await notifySession(session, { kind: "approval", requestId: 7 }, false),
  ).toBe(true);
  const tag = `decision:${session.id}:approval:7`;
  expect(
    invoke.mock.calls.find(([command]) => command === "show_notification")?.[1],
  ).toMatchObject({
    title: "app › Fix login",
    subtitle: "Waiting for your answer",
    body: "Approve: Run npm test",
    tag,
  });
  expect(
    invoke.mock.calls.find(([command]) => command === "web_push_send")?.[1],
  ).toMatchObject({
    title: "app › Fix login",
    body: "Waiting for your answer · Approve: Run npm test",
    tag,
    retire: [],
  });

  retireDecisionNotification(tag);
  expect(invoke).toHaveBeenCalledWith("retire_notification", { tag });
  // The phone hears about it with the next push, which shows a banner anyway.
  invoke.mockClear();
  await notifySession(session, "finished", false);
  expect(
    invoke.mock.calls.find(([command]) => command === "web_push_send")?.[1],
  ).toMatchObject({ retire: [tag] });
});

it("marks a deferred request's second banner as a reminder", async () => {
  const session = newSession("claude", "/work/app");
  session.blocks = [
    { id: "p1", role: "tool", text: "Deploy", approval: { requestId: 1 } },
  ];
  await notifySession(session, { kind: "approval", requestId: 1 }, false, {
    reminder: true,
  });
  expect(
    invoke.mock.calls.find(([command]) => command === "show_notification")?.[1],
  ).toMatchObject({ subtitle: "Reminder · Waiting for your answer" });
});

it("asks for a habit's approval with a banner that opens its Irgat's chat", async () => {
  const irgat = createIrgat();
  expect(await notifyHabitApproval(irgat.id, "Morning digest")).toBe(false);
  saveIrgatSessionId(irgat.id, "irgat-chat");
  expect(await notifyHabitApproval(irgat.id, "Morning digest")).toBe(true);
  const banner = invoke.mock.calls.find(
    ([command]) => command === "show_notification",
  )?.[1] as { sessionId: string; title: string; subtitle: string; body: string };
  expect(banner.sessionId).toBe("irgat-chat");
  expect(banner.title).toMatch(/ › Morning digest$/);
  expect(banner.subtitle).toBe("Waiting for your answer");
  expect(banner.body).toBe("Approve: run the habit “Morning digest”");
});
