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
      { id: "r", role: "assistant", text: "Fixed the window reset." },
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
  chat("docs", "claude", "/Users/demo/src/web", "Explain the deploy script", {
    blocks: [sent(26 * 60 * MIN), { id: "r", role: "assistant", text: "It runs three steps." }],
  }),
];

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
      <FleetView
        besideRail
        sessions={sessions}
        unseenFinishedIds={new Set(["limiter"])}
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
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
