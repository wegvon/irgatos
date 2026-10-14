import { describe, expect, it } from "vitest";
import {
  cleanGroupReply,
  groupRoomBlock,
  groupTurnPrompt,
  soulRole,
  speakerLabel,
  transcriptLine,
  transcriptWindow,
  type GroupRosterEntry,
} from "./irgatGroupContext";
import type { IrgatFiles } from "./irgatFiles";
import type { IrgatGroupMessage } from "./irgatGroups";

const files = (soul: string, memory = ""): IrgatFiles => ({
  id: "x",
  dir: "/data/agents/x",
  soul,
  soulHash: "s",
  memory,
  memoryHash: "m",
  memoryPath: "/data/agents/x/MEMORY.md",
  topics: [],
});
const look = (name: string) => ({ name, mascot: "crab", color: "#f00", projects: [] });

const roster: GroupRosterEntry[] = [
  { id: "a", name: "Architect", role: "Designs systems and owns boundaries." },
  { id: "s", name: "Security", role: "Reviews auth and secrets." },
  { id: "f", name: "Frontend" },
];

let at = 0;
const msg = (m: Partial<IrgatGroupMessage> & Pick<IrgatGroupMessage, "role" | "text">): IrgatGroupMessage => ({
  id: `m${++at}`,
  at,
  ...m,
});

describe("member roles from SOUL.md", () => {
  it("takes the first lines of instructions, skipping headings and list marks", () => {
    expect(
      soulRole("# Soul\n\n- You are the **security** reviewer.\n- Flag leaked secrets.\n- Third"),
    ).toBe("You are the security reviewer. Flag leaked secrets.");
  });

  it("has none while the soul is still the default placeholder", () => {
    expect(soulRole("# Soul\n\n(Add anything it should always keep in mind.)")).toBeUndefined();
    expect(soulRole(undefined)).toBeUndefined();
  });

  it("stays one short line", () => {
    expect(soulRole("x".repeat(500))!.length).toBeLessThanOrEqual(180);
  });
});

describe("the labeled transcript", () => {
  it("labels the user, other members, and the speaker itself", () => {
    expect(speakerLabel({ role: "user" })).toBe("[User]");
    expect(speakerLabel({ role: "irgat", irgatId: "a", name: "Architect" })).toBe("[Irgat: Architect]");
    expect(speakerLabel({ role: "irgat", irgatId: "a", name: "Architect" }, "a")).toBe(
      "[Irgat: Architect (you)]",
    );
  });

  it("leaves notices out, shows reactions and attachment paths", () => {
    expect(transcriptLine(msg({ role: "notice", text: "Security failed" }))).toBeUndefined();
    expect(
      transcriptLine(msg({ role: "irgat", irgatId: "s", name: "Security", text: "", reaction: "👍" })),
    ).toBe("[Irgat: Security] reacted 👍");
    expect(
      transcriptLine(
        msg({
          role: "user",
          text: "look",
          attachments: [{ id: "1", name: "a.ts", kind: "file", mimeType: "text/plain", size: 1, path: "/w/a.ts" }],
        }),
      ),
    ).toBe("[User] look\n(Attached: /w/a.ts)");
  });

  it("keeps the newest lines that fit and counts the rest", () => {
    const messages = Array.from({ length: 6 }, (_, i) => msg({ role: "user", text: `line ${i}` }));
    const window = transcriptWindow(messages, undefined, { messages: 2, chars: 1000 });
    expect(window.lines).toEqual(["[User] line 4", "[User] line 5"]);
    expect(window.dropped).toBe(4);
  });
});

describe("the room block", () => {
  it("lists every member with handle and role, marking the speaker", () => {
    const block = groupRoomBlock({ room: "Launch", self: roster[1], roster });
    expect(block).toContain('You are in "Launch"');
    expect(block).toContain("You are Security");
    expect(block).toContain("- Architect, @Architect: Designs systems and owns boundaries.");
    expect(block).toContain("- Security (you), @Security: Reviews auth and secrets.");
    expect(block).toContain("- Frontend, @Frontend: No standing role written yet.");
  });
});

