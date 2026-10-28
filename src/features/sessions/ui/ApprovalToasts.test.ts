// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updateNotificationPreferences } from "../../notifications/model/notificationPreferences";
import { ApprovalToasts } from "./ApprovalToasts";

type Notice = ComponentProps<typeof ApprovalToasts>["notices"][number];
function notice(
  id: string,
  kind: Notice["kind"] = "approval",
  requestId = 1,
): Notice {
  return {
    sessionId: id,
    requestId,
    label: `Request ${id}`,
    kind,
    session: {
      id,
      cwd: `/projects/${id}`,
      title: id,
      harness: "codex",
      model: "",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [],
    },
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  onApproval.mockClear();
  onFocusSession.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const onApproval = vi.fn();
const onFocusSession = vi.fn();
function render(notices: Notice[]) {
  root.render(
    createElement(ApprovalToasts, { notices, onApproval, onFocusSession }),
  );
}
function visibleRequests() {
  return [...document.querySelectorAll(".approval-toast")].map(
    (item) => item.textContent,
  );
}

it("hides muted project approval popups while another project's controls remain usable", async () => {
  updateNotificationPreferences(["local:/projects/private"], {
    mutedUntil: null,
  });
  act(() => render([notice("private"), notice("work")]));
  expect(visibleRequests()).toHaveLength(1);
  expect(visibleRequests()[0]).toContain("Request work");
  const allow = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Allow",
  )!;
  act(() => allow.click());
  expect(onApproval).toHaveBeenCalledWith("work", 1, "allow");
});

it("immediately hides an existing question when its notification category is disabled", async () => {
  await act(async () => render([notice("work", "question")]));
  expect(visibleRequests()).toHaveLength(1);
  act(() =>
    updateNotificationPreferences(["local:/projects/work"], {
      disabled: ["agentInput"],
    }),
  );
  expect(visibleRequests()).toHaveLength(0);
});

it("does not replay a mounted approval after its path is resumed", async () => {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const ids = ["local:/projects/work"];
  updateNotificationPreferences(ids, {
    mutedUntil: null,
  });
  await act(async () => render([notice("work")]));
  expect(visibleRequests()).toHaveLength(0);
  now += 1000;
  act(() =>
    updateNotificationPreferences(ids, {
      mutedUntil: undefined,
    }),
  );
  expect(visibleRequests()).toHaveLength(0);
  now += 1;
  await act(async () => render([notice("work", "approval", 2)]));
  expect(visibleRequests()).toHaveLength(1);
});

it.each(["resume", "expiry", "category"] as const)(
  "does not replay a suppressed request after %s, but shows a new request",
  async (reason) => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const ids = ["local:/projects/private"];
    updateNotificationPreferences(
      ids,
      reason === "category"
        ? { disabled: ["agentInput"] }
        : { mutedUntil: reason === "expiry" ? now + 60_000 : null },
    );
    await act(async () => render([notice("private", "question")]));
    expect(visibleRequests()).toHaveLength(0);
    now += 120_000;
    act(() => {
      if (reason === "resume")
        updateNotificationPreferences(ids, { mutedUntil: undefined });
      else if (reason === "category")
        updateNotificationPreferences(ids, { disabled: [] });
      else window.dispatchEvent(new Event("focus"));
    });
    expect(visibleRequests()).toHaveLength(0);
    now += 1;
    await act(async () => render([notice("private", "question", 2)]));
    expect(visibleRequests()).toHaveLength(1);
  },
);

it("names the project above the chat and says the agent is waiting", async () => {
  await act(async () => render([notice("work")]));
  const card = document.querySelector(".approval-toast")!;
  expect(card.textContent).toContain("work");
  expect(card.textContent).toContain("Waiting for your answer");
  expect(card.getAttribute("data-decision")).toBe("blocking");
});

it("marks a timed question optional with its deadline", async () => {
  const timed = notice("work", "question");
  timed.session.pendingQuestion = {
    requestId: 1,
    autoResolveAt: Date.now() + 90_000,
    questions: [],
  };
  await act(async () => render([timed]));
  const card = document.querySelector(".approval-toast")!;
  expect(card.getAttribute("data-decision")).toBe("optional");
  expect(card.textContent).toContain("Optional — continues without an answer");
});

it("shows three cards and links the rest to Fleet", async () => {
  const onOpenFleet = vi.fn();
  await act(async () =>
    root.render(
      createElement(ApprovalToasts, {
        notices: ["a", "b", "c", "d", "e"].map((id) => notice(id)),
        onApproval,
        onFocusSession,
        onOpenFleet,
      }),
    ),
  );
  expect(visibleRequests()).toHaveLength(3);
  const more = document.querySelector<HTMLButtonElement>(
    "[data-decision-overflow]",
  )!;
  expect(more.textContent).toBe("2 more requests in Fleet");
  act(() => more.click());
  expect(onOpenFleet).toHaveBeenCalled();
});

it("puts one request off without answering it or hiding the others", async () => {
  await act(async () => render([notice("a"), notice("b")]));
  const later = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Later",
  )!;
  act(() => later.click());
  const panel = document.querySelector("[data-decision-defer]")!;
  expect(panel.textContent).toContain("The agent stays blocked");
  const remind = [...panel.querySelectorAll("button")].find(
    (item) => item.textContent === "Remind me in 1 hour",
  )!;
  act(() => remind.click());
  expect(visibleRequests()).toHaveLength(1);
  expect(visibleRequests()[0]).toContain("Request b");
  expect(onApproval).not.toHaveBeenCalled();
});

it("keeps a timed question's deadline when it is put off", async () => {
  const timed = notice("work", "question");
  timed.session.pendingQuestion = {
    requestId: 1,
    autoResolveAt: Date.now() + 120_000,
    questions: [],
  };
  await act(async () => render([timed]));
  const later = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Later",
  )!;
  act(() => later.click());
  const panel = document.querySelector("[data-decision-defer]")!;
  expect(panel.textContent).toContain("The deadline stays at");
  // A reminder after the deadline would come too late, so none is offered.
  expect(panel.textContent).not.toContain("Remind me");
});
