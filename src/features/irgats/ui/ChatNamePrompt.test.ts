// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatNamePrompt } from "./ChatNamePrompt";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(props: Partial<Parameters<typeof ChatNamePrompt>[0]> = {}) {
  const onSave = vi.fn();
  const onDismiss = vi.fn();
  act(() =>
    root.render(
      createElement(ChatNamePrompt, {
        suggestion: "Mail undo",
        onSave,
        onDismiss,
        ...props,
      }),
    ),
  );
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Chat name"]',
  )!;
  return { onSave, onDismiss, input };
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  )!;

it("prefills the suggestion without taking focus and saves it", () => {
  const { onSave, input } = render();
  expect(input.value).toBe("Mail undo");
  expect(document.activeElement).not.toBe(input);
  act(() => button("Save").click());
  expect(onSave).toHaveBeenCalledWith("Mail undo");
});

it("saves what was typed on Enter", () => {
  const { onSave, input } = render();
  type(input, "  Trash with undo ");
  act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(onSave).toHaveBeenCalledWith("Trash with undo");
});

it("cannot save an empty name", () => {
  const { onSave, input } = render();
  type(input, "   ");
  expect(button("Save").disabled).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
});

it("puts the question off with Later or Escape", () => {
  const { onDismiss, input } = render();
  act(() => button("Later").click());
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(onDismiss).toHaveBeenCalledTimes(2);
});

it("takes the model's suggestion unless the user already typed", async () => {
  let resolve!: (value: string | null) => void;
  const { input } = render({
    generate: () => new Promise((done) => (resolve = done)),
  });
  await act(async () => resolve("Gmail trash undo"));
  expect(input.value).toBe("Gmail trash undo");

  act(() => root.unmount());
  root = createRoot(container);
  let late!: (value: string | null) => void;
  const second = render({
    generate: () => new Promise((done) => (late = done)),
  });
  type(second.input, "Mine");
  await act(async () => late("Model name"));
  expect(second.input.value).toBe("Mine");
});
