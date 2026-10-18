import { describe, expect, it } from "vitest";
import { agentExchangesSinceUser, irgatMessagePrompt, resolveIrgatContact } from "./irgatDirectMessages";

const contacts = [
  { id: "a", name: "IrgatInvader", busy: false },
  { id: "b", name: "LocalAI", busy: false },
  { id: "c", name: "Twin", busy: false },
  { id: "d", name: "twin", busy: true },
];

describe("resolveIrgatContact", () => {
  it("finds an Irgat by id or by name regardless of case", () => {
    expect(resolveIrgatContact(contacts, "b", "a").name).toBe("LocalAI");
    expect(resolveIrgatContact(contacts, " localai ", "a").id).toBe("b");
  });

  it("rejects unknown, ambiguous and own names", () => {
    expect(() => resolveIrgatContact(contacts, "Nobody", "a")).toThrow(
      /irgats\.list/,
    );
    expect(() => resolveIrgatContact(contacts, "TWIN", "a")).toThrow(
      /Several Irgats/,
    );
    expect(() => resolveIrgatContact(contacts, "IrgatInvader", "a")).toThrow(
      /yourself/,
    );
  });
});

describe("irgatMessagePrompt", () => {
  it("marks the sender and tells the receiver its reply goes back", () => {
    const prompt = irgatMessagePrompt(
      { id: "a", name: "IrgatInvader" },
      "What is rem's LAN IP?",
    );
    expect(prompt).toContain("from IrgatInvader, another Irgat, not from the user");
    expect(prompt).toContain("returns your reply to IrgatInvader automatically");
    expect(prompt).toContain(
      '<irgat_message from="IrgatInvader">\nWhat is rem\'s LAN IP?\n</irgat_message>',
    );
  });
});

describe("agentExchangesSinceUser", () => {
  const user = (id: string, extra: object = {}) => ({ id, role: "user" as const, text: id, ...extra });
  it("counts agent messages back to the user's last own message", () => {
    expect(agentExchangesSinceUser({ blocks: [] })).toBe(0);
    expect(agentExchangesSinceUser({ blocks: [
      user("old-in", { fromIrgat: { id: "x", name: "X" } }),
      user("typed"),
      { id: "a", role: "assistant", text: "ok" },
      user("in", { fromIrgat: { id: "x", name: "X" } }),
      user("report", { internal: true, irgatSessionCompletion: { sessionId: "s", title: "t", status: "completed" } }),
      user("reply", { internal: true, irgatSessionCompletion: { sessionId: "s", title: "t", status: "completed", agentReply: true } }),
      user("draft", { draft: true }),
    ] })).toBe(2);
  });
});
