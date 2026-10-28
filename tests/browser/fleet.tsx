import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { FleetView } from "../../src/features/fleet/ui/FleetView";
import { countNeedsYou } from "../../src/features/fleet/model/fleet";
import { FleetNeedsYouCount, RailAction } from "../../src/app/shell/RailAction";
import { Radar } from "../../src/shared/ui/icons";
import {
  newSession,
  type Block,
  type HarnessId,
  type Session,
} from "../../src/features/sessions/model/session";
import { saveGoals } from "../../src/features/goals/model/goalStore";
import { syncGoals } from "../../src/features/goals/model/goals";
import type { OrchestrationRun } from "../../src/features/orchestration/model/orchestrationState";
import { INTERRUPT_MESSAGE } from "../../src/features/sessions/model/inFlight";
import "../../src/styles/index.css";

// The real Fleet view over sessions from three projects. Answering a request
// settles it the way a harness would, so the rail count follows along.
const now = Date.now();
const MIN = 60_000;

function chat(
  id: string,
  harness: HarnessId,
  cwd: string,
  title: string,
  patch: Partial<Session>,
): Session {
  return { ...newSession(harness, cwd), id, title, ...patch };
}

const sent = (ago: number, text = "Go"): Block => ({
  id: `u-${ago}`,
  role: "user",
  text,
  startedAt: now - ago,
  durationMs: Math.min(ago / 2, 4 * MIN),
});

const edit = (path: string): Block => ({
  id: `edit-${path}`,
  role: "tool",
  text: `Edit ${path.split("/").pop()}`,
  tool: { kind: "edit", status: "completed", preview: { kind: "write", path } },
});

const seed: Session[] = [
  chat("publish", "claude", "/Users/demo/src/sdk", "Publish the 2.4 SDK", {
    busy: true,
    branch: "release-2.4",
    worktreeCwd: "/Users/demo/src/sdk-worktrees/release-2.4",
    blocks: [
      sent(9 * MIN),
      {
        id: "ask-publish",
        role: "tool",
        text: "Run npm publish",
        tool: {
          kind: "execute",
          status: "pending",
          preview: { kind: "shell", query: "npm publish --access public --tag next" },
        },
        approval: { requestId: 1 },
      },
    ],
  }),
  chat("cache", "codex", "/Users/demo/src/api", "Add a response cache", {
    busy: true,
    blocks: [sent(4 * MIN)],
    pendingQuestion: {
      requestId: 2,
      title: "Cache store",
      questions: [
        {
          id: "store",
          header: "Cache store",
          prompt: "Which store should the response cache use?",
          multiSelect: false,
          allowCustom: true,
          options: [
            { id: "redis", label: "Redis", description: "Shared across instances" },
            { id: "lru", label: "In-memory LRU", description: "Per process, no new service" },
          ],
        },
      ],
    },
  }),
  chat("limiter", "claude", "/Users/demo/src/api", "Fix the rate limiter reset", {
    branch: "fix/limiter",
    blocks: [
      sent(12 * MIN),
      edit("/Users/demo/src/api/src/limiter.ts"),
      edit("/Users/demo/src/api/src/limiter.test.ts"),
      {
        id: "limiter-test",
        role: "tool",
        text: "Run tests",
        tool: { kind: "execute", status: "completed", preview: { kind: "shell", query: "pnpm vitest run limiter" } },
      },
      {
        id: "r",
        role: "assistant",
        text: "Fixed the window reset: a blocked client's window now restarts when it ends, so it can call again. Try it on the local server at http://localhost:4000/limits.\n\n<completion_criteria>\n- A client blocked at the limit can call again once its window ends\n- Existing limiter tests still pass\n- No change to the limits users see\n</completion_criteria>\n\n<criteria_check>\n- [met] A client blocked at the limit can call again once its window ends — new test resets after 60s\n- [met] Existing limiter tests still pass — 42 passed\n- [unverified] No change to the limits users see — needs a look at the dashboard\n</criteria_check>\n\n<known_limitations>\n- Clients already blocked when you deploy stay blocked until their old window ends\n</known_limitations>",
      },
    ],
  }),
  chat("header", "cursor", "/Users/demo/src/web", "Restyle the marketing header", {
    busy: true,
    blocks: [
      sent(2 * MIN),
      {
        id: "t",
        role: "tool",
        text: "Run tests",
        tool: { kind: "execute", status: "in_progress", preview: { kind: "shell", query: "pnpm test header" } },
      },
    ],
  }),
  chat("migrate", "codex", "/Users/demo/src/api", "Migrate the billing schema", {
    branch: "billing-v2",
    blocks: [
      sent(40 * MIN, "Migrate"),
      {
        id: "migrate-steps",
        role: "tasks",
        text: "",
        taskList: {
          items: [
            { text: "Write the migration", status: "completed" },
            { text: "Backfill old invoices", status: "in_progress" },
            { text: "Drop the old columns", status: "pending" },
          ],
        },
      },
      edit("/Users/demo/src/api/migrations/0042_billing.sql"),
      { id: "migrate-stop", role: "system", text: INTERRUPT_MESSAGE, notice: "interrupt" },
    ],
  }),
  chat("publish-notes", "codex", "/Users/demo/src/sdk", "Draft the 2.4 release notes", {
    orchestrationLeadId: "publish",
    blocks: [sent(8 * MIN, "Draft release notes"), { id: "r", role: "assistant", text: "Drafted." }],
  }),
  chat("docs", "claude", "/Users/demo/src/web", "Explain the deploy script", {
    blocks: [sent(26 * 60 * MIN), { id: "r", role: "assistant", text: "It runs three steps." }],
  }),
];

