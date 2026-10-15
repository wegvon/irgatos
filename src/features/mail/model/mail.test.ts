import { describe, expect, it } from "vitest";
import { isFromMe, mailContext, mailQuery, senderName } from "./mail";

describe("mailQuery", () => {
  it("narrows the folder by the search", () => {
    expect(mailQuery("inbox", "")).toBe("in:inbox");
    expect(mailQuery("unread", " from:ayse ")).toBe(
      "in:inbox is:unread from:ayse",
    );
    expect(mailQuery("all", "fatura")).toBe("fatura");
    expect(mailQuery("all", "")).toBe("");
  });
});

describe("senderName", () => {
  it("prefers the display name", () => {
    expect(senderName('"Ayşe Y." <ayse@example.com>')).toBe("Ayşe Y.");
    expect(senderName("<ayse@example.com>")).toBe("ayse@example.com");
    expect(senderName("ayse@example.com")).toBe("ayse@example.com");
  });
});

describe("isFromMe", () => {
  it("compares addresses without case", () => {
    expect(isFromMe("Turel <Turel@Example.com>", "turel@example.com")).toBe(
      true,
    );
    expect(isFromMe("turel@example.com", "turel@example.com")).toBe(true);
    expect(isFromMe("Bob <bob@example.com>", "turel@example.com")).toBe(false);
    expect(isFromMe("turel@example.com", "")).toBe(false);
  });
});

describe("mailContext", () => {
  it("names the tools, forbids sending and marks mail as untrusted", () => {
    const text = mailContext("/bin/irgat app", {
      threadId: "t1",
      subject: 'Say "hi"',
    });
    expect(text).toContain("/bin/irgat app mail.read");
    expect(text).toContain("/bin/irgat app mail.draft --input -");
    expect(text).toContain("You cannot send email");
    expect(text).toContain("untrusted");
    expect(text).toContain(`"Say 'hi'"`);
  });
});
