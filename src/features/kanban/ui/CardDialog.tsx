import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { Trash2, X } from "../../../shared/ui/icons";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { MarkdownSourceEditor } from "../../sessions/ui/MarkdownSourceEditor";
import { useMarkdownMode } from "../../sessions/ui/MarkdownModeToggle";
import {
  MAX_CARD_LABELS,
  MAX_CARD_TITLE,
  normalizeCardLabels,
  type KanbanCard,
  type KanbanCardInput,
  type KanbanColumn,
} from "../model/kanban";
import { formatCardTime } from "./cardTime";

const SAVE_DELAY = 500;

type Props = {
  card: KanbanCard;
  columns: readonly KanbanColumn[];
  project: string;
  onSave: (input: KanbanCardInput) => void;
  onMove: (columnId: string) => void;
  onDelete: () => void;
  onClose: () => void;
  /** Rendered under the metadata, for the linked agent session. */
  children?: ReactNode;
};

export function CardDialog({
  card,
  columns,
  project,
  onSave,
  onMove,
  onDelete,
  onClose,
  children,
}: Props) {
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  const [labels, setLabels] = useState(card.labels);
  const [mode, setMode] = useMarkdownMode(`kanban:${card.id}`, card.notes ? "preview" : "source");
  const timer = useRef<number | null>(null);
  const latest = useRef({ title, notes, labels });
  latest.current = { title, notes, labels };
  const saved = useRef({ title: card.title, notes: card.notes, labels: card.labels });
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const columnFieldId = useId();

  const flush = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const next = latest.current;
    const before = saved.current;
    if (
      next.title.trim() === before.title &&
      next.notes === before.notes &&
      next.labels.join("\n") === before.labels.join("\n")
    ) {
      return;
    }
    saved.current = { ...next, title: next.title.trim() };
    onSaveRef.current({
      id: card.id,
      title: next.title.trim() || "Untitled",
      notes: next.notes,
      labels: next.labels,
    });
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => () => flushRef.current(), []);

  const schedule = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), SAVE_DELAY);
  };

  const close = () => {
    flush();
    onClose();
  };

  return (
    <Modal title="Card" size="md" minimalHeader fitViewport onClose={close}>
      <div className="flex flex-col gap-3 px-4 pt-4 pb-4" data-kanban-card-dialog>
        <input
          aria-label="Card title"
          value={title}
          maxLength={MAX_CARD_TITLE}
          autoFocus={!card.title || card.title === "Untitled"}
          onChange={(event) => {
            setTitle(event.target.value.replace(/\s*\n\s*/g, " "));
            schedule();
          }}
          onBlur={flush}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              flush();
            }
          }}
          placeholder="Card title"
          spellCheck={false}
          className="mr-9 w-[calc(100%-2.25rem)] border-0 bg-transparent text-[16px] font-semibold leading-tight text-content outline-none placeholder:text-content/30"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-content/50">
          <label htmlFor={columnFieldId} className="sr-only">
            Column
          </label>
          <select
            id={columnFieldId}
            value={card.columnId}
            onChange={(event) => onMove(event.target.value)}
            className="h-6.5 rounded-md border border-content/10 bg-transparent px-1.5 text-[12px] text-content/80 outline-none hover:border-content/25 focus-visible:ring-2 focus-visible:ring-accent"
          >
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.title}
              </option>
            ))}
          </select>
          <span title={new Date(card.createdAt).toLocaleString()}>
            Created {formatCardTime(card.createdAt)}
          </span>
          <span aria-hidden>·</span>
          <span title={new Date(card.updatedAt).toLocaleString()}>
            Updated {formatCardTime(card.updatedAt)}
          </span>
        </div>
        <LabelsEditor
          labels={labels}
          onChange={(next) => {
            setLabels(next);
            latest.current = { ...latest.current, labels: next };
            flushRef.current();
          }}
        />
        {children}
        <div className="flex flex-col rounded-lg border border-content/10">
          <div
            role="tablist"
            aria-label="Notes view"
            className="flex h-8 items-stretch gap-4 border-b border-content/10 px-3"
          >
            <span className="mr-auto self-center text-[11px] text-content/45">Notes</span>
            {(["preview", "source"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={`border-b text-[12px] ${
                  mode === value
                    ? "border-content text-content"
                    : "border-transparent text-content/45 hover:text-content/80"
                }`}
              >
                {value === "preview" ? "Preview" : "Write"}
              </button>
            ))}
          </div>
          <div className="max-h-[46vh] min-h-[180px] overflow-y-auto">
            {mode === "source" ? (
              <MarkdownSourceEditor
                label="Card notes"
                value={notes}
                lineNumbers={false}
                className="min-h-[180px]"
                placeholder="Add context, acceptance criteria, links… Markdown works."
                onChange={(next) => {
                  setNotes(next);
                  schedule();
                }}
                onBlur={flush}
              />
            ) : notes.trim() ? (
              <div className="px-3 py-2.5">
                <AgentMarkdown text={notes} cwd={project} hardBreaks />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setMode("source")}
                className="h-full min-h-[180px] w-full px-3 py-2.5 text-left text-[13px] text-content/40 hover:text-content/60"
              >
                No notes yet. Click to write some.
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <SecondaryButton danger onClick={onDelete}>
            <Trash2 className="size-3.5" strokeWidth={1.75} />
            Delete card
          </SecondaryButton>
          <span className="ml-auto text-[11px] text-content/35">Changes save automatically</span>
        </div>
      </div>
    </Modal>
  );
}

function LabelsEditor({
  labels,
  onChange,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const add = (input = value) => {
    const next = normalizeCardLabels([...labels, input]);
    setValue("");
    if (next.join("\n") !== labels.join("\n")) onChange(next);
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Labels">
      <span className="mr-0.5 text-[11px] text-content/45">Labels</span>
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex h-6 max-w-48 items-center gap-1 rounded-md bg-content/8 pl-2 pr-1 text-[11px] text-content/70"
        >
          <span className="truncate">{label}</span>
          <button
            type="button"
            title={`Remove ${label}`}
            aria-label={`Remove label ${label}`}
            onClick={() => onChange(labels.filter((item) => item !== label))}
            className="grid size-4 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
          >
            <X className="size-2.5" strokeWidth={1.75} />
          </button>
        </span>
      ))}
      {labels.length < MAX_CARD_LABELS ? (
        <input
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next.endsWith(",")) add(next.slice(0, -1));
            else setValue(next);
          }}
          onBlur={() => {
            if (value.trim()) add();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
              return;
            }
            if (event.key === "Backspace" && !value && labels.length > 0) {
              onChange(labels.slice(0, -1));
            }
          }}
          aria-label="Add label"
          placeholder={labels.length ? "Add label…" : "Add a label, like bug or p1…"}
          spellCheck={false}
          autoComplete="off"
          className="h-6 min-w-20 flex-1 border-0 bg-transparent px-1 text-[11px] text-content outline-none placeholder:text-content/35"
        />
      ) : null}
    </div>
  );
}
