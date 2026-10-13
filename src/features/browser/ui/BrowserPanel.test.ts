// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { BrowserPanel } from "./BrowserPanel";
import type {
  PageSelection,
  PickerPoll,
} from "../../../platform/tauri/browserPicker";
import {
  SEND_TO_CHAT_EVENT,
  type SendToChatRequest,
} from "../../sessions/model/sendToChat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(() => Promise.resolve(() => undefined)),
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../sessions/model/attachments", () => ({
  attachmentsFromFiles: vi.fn(async (files: File[]) =>
    files.map((file) => ({
      id: "shot",
      name: file.name,
      mimeType: file.type,
      kind: "image",
      size: file.size,
      data: "iVBORw0KGgo=",
    })),
  ),
  revokeAttachment: vi.fn(),
}));

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

const picked: PageSelection = {
  kind: "element",
  url: "https://example.com/pricing",
  title: "Pricing",
  viewport: { width: 560, height: 760 },
  rect: { x: 20, y: 100, width: 240, height: 40 },
  element: {
    label: "button.cta",
    selector: "main > button.cta",
    tag: "button",
    text: "Get started",
    rect: { x: 20, y: 100, width: 240, height: 40 },
    attributes: [],
    styles: [["display", "inline-flex"]],
    parent: null,
  },
  container: null,
  elements: [],
};

function setTextArea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function openPage(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Address"]',
  )!;
  act(() => setInput(input, "https://example.com/pricing"));
  act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await flush();
}

function pickerButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Select Part of the Page"], button[aria-label="Cancel Selection (Esc)"]',
  )!;
}

function mockPicker(polls: PickerPoll[]) {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "browser_picker_poll") {
      return polls.length > 1 ? polls.shift() : polls[0];
    }
    if (command === "browser_capture") return "iVBORw0KGgo=";
    return undefined;
  });
}

it("sends a picked element, its screenshot and a note to the chat", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const requests: SendToChatRequest[] = [];
  const onSend = (event: Event) => {
    const request = (event as CustomEvent<SendToChatRequest>).detail;
    requests.push(request);
    request.delivery = {
      status: "sent",
      sessionId: "s1",
      title: "Fix the hero",
      droppedAttachments: 0,
    };
  };
  window.addEventListener(SEND_TO_CHAT_EVENT, onSend);
  try {
    act(() =>
      root.render(
        createElement(BrowserPanel, { visible: true, onClose: vi.fn() }),
      ),
    );
    await openPage(container);
    mockPicker([{ state: "active" }, { state: "picked", selection: picked }]);

    act(() => pickerButton(container).click());
    await flush();
    expect(invoke).toHaveBeenCalledWith("browser_picker_start", {
      id: "main",
    });
    expect(container.textContent).toContain(
      "Click an element or drag across an area",
    );
    expect(pickerButton(container).getAttribute("aria-pressed")).toBe("true");

    await wait(400);
    expect(invoke).toHaveBeenCalledWith("browser_capture", {
      id: "main",
      rect: { x: 12, y: 92, width: 256, height: 56, viewportWidth: 560 },
    });
    const card = container.querySelector<HTMLFormElement>(
      'form[aria-label="Send selection to agent"]',
    )!;
    expect(card.textContent).toContain("button.cta");
    expect(card.textContent).toContain("240 × 40");
    expect(card.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );

    const note = card.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Note for the agent"]',
    )!;
    act(() => setTextArea(note, "Make this button bigger"));
    act(() =>
      card.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await flush();

    expect(requests).toHaveLength(1);
    expect(requests[0].text).toMatch(/^Make this button bigger\n\n/);
    expect(requests[0].text).toContain("Selector: main > button.cta");
    expect(requests[0].attachments).toEqual([
      expect.objectContaining({
        name: "example-com-button-cta.png",
        mimeType: "image/png",
      }),
    ]);
    expect(
      container.querySelector('form[aria-label="Send selection to agent"]'),
    ).toBeNull();
    const status = [...container.querySelectorAll('[role="status"]')].find(
      (node) => node.textContent?.includes("Sent"),
    );
    expect(status?.textContent).toContain("Sent button.cta to Fix the hero");
    expect(status?.textContent).toContain("screenshot, selector, text");
  } finally {
    window.removeEventListener(SEND_TO_CHAT_EVENT, onSend);
    act(() => root.unmount());
    container.remove();
  }
});