// ?scheme=light shows the light theme; ?sidebar=1 the narrow sidebar Fleet.
const params = new URLSearchParams(location.search);
if (params.get("scheme") === "light")
  document.documentElement.classList.add("theme-light");
const asSidebar = params.get("sidebar") === "1";
// ?mode=goals opens the Goals tab; the default fixture shows Sessions.
localStorage.setItem("irgatos.fleet.mode.v1", params.get("mode") ?? "sessions");
if (params.get("state") !== "empty")
  saveGoals(syncGoals([], seed, { now, interruptedIds: new Set(["migrate"]) }));

mockWindows("main");
mockIPC(() => null);

const events: string[] = [];
Object.assign(window, { fleetEvents: () => [...events] });

function settle(sessions: Session[], id: string, requestId: number): Session[] {
  return sessions.map((session) =>
    session.id !== id
      ? session
      : {
          ...session,
          pendingQuestion:
            session.pendingQuestion?.requestId === requestId ? undefined : session.pendingQuestion,
          blocks: session.blocks.map((block) =>
            block.approval?.requestId === requestId
              ? { ...block, approval: { requestId, decided: "allow" as const } }
              : block,
          ),
        },
  );
}

// The SDK release is coordinated: one worker done, one running, one queued.
const task = (id: string, title: string, status: string, patch: object = {}) => ({
  id,
  sessionId: id,
  title,
  harness: "claude",
  model: "m",
  prompt: "",
  files: [],
  scopes: [],
  dependsOn: [],
  status,
  accepted: status === "completed",
  result: "",
  delivered: false,
  ...patch,
});
const runs = [
  {
    leadId: "publish",
    status: "active",
    tasks: [
      task("publish-notes", "Draft the 2.4 release notes", "completed", { result: "Notes cover 14 changes and 2 breaking ones" }),
      task("publish-bump", "Bump package versions", "running"),
      task("publish-tag", "Tag and push the release", "queued", { dependsOn: ["publish-bump"] }),
    ],
  },
] as unknown as OrchestrationRun[];

function Fixture() {
  const state = new URLSearchParams(location.search).get("state");
  const [sessions, setSessions] = useState(state === "empty" ? [] : seed);
  const count = countNeedsYou(sessions);
  return (
    <div className="flex h-full w-full bg-background-base text-content">
      <nav className="sidebar-glass flex w-56 shrink-0 flex-col gap-px border-r border-stroke p-2 max-sm:hidden">
        <RailAction
          label="Fleet"
          icon={Radar}
          active
          onClick={() => {}}
          meta={<FleetNeedsYouCount count={count} />}
        />
      </nav>
      <div className={asSidebar ? "flex w-80 shrink-0 flex-col border-r border-stroke" : "contents"}>
      <FleetView
        besideRail={!asSidebar}
        sidebar={asSidebar}
        sessions={sessions}
        unseenFinishedIds={new Set(["limiter"])}
        interruptedSessionIds={new Set(["migrate"])}
        orchestrationRuns={runs}
        onResumeGoalSession={(id, cause) => events.push(`resume:${id}:${cause}`)}
        onClose={() => {}}
        onOpenSession={(id) => events.push(`open:${id}`)}
        onApproval={(id, requestId, decision) => {
          events.push(`${decision}:${id}:${requestId}`);
          setSessions((current) => settle(current, id, requestId));
        }}
        onQuestionReply={(id, requestId, reply) => {
          events.push(`answer:${id}:${requestId}:${JSON.stringify(reply)}`);
          setSessions((current) => settle(current, id, requestId));
        }}
      />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
