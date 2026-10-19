import { describe, expect, it } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import {
  AGENT_TREE_ROOT_ID,
  agentDurationMs,
  agentSummary,
  buildAgentTree,
  buildAgents,
  buildIrgatTree,
  flattenTree,
  formatCost,
  sessionParents,
} from "./agentTree";

const NOW = 1_800_000_000_000;

function session(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/repo"), id, title: id, ...patch };
}

function turn(text: string, patch: Partial<Block> = {}): Block {
  return {
    id: `u-${text}`,
    role: "user",
    text,
    startedAt: NOW - 60_000,
    durationMs: 10_000,
    ...patch,
  };
}

function subagent(callId: string, status: string, name = "Review"): Block {
  return {
    id: `t-${callId}`,
    role: "tool",
    text: "",
    tool: { callId, title: "Agent", kind: "other", status, detail: `Check ${name}` },
    agentRun: {
      name,
      model: "claude-haiku",
      steps: [{ id: "s1", kind: "tool", text: "Run npm test", toolKind: "execute" }],
    },
  };
}

describe("sessionParents", () => {
  it("links app-started sessions, spawn records and orchestration workers", () => {
    const lead = session("lead-1");
    const spawned = session("app-lead-1-req-7");
    const recorded = session("child-b");
    const worker = session("worker-1", { orchestrationLeadId: "child-b" });
    const owner = session("owner", {
      blocks: [
        turn("go", {
          irgatSpawnedSessions: [
            { sessionId: "child-b", cwd: "/repo", title: "b", harness: "claude", model: "x" },
          ],
        }),
      ],
    });
    const parents = sessionParents([lead, spawned, recorded, worker, owner]);
    expect(parents.get("app-lead-1-req-7")).toBe("lead-1");
    expect(parents.get("child-b")).toBe("owner");
    expect(parents.get("worker-1")).toBe("child-b");
    expect(parents.has("lead-1")).toBe(false);
  });

  it("puts a retry under the parent of the run it replaced", () => {
    const parent = session("p");
    const failed = session("app-p-1");
    const retry = session("r");
    const parents = sessionParents([parent, failed, retry], {
      r: { from: "app-p-1" },
    });
    expect(parents.get("r")).toBe("p");
  });
});

