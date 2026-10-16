// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import {
  closeTab,
  cycleTab,
  newTab,
  restoreTabs,
  saveTabs,
  tabLabel,
} from "./browserTabs";

afterEach(() => localStorage.clear());

const tabs = () => [newTab(null, "a"), newTab(null, "b"), newTab(null, "c")];

it("moves to the tab on the right when the active tab closes", () => {
  expect(closeTab(tabs(), "b", "b").activeId).toBe("c");
  expect(closeTab(tabs(), "c", "c").activeId).toBe("b");
  expect(closeTab(tabs(), "a", "c")).toMatchObject({ activeId: "a" });
});

it("leaves one empty tab when the last tab closes", () => {
  const result = closeTab([newTab("https://x.com/", "a")], "a", "a");
  expect(result.tabs).toHaveLength(1);
  expect(result.tabs[0]).toMatchObject({ url: null, started: false });
  expect(result.activeId).toBe(result.tabs[0].id);
});

it("cycles through tabs in both directions", () => {
  expect(cycleTab(tabs(), "c", 1)).toBe("a");
  expect(cycleTab(tabs(), "a", -1)).toBe("c");
  expect(cycleTab([newTab(null, "a")], "a", 1)).toBe("a");
});

it("names a tab by title, then address", () => {
  expect(tabLabel(newTab())).toBe("New Tab");
  expect(tabLabel(newTab("https://example.com/a"))).toBe("example.com/a");
  expect(
    tabLabel({ ...newTab("https://example.com/"), title: "Example" }),
  ).toBe("Example");
});

it("restores open pages unloaded, keeping the shown tab", () => {
  const open = [
    { ...newTab("https://a.com/"), title: "A", started: true },
    newTab(),
    { ...newTab("https://b.com/"), title: "B", started: true },
  ];
  saveTabs(open, open[2].id);
  const restored = restoreTabs();
  expect(restored.tabs.map((tab) => [tab.url, tab.title, tab.started])).toEqual(
    [
      ["https://a.com/", "A", false],
      ["https://b.com/", "B", false],
    ],
  );
  expect(restored.tabs[0].id).toBe("main");
  expect(restored.activeId).toBe(restored.tabs[1].id);
});

it("starts with one empty tab when nothing was kept", () => {
  localStorage.setItem("irgat-browser-tabs", "not json");
  expect(restoreTabs().tabs).toEqual([
    expect.objectContaining({ id: "main", url: null }),
  ]);
});
