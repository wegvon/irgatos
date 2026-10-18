import { describe, expect, it } from "vitest";
import {
  pendingSecretRequest,
  sanitizeSecretRequest,
  secretAnswerPrompt,
  secretRequestBlock,
  secretScopeLabel,
  secretsContext,
} from "./secrets";

const event = {
  sessionId: "chat-1",
  requestId: "abc",
  name: "STRIPE_KEY",
  label: "Stripe key",
  description: "To list charges",
  hosts: ["api.stripe.com"],
  allowIn: ["header"],
  purpose: null,
  once: false,
};

describe("secret requests", () => {
  it("puts a pending card in the chat with names and limits only", () => {
    const block = secretRequestBlock(event)!;
    expect(block.role).toBe("system");
    expect(block.secretRequest).toMatchObject({
      name: "STRIPE_KEY",
      sessionId: "chat-1",
      hosts: ["api.stripe.com"],
      state: "pending",
    });
    expect(pendingSecretRequest([block], "STRIPE_KEY")).toBe(block);
    expect(pendingSecretRequest([block], "OTHER")).toBeUndefined();
  });

  it("drops anything that could carry a value or is malformed", () => {
    const saved = sanitizeSecretRequest({
      ...event,
      state: "saved",
      persistent: true,
      expiresAt: null,
      value: "sk_test_FAKE",
    });
    expect(saved).not.toHaveProperty("value");
    expect(JSON.stringify(saved)).not.toContain("sk_test_FAKE");
    expect(sanitizeSecretRequest({ ...event, name: "bad name" })).toBeUndefined();
    expect(sanitizeSecretRequest({ ...event, hosts: [] })).toBeUndefined();
    expect(sanitizeSecretRequest({ ...event, sessionId: 1 })).toBeUndefined();
    expect(
      sanitizeSecretRequest({ ...event, allowIn: ["header", "shell"] })?.allowIn,
    ).toEqual(["header"]);
  });

  it("tells the agent how to use the placeholder, or that the user declined", () => {
    const request = sanitizeSecretRequest({ ...event, state: "saved", once: true })!;
    const prompt = secretAnswerPrompt(request);
    expect(prompt).toContain("{{secret:STRIPE_KEY}}");
    expect(prompt).toContain("secrets.http");
    expect(prompt).toContain("api.stripe.com");
    expect(prompt).toContain("usable once");
    expect(secretAnswerPrompt({ ...request, state: "declined" })).toContain("declined");
  });

  it("teaches every chat to ask instead of asking for a paste", () => {
    const hint = secretsContext("/Applications/Irgatos.app/Contents/MacOS/irgat app");
    expect(hint).toContain("never ask the user to paste");
    expect(hint).toContain("secrets.request");
  });

  it("labels scope and time left", () => {
    expect(secretScopeLabel({ sessionId: null, expiresAt: null })).toBe("Saved for all chats");
    expect(
      secretScopeLabel({ sessionId: "s", expiresAt: 10 * 3_600_000 }, 0),
    ).toBe("This chat · 10 h left");
  });
});
