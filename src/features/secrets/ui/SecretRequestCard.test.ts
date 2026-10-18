// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SecretRequestCard } from "./SecretRequestCard";
import { SECRET_ANSWERED_EVENT, type SecretAnswer, type SecretRequest } from "../model/secrets";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// A fake value; never a real credential.
const VALUE = "sk_test_FAKE_card_0123456789";
const request: SecretRequest = {
  requestId: "r1",
  sessionId: "chat-1",
  name: "STRIPE_KEY",
  label: "Stripe key",
  description: "To list charges",
  hosts: ["api.stripe.com"],
  allowIn: ["header"],
  once: false,
  state: "pending",
};

let container: HTMLDivElement;
let root: Root;
let answers: SecretAnswer[];
const onAnswer = (event: Event) => answers.push((event as CustomEvent<SecretAnswer>).detail);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  answers = [];
  window.addEventListener(SECRET_ANSWERED_EVENT, onAnswer);
  vi.mocked(invoke).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.removeEventListener(SECRET_ANSWERED_EVENT, onAnswer);
});

async function render(value: SecretRequest) {
  await act(async () => {
    root.render(createElement(SecretRequestCard, { blockId: "secret-r1", request: value }));
  });
}

it("sends the value only to the vault and answers the chat with its name", async () => {
  vi.mocked(invoke).mockResolvedValue({
    id: "x",
    name: "STRIPE_KEY",
    hosts: ["api.stripe.com"],
    sessionId: "chat-1",
    purpose: null,
    maxUses: null,
    expiresAt: 99,
  });
  await render(request);
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(input.autocomplete).toBe("new-password");
  input.value = VALUE;
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(invoke).toHaveBeenCalledWith("secrets_save", {
    input: expect.objectContaining({ sessionId: "chat-1", name: "STRIPE_KEY", value: VALUE, persistent: false }),
  });
  expect(input.value).toBe("");
  expect(answers).toHaveLength(1);
  expect(answers[0].request.state).toBe("saved");
  expect(JSON.stringify(answers)).not.toContain(VALUE);
  expect(container.innerHTML).not.toContain(VALUE);
});

it("declining sends nothing to the vault", async () => {
  await render(request);
  const decline = [...container.querySelectorAll("button")].find((b) => b.textContent === "Decline")!;
  await act(async () => decline.click());
  expect(invoke).not.toHaveBeenCalled();
  expect(answers[0].request.state).toBe("declined");
});

it("an answered card shows only the outcome", async () => {
  await render({ ...request, state: "saved", persistent: false });
  expect(container.querySelector("input")).toBeNull();
  expect(container.textContent).toContain("STRIPE_KEY saved for this chat");
});