it("cancels selection mode with Escape", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(BrowserPanel, { visible: true, onClose: vi.fn() }),
      ),
    );
    await openPage(container);
    mockPicker([{ state: "active" }]);
    act(() => pickerButton(container).click());
    await flush();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();

    expect(invoke).toHaveBeenCalledWith("browser_picker_stop", { id: "main" });
    expect(container.textContent).not.toContain("Click an element");
    expect(pickerButton(container).getAttribute("aria-pressed")).not.toBe(
      "true",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("keeps the page's size unchanged until the screenshot is taken", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finishCapture: (image: string) => void = () => undefined;
  try {
    act(() =>
      root.render(
        createElement(BrowserPanel, { visible: true, onClose: vi.fn() }),
      ),
    );
    await openPage(container);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "browser_picker_poll")
        return { state: "picked", selection: picked };
      if (command === "browser_capture")
        return new Promise<string>((resolve) => (finishCapture = resolve));
      return undefined;
    });
    act(() => pickerButton(container).click());
    await flush();
    await wait(300);

    expect(invoke).toHaveBeenCalledWith("browser_capture", expect.anything());
    expect(container.textContent).toContain(
      "Taking a screenshot of the selection",
    );
    expect(
      container.querySelector('form[aria-label="Send selection to agent"]'),
    ).toBeNull();

    await act(async () => finishCapture("iVBORw0KGgo="));
    expect(container.textContent).not.toContain("Taking a screenshot");
    expect(
      container.querySelector('form[aria-label="Send selection to agent"]'),
    ).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("keeps the selection when no chat is open to take it", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(BrowserPanel, { visible: true, onClose: vi.fn() }),
      ),
    );
    await openPage(container);
    mockPicker([{ state: "picked", selection: picked }]);
    act(() => pickerButton(container).click());
    await flush();
    await wait(300);

    const card = container.querySelector<HTMLFormElement>(
      'form[aria-label="Send selection to agent"]',
    )!;
    act(() =>
      card.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Open an agent chat to send this selection to.",
    );
    expect(
      container.querySelector('form[aria-label="Send selection to agent"]'),
    ).not.toBeNull();
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

it("explains when macOS blocks Chrome profile discovery", async () => {
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "browser_chrome_profiles") {
      return Promise.reject(
        new Error(
          "No Chrome profiles are accessible. Grant MonoCode Full Disk Access in System Settings > Privacy & Security, then restart MonoCode.",
        ),
      );
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

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Grant MonoCode Full Disk Access",
    );
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Import profile",
      )?.disabled,
    ).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("hides the page and ends selection while the Chrome import dialog is open", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(BrowserPanel, { visible: true, onClose: vi.fn() }),
      ),
    );
    await openPage(container);
    mockPicker([{ state: "active" }]);
    act(() => pickerButton(container).click());
    await flush();
    vi.mocked(invoke).mockClear();

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[title="Import a Chrome profile"]',
        )!
        .click(),
    );
    await flush();

    expect(
      container.querySelector('[aria-labelledby="chrome-import-title"]'),
    ).not.toBeNull();
    expect(invoke).toHaveBeenCalledWith("browser_set_bounds", {
      id: "main",
      bounds: null,
    });
    expect(invoke).toHaveBeenCalledWith("browser_picker_stop", { id: "main" });

    vi.mocked(invoke).mockClear();
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Cancel")!
        .click(),
    );
    await flush();
    expect(invoke).toHaveBeenCalledWith("browser_set_bounds", {
      id: "main",
      bounds: expect.objectContaining({ width: 560, height: 760 }),
    });
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
