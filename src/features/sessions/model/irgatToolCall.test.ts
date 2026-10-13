import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { irgatCodeToolCall, irgatCodeWorkSummary } from "./irgatToolCall";

function shell(text: string): Block {
  return { id: text, role: "tool", text, tool: { kind: "shell" } };
}

describe("Irgat CLI tool calls", () => {
  it("recognizes app actions with absolute, quoted, or bare executables", () => {
    expect(
      irgatCodeToolCall(
        shell(
          "/repo/target/debug/Irgat.app/Contents/MacOS/irgat app notes.list --json '{}'",
        ),
      )?.label,
    ).toBe("List notes");
    expect(
      irgatCodeToolCall(
        shell(
          "'/Applications/Irgat App/irgat' app folders.move --input -",
        ),
      )?.label,
    ).toBe("Move a session");
    expect(
      irgatCodeToolCall(
        shell('"C:\\Program Files\\Irgat\\irgat.exe" app notes.list'),
      )?.label,
    ).toBe("List notes");
    expect(irgatCodeToolCall(shell("irgat app --help"))?.label).toBe(
      "View CLI commands",
    );
    expect(
      irgatCodeToolCall(shell("irgat app sessions.read --json '{}'"))?.label,
    ).toBe("Read a session");
    expect(
      irgatCodeToolCall(shell("irgat app sessions.send --json '{}'"))?.label,
    ).toBe("Continue a session");
    expect(
      irgatCodeToolCall(shell("irgat app sessions.draft --json '{}'"))?.label,
    ).toBe("Save a draft");
    for (const [action, label] of [
      ["sessions.stop", "Stop a session"],
      ["sessions.archive", "Archive a session"],
      ["sessions.delete", "Delete a session"],
    ]) {
      expect(
        irgatCodeToolCall(shell(`irgat app ${action} --json '{}'`))?.label,
      ).toBe(label);
    }
    expect(
      irgatCodeToolCall(shell("irgat app notes.write --input -"))?.label,
    ).toBe("Write a note");
    expect(
      irgatCodeToolCall({
        id: "generic",
        role: "tool",
        text: "Run command:",
        tool: { kind: "other", title: "irgat app sessions.start" },
      })?.label,
    ).toBe("Start a session");
    expect(
      irgatCodeToolCall({
        id: "codex-action",
        role: "tool",
        text: "List",
        tool: {
          kind: "execute",
          preview: { kind: "shell", title: "irgat app notes.list" },
        },
      })?.label,
    ).toBe("List notes");
  });

  it("does not restyle unrelated commands or text mentioning the CLI", () => {
    expect(
      irgatCodeToolCall(shell("echo irgat app notes.list")),
    ).toBeUndefined();
    expect(irgatCodeToolCall(shell("irgat control list"))).toBeUndefined();
    expect(
      irgatCodeToolCall({
        id: "prose",
        role: "assistant",
        text: "irgat app notes.list",
      }),
    ).toBeUndefined();
  });

  it("does not compact compound shell commands or hide a longer shell preview", () => {
    for (const command of [
      "irgat app notes.list && echo extra",
      "irgat app notes.list; echo extra",
      "irgat app notes.list | cat",
      "irgat app notes.list\necho extra",
      "irgat app notes.list --json \"$(echo extra)\"",
    ]) {
      expect(irgatCodeToolCall(shell(command))).toBeUndefined();
    }
    expect(
      irgatCodeToolCall({
        id: "short-title",
        role: "tool",
        text: "irgat app notes.list",
        tool: {
          kind: "shell",
          title: "irgat app notes.list",
          preview: {
            kind: "shell",
            title: "irgat app notes.list && echo extra",
          },
        },
      }),
    ).toBeUndefined();
    expect(
      irgatCodeToolCall(
        shell("irgat app sessions.send --json '{\"prompt\":\"a; b\"}'"),
      )?.command,
    ).toBe("irgat app sessions.send --json '{\"prompt\":\"a; b\"}'");
  });

  it("names a group only when all its tool calls use Irgat", () => {
    const calls = [
      shell("irgat app --help"),
      shell("irgat app notes.list"),
    ];
    expect(irgatCodeWorkSummary(calls, true)).toBe("Using Irgat");
    expect(irgatCodeWorkSummary(calls, false)).toBe("Used Irgat");
    expect(
      irgatCodeWorkSummary([...calls, shell("git status")], true),
    ).toBeUndefined();
  });
});
