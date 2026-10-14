// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FleetNeedsYouCount, RailAction } from "./RailAction";
import { Inbox, Radar } from "../../shared/ui/icons";

it("opens Inbox context actions from the keyboard without navigating", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClick = vi.fn();
  const onOpenContextMenu = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(RailAction, {
          label: "Inbox",
          icon: Inbox,
          onClick,
          onOpenContextMenu,
        }),
      ),
    );
    const button = container.querySelector("button")!;
    act(() =>
      button.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onOpenContextMenu).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("shows the live Fleet count only while sessions need the user", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (count: number) =>
    act(() =>
      root.render(
        createElement(RailAction, {
          label: "Fleet",
          icon: Radar,
          onClick: () => {},
          meta: createElement(FleetNeedsYouCount, { count }),
        }),
      ),
    );
  try {
    render(0);
    expect(container.querySelector("[data-fleet-needs-you]")).toBeNull();
    render(3);
    expect(container.querySelector("[data-fleet-needs-you]")?.textContent).toBe("3");
    render(120);
    expect(container.querySelector("[data-fleet-needs-you]")?.textContent).toBe("99+");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
