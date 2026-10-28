import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { Composer } from "../../src/features/sessions/ui/Composer";
import { EmptySession } from "../../src/features/sessions/ui/EmptySession";
import { ChatStarters } from "../../src/features/sessions/ui/ChatStarters";
import { ContinueConversation } from "../../src/features/sessions/ui/ContinueConversation";
import { AgentTabView } from "../../src/features/sessions/ui/AgentTabView";
import { ArtifactSurface } from "../../src/features/artifacts/ui/ArtifactSurface";
import { RestoredTerminalBar } from "../../src/features/terminal/ui/RestoredTerminalBar";
import { rememberLastConversation } from "../../src/features/projects/model/lastConversation";
import { newSession, type Session } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

// Continuity after closing tabs and after a restart.
// ?scene=return | views | terminal, ?scheme=light for the light theme,
// ?dev=running to show a running development environment.
const params = new URLSearchParams(location.search);
if (params.get("scheme") === "light")
  document.documentElement.classList.add("theme-light");
const scene = params.get("scene") ?? "return";
const project = "/Users/turel/Documents/GitHub/irgatos";

mockWindows("main");
mockIPC((command) =>
  /list|files|skills|search/.test(command) ? [] : null,
);

rememberLastConversation(
  {
    id: "last",
    cwd: project,
    title: "Mobilde alt çubuğu ekrana hizala",
    harness: "claude",
  },
  Date.now() - 3 * 3600_000,
);

function ReturnScene() {
  return (
    <EmptySession
      cwd={project}
      hasChatBackground
      resume={<ContinueConversation sessionId="blank" cwd={project} />}
      starters={<ChatStarters sessionId="blank" />}
      composer={
        <Composer
          focused
          sessionId="blank"
          harness="claude"
          model=""
          runtimeMode="supervised"
          executionCwd={project}
          hideTopBar
          onDraftChange={() => {}}
          onFocus={() => {}}
          onCwdChange={() => {}}
          onModelChange={() => {}}
          onRuntimeModeChange={() => {}}
          onSubmit={() => true}
        />
      }
    />
  );
}

const worker: Session = {
  ...newSession("codex", project),
  id: "worker",
  title: "Audit the engine",
  blocks: [
    { id: "u1", role: "user", text: "Audit the session store for stale writes." },
    {
      id: "a1",
      role: "assistant",
      text: "I read `session_store.rs` and `sessionStore.ts`. Writes now carry a base revision; two paths still skip it:\n\n1. `upsert_session` from the CLI\n2. the window-transfer import\n\nBoth are covered by the new test in `sessionStoreMultiWindow.test.ts`.",
    },
  ],
};

function ViewsScene() {
  return (
    <div className="grid h-full grid-cols-2 divide-x divide-stroke">
      <div className="relative min-h-0">
        <AgentTabView
          title="Audit the engine"
          session={worker}
          visible
          leadId="lead"
          restored
        />
      </div>
      <div className="relative min-h-0">
        <ArtifactSurface
          restored
          source={{
            id: "snippet:gone:1",
            title: "landing.html",
            fileName: "landing.html",
            sessionId: "gone",
            sessionTitle: "Build the landing page",
          }}
        />
      </div>
    </div>
  );
}

function TerminalScene() {
  const running = params.get("dev") === "running";
  return (
    <div className="flex h-full flex-col">
      <RestoredTerminalBar
        ptyId="t1"
        cwd={project}
        onDismiss={() => {}}
        check={async () => ({
          command: "npm run tauri dev",
          running,
          port: running ? 4107 : null,
        })}
        write={async () => {}}
      />
      <pre className="flex-1 bg-background-base p-3 font-mono text-[12px] text-content/80">
        {"turel@mac48 irgatos % "}
      </pre>
    </div>
  );
}

function Fixture() {
  return (
    <div className="flex h-full w-full bg-background-base text-content">
      <main className="relative flex min-w-0 flex-1 flex-col">
        {scene === "views" ? (
          <ViewsScene />
        ) : scene === "terminal" ? (
          <TerminalScene />
        ) : (
          <ReturnScene />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
