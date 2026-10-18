import { expect, it } from "vitest";
import { pathKey } from "../../shared/lib/paths";
import { projectAlertsFromSessions, railAlertLabel } from "./RailAlert";

it("counts sessions per project, never the open one or excluded ones", () => {
  const alerts = projectAlertsFromSessions(
    [
      { id: "ask", cwd: "/work/a" },
      { id: "done", cwd: "/work/a/" },
      { id: "open", cwd: "/work/a" },
      { id: "irgat", cwd: "/work/a" },
      { id: "calm", cwd: "/work/b" },
      { id: "nowhere" },
    ],
    {
      needsYou: (session) => session.id === "ask",
      unread: new Set(["done", "open", "irgat", "nowhere"]),
      activeSessionId: "open",
      excluded: new Set(["irgat"]),
    },
  );
  expect(alerts.get(pathKey("/work/a"))).toEqual({ needsYou: 1, unread: 1 });
  expect(alerts.has(pathKey("/work/b"))).toBe(false);
  expect(alerts.size).toBe(1);
});

it("names both counts for titles and screen readers", () => {
  expect(railAlertLabel({ needsYou: 2, unread: 1 })).toBe(
    "2 need you, 1 unread",
  );
  expect(railAlertLabel({ needsYou: 0, unread: 0 })).toBe("");
});
