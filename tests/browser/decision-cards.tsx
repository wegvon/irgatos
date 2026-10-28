import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ApprovalToasts } from "../../src/features/sessions/ui/ApprovalToasts";
import {
  deviceNotificationText,
  notificationText,
} from "../../src/features/notifications/model/notifications";
import type { Session } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

// The real decision cards over five pending requests: two approvals from the
// same chat title in different worktrees, an optional timed question and two
// more that wait behind the Fleet link. Beside them, the text the Mac banner
// and the phone push would carry. ?scheme=light shows the light theme;
// ?later=1 opens the first card's Later panel.
const params = new URLSearchParams(location.search);
if (params.get("scheme") === "light")
  document.documentElement.classList.add("theme-light");

mockWindows("main");
mockIPC(() => null);
localStorage.clear();

const base = (id: string, cwd: string, title: string): Session => ({
  id,
  cwd,
  title,
  harness: "claude",
  model: "",
  modelSettings: {},
  runtimeMode: "supervised",
  blocks: [],
});

const approval = (
  id: string,
  cwd: string,
  title: string,
  what: string,
  worktree?: { cwd: string; branch: string },
): Session => ({
  ...base(id, cwd, title),
  ...(worktree ? { worktreeCwd: worktree.cwd, branch: worktree.branch } : {}),
  blocks: [
    {
      id: `${id}-a`,
      role: "tool",
      text: what,
      tool: { title: what },
      approval: { requestId: 1 },
    },
  ],
});

const question: Session = {
  ...base("q", "/Users/turel/Documents/GitHub/billing", "Pick the invoice format"),
  harness: "codex",
  pendingQuestion: {
    requestId: 2,
    autoResolveAt: Date.now() + 100_000,
    questions: [
      {
        id: "f",
        prompt: "Keep PDF invoices, or switch to HTML?",
        multiSelect: false,
        allowCustom: true,
        options: [],
      },
    ],
  },
};

const sessions = [
  approval("a1", "/Users/turel/Documents/GitHub/irgatos", "Fix login", "Run npm test", {
    cwd: "/Users/turel/Documents/GitHub/irgatos-build-41",
    branch: "fix/login-redirect",
  }),
  approval("a2", "/Users/turel/Documents/GitHub/irgatos", "Fix login", "Run git push origin fix/login-mobile", {
    cwd: "/Users/turel/Documents/GitHub/irgatos-build-42",
    branch: "fix/login-mobile",
  }),
  question,
  approval("a3", "/Users/turel/Documents/GitHub/feed", "Refresh trending", "Run curl api.github.com"),
  approval("a4", "/Users/turel/Documents/GitHub/mail", "Archive newsletters", "Edit rules.json"),
];

const notices = sessions.map((session) => ({
  session,
  sessionId: session.id,
  requestId: session.pendingQuestion?.requestId ?? 1,
  kind: session.pendingQuestion ? ("question" as const) : ("approval" as const),
  label: session.pendingQuestion
    ? session.pendingQuestion.questions[0].prompt
    : session.blocks[0].text,
}));

function Banner({ session }: { session: Session }) {
  const event = session.pendingQuestion
    ? { kind: "question" as const, requestId: 2 }
    : { kind: "approval" as const, requestId: 1 };
  const mac = notificationText(session, event);
  const phone = deviceNotificationText(mac, true);
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-2xl bg-content/10 px-3.5 py-2.5 shadow-lg">
        <div className="text-[10px] uppercase tracking-wide text-content/40">
          Mac banner · Irgatos
        </div>
        <div className="text-[13px] font-semibold text-content">{mac.title}</div>
        <div className="text-[12px] font-medium text-content/80">{mac.subtitle}</div>
        <div className="text-[12px] text-content/70">{mac.body}</div>
      </div>
      <div className="rounded-2xl bg-content/5 px-3.5 py-2.5">
        <div className="text-[10px] uppercase tracking-wide text-content/40">
          Phone push
        </div>
        <div className="text-[13px] font-semibold text-content">{phone.title}</div>
        <div className="text-[12px] text-content/70">{phone.body}</div>
      </div>
    </div>
  );
}

function Fixture() {
  const [log, setLog] = useState<string[]>([]);
  return (
    <div className="flex h-full bg-background-base p-6 text-content">
      <div className="flex w-[380px] flex-col gap-4 overflow-auto">
        <h1 className="text-[15px] font-semibold">Banner text</h1>
        {sessions.slice(0, 3).map((session) => (
          <Banner key={session.id} session={session} />
        ))}
        <div className="text-[11px] text-content/50">{log.join(" · ")}</div>
      </div>
      <ApprovalToasts
        notices={notices}
        onFocusSession={(id) => setLog((l) => [...l, `open ${id}`])}
        onApproval={(id, _r, d) => setLog((l) => [...l, `${d} ${id}`])}
        onOpenFleet={() => setLog((l) => [...l, "open Fleet"])}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
if (params.get("later") === "1") {
  setTimeout(() => {
    const later = [...document.querySelectorAll("button")].find(
      (item) => item.textContent === "Later",
    );
    later?.click();
  }, 300);
}
