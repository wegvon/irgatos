import { useMemo, useState, type ReactNode } from "react";
import type { WebNote, WebNoteRow, WebNotes } from "../../model/protocol";
import { read, usePoll, write } from "../client";
import { ago } from "../format";
import { navigate } from "../route";
import { Markdown } from "./Markdown";
import { Sheet } from "./Sheet";
import {
  Empty,
  Spinner,
  plainButton,
  primaryButton,
  secondaryButton,
  useAction,
} from "./parts";
import {
  ChipStrip,
  FieldLabel,
  FilterChip,
  ScreenFrame,
  SearchField,
  TitleButton,
  fieldClass,
  splitTags,
} from "./WorkspaceParts";
import {
  Folder,
  MessageSquarePlus,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
} from "../../../../shared/ui/icons";

/** Notes: search and read them, write new ones, start a chat from one. */
export function Notes({
  now,
  wide,
  header,
}: {
  now: number;
  wide: boolean;
  header?: ReactNode;
}) {
  const notes = usePoll(
    "notes",
    () => read<WebNotes>("notes"),
    () => 30_000,
  );
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [open, setOpen] = useState<string | "new" | null>(null);
  const list = notes.data?.notes;
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of list ?? [])
      for (const entry of note.tags) counts.set(entry, (counts.get(entry) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [list]);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (list ?? []).filter(
      (note) =>
        (!tag || note.tags.includes(tag)) &&
        (!words ||
          [note.title, note.preview, note.project ?? "", ...note.tags].some(
            (field) => field.toLowerCase().includes(words),
          )),
    );
  }, [list, query, tag]);

  return (
    <ScreenFrame
      header={header}
      wide={wide}
      title="Notes"
      action={
        <TitleButton label="New note" onClick={() => setOpen("new")}>
          <Plus className="size-5" strokeWidth={2.2} />
        </TitleButton>
      }
      controls={
        <>
          <SearchField value={query} onChange={setQuery} placeholder="Search notes" />
          {tags.length ? (
            <ChipStrip>
              <FilterChip on={tag === null} onClick={() => setTag(null)}>
                All
              </FilterChip>
              {tags.map(([name, count]) => (
                <FilterChip
                  key={name}
                  on={tag === name}
                  count={count}
                  onClick={() => setTag(tag === name ? null : name)}
                >
                  #{name}
                </FilterChip>
              ))}
            </ChipStrip>
          ) : null}
        </>
      }
    >
      {!list ? (
        notes.error ? (
          <Empty title="Can't load notes">{notes.error.message}</Empty>
        ) : (
          <div className="flex justify-center py-16 text-(--ink-3)">
            <Spinner className="size-6" />
          </div>
        )
      ) : shown.length ? (
        <div className="glass divide-y divide-(--hairline) overflow-hidden rounded-[24px]">
          {shown.map((note) => (
            <NoteRow key={note.id} note={note} now={now} onOpen={() => setOpen(note.id)} />
          ))}
        </div>
      ) : (
        <Empty icon={<StickyNote className="size-12 text-(--ink-3)" />} title={list.length ? "No notes match" : "No notes yet"}>
          {list.length
            ? "Try other words or another tag."
            : "Save an answer from a chat, or tap + to write one."}
        </Empty>
      )}
      {open ? (
        <Sheet
          title={open === "new" ? "New note" : "Note"}
          wide={wide}
          onClose={() => setOpen(null)}
        >
          {open === "new" ? (
            <NoteForm
              onDone={(id) => {
                notes.reload();
                setOpen(id ?? null);
              }}
            />
          ) : (
            <NoteDetail
              id={open}
              now={now}
              onChanged={notes.reload}
              onClose={() => setOpen(null)}
            />
          )}
        </Sheet>
      ) : null}
    </ScreenFrame>
  );
}