describe("buildAgents / buildAgentTree", () => {
  const irgat = session("irgat-chat", { blocks: [turn("Plan the release")] });
  const child = session("app-irgat-chat-a", {
    busy: true,
    blocks: [
      turn("Fix the build", { durationMs: undefined, startedAt: NOW - 5_000 }),
      subagent("c1", "completed", "Lint"),
      subagent("c2", "in_progress", "Tests"),
      subagent("c3", "failed", "Docs"),
    ],
  });
  const broken = session("app-irgat-chat-b", {
    blocks: [
      turn("Deploy", { turnMetrics: { costUsd: 0.12, inputTokens: 10 } }),
      { id: "e", role: "system", text: "Provider overloaded", notice: "error" },
    ],
  });
  const asking = session("ask", {
    blocks: [
      turn("Rename"),
      {
        id: "a",
        role: "tool",
        text: "",
        tool: { title: "Run rm -rf build", kind: "execute", status: "pending" },
        approval: { requestId: 3 },
      },
    ],
  });
  const old = session("old", {
    blocks: [turn("Ancient", { startedAt: NOW - 30 * 86_400_000 })],
  });
  const options = {
    since: NOW - 86_400_000,
    irgatName: (id: string) => (id === "irgat-chat" ? "Kahya" : undefined),
  };

  it("draws three or more levels with statuses from the sessions", () => {
    const agents = buildAgents([irgat, child, broken, asking, old], options);
    const tree = buildAgentTree(agents);
    expect(tree.id).toBe(AGENT_TREE_ROOT_ID);
    const kahya = tree.children.find((node) => node.id === "irgat-chat")!;
    expect(kahya.name).toBe("Kahya");
    expect(kahya.role).toBe("irgat");
    const running = kahya.children.find((node) => node.id === child.id)!;
    expect(running.status).toBe("running");
    expect(running.children.map((node) => [node.name, node.status])).toEqual([
      ["Lint", "done"],
      ["Tests", "running"],
      ["Docs", "failed"],
    ]);
    expect(running.children[1].toolIcon).toBe("terminal");
    const failed = kahya.children.find((node) => node.id === broken.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Provider overloaded");
    expect(failed.costUsd).toBe(0.12);
    expect(failed.retryPrompt).toBe("Deploy");
    const waiting = tree.children.find((node) => node.id === "ask")!;
    expect(waiting.status).toBe("needs_you");
    expect(waiting.toolIcon).toBe("key");
    // Outside the window and nothing below it is live.
    expect(agents.some((agent) => agent.id === "old")).toBe(false);
  });

  it("marks a retried run stopped and hangs the new one beside it", () => {
    const retry = session("retry-1", {
      busy: true,
      blocks: [turn("Deploy", { durationMs: undefined, startedAt: NOW - 2_000 })],
    });
    const agents = buildAgents([irgat, broken, retry], {
      ...options,
      retries: { "retry-1": { from: broken.id } },
    });
    const tree = buildAgentTree(agents);
    const kahya = tree.children[0];
    const byId = new Map(kahya.children.map((node) => [node.id, node]));
    expect(byId.get(broken.id)?.status).toBe("stopped");
    expect(byId.get("retry-1")?.status).toBe("running");
    const order = kahya.children.map((node) => node.id);
    expect(order.indexOf("retry-1")).toBe(order.indexOf(broken.id) + 1);
  });

  it("summarises counts and spend", () => {
    const agents = buildAgents([irgat, child, broken, asking], options);
    const summary = agentSummary(agents);
    expect(summary.total).toBe(7);
    expect(summary.running).toBe(2);
    expect(summary.failed).toBe(2);
    expect(summary.needsYou).toBe(1);
    expect(summary.costUsd).toBeCloseTo(0.12);
    expect(formatCost(2.149)).toBe("$2.15");
  });

  it("counts a running agent's time up live", () => {
    const [agent] = buildAgents([child], options).filter(
      (entry) => entry.id === child.id,
    );
    expect(agentDurationMs(agent, NOW)).toBe(5_000);
    expect(agentDurationMs(agent, NOW + 1_000)).toBe(6_000);
  });
});

describe("buildIrgatTree", () => {
  const irgat = session("irgat-chat", { blocks: [turn("Plan")] });
  const launched = session("open-child", {
    blocks: [turn("Fix", { startedAt: NOW - 1_000 }), subagent("x", "completed", "Lint")],
  });
  const grandchild = session("app-open-child-1", { busy: true, blocks: [turn("Deep")] });
  const unrelated = session("other", { blocks: [turn("Elsewhere")] });

  it("hangs only what the Irgat started under its own chat, saved ones included", () => {
    const tree = buildIrgatTree(
      {
        irgatSessionId: "irgat-chat",
        sessions: [irgat, launched, grandchild, unrelated],
        launches: [
          { sessionId: "open-child", title: "Fix", harness: "claude", model: "m" },
          {
            sessionId: "saved-only",
            title: "Old review",
            harness: "codex",
            model: "m",
            updatedAt: NOW - 1_000,
          },
        ],
      },
      { since: NOW - 86_400_000, irgatName: () => "Kahya" },
    )!;
    expect(tree.id).toBe("irgat-chat");
    expect(tree.name).toBe("Kahya");
    const ids = flattenTree(tree).map((node) => node.id);
    expect(ids).toContain("open-child");
    expect(ids).toContain("app-open-child-1");
    expect(ids).toContain("open-child:agent:x");
    expect(ids).toContain("saved-only");
    expect(ids).not.toContain("other");
    const deep = flattenTree(tree).find((node) => node.id === "app-open-child-1")!;
    expect(deep.parentId).toBe("open-child");
  });
});
