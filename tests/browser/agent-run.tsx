import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { AgentRunCard } from "../../src/features/sessions/ui/AgentRunCard";
import type { Block } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

// The real status card over a scripted coding turn: reads, a search, edits,
// tests, then an approval for git push. Approve finishes the run.
// ?scheme=light shows the light theme; ?speed=4 plays it four times faster.
const params = new URLSearchParams(location.search);
if (params.get("scheme") === "light")
  document.documentElement.classList.add("theme-light");
const speed = Number(params.get("speed") ?? "1") || 1;
const fail = params.get("fail") === "1";

mockWindows("main");
mockIPC(() => null);

const cwd = "/Users/turel/billing";
const tests = ["proration", "invoice", "credit", "refund", "tax"].map(
  (name) => `test/${name}.test.ts`,
);

const read = (path: string, status: string): Block => ({
  id: `read:${path}`,
  role: "tool",
  text: "Read",
  tool: {
    kind: "read",
    status,
    preview: { kind: "read", path: `${cwd}/${path}` },
  },
});
const edit = (path: string, status: string): Block => ({
  id: `edit:${path}`,
  role: "tool",
  text: "Edit",
  tool: {
    kind: "edit",
    status,
    preview: {
      kind: "write",
      path: `${cwd}/${path}`,
      additions: 3,
      deletions: 1,
    },
  },
});
const find = (query: string, status: string): Block => ({
  id: `find:${query}`,
  role: "tool",
  text: `Find ${query}`,
  tool: { kind: "search", status, preview: { kind: "search", query } },
});
const shell = (
  command: string,
  status: string,
  requestId?: number,
  decided?: "allow" | "deny",
): Block => ({
  id: `run:${command}`,
  role: requestId != null ? "approval" : "tool",
  text: command,
  tool: { kind: "execute", status },
  approval: requestId != null ? { requestId, decided } : undefined,
});

type Script = { at: number; apply: (blocks: Block[]) => Block[] }[];

function upsert(block: Block) {
  return (blocks: Block[]) => {
    const index = blocks.findIndex((entry) => entry.id === block.id);
    if (index < 0) return [...blocks, block];
    const next = blocks.slice();
    next[index] = block;
    return next;
  };
}

const files = Array.from(
  { length: 12 },
  (_, i) => `src/billing/part${i + 1}.ts`,
);
const script: Script = [
  ...files.map((path, i) => ({
    at: 200 + i * 140,
    apply: upsert(read(path, "in_progress")),
  })),
  ...files.map((path, i) => ({
    at: 400 + i * 150,
    apply: upsert(read(path, "completed")),
  })),
  { at: 2200, apply: upsert(find("prorateInvoice", "in_progress")) },
  { at: 3700, apply: upsert(find("prorateInvoice", "completed")) },
  { at: 3800, apply: upsert(edit("src/billing/invoice.ts", "in_progress")) },
  { at: 5800, apply: upsert(edit("src/billing/invoice.ts", "completed")) },
  ...tests.flatMap((path, i) => [
    { at: 5900 + i * 500, apply: upsert(edit(path, "in_progress")) },
    { at: 6300 + i * 500, apply: upsert(edit(path, "completed")) },
  ]),
  { at: 8500, apply: upsert(shell("npm test", "in_progress")) },
  {
    at: 11500,
    apply: upsert(shell("npm test", fail ? "failed" : "completed")),
  },
  ...(fail
    ? []
    : [
        {
          at: 11700,
          apply: upsert(
            shell("git push -u origin fix/proration-rounding", "pending", 1),
          ),
        },
      ]),
];

function Fixture() {
  const startedAt = useRef(Date.now());
  const [blocks, setBlocks] = useState<Block[]>(() => [
    {
      id: "turn",
      role: "user",
      text: "Fix the proration rounding bug",
      startedAt: startedAt.current,
      turnModel: {
        harness: "claude",
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
      },
    },
  ]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const timers = script.map((step) =>
      window.setTimeout(() => setBlocks(step.apply), step.at / speed),
    );
    if (fail) {
      timers.push(
        window.setTimeout(() => {
          setBlocks((prev) => [
            ...prev,
            {
              id: "error",
              role: "system",
              notice: "error",
              text: "3 tests failed: proration rounds half-cents down",
            },
          ]);
          finish();
        }, 11800 / speed),
      );
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const finish = () => {
    setBusy(false);
    setBlocks((prev) =>
      prev.map((block) =>
        block.id === "turn"
          ? { ...block, durationMs: Date.now() - startedAt.current }
          : block,
      ),
    );
  };

  return (
    <div className="flex h-full w-full items-end justify-center bg-background-base p-10 text-content">
      <div className="w-[440px]">
        <AgentRunCard
          session={{
            id: "s1",
            blocks,
            busy,
            cwd,
            harness: "claude",
            model: "claude-sonnet-5-5",
          }}
          onStop={() => setBusy(false)}
          onApproval={(requestId, decision) => {
            const command = "git push -u origin fix/proration-rounding";
            setBlocks(
              upsert(
                shell(
                  command,
                  decision === "allow" ? "in_progress" : "failed",
                  requestId,
                  decision,
                ),
              ),
            );
            if (decision === "deny") return finish();
            window.setTimeout(() => {
              setBlocks(
                upsert(shell(command, "completed", requestId, "allow")),
              );
              finish();
            }, 1500 / speed);
          }}
          onContinue={() => location.reload()}
          onOpenRun={() => undefined}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