function NoteRow({
  note,
  now,
  onOpen,
}: {
  note: WebNoteRow;
  now: number;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="web-press flex w-full flex-col gap-1 px-4 py-3.5 text-left active:bg-content/6"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-(--ink)">
          {note.title}
        </span>
        <span className="shrink-0 text-[12.5px] text-(--ink-3)">
          {ago(note.updatedAt, now)}
        </span>
      </span>
      {note.preview ? (
        <span className="line-clamp-2 text-[14px] leading-snug text-(--ink-2)">
          {note.preview}
        </span>
      ) : null}
      {note.tags.length || note.project ? (
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-(--ink-3)">
          {note.project ? (
            <span className="inline-flex items-center gap-1">
              <Folder className="size-3.5" />
              {note.project}
            </span>
          ) : null}
          {note.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

function NoteDetail({
  id,
  now,
  onChanged,
  onClose,
}: {
  id: string;
  now: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const note = usePoll(
    `note:${id}`,
    () => read<WebNote>("note", { id }),
    () => 30_000,
  );
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useAction();
  const data = note.data;
  if (!data)
    return note.error ? (
      <Empty title="This note is gone">{note.error.message}</Empty>
    ) : (
      <div className="flex justify-center py-16 text-(--ink-3)">
        <Spinner className="size-6" />
      </div>
    );
  if (editing)
    return (
      <NoteForm
        note={data}
        onDone={() => {
          setEditing(false);
          note.reload();
          onChanged();
        }}
      />
    );
  if (asking)
    return (
      <NoteChat
        note={data}
        onCancel={() => setAsking(false)}
        onStarted={(sessionId) => {
          onClose();
          navigate({ name: "chat", id: sessionId });
        }}
      />
    );
  return (
    <div className="flex flex-col gap-4 px-5 pb-8">
      <div>
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-(--ink)">
          {data.title}
        </h2>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-(--ink-3)">
          <span>Edited {ago(data.updatedAt, now) || "now"} ago</span>
          {data.project ? <span>From {data.project}</span> : null}
          {data.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button className={`${secondaryButton} h-10 flex-1 px-4`} onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
          Edit
        </button>
        <button
          className={`${secondaryButton} h-10 flex-1 px-4`}
          disabled={!data.body.trim()}
          onClick={() => setAsking(true)}
        >
          <MessageSquarePlus className="size-4" />
          Use in chat
        </button>
      </div>
      {data.body.trim() ? (
        <Markdown text={data.body} />
      ) : (
        <div className="text-[15px] text-(--ink-3)">This note is empty.</div>
      )}
      <button
        onClick={() =>
          confirm
            ? void run(
                "delete",
                () => write("noteDelete", { id: data.id }),
                "Note deleted",
              ).then((done) => {
                if (!done) return;
                onChanged();
                onClose();
              })
            : setConfirm(true)
        }
        disabled={busy !== null}
        className={`${plainButton} mt-8 self-center text-(--bad)`}
      >
        <Trash2 className="size-4" />
        {confirm ? "Tap again to delete it" : "Delete note"}
      </button>
    </div>
  );
}

/** Starts a new chat on the Mac with the note attached, as Add to chat does. */
function NoteChat({
  note,
  onCancel,
  onStarted,
}: {
  note: WebNote;
  onCancel: () => void;
  onStarted: (sessionId: string) => void;
}) {
  const [text, setText] = useState("");
  const { busy, run } = useAction();
  const start = async () => {
    const result = await run("chat", () =>
      write<{ sessionId: string }>("noteChat", { id: note.id, text }),
    );
    if (result) onStarted(result.sessionId);
  };
  return (
    <form
      className="flex flex-col gap-4 px-5 pb-8"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <div className="rounded-[16px] bg-content/6 px-4 py-3 text-[14px] text-(--ink-2)">
        A new chat starts on your Mac with “{note.title}” attached.
      </div>
      <div>
        <FieldLabel>What should it do with the note?</FieldLabel>
        <textarea
          autoFocus
          className={`${fieldClass} min-h-[120px] resize-none`}
          value={text}
          placeholder="Use this note."
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <button className={primaryButton} disabled={busy !== null}>
        {busy ? <Spinner /> : null}
        Start chat
      </button>
      <button type="button" className={secondaryButton} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function NoteForm({
  note,
  onDone,
}: {
  note?: WebNote;
  onDone: (id?: string) => void;
}) {
  const [title, setTitle] = useState(note?.title === "Untitled" ? "" : (note?.title ?? ""));
  const [body, setBody] = useState(note?.body ?? "");
  const [tags, setTags] = useState(note?.tags.map((tag) => `#${tag}`).join(" ") ?? "");
  const { busy, run } = useAction();
  const save = async () => {
    const saved = await run(
      "save",
      () =>
        write<{ id: string }>("noteSave", {
          ...(note ? { id: note.id } : {}),
          title,
          body,
          tags: splitTags(tags),
        }),
      note ? "Saved" : "Note added",
    );
    if (saved) onDone(saved.id);
  };
  return (
    <form
      className="flex flex-col gap-4 px-5 pb-8"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        className={`${fieldClass} text-[18px] font-semibold`}
        value={title}
        placeholder="Title"
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className={`${fieldClass} min-h-[280px] resize-y font-mono text-[14.5px] leading-relaxed`}
        value={body}
        placeholder="Write in Markdown…"
        onChange={(event) => setBody(event.target.value)}
      />
      <div>
        <FieldLabel>Tags</FieldLabel>
        <input
          className={fieldClass}
          value={tags}
          placeholder="#idea #work"
          autoCapitalize="none"
          onChange={(event) => setTags(event.target.value)}
        />
      </div>
      <button
        className={primaryButton}
        disabled={busy !== null || (!title.trim() && !body.trim())}
      >
        {busy ? <Spinner /> : null}
        Save
      </button>
      <button type="button" className={secondaryButton} onClick={() => onDone(note?.id)}>
        Cancel
      </button>
    </form>
  );
}
