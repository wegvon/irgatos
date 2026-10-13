// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { BrowserPanel } from "./BrowserPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(() => Promise.resolve(() => undefined)),
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 600,
    y: 40,
    left: 600,
    top: 40,
    right: 1160,
    bottom: 800,
    width: 560,
    height: 760,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.innerHTML = "";
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

it("opens a typed address in the native view and hides it with the panel", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (visible: boolean) =>
    act(() =>
      root.render(createElement(BrowserPanel, { visible, onClose: vi.fn() })),
    );
  try {
    render(true);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Address"]',
    )!;
    act(() => setInput(input, "example.com"));
    act(() =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await flush();

    expect(invoke).toHaveBeenCalledWith("browser_open", {
      id: "main",
      url: "https://example.com/",
      bounds: expect.objectContaining({ width: 560, height: 760 }),
    });
    expect(input.value).toBe("https://example.com");

    vi.mocked(invoke).mockClear();
    render(false);
    await flush();
    expect(invoke).toHaveBeenCalledWith("browser_set_bounds", {
      id: "main",
      bounds: null,
    });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("steps aside for a menu that covers it", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(BrowserPanel, { visible: true, onClose: vi.fn() }),
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Address"]',
    )!;
    act(() => setInput(input, "https://example.com"));
    act(() =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await flush();
    vi.mocked(invoke).mockClear();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    await flush();

    expect(invoke).toHaveBeenCalledWith("browser_set_bounds", {
      id: "main",
      bounds: null,
    });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("rejects addresses that aren't on the web", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(BrowserPanel, { visible: true, onClose: vi.fn() }),
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Address"]',
    )!;
    act(() => setInput(input, "file:///etc/passwd"));
    act(() =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await flush();

    expect(invoke).not.toHaveBeenCalledWith("browser_open", expect.anything());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Only web addresses",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("imports only after the user selects a Chrome profile", async () => {
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "browser_chrome_profiles") {
      return Promise.resolve([{ id: "Default", name: "Personal" }]);
    }
    if (command === "browser_import_chrome_profile") {
      return Promise.resolve({
        importedCookies: 3,
        skippedCookies: 0,
        bookmarks: [{ name: "Example", url: "https://example.com" }],
        history: [],
      });
    }
    return Promise.resolve(undefined);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(BrowserPanel, { visible: true, onClose: vi.fn() }),
      ),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[title="Import a Chrome profile"]',
        )!
        .click(),
    );
    await flush();
    expect(container.querySelector("select")?.value).toBe("Default");
    expect(invoke).not.toHaveBeenCalledWith(
      "browser_import_chrome_profile",
      expect.anything(),
    );

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Import profile")!
        .click(),
    );
    await flush();
    expect(invoke).toHaveBeenCalledWith("browser_prepare", {
      id: "main",
      bounds: expect.objectContaining({ width: 560, height: 760 }),
    });
    expect(invoke).toHaveBeenCalledWith("browser_import_chrome_profile", {
      id: "main",
      profileId: "Default",
    });
    expect(container.textContent).toContain("Imported 3 cookies");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("explains persistent sessions and the passkey fallback before browsing", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(BrowserPanel, { visible: true, onClose: vi.fn() }),
      ),
    );
    expect(container.textContent).toContain("persistent store");
    expect(container.textContent).toContain("Open in Default Browser");
    expect(container.textContent).toContain("passkey");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
