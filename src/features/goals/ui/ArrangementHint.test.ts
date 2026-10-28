// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ArrangementHint } from "./ArrangementHint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
afterEach(() => act(() => root.render(null)));

it("names the setup, says why, and applies or hides it", () => {
  const onUse = vi.fn();
  const onDismiss = vi.fn();
  act(() =>
    root.render(
      createElement(ArrangementHint, {
        arrangement: {
          mode: "plan",
          worktree: true,
          title: "Plan first · own worktree",
          benefit: "A bigger change: agree on the approach first.",
        },
        onUse,
        onDismiss,
      }),
    ),
  );
  expect(container.textContent).toContain("Suggested: Plan first · own worktree.");
  expect(container.textContent).toContain("agree on the approach");
  const buttons = [...container.querySelectorAll("button")];
  act(() => buttons.find((b) => b.textContent === "Use")!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Hide suggestion"]')!.click());
  expect(onUse).toHaveBeenCalledOnce();
  expect(onDismiss).toHaveBeenCalledOnce();
});
