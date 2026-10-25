import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  matchesSecret,
  pendingSecretApproval,
  sanitizeSecretApproval,
  secretApprovalBlock,
  secretApprovalPrompt,
  settledSecretApprovals,
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

describe("vault approvals and search", () => {
  const event = {
    requestId: "r1",
    sessionId: "chat-1",
    secretId: "abc",
    name: "GH_TOKEN",
    label: "GitHub token",
    kind: "key" as const,
    action: "secrets.http",
    method: "GET",
    target: "api.github.com",
  };

  it("builds an approval card and keeps only known fields", () => {
    const block = secretApprovalBlock(event)!;
    expect(block.secretApproval).toEqual({ ...event, state: "pending" });
    expect(sanitizeSecretApproval({ ...event, value: "x", state: "chat" })).toEqual({
      ...event,
      state: "chat",
    });
    expect(sanitizeSecretApproval({ ...event, name: "bad name" })).toBeUndefined();
    expect(pendingSecretApproval([block], "abc")).toBe(block);
  });

  it("tells the agent to retry or carry on without it", () => {
    const approval = { ...event, state: "once" as const };
    expect(secretApprovalPrompt([approval])).toMatch(/allowed GH_TOKEN for one use.*Retry/);
    expect(secretApprovalPrompt([{ ...approval, state: "chat" }])).toMatch(/rest of this chat/);
    expect(secretApprovalPrompt([{ ...approval, state: "deny" }])).toMatch(/Do not retry/);
  });

  it("answers the cards of one call once, after the last", () => {
    const card = (id: string, state: "pending" | "once" | "deny", callId = "c1") =>
      ({
        id,
        role: "system",
        text: "",
        secretApproval: { ...event, secretId: id, name: id.toUpperCase(), callId, state },
      }) as Block;
    const first = card("a", "once");
    const open = [first, card("b", "pending"), card("x", "pending", "c2")];
    expect(settledSecretApprovals(open, first.secretApproval!)).toBeUndefined();
    const done = [first, card("b", "deny"), card("x", "pending", "c2")];
    const settled = settledSecretApprovals(done, first.secretApproval!)!;
    expect(settled.map((item) => item.name)).toEqual(["A", "B"]);
    expect(secretApprovalPrompt(settled)).toMatch(/did not allow B/);
  });

  it("finds entries by label, username or host", () => {
    const meta = {
      id: "1",
      name: "GITHUB_LOGIN",
      label: "GitHub login",
      description: "",
      sessionId: null,
      hosts: ["github.com"],
      allowIn: ["header"],
      purpose: null,
      maxUses: null,
      uses: 0,
      createdAt: 0,
      expiresAt: null,
      kind: "login" as const,
      username: "wegvon",
      policy: "ask" as const,
      updatedAt: 0,
      commands: ["gh"],
    };
    expect(matchesSecret(meta, "")).toBe(true);
    expect(matchesSecret(meta, "github wegvon")).toBe(true);
    expect(matchesSecret(meta, "stripe")).toBe(false);
    expect(matchesSecret(meta, "gh")).toBe(true);
  });
});

describe("secretNameFrom", () => {
  it("turns a label into the name agents use", async () => {
    const { secretNameFrom } = await import("../ui/SecretsSettings");
    expect(secretNameFrom("GitHub token")).toBe("GITHUB_TOKEN");
    expect(secretNameFrom("Şirket şifresi ı")).toBe("SIRKET_SIFRESI_I");
    expect(secretNameFrom("1password key")).toBe("_1PASSWORD_KEY");
  });
});
