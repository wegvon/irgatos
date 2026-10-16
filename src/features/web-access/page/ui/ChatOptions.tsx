import { useState } from "react";
import { createPortal } from "react-dom";
import type { WebSession } from "../../model/protocol";
import { write } from "../client";
import { Sheet } from "./Sheet";
import { Spinner, primaryButton, secondaryButton, useAction } from "./parts";
import { Pencil, Trash2 } from "../../../../shared/ui/icons";

/** Rename or delete the open chat, as its sidebar row does on the Mac. */
export function ChatOptions({
  session,
  wide,
  onClose,
  onDeleted,
}: {
  session: WebSession;
  wide: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(session.title);
  const { busy, run } = useAction();
  const trimmed = name.trim();
  const changed = !!trimmed && trimmed !== session.title;

  const rename = async () => {
    if (!changed) return;
    const done = await run(
      "rename",
      () => write("renameChat", { sessionId: session.id, title: trimmed }),
      "Chat renamed",
    );
    if (done) onClose();
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${session.title}”? This can’t be undone.`))
      return;
    const done = await run(
      "delete",
      () => write("deleteChat", { sessionId: session.id }),
      "Chat deleted",
    );
    if (done) onDeleted();
  };

  // Over the whole page: the chat screen may be mid-swipe, and a transformed
  // parent would pin the sheet inside it.
  return createPortal(
    <Sheet title="Chat" wide={wide} onClose={onClose}>
      <div className="flex flex-col gap-6 px-5 pb-8">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void rename();
          }}
        >
          <label
            htmlFor="chat-name"
            className="px-1 text-[13px] font-semibold text-(--ink-2)"
          >
            Name
          </label>
          <div className="glass flex h-[52px] items-center gap-2 rounded-full pl-4 pr-1.5 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
            <Pencil className="size-[18px] shrink-0 text-(--ink-3)" />
            <input
              id="chat-name"
              className="web-field min-w-0 flex-1 bg-transparent outline-none"
              value={name}
              maxLength={200}
              enterKeyHint="done"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className={`${primaryButton} disabled:opacity-40`}
            disabled={!changed || busy !== null}
          >
            {busy === "rename" ? <Spinner /> : null}
            Rename
          </button>
        </form>

        {session.deletable ? (
          <button
            className={`${secondaryButton} text-(--bad)!`}
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === "delete" ? <Spinner /> : <Trash2 className="size-4" />}
            Delete chat
          </button>
        ) : (
          <p className="px-1 text-[13.5px] leading-snug text-(--ink-2)">
            This is {session.irgat}’s own chat, so it goes only when{" "}
            {session.irgat} is deleted on your Mac.
          </p>
        )}
      </div>
    </Sheet>,
    document.body,
  );
}
