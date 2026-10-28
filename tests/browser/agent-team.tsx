import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { FleetView } from "../../src/features/fleet/ui/FleetView";
import { OrchestrationSidebarAgents } from "../../src/features/orchestration/ui/OrchestrationSidebarAgents";
import { summarizeOrchestration } from "../../src/features/orchestration/model/orchestrationSummary";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../src/features/orchestration/model/orchestrationState";
import {
  newSession,
  type Block,
  type HarnessId,
  type Session,
} from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

// A live orchestration team in Fleet and in the lead's sidebar card, plus
// results waiting in Ready to review. ?scheme=light for the light theme.
const now = Date.now();
const MIN = 60_000;
const params = new URLSearchParams(location.search);
if (params.get("scheme") === "light")
  document.documentElement.classList.add("theme-light");
localStorage.setItem("irgatos.fleet.mode.v1", "sessions");
// Track every result in this fixture, however old.
localStorage.setItem(
  "irgatos.fleet.review.v1",
  JSON.stringify({
    since: 0,
    marks: { notes: { turnAt: now - 50 * MIN, state: "later" } },
  }),
);
mockWindows("main");
mockIPC(() => null);

const sent = (ago: number, length = 10 * MIN): Block => ({
  id: `u-${ago}`,
  role: "user",
  text: "Go",
  startedAt: now - ago,
  durationMs: length,
});
const edit = (path: string): Block => ({
  id: `edit-${path}`,
  role: "tool",
  text: `Edit ${path.split("/").pop()}`,
  tool: { kind: "edit", status: "completed", preview: { kind: "write", path } },
});
const running = (query: string): Block => ({
  id: `run-${query}`,
  role: "tool",
  text: query,
  tool: { kind: "execute", status: "in_progress", preview: { kind: "shell", query } },
});

function chat(id: string, harness: HarnessId, title: string, patch: Partial<Session>): Session {
  return { ...newSession(harness, "/Users/demo/src/shop"), id, title, ...patch };
}

function task(id: string, title: string, harness: HarnessId, patch: Partial<OrchestrationTask>): OrchestrationTask {
  return {
    id,
    sessionId: `w-${id}`,
    title,
    harness,
    model: harness === "codex" ? "gpt-5.5-codex" : "claude-sonnet-5-5",
    prompt: "",
    files: [id],
    scopes: [`/Users/demo/src/shop/${id}`],
    dependsOn: [],
    status: "queued",
    accepted: false,
    result: "",
    delivered: true,
    ...patch,
  };
}

const run: OrchestrationRun = {
  version: 2,
  leadId: "lead",
  cwd: "/Users/demo/src/shop",
  status: "active",
  allowedHarnesses: ["codex", "claude"],
  maxWorkers: 2,
  cli: "irgat",
  continuations: 0,
  requests: {},
  tasks: [
    task("api", "Payment API endpoints", "codex", {
      status: "running",
      scopes: ["/Users/demo/src/shop/server"],
      guidance: [
        {
          id: "g1",
          text: "Keep the v1 routes working until the app ships",
          at: now - 3 * MIN,
          status: "delivered",
          via: "worker",
          leadNotified: true,
        },
      ],
    }),
    task("schema", "Orders table migration", "claude", {
      status: "running",
      scopes: ["/Users/demo/src/shop/db"],
    }),
    task("checkout", "Checkout form", "claude", { dependsOn: ["api"] }),
    task("seed", "Seed data refresh", "codex", {
      scopes: ["/Users/demo/src/shop/db/seed.ts"],
    }),
    task("e2e", "End-to-end checkout tests", "codex", {
      dependsOn: ["checkout"],
      guidance: [
        {
          id: "g2",
          text: "Cover the declined-card path",
          at: now - MIN,
          status: "pending",
          via: "prompt",
          leadNotified: true,
        },
      ],
    }),
    task("copy", "Receipt email copy", "claude", {
      status: "completed",
      result: "Updated receipts",
    }),
  ],
};

const sessions: Session[] = [
  chat("lead", "claude", "Ship checkout v2", {
    branch: "checkout-v2",
    blocks: [sent(30 * MIN, 2 * MIN), { id: "r", role: "assistant", text: "Supervising." }],
  }),
  chat("w-api", "codex", "Payment API endpoints", {
    orchestrationLeadId: "lead",
    busy: true,
    blocks: [sent(12 * MIN), running("pnpm test server/payments")],
  }),
  chat("w-schema", "claude", "Orders table migration", {
    orchestrationLeadId: "lead",
    busy: true,
    blocks: [sent(9 * MIN), running("pnpm db:migrate --dry-run")],
  }),
  chat("limiter", "claude", "Fix the rate limiter reset", {
    branch: "fix/limiter",
    blocks: [sent(26 * 60 * MIN), edit("/Users/demo/src/shop/src/limiter.ts"), edit("/Users/demo/src/shop/src/limiter.test.ts")],
  }),
  chat("notes", "codex", "Draft the 2.4 release notes", {
    blocks: [sent(60 * MIN), edit("/Users/demo/src/shop/CHANGELOG.md")],
  }),
];

// The fixture's run lives in the real orchestrator, so guidance and cancel
// go through the same code the app uses. Delivery is simulated.
orchestrator.bind({
  session: (id) => sessions.find((session) => session.id === id),
  sessions: () => sessions,
  choices: () => [],
  createWorker: async () => {
    throw new Error("fixture");
  },
  integrateWorker: async () => ({ files: [], alreadyApplied: 0 }),
  cleanupWorker: async () => true,
  submit: () => {},
  stop: async () => {},
  steer: async () => {},
  respondApproval: () => {},
  answerQuestion: () => {},
} as never);
(orchestrator as unknown as { runs: OrchestrationRun[] }).runs = [run];

function Fixture() {
  return (
    <div className="flex h-full w-full bg-background-base text-content">
      <aside className="sidebar-glass w-72 shrink-0 overflow-y-auto border-r border-stroke p-2">
        <div className="rounded-lg bg-selection/60 p-2.5" data-fixture-lead-card>
          <p className="text-[13px] font-semibold">Ship checkout v2</p>
          <OrchestrationSidebarAgents
            leadId="lead"
            summary={summarizeOrchestration(run, sessions)}
          />
        </div>
      </aside>
      <FleetView
        besideRail
        sessions={sessions}
        unseenFinishedIds={new Set()}
        onClose={() => {}}
        onOpenSession={() => {}}
        onApproval={() => {}}
        onQuestionReply={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
