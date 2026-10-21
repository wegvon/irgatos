import { useEffect, useRef, useState } from "react";
import { Pencil } from "../../../shared/ui/icons";

/**
 * Asks, once, for a name for a new Irgat chat. It sits above the composer and
 * never takes focus, so it can be ignored while the conversation goes on.
 */
export function ChatNamePrompt({
  suggestion,
  generate,
  onSave,
  onDismiss,
}: {
  /** Prefills the field until a better one arrives or the user types. */
  suggestion: string;
  /** A better suggestion, e.g. from the model; null keeps the first one. */
  generate?: () => Promise<string | null>;
  onSave: (name: string) => void;
  onDismiss: () => void;
}) {
  const [name, setName] = useState(suggestion);
  const edited = useRef(false);

  useEffect(() => {
    if (!generate) return;
    let current = true;
    void generate()
      .then((better) => {
        const trimmed = better?.trim();
        if (current && trimmed && !edited.current) setName(trimmed);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
    // One request per prompt; the suggestion does not change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = name.trim();
  return (
    <form
      data-chat-name-prompt
      aria-label="Name this chat"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSave(trimmed);
      }}
      className="mx-1.5 mb-2 flex items-center gap-2 rounded-lg border border-content/10 bg-content/4 py-1.5 pl-3 pr-1.5 text-[12px] text-content/60"
    >
      <Pencil className="size-3.5 shrink-0 text-content/45" />
      <span className="shrink-0 text-content/85">Name this chat</span>
      <input
        value={name}
        onChange={(event) => {
          edited.current = true;
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDismiss();
          }
        }}
        aria-label="Chat name"
        placeholder="e.g. Release notes"
        maxLength={120}
        spellCheck={false}
        className="h-6.5 min-w-0 flex-1 rounded-md border border-content/10 bg-background-base px-2 text-[12px] text-content outline-none placeholder:text-content/35 focus:border-content/25"
      />
      <button
        type="submit"
        disabled={!trimmed}
        className="flex h-6.5 shrink-0 items-center rounded-md bg-accent px-2.5 text-[12px] font-medium text-on-accent hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="flex h-6.5 shrink-0 items-center rounded-md px-2 hover:bg-content/10 hover:text-content"
      >
        Later
      </button>
    </form>
  );
}
