import { describe, expect, it } from "vitest";
import {
  accountLabel,
  connectionName,
  DEFAULT_MAIL_FOLDER,
  executorAccountsUrl,
  isFromMe,
  MAIL_FOLDERS,
  mailContext,
  mailQuery,
  needsReconnect,
  senderName,
} from "./mail";

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

describe("MAIL_FOLDERS", () => {
  it("opens on Unread, listed first", () => {
    expect(MAIL_FOLDERS.map((f) => f.id)).toEqual([
      "unread",
      "inbox",
      "sent",
      "all",
    ]);
    expect(DEFAULT_MAIL_FOLDER).toBe("unread");
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
      account: "google.org.work.",
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

describe("expired Gmail accounts", () => {
  const expired =
    'users.threads.list: OAuth connection "google_gmail.user.personalGmail" requires reauthorization: OAuth token refresh was rejected (invalid_grant): Token has been expired or revoked. Reconnect to continue.';

  it("recognises Executor's reauthorization error", () => {
    expect(needsReconnect(expired)).toBe(true);
    expect(needsReconnect("Gmail: users.drafts.send: Insufficient scope")).toBe(
      false,
    );
  });

  it("names an account without an address by its connection", () => {
    expect(connectionName("google_gmail.user.personalGmail.")).toBe(
      "personalGmail",
    );
    expect(
      accountLabel({ id: "google_gmail.user.personalGmail.", email: "" }),
    ).toBe("personalGmail");
    expect(accountLabel({ id: "google_gmail.user.t.", email: "t@x.com" })).toBe(
      "t@x.com",
    );
  });

  it("links to the integration's accounts in Executor", () => {
    expect(
      executorAccountsUrl(
        "https://executor.zvc.net/",
        "google_gmail.user.personalGmail.",
      ),
    ).toBe("https://executor.zvc.net/integrations/google_gmail?tab=accounts");
  });
});
