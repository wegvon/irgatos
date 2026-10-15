import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatsRailSection } from "../../src/app/shell/ChatsRailSection";
import { IrgatRailSection } from "../../src/app/shell/IrgatRailSection";
import {
  createIrgat,
  saveIrgatName,
  saveIrgatSessionId,
  irgatForSession,
} from "../../src/features/irgats/model/irgat";
import {
  createIrgatChildSession,
  deleteIrgatChildSession,
} from "../../src/features/irgats/model/irgatWorkspace";
import {
  newSession,
  type Session,
} from "../../src/features/sessions/model/session";
import {
  textQuestion,
  textQuestionAnswer,
} from "../../src/features/sessions/model/interactiveQuestion";
import { QuestionForm } from "../../src/features/sessions/ui/QuestionForm";
import "../../src/styles/index.css";

const irgat = createIrgat(["/project"]);
saveIrgatName(irgat.id, "Onna");
const main = newSession("codex", "/project");
main.blocks = [
  {
    id: "main-history",
    role: "user",
    text: "Ana sohbetin geçmişi",
    at: Date.now(),
  },
];
saveIrgatSessionId(irgat.id, main.id);
const free = newSession("codex", "/home/.irgat/scratch");
free.title = "Serbest sohbet";

function Fixture() {
  const [sessions, setSessions] = useState<Session[]>([main, free]);
  const [active, setActive] = useState(main.id);
  const session = sessions.find((s) => s.id === active)!;
  const question = textQuestion(session);
  const patch = (update: (s: Session) => Session) =>
    setSessions((all) => all.map((s) => (s.id === active ? update(s) : s)));
  return (
    <div className="flex h-screen bg-surface text-content">
      <aside className="w-64 border-r border-content/10 p-2">
        <IrgatRailSection
          states={new Map()}
          activeId={irgatForSession(active)?.id}
          activeSessionId={active}
          chatTitles={new Map(sessions.map((s) => [s.id, s.title]))}
          onOpen={() => setActive(main.id)}
          onCreate={() => {}}
          onDelete={() => {}}
          onOpenChat={(_, id) => setActive(id)}
          onDeleteChat={async (_, id) => {
            if (!window.confirm("Delete this chat? This cannot be undone."))
              return;
            const removed = await deleteIrgatChildSession(
              irgat.id,
              id,
              async () => {
                setSessions((all) =>
                  all.filter((session) => session.id !== id),
                );
                if (active === id) setActive(main.id);
                return true;
              },
            );
            if (!removed) throw new Error("Chat could not be deleted");
          }}
          onCreateChat={() => {
            const child = createIrgatChildSession(irgat.id, main);
            setSessions((all) => [...all, child]);
            setActive(child.id);
          }}
        />
        <div
          data-projects-section
          className="mt-8 px-3 text-xs text-content/50"
        >
          Projects
        </div>
        <div className="px-3 py-2">Project</div>
        <ChatsRailSection
          rows={[
            {
              id: free.id,
              title: free.title,
              harness: free.harness,
              model: "",
              pinned: false,
              updatedAt: 1,
              state: "idle",
              blank: false,
            },
          ]}
          activeId={active}
          onSelect={setActive}
          onNew={() => setActive(free.id)}
          onRename={() => {}}
          onPin={() => {}}
          onDelete={() => {}}
          onBoard={() => {}}
        />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col p-8">
        <h1 data-chat-title className="text-xl">
          {session.id === main.id ? "Onna" : session.title}
        </h1>
        <p data-owner className="mt-2 text-content/50">
          {irgatForSession(active)?.id === irgat.id
            ? "Onna · Ortak kimlik ve projeler"
            : "Chats"}
        </p>
        <div data-transcript className="mt-8 flex-1 whitespace-pre-line">
          {session.blocks.map((b) => (
            <p key={b.id}>{b.text}</p>
          ))}
        </div>
        {question ? (
          <QuestionForm
            key={question.questions[0].id}
            prompt={question}
            onReply={(_, reply) =>
              patch((s) => ({
                ...s,
                blocks: [
                  ...s.blocks,
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    text: textQuestionAnswer(question, reply),
                    at: Date.now(),
                  },
                ],
              }))
            }
          />
        ) : null}
        <button
          className="self-start rounded-lg border border-content/20 px-4 py-2"
          onClick={() =>
            patch((s) => ({
              ...s,
              blocks: [
                ...s.blocks,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text: "Nasıl devam edelim?\n1. Uygula ve test et\n2. Önce göster",
                  at: Date.now(),
                },
              ],
            }))
          }
        >
          Karar sorusu göster
        </button>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
