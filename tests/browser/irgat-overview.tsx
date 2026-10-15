import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import {
  IrgatOverview,
  type IrgatOverviewTab,
} from "../../src/features/irgats/ui/IrgatOverview";
import type { ArtifactCard } from "../../src/features/artifacts/artifacts";
import type {
  IrgatSpawnedSession,
  Session,
} from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

// The real overview over in-memory sessions, documents and habits, so its
// sections lay out in Chromium and WebKit at any panel width.
const APP = "/Users/demo/src/irgatos";
const SITE = "/Users/demo/src/landing";
const HOUR = 3_600_000;
const now = Date.now();

const SESSION_TITLES = [
  "Fix flaky harness spawn test",
  "Review the updater focus check",
  "Persist split pane sizes per project",
  "Speed up first paint of long transcripts",
  "Add copy button to note code blocks",
  "Group worktree sessions under their branch",
  "Debounce file watcher events on large repos",
  "Remember the last model per harness",
  "Highlight failed turns in the session list",
  "Collapse finished tool calls by default",
  "Audit landing page Lighthouse scores",
  "Retry harness spawn when the CLI updates",
  "Keyboard shortcut for the palette on Linux",
  "Show token usage in the session footer",
  "Fix scroll jump when a long diff renders",
  "Write the 0.13 release notes",
  "Bump Tauri plugins to the latest minor",
  "Translate onboarding copy to Turkish",
  "Trim unused icons from the bundle",
  "Profile the kanban drag on WebKit",
  "Fix dark mode contrast on the pricing page",
  "Investigate the mic permission crash",
  "Add a one-click commit and push button",
];
const DOC_TITLES = [
  ["Plan: unified overview", "Sections, paging and the default tab"],
  ["Weekly summary", "What shipped, what slipped, what is next"],
  ["Release checklist 0.13", "Signing, notarizing and the update feed"],
  ["Crash report triage", "Three crashes, one root cause"],
  ["Onboarding copy review", "Tone, length and the Turkish draft"],
  ["Dependency audit", "Licenses and maintenance of new packages"],
  ["Kanban design notes", "Columns, cards and linked sessions"],
  ["Voice mode privacy notes", "On-device speech and usage keys"],
  ["Landing page audit", "Core Web Vitals and fixes"],
  ["Browser panel spec", "Profiles, bookmarks and annotations"],
  ["Retro: September", "What went well and what to change"],
  ["Pricing page plan", "Tiers, copy and a comparison table"],
  ["Q4 roadmap draft", "Themes, bets and what we drop"],
];
const HABIT_NAMES = [
  ["Morning digest", "daily", "08:30"],
  ["Weekly report", "weekly", "09:00"],
  ["Dependency check", "weekly", "10:00"],
  ["Inbox sweep", "hourly", "00:15"],
  ["Nightly test run", "daily", "23:00"],
  ["PR review nudge", "daily", "14:00"],
  ["Changelog draft", "weekly", "16:00"],
  ["Release health", "daily", "11:00"],
  ["Stale branch cleanup", "weekly", "18:00"],
  ["Error budget check", "daily", "12:00"],
  ["Docs link check", "weekly", "15:00"],
  ["Standup notes", "daily", "09:45"],
];

const params = new URLSearchParams(location.search);
const seed = params.get("seed") ?? "demo";
const empty = seed === "empty";

const launches: IrgatSpawnedSession[] = empty
  ? []
  : SESSION_TITLES.map((title, index) => ({
      sessionId: `s${index}`,
      cwd: index % 3 === 0 ? SITE : APP,
      title,
      harness: (["codex", "claude", "cursor"] as const)[index % 3]!,
      model: ["codex:gpt-5.4", "claude:sonnet", "cursor:auto"][index % 3]!,
    }));
const documents: ArtifactCard[] = empty
  ? []
  : DOC_TITLES.map(([title, summary], index) => ({
      id: `d${index}`,
      kind: index % 4 === 3 ? "html" : "document",
      title: title!,
      summary,
    }));
