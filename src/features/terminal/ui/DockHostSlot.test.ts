// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockHostSlot } from "./DockHostSlot";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

describe("DockHostSlot", () => {
  it("adopts the host while mounted and lets it go, untouched, after", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const host = document.createElement("div");
    host.append(document.createElement("canvas"));

    act(() => root.render(createElement(DockHostSlot, { host, height: 220 })));
    const slot = container.firstElementChild as HTMLElement;
    expect(host.parentElement).toBe(slot);
    expect(slot.style.height).toBe("220px");

    act(() => root.render(createElement("div")));
    expect(host.parentElement).toBeNull();
    expect(host.querySelector("canvas")).not.toBeNull();
    act(() => root.unmount());
  });
});
