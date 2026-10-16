import { useLayoutEffect, useRef, useState } from "react";
import {
  findCard,
  withCardMoved,
  withCardRemoved,
  withCardReplaced,
  type IdeaCard,
  type IdeaTask,
  type IdeasState,
} from "../../../ideas/model/ideas";
import { write } from "../client";
import { basename, dueLabel } from "../format";
import { Markdown } from "./Markdown";
import {
  Empty,
  Pill,
  Spinner,
  Ticks,
  plainButton,
  secondaryButton,
  useToast,
} from "./parts";
import { Check, Plus, Trash2, X } from "../../../../shared/ui/icons";

/** Not `crypto.randomUUID`: that needs HTTPS, and Tailscale links are plain HTTP. */
function newTaskId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** One idea: rename it, move it, write notes, tick off its checklist. */
export function IdeaDetail({
  ideas,
  id,
  now,
  mutate,
  onClose,
}: {
  ideas: IdeasState | null;
  id: string;
  now: number;
  mutate: (update: (state: IdeasState) => IdeasState) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const found = ideas ? findCard(ideas, id) : null;
  if (!ideas)
    return (
      <div className="flex justify-center py-16 text-(--ink-3)">
        <Spinner className="size-6" />
      </div>
    );
  if (!found)
    return (
      <Empty title="This idea is gone">
        It was moved to another board or deleted on your Mac.
      </Empty>
    );

  const { board, list, card } = found;
  const save = (
    patch: Partial<Pick<IdeaCard, "title" | "description" | "tasks">>,
  ) => {
    mutate((state) =>
      withCardReplaced(state, { ...card, ...patch, updatedAt: Date.now() }),
    );
    write("ideaUpdate", { id: card.id, ...patch }).catch((error: unknown) =>
      toast(error instanceof Error ? error.message : String(error), "error"),
    );
  };
  const labels = card.labelIds
    .map((labelId) => board.labels.find((label) => label.id === labelId))
    .filter((label) => !!label);

  return (
    <div className="flex flex-col gap-6 px-5 pb-8">
      <div className="flex flex-col gap-3">
        <Title
          key={card.id}
          value={card.title}
          onSave={(title) => save({ title })}
        />
        {labels.length ? (
          <div className="flex flex-wrap gap-1.5">
            {labels.map((label) => (
              <Pill key={label.id} tone={label.color}>
                {label.name}
              </Pill>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-medium text-(--ink-2)">
          {card.project ? (
            <span>Project · {basename(card.project)}</span>
          ) : null}
          {card.dueAt ? <span>Due · {dueLabel(card.dueAt, now)}</span> : null}
          <span>
            Added ·{" "}
            {new Date(card.createdAt).toLocaleDateString([], {
              day: "numeric",
              month: "short",
            })}
          </span>
        </div>
      </div>

      <div>
        <Label>List</Label>
        <div className="flex rounded-full bg-white/55 p-1 shadow-[inset_0_0_0_1px_var(--hairline)]">
          {board.lists.map((entry) => (
            <button
              key={entry.id}
              onClick={() => {
                if (entry.id === list.id) return;
                mutate((state) => withCardMoved(state, card.id, entry.id, 0));
                write("ideaMove", { id: card.id, listId: entry.id, index: 0 })
                  .then(() => toast(`Moved to ${entry.title}`))
                  .catch((error: unknown) =>
                    toast(
                      error instanceof Error ? error.message : String(error),
                      "error",
                    ),
                  );
              }}
              className={`min-h-9 min-w-0 flex-1 truncate rounded-full px-1.5 text-[13.5px] font-semibold transition-colors ${
                entry.id === list.id
                  ? "bg-white text-(--ink) shadow-[0_4px_14px_-6px_rgb(64_44_150/0.35)]"
                  : "text-(--ink-2)"
              }`}
            >
              {entry.title}
            </button>
          ))}
        </div>
      </div>

      <Notes
        key={`${card.id}-notes`}
        value={card.description}
        onSave={(description) => save({ description })}
      />

      <Checklist tasks={card.tasks} onChange={(tasks) => save({ tasks })} />

      <button
        className={`${secondaryButton} mt-2 text-(--bad)!`}
        onClick={() => {
          if (!window.confirm(`Delete “${card.title}”?`)) return;
          onClose();
          mutate((state) => withCardRemoved(state, card.id));
          write("ideaDelete", { id: card.id })
            .then(() => toast("Idea deleted"))
            .catch((error: unknown) =>
              toast(
                error instanceof Error ? error.message : String(error),
                "error",
              ),
            );
        }}
      >
        <Trash2 className="size-4" />
        Delete idea
      </button>
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <div className="mb-2 px-1 text-[13px] font-semibold text-(--ink-2)">
      {children}
    </div>
  );
}

function useAutoHeight(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return ref;
}

function Title({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const ref = useAutoHeight(text);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      aria-label="Title"
      enterKeyHint="done"
      onChange={(event) => setText(event.target.value.replace(/\n/g, " "))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const title = text.trim();
        if (!title) setText(value);
        else if (title !== value) onSave(title);
      }}
      className="w-full resize-none bg-transparent text-[26px] font-semibold leading-tight tracking-[-0.02em] text-(--ink) outline-none"
    />
  );
}

function Notes({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const ref = useAutoHeight(editing ? text : "");
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>Notes</Label>
        {editing ? (
          <div className="-mt-2 flex gap-1">
            <button
              className={plainButton}
              onClick={() => {
                setText(value);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              className={`${plainButton} font-semibold`}
              onClick={() => {
                if (text !== value) onSave(text);
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        ) : value ? (
          <button
            className={`${plainButton} -mt-2`}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        ) : null}
      </div>
      {editing ? (
        <textarea
          ref={ref}
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write in Markdown"
          className="web-field min-h-32 w-full resize-none rounded-[22px] bg-white/85 px-4 py-3 shadow-[inset_0_0_0_1.5px_var(--accent)] outline-none"
        />
      ) : value ? (
        <div className="glass web-selectable rounded-[22px] px-4 py-3">
          <Markdown text={value} />
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="w-full rounded-[22px] border-[1.5px] border-dashed border-white bg-white/35 px-4 py-4 text-left text-[15px] font-medium text-(--ink-3)"
        >
          Add notes…
        </button>
      )}
    </div>
  );
}

function Checklist({
  tasks,
  onChange,
}: {
  tasks: IdeaTask[];
  onChange: (tasks: IdeaTask[]) => void;
}) {
  const [text, setText] = useState("");
  const done = tasks.filter((task) => task.done).length;
  const add = () => {
    const step = text.trim();
    if (!step) return;
    onChange([...tasks, { id: newTaskId(), text: step, done: false }]);
    setText("");
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>Checklist</Label>
        {tasks.length ? (
          <span className="-mt-2 px-1 text-[13px] font-semibold tabular-nums text-(--ink-2)">
            {done}/{tasks.length}
          </span>
        ) : null}
      </div>
      {tasks.length ? (
        <Ticks value={done / tasks.length} tone="green" className="mb-3" />
      ) : null}
      <div className="glass divide-y divide-(--hairline) overflow-hidden rounded-[22px]">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex min-h-12 items-center gap-3 pl-3.5 pr-1.5"
          >
            <button
              role="checkbox"
              aria-checked={task.done}
              aria-label={task.text}
              onClick={() =>
                onChange(
                  tasks.map((entry) =>
                    entry.id === task.id
                      ? { ...entry, done: !entry.done }
                      : entry,
                  ),
                )
              }
              className={`flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                task.done
                  ? "border-(--ok) bg-(--ok) text-white"
                  : "border-(--ink-3)"
              }`}
            >
              {task.done ? (
                <Check className="size-3.5" strokeWidth={2.6} />
              ) : null}
            </button>
            <span
              className={`min-w-0 flex-1 py-2.5 text-[15px] leading-snug ${task.done ? "text-(--ink-3) line-through" : "text-(--ink)"}`}
            >
              {task.text}
            </span>
            <button
              aria-label={`Remove ${task.text}`}
              onClick={() =>
                onChange(tasks.filter((entry) => entry.id !== task.id))
              }
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-(--ink-3) active:bg-white/60"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <form
          className="flex min-h-12 items-center gap-3 pl-3.5 pr-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Plus className="size-5 shrink-0 text-(--accent)" />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Add a step"
            enterKeyHint="done"
            className="web-field min-w-0 flex-1 bg-transparent py-2.5 outline-none"
          />
          {text.trim() ? (
            <button className={`${plainButton} h-9`}>Add</button>
          ) : null}
        </form>
      </div>
    </div>
  );
}