const habits = empty
  ? []
  : HABIT_NAMES.map(([name, kind, time], index) => ({
      id: `h${index}`,
      name,
      instructions: `Do the ${name!.toLowerCase()}.`,
      schedule: {
        scheduleKind: kind,
        minute: 15,
        time,
        dayOfWeek: 1,
      },
      enabled: index % 5 !== 4,
      createdAt: now - (30 - index) * 24 * HOUR,
      nextRunAt: now + (index + 1) * HOUR,
      lastRunAt: index % 2 ? now - index * HOUR : undefined,
    }));

// The newest launches are still open: one working, one waiting on approval.
const live = (id: string, extra: Partial<Session>) => {
  const launch = launches.find((entry) => entry.sessionId === id);
  return launch
    ? ({
        id,
        cwd: launch.cwd,
        harness: launch.harness,
        model: launch.model,
        runtimeMode: "auto",
        title: launch.title,
        blocks: [],
        ...extra,
      } as unknown as Session)
    : undefined;
};
const sessions = [
  live("s22", { busy: true }),
  live("s21", { pendingQuestion: { id: "q" } as unknown as Session["pendingQuestion"] }),
].filter((entry): entry is Session => !!entry);

type Args = Record<string, unknown>;
const handlers: Record<string, (args: Args) => unknown> = {
  irgat_read: (args) => {
    if (seed === "error") throw new Error("permission denied");
    return args.path === "habits.json"
      ? { text: JSON.stringify(habits), hash: "h" }
      : { text: null, hash: "" };
  },
  session_list_by_project: (args) =>
    launches
      .filter((launch) => launch.cwd === args.cwd)
      .map((launch, index) => ({
        id: launch.sessionId,
        cwd: launch.cwd,
        harness: launch.harness,
        model: launch.model,
        runtimeMode: "auto",
        title: launch.title,
        branch: index % 2 ? `feat/${launch.sessionId}` : undefined,
        createdAt: now - (40 - index) * HOUR,
        updatedAt: now - index * HOUR,
      })),
};

mockWindows("main");
mockIPC(
  (command, payload) => {
    const handler = handlers[command];
    return handler ? handler((payload ?? {}) as Args) : null;
  },
  { shouldMockEvents: true },
);

const events: string[] = [];
Object.assign(window, { overviewEvents: () => [...events] });

function Fixture() {
  const [tab, setTab] = useState<IrgatOverviewTab>(
    (params.get("tab") as IrgatOverviewTab) ?? "all",
  );
  const [shownDocument, setShownDocument] = useState<string>();
  return (
    <div className="flex h-full w-full justify-end bg-background-base text-content">
      <div className="flex min-w-0 flex-1 items-center justify-center text-[12px] text-content/30">
        Irgat chat
      </div>
      <div className="flex h-full">
        <IrgatOverview
          open
          irgatId="irgat-demo"
          cwd="/Users/demo/.irgatos/irgats/broski"
          agent={{
            name: "Broski",
            mascot: "cat",
            color: "#7aa2f7",
            projects: [
              { name: "irgatos", path: APP },
              { name: "landing", path: SITE },
            ],
          }}
          state={{ status: "idle" }}
          launches={launches}
          sessions={sessions}
          documents={documents}
          changes={{
            sessionId: "irgat-demo-session",
            cwd: APP,
            totals: empty ? null : { files: 7, additions: 214, deletions: 38 },
            request: {},
            projects: [APP, SITE],
          }}
          tab={tab}
          onTabChange={(next) => {
            events.push(`tab:${next}`);
            setTab(next);
          }}
          onOpenSession={(id) => {
            events.push(`session:${id}`);
          }}
          onOpenDocument={(id) => {
            events.push(`document:${id}`);
            setShownDocument(id);
          }}
          shownDocumentId={shownDocument}
          onBackFromDocument={() => setShownDocument(undefined)}
          onClose={() => events.push("close")}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
