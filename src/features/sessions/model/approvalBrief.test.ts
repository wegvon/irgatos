import { describe, expect, it } from "vitest";
import { approvalBrief, approvalReason } from "./approvalBrief";
import type { Block } from "./session";

const shell = (query: string): Block => ({
  id: `sh-${query}`,
  role: "tool",
  text: query,
  tool: { kind: "execute", status: "pending", preview: { kind: "shell", query } },
  approval: { requestId: 1 },
});

const brief = (query: string) => approvalBrief(shell(query), { cwd: "/repo" });

describe("approval brief", () => {
  it("explains a test run as safe, with the command kept as detail", () => {
    const result = brief("npm test -- src/export");
    expect(result).toMatchObject({
      what: "Run the tests",
      reversible: "none",
      risk: "low",
      technical: "npm test -- src/export",
    });
    expect(result.impact).toMatch(/Code is not changed/);
  });

  it("lets the riskiest part of a chained command decide", () => {
    expect(brief("npm run build && git push origin main")).toMatchObject({
      what: "Push commits to the remote",
      reversible: "partly",
      risk: "high",
    });
    expect(brief("cd web && rm -rf dist")).toMatchObject({ what: "Delete files", reversible: "no" });
    expect(brief("git push --force origin main").reversible).toBe("no");
    expect(brief("git reset --hard HEAD~1").what).toBe("Discard uncommitted changes");
  });

  it("knows read-only, dependency and unknown commands", () => {
    expect(brief("git status && ls src").impact).toBe("Only reads. Nothing changes.");
    expect(brief("npm test 2>&1 > /dev/null").what).toBe("Run the tests");
    expect(brief("pnpm add zod")).toMatchObject({ what: "Change dependencies", reversible: "yes" });
    expect(brief("echo hi > notes.txt").reversible).toBe("partly");
    expect(brief("./deploy-thing")).toMatchObject({
      what: "Run ./deploy-thing",
      reversible: "unknown",
      risk: "medium",
    });
    expect(brief("curl -X POST https://api.example.com/x")).toMatchObject({ risk: "high" });
    expect(brief("curl https://example.com")).toMatchObject({ risk: "low" });
  });

  it("names the file for an edit and says when a worktree keeps it apart", () => {
    const edit: Block = {
      id: "e",
      role: "tool",
      text: "Edit src/export.ts",
      tool: {
        kind: "edit",
        status: "pending",
        preview: { kind: "write", path: "/repo-wt/src/export.ts", additions: 4, deletions: 1 },
      },
      approval: { requestId: 2 },
    };
    const result = approvalBrief(edit, { cwd: "/repo", workCwd: "/repo-wt" });
    expect(result.what).toBe("Edit export.ts");
    expect(result.impact).toBe(
      "Changes export.ts (+4 −1 lines). Only in its own worktree (repo-wt); your project folder stays as it is.",
    );
    expect(result).toMatchObject({ reversible: "yes", risk: "low" });
  });

  it("takes the reason from the agent's last words in the same turn", () => {
    const ask = shell("npm test");
    const blocks: Block[] = [
      { id: "u0", role: "user", text: "old" },
      { id: "a0", role: "assistant", text: "Old reason." },
      { id: "u", role: "user", text: "Fix the export" },
      { id: "a", role: "assistant", text: "I changed the handler.\n\nLet me run the tests to confirm the fix:" },
      { id: "r", role: "thinking", text: "hmm" },
      ask,
    ];
    expect(approvalReason(blocks, ask)).toBe("Let me run the tests to confirm the fix.");
    expect(approvalReason([{ id: "u", role: "user", text: "go" }, ask], ask)).toBeUndefined();
    expect(approvalBrief(ask, { blocks }).why).toBe("Let me run the tests to confirm the fix.");
  });
});

describe("approval brief in a worktree", () => {
  it("only says the worktree keeps it apart when the change stays on this Mac", () => {
    const context = { cwd: "/repo", workCwd: "/repo-wt" };
    expect(approvalBrief(shell("git push origin main"), context).impact).not.toMatch(/worktree/);
    expect(approvalBrief(shell("pnpm add zod"), context).impact).toMatch(/Only in its own worktree/);
    expect(approvalBrief(shell("npm test"), context).impact).not.toMatch(/worktree/);
  });
});