describe("a round's turns", () => {
  const user = msg({ role: "user", text: "Should we ship the login rewrite?" });
  const architectReply = msg({
    role: "irgat",
    irgatId: "a",
    name: "Architect",
    text: "Yes: the session store boundary is clean now.",
  });

  it("gives the first speaker its soul, memory, the roster and the user's message", () => {
    const prompt = groupTurnPrompt({
      room: "Launch",
      self: roster[0],
      look: look("Architect"),
      files: files("You design systems.", "- 2026-10-01 · prefers small PRs"),
      roster,
      messages: [user],
      reason: { kind: "round", messageId: user.id },
      after: ["Security", "Frontend"],
    });
    expect(prompt).toContain("<soul>");
    expect(prompt).toContain("You design systems.");
    expect(prompt).toContain("prefers small PRs");
    expect(prompt).toContain("<group_room>");
    expect(prompt).toContain("[User] Should we ship the login rewrite?");
    expect(prompt).toContain("You reply first");
    expect(prompt).toContain("Security and Frontend will reply after you");
    expect(prompt).not.toContain("<group_transcript>");
  });

  it("shows the second speaker the first speaker's reply, labeled with its name", () => {
    const prompt = groupTurnPrompt({
      room: "Launch",
      self: roster[1],
      look: look("Security"),
      files: files("You review auth."),
      roster,
      messages: [user, architectReply],
      reason: { kind: "round", messageId: user.id },
      after: ["Frontend"],
    });
    const userAt = prompt.indexOf("[User] Should we ship the login rewrite?");
    const architectAt = prompt.indexOf(
      "[Irgat: Architect] Yes: the session store boundary is clean now.",
    );
    expect(userAt).toBeGreaterThan(-1);
    expect(architectAt).toBeGreaterThan(userAt);
    expect(prompt).toContain("You review auth.");
    expect(prompt).toContain("Architect already replied to the user above");
    expect(prompt).toContain("do not repeat it");
    expect(prompt.indexOf("<your_turn>")).toBeGreaterThan(architectAt);
  });

  it("labels the speaker's own earlier lines as its own", () => {
    const earlier = msg({ role: "irgat", irgatId: "s", name: "Security", text: "Rotate keys first." });
    const next = msg({ role: "user", text: "Done. Now?" });
    const prompt = groupTurnPrompt({
      room: "Launch",
      self: roster[1],
      look: look("Security"),
      files: files("You review auth."),
      roster,
      messages: [user, architectReply, earlier, next],
      reason: { kind: "round", messageId: next.id },
    });
    expect(prompt).toContain("<group_transcript>");
    expect(prompt).toContain("[Irgat: Security (you)] Rotate keys first.");
    expect(prompt).toContain("[User] Done. Now?");
    expect(prompt).toContain("You reply first");
  });

  it("tells a handed-off member who addressed it", () => {
    const handoff = msg({
      role: "irgat",
      irgatId: "a",
      name: "Architect",
      text: "@Security can you check token expiry?",
    });
    const prompt = groupTurnPrompt({
      room: "Launch",
      self: roster[1],
      look: look("Security"),
      files: files("You review auth."),
      roster,
      messages: [user, handoff],
      reason: { kind: "handoff", messageId: handoff.id },
    });
    expect(prompt).toContain("[Irgat: Architect] @Security can you check token expiry?");
    expect(prompt).toContain("Architect addressed you");
  });

  it("asks a reviewer to critique the named member's message", () => {
    const prompt = groupTurnPrompt({
      room: "Launch",
      self: roster[2],
      look: look("Frontend"),
      files: files("You build UI."),
      roster,
      messages: [user, architectReply],
      reason: { kind: "review", messageId: architectReply.id },
    });
    expect(prompt).toContain("review Architect's message above");
  });
});

it("strips a label the model echoed back", () => {
  expect(cleanGroupReply("[Irgat: Security (you)] Rotate keys.", "Security")).toBe("Rotate keys.");
  expect(cleanGroupReply("  [irgat: Security]  ok", "Security")).toBe("ok");
  expect(cleanGroupReply("[Irgat: Architect] said x", "Security")).toBe("[Irgat: Architect] said x");
});
