import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserPageContext,
  browserState,
  browserToolsContext,
  claimBrowserPage,
  claimBrowserToolsHint,
  handleBrowserAgentRequest,
  noteBrowserShown,
  type BrowserAgentHost,
} from "./browserAgent";
import {
  newTab,
  publishBrowserTabs,
  setBrowserTabControl,
  type BrowserTab,
} from "./browserTabs";

function tab(id: string, patch: Partial<BrowserTab> = {}): BrowserTab {
  return { ...newTab(null, id), ...patch };
}

function host(overrides: Partial<BrowserAgentHost> = {}): BrowserAgentHost {
  return {
    show: vi.fn(),
    openUrl: vi.fn(),
    navigate: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  publishBrowserTabs([], "main");
  setBrowserTabControl(null);
  noteBrowserShown(false);
});

describe("browser state for agents", () => {
  it("reports the active tab and every tab", () => {
    publishBrowserTabs(
      [
        tab("main", { url: "https://a.test/", title: "A", started: true }),
        tab("t2", { url: "https://b.test/", title: "B", started: true }),
      ],
      "t2",
    );
    noteBrowserShown(true);
    expect(browserState()).toEqual({
      open: true,
      shown: true,
      url: "https://b.test/",
      title: "B",
      loading: false,
      tabs: [
        { id: "main", url: "https://a.test/", title: "A", active: false },
        { id: "t2", url: "https://b.test/", title: "B", active: true },
      ],
    });
  });

  it("has no page before a view exists", () => {
    publishBrowserTabs([tab("main", { url: "https://a.test/" })], "main");
    expect(browserState()).toMatchObject({ open: false, url: null, title: "" });
  });
});

describe("browser actions the panel answers", () => {
  it("navigates a started tab in place and waits for it to load", async () => {
    publishBrowserTabs(
      [tab("main", { url: "https://a.test/", started: true })],
      "main",
    );
    noteBrowserShown(true);
    const navigate = vi.fn(async (id: string, url: string) => {
      publishBrowserTabs([tab(id, { url, started: true, loading: true })], id);
      publishBrowserTabs(
        [tab(id, { url, title: "Headroom", started: true })],
        id,
      );
    });
    const target = host({ navigate });
    const result = await handleBrowserAgentRequest(
      "browser.open",
      { url: "headroom.dev" },
      target,
    );
    expect(target.show).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("main", "https://headroom.dev/");
    expect(result).toMatchObject({
      url: "https://headroom.dev/",
      title: "Headroom",
    });
  });

  it("opens through the panel when nothing is started, and says when it is hidden", async () => {
    const target = host();
    const result = await handleBrowserAgentRequest(
      "browser.open",
      { url: "https://a.test" },
      target,
      10,
    );
    expect(target.openUrl).toHaveBeenCalledWith("https://a.test/");
    expect(result).toMatchObject({ note: expect.stringContaining("hidden") });
  });

  it("opens, switches and closes tabs through the panel's control", async () => {
    const control = {
      open: vi.fn(() => "t3"),
      activate: vi.fn(),
      close: vi.fn(),
    };
    setBrowserTabControl(control);
    publishBrowserTabs(
      [tab("main", { url: "https://a.test/", started: true })],
      "main",
    );
    await handleBrowserAgentRequest(
      "browser.open",
      { url: "https://b.test", newTab: true },
      host(),
      10,
    );
    expect(control.open).toHaveBeenCalledWith("https://b.test/");
    await handleBrowserAgentRequest(
      "browser.tab",
      { activate: "main" },
      host(),
    );
    expect(control.activate).toHaveBeenCalledWith("main");
    await handleBrowserAgentRequest("browser.tab", { close: "main" }, host());
    expect(control.close).toHaveBeenCalledWith("main");
    await expect(
      handleBrowserAgentRequest("browser.tab", { close: "nope" }, host()),
    ).rejects.toThrow(/No tab nope/);
  });

  it("rejects addresses the Browser cannot open", async () => {
    await expect(
      handleBrowserAgentRequest("browser.open", { url: "file:///etc" }, host()),
    ).rejects.toThrow(/web addresses/);
    await expect(
      handleBrowserAgentRequest("browser.open", {}, host()),
    ).rejects.toThrow(/takes/);
  });
});

describe("what a chat hears", () => {
  it("hands over the shown page once per page", () => {
    publishBrowserTabs(
      [
        tab("main", {
          url: "https://headroom.dev/",
          title: "Headroom",
          started: true,
        }),
      ],
      "main",
    );
    expect(claimBrowserPage("s1")).toBeNull();
    noteBrowserShown(true);
    expect(claimBrowserPage("s1")).toEqual({
      url: "https://headroom.dev/",
      title: "Headroom",
    });
    expect(claimBrowserPage("s1")).toBeNull();
    expect(claimBrowserPage("s2")).not.toBeNull();
    publishBrowserTabs(
      [
        tab("main", {
          url: "https://headroom.dev/docs",
          title: "Docs",
          started: true,
        }),
      ],
      "main",
    );
    expect(claimBrowserPage("s1")).toMatchObject({ title: "Docs" });
  });

  it("tells each session about the tools once", () => {
    expect(claimBrowserToolsHint("hint-1")).toBe(true);
    expect(claimBrowserToolsHint("hint-1")).toBe(false);
    expect(browserToolsContext("irgatos app")).toContain(
      "irgatos app browser.state",
    );
  });

  it("marks page text as untrusted and points at the rest", () => {
    const text = browserPageContext(
      { url: "https://headroom.dev/", title: "Headroom" },
      { text: "Headroom is a context compressor.", totalChars: 9000 },
    );
    expect(text).toContain("URL: https://headroom.dev/");
    expect(text).toContain("untrusted data");
    expect(text).toContain("browser.read");
    expect(
      browserPageContext({ url: "https://x.test/", title: "" }),
    ).not.toContain("Page text");
  });
});
