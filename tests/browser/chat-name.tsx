import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ChatNamePrompt } from "../../src/features/irgats/ui/ChatNamePrompt";
import { IrgatComposer } from "../../src/features/irgats/ui/IrgatComposer";
import "../../src/styles/index.css";

// A Irgat chat after its second turn: the name prompt above the composer.
// ?scheme=light shows the light theme.
const params = new URLSearchParams(location.search);
if (params.get("scheme") === "light")
  document.documentElement.classList.add("theme-light");

mockWindows("main");
mockIPC(() => null);

const turns = [
  ["user", "Mail'de çöp kutusuna atınca geri alma butonu çalışmıyor"],
  ["assistant", "Undo toast'u 8 saniye sonra kapanıyor ama ⌘Z dinlenmiyordu. Düzelttim."],
  ["user", "Arşivle de bir sonraki maili açsın"],
  ["assistant", "Tamam, arşivden sonra sıradaki mail açılıyor."],
] as const;

function Fixture() {
  const [title, setTitle] = useState("Chat 2");
  const [open, setOpen] = useState(true);
  return (
    <div className="flex h-full w-full bg-background-base text-content">
      <nav className="sidebar-glass flex w-56 shrink-0 flex-col gap-1 border-r border-stroke p-3 text-[13px]">
        <div className="text-content/50">Irgats</div>
        <div className="pl-3">Kahya</div>
        <div className="ml-5 border-l border-content/10 pl-2">
          <div className="rounded-md bg-selection px-2 py-1" data-title>
            {title}
          </div>
          <div className="px-2 py-1 text-content/60">Chat 1</div>
        </div>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-end gap-3 p-4 text-[14px]">
          {turns.map(([role, text]) => (
            <div
              key={text}
              className={
                role === "user"
                  ? "max-w-[70%] self-end rounded-2xl bg-content/8 px-3.5 py-2"
                  : "max-w-[80%] self-start leading-relaxed"
              }
            >
              {text}
            </div>
          ))}
        </div>
        <div className="mx-auto w-full max-w-4xl shrink-0 pb-3">
          {open ? (
            <ChatNamePrompt
              suggestion="Mail'de çöp kutusuna atınca geri alma butonu…"
              generate={() =>
                new Promise((done) => setTimeout(() => done("Mail geri alma ve arşiv"), 300))
              }
              onSave={(name) => {
                setTitle(name);
                setOpen(false);
              }}
              onDismiss={() => setOpen(false)}
            />
          ) : null}
          <IrgatComposer sessionId="preview" name="Kahya" onSubmit={() => {}} />
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
