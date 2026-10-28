import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { Composer } from "../../src/features/sessions/ui/Composer";
import { EmptySession } from "../../src/features/sessions/ui/EmptySession";
import type { WorkspaceMode } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

// A new chat before its first message: describe the outcome, and the
// suggested setup appears under the composer. ?scheme=light for light.
const params = new URLSearchParams(location.search);
if (params.get("scheme") === "light")
  document.documentElement.classList.add("theme-light");

mockWindows("main");
mockIPC((cmd) => (/files|list|branches|worktrees/i.test(cmd) ? [] : null));

type Sent = { text: string; intent?: string; workspace: WorkspaceMode };
const sent: Sent[] = [];
(window as unknown as { goalSent: () => Sent[] }).goalSent = () => sent;

function Fixture() {
  const [mode, setMode] = useState<WorkspaceMode>("current");
  return (
    <div className="h-full w-full bg-background-base text-content">
      <EmptySession
        cwd="/Users/demo/src/irgatos"
        composer={
          <Composer
            focused
            harness="claude"
            model=""
            runtimeMode="supervised"
            executionCwd="/Users/demo/src/irgatos"
            cwd="/Users/demo/src/irgatos"
            sessionId="new-goal"
            branch="main"
            suggestArrangement
            workspaceMode={mode}
            worktreeBase="main"
            onWorkspaceModeChange={(next) => setMode(next)}
            onWorktreeBaseChange={() => {}}
            onFocus={() => {}}
            onCwdChange={() => {}}
            onModelChange={() => {}}
            onRuntimeModeChange={() => {}}
            onSubmit={(text, _files, options) => {
              sent.push({ text, intent: options?.intent, workspace: mode });
              return true;
            }}
          />
        }
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
