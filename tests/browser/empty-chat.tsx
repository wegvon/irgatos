import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { Composer } from "../../src/features/sessions/ui/Composer";
import { EmptySession } from "../../src/features/sessions/ui/EmptySession";
import { ChatStarters } from "../../src/features/sessions/ui/ChatStarters";
import { setComposerDraft } from "../../src/features/sessions/model/draftCache";
import "../../src/styles/index.css";

// A new chat with a project open: the starters under the real composer.
// ?scheme=light shows the light theme.
const params = new URLSearchParams(location.search);
if (params.get("scheme") === "light")
  document.documentElement.classList.add("theme-light");

mockWindows("main");
// File and skill lookups answer with empty lists.
mockIPC((command) =>
  /list|files|skills|search/.test(command) ? [] : null,
);

function Fixture() {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div className="flex h-full w-full bg-background-base text-content">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <EmptySession
          cwd="/Users/turel/Documents/GitHub/irgatos"
          hasChatBackground
          starters={<ChatStarters sessionId="preview" />}
          composer={
            <Composer
              focused
              sessionId="preview"
              harness="claude"
              model=""
              runtimeMode="supervised"
              executionCwd="/Users/turel/Documents/GitHub/irgatos"
              hideTopBar
              onDraftChange={(text) => setComposerDraft("preview", text)}
              onFocus={() => {}}
              onCwdChange={() => {}}
              onModelChange={() => {}}
              onRuntimeModeChange={() => {}}
              onSubmit={(text) => {
                setSent((current) => [...current, text]);
                return true;
              }}
            />
          }
        />
        <div data-sent-count className="hidden">
          {sent.length}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
