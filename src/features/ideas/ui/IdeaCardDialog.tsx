import { useEffect, useRef, useState } from "react";
import {
  Calendar,
  Check,
  CheckList,
  Plus,
  Tag,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import type { RecentProject } from "../../projects/model/recents";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import {
  LABEL_COLORS,
  LABEL_STYLES,
  LABEL_SWATCHES,
  cardInput,
  dateInputValue,
  newIdeaId,
  parseDateInput,
  taskProgress,
  type IdeaBoard,
  type IdeaCard,
  type IdeaCardInput,
  type IdeaLabel,
  type LabelColor,
} from "../model/ideas";

type Props = {
  board: IdeaBoard;
  card: IdeaCard;
  recents: RecentProject[];
  onSave: (input: IdeaCardInput) => void;
  onMove: (listId: string) => void;
  onDelete: () => void;
  onSaveLabel: (label: IdeaLabel) => Promise<IdeaLabel | null>;
  onDeleteLabel: (id: string) => void;
  onClose: () => void;
};

const time = (ms: number) => formatRelativeTime(new Date(ms).toISOString());

export function IdeaCardDialog({
  board,
  card,
  recents,
  onSave,
  onMove,
  onDelete,
  onSaveLabel,
  onDeleteLabel,
  onClose,
}: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [editingDescription, setEditingDescription] = useState(
    card.description.trim() === "",
  );
  const [newTask, setNewTask] = useState("");
  const [editingLabels, setEditingLabels] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cardRef = useRef(card);
  cardRef.current = card;

  // Another window or an undo can change the card under the dialog.
  useEffect(() => setTitle(card.title), [card.title]);
  useEffect(() => {
    if (!editingDescription) setDescription(card.description);
  }, [card.description, editingDescription]);

  const save = (patch: Partial<IdeaCardInput>) =>
    onSave({ ...cardInput(cardRef.current), ...patch });

  const commitTitle = () => {
    const next = title.replace(/\s+/g, " ").trim();
    if (!next) setTitle(card.title);
    else if (next !== card.title) save({ title: next });
  };
  const commitDescription = () => {
    if (description !== card.description) save({ description });
    if (description.trim()) setEditingDescription(false);
  };

  const toggleLabel = (id: string) =>
    save({
      labelIds: card.labelIds.includes(id)
        ? card.labelIds.filter((label) => label !== id)
        : [...card.labelIds, id],
    });

  const addTask = () => {
    const text = newTask.replace(/\s+/g, " ").trim();
    if (!text) return;
    save({ tasks: [...card.tasks, { id: newIdeaId(), text, done: false }] });
    setNewTask("");
  };

  const progress = taskProgress(card);
  const list = board.lists.find((l) => l.id === card.listId);

  return (
    <Modal
      title="Idea"
      description={`${board.title} · ${list?.title ?? ""}`}
      size="lg"
      fitViewport
      onClose={() => {
        commitTitle();
        commitDescription();
        onClose();
      }}
    >
      <div className="flex min-h-0 flex-1 gap-5 overflow-y-auto px-4 pb-4 pt-2 max-sm:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <textarea
            value={title}
            rows={1}
            aria-label="Idea title"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                (event.target as HTMLTextAreaElement).blur();
              }
            }}
            className="field-sizing-content w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[17px] font-semibold leading-snug text-content outline-none hover:border-content/10 focus:border-content/25"
          />

          {board.labels.length > 0 ? (
            <section className="flex flex-wrap gap-1.5" aria-label="Labels">
              {board.labels.map((label) => {
                const on = card.labelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleLabel(label.id)}
                    className={`rounded-md px-2 py-0.5 text-[11.5px] font-medium transition-opacity ${LABEL_STYLES[label.color]} ${
                      on ? "" : "opacity-35 hover:opacity-70"
                    }`}
                  >
                    {label.name}
                  </button>
                );
              })}
            </section>
          ) : null}

          <section className="flex flex-col gap-1.5">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-content/45">
              Description
            </h3>
            {editingDescription ? (
              <textarea
                value={description}
                autoFocus={card.description.trim() !== ""}
                placeholder="Write the idea out. Markdown works."
                aria-label="Description"
                onChange={(event) => setDescription(event.target.value)}
                onBlur={commitDescription}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    commitDescription();
                    setEditingDescription(false);
                  }
                }}
                className="min-h-32 w-full resize-y rounded-md border border-content/10 bg-content/[0.03] px-2.5 py-2 text-[13px] leading-relaxed text-content outline-none placeholder:text-content/35 focus:border-content/25"
              />
            ) : (
              <div
                role="button"
                tabIndex={0}
                title="Edit description"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) return;
                  setEditingDescription(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setEditingDescription(true);
                }}
                className="cursor-text rounded-md px-2.5 py-2 text-[13px] hover:bg-content/[0.04]"
              >
                <AgentMarkdown text={card.description} hardBreaks />
              </div>
            )}
          </section>

          <section className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-content/45">
              <CheckList className="size-3.5" strokeWidth={1.75} />
              Checklist
              {progress.total ? (
                <span className="ml-1 normal-case tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              ) : null}
            </h3>
            {progress.total ? (
              <div className="h-1 overflow-hidden rounded-full bg-content/10">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            ) : null}
            <ul className="flex flex-col">
              {card.tasks.map((task) => (
                <li
                  key={task.id}
                  className="group/task flex items-center gap-2 rounded-md px-1 py-1 hover:bg-content/[0.04]"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={task.done}
                    aria-label={task.text}
                    onClick={() =>
                      save({
                        tasks: card.tasks.map((t) =>
                          t.id === task.id ? { ...t, done: !t.done } : t,
                        ),
                      })
                    }
                    className={`grid size-4 shrink-0 place-items-center rounded border ${
                      task.done
                        ? "border-accent bg-accent text-background-base"
                        : "border-content/30 hover:border-content/60"
                    }`}
                  >
                    {task.done ? <Check className="size-3" strokeWidth={2.5} /> : null}
                  </button>
                  <span
                    className={`min-w-0 flex-1 break-words text-[13px] ${
                      task.done ? "text-content/40 line-through" : "text-content"
                    }`}
                  >
                    {task.text}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${task.text}`}
                    onClick={() =>
                      save({ tasks: card.tasks.filter((t) => t.id !== task.id) })
                    }
                    className="invisible grid size-6 place-items-center rounded text-content/40 hover:bg-content/8 hover:text-content group-hover/task:visible"
                  >
                    <X className="size-3" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                addTask();
              }}
            >
              <Plus className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
              <input
                value={newTask}
                onChange={(event) => setNewTask(event.target.value)}
                placeholder="Add a step"
                aria-label="Add a checklist item"
                className="min-w-0 flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-content/35"
              />
            </form>
          </section>
        </div>

        <aside className="flex w-56 shrink-0 flex-col gap-4 text-[12px] max-sm:w-full">
          <Field label="List">
            <select
              value={card.listId}
              aria-label="List"
              onChange={(event) => onMove(event.target.value)}
              className="w-full rounded-md border border-stroke bg-transparent px-2 py-1 text-[12px] text-content outline-none focus:border-content/40"
            >
              {board.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Project">
            <div className="flex items-center gap-1">
              <SearchableProjectPicker
                cwd={card.project ?? "~"}
                recents={recents}
                mode="move"
                buttonClassName="px-1.5"
                onSelectProject={(project) => save({ project })}
              />
              {card.project ? (
                <button
                  type="button"
                  onClick={() => save({ project: null })}
                  className="rounded px-1.5 py-1 text-content/50 hover:bg-content/8 hover:text-content"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {card.project ? null : (
              <p className="text-[11px] text-content/40">Not about a project.</p>
            )}
          </Field>

          <Field label="Due" icon={<Calendar className="size-3.5" strokeWidth={1.75} />}>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={dateInputValue(card.dueAt)}
                aria-label="Due date"
                onChange={(event) =>
                  save({ dueAt: parseDateInput(event.target.value) })
                }
                className="min-w-0 flex-1 rounded-md border border-stroke bg-transparent px-2 py-1 text-[12px] text-content outline-none focus:border-content/40"
              />
              {card.dueAt !== null ? (
                <button
                  type="button"
                  onClick={() => save({ dueAt: null })}
                  className="rounded px-1.5 py-1 text-content/50 hover:bg-content/8 hover:text-content"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </Field>

          <Field label="Labels" icon={<Tag className="size-3.5" strokeWidth={1.75} />}>
            {editingLabels ? (
              <LabelEditor
                labels={board.labels}
                onSave={onSaveLabel}
                onDelete={onDeleteLabel}
                onDone={() => setEditingLabels(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingLabels(true)}
                className="self-start rounded px-1.5 py-1 text-content/60 hover:bg-content/8 hover:text-content"
              >
                {board.labels.length ? "Edit labels" : "Create a label"}
              </button>
            )}
          </Field>

          <div className="mt-auto flex flex-col gap-2 border-t border-stroke pt-3">
            <p className="text-[11px] leading-relaxed text-content/40">
              Added {time(card.createdAt)}
              {card.updatedAt !== card.createdAt ? ` · edited ${time(card.updatedAt)}` : ""}
            </p>
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-md bg-red-500/90 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-red-500"
                >
                  Delete idea
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md px-2 py-1 text-content/60 hover:bg-content/8 hover:text-content"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 self-start rounded px-1.5 py-1 text-content/50 hover:bg-red-500/10 hover:text-red-500"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
                Delete
              </button>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-content/45">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

function LabelEditor({
  labels,
  onSave,
  onDelete,
  onDone,
}: {
  labels: IdeaLabel[];
  onSave: (label: IdeaLabel) => Promise<IdeaLabel | null>;
  onDelete: (id: string) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<IdeaLabel>(() => ({
    id: newIdeaId(),
    name: "",
    color: LABEL_COLORS[(labels.length * 2) % LABEL_COLORS.length],
  }));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-stroke p-2">
      {labels.map((label) => (
        <LabelRow key={label.id} label={label} onSave={onSave} onDelete={onDelete} />
      ))}
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.name.trim()) return;
          void onSave(draft).then((saved) => {
            if (saved)
              setDraft({
                id: newIdeaId(),
                name: "",
                color: LABEL_COLORS[(labels.length * 2 + 2) % LABEL_COLORS.length],
              });
          });
        }}
      >
        <input
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          placeholder="New label"
          aria-label="New label name"
          className="rounded-md border border-stroke bg-transparent px-2 py-1 text-[12px] outline-none placeholder:text-content/35 focus:border-content/40"
        />
        <ColorPicker
          value={draft.color}
          onChange={(color) => setDraft({ ...draft, color })}
        />
      </form>
      <button
        type="button"
        onClick={onDone}
        className="self-end rounded px-1.5 py-0.5 text-content/60 hover:bg-content/8 hover:text-content"
      >
        Done
      </button>
    </div>
  );
}

function LabelRow({
  label,
  onSave,
  onDelete,
}: {
  label: IdeaLabel;
  onSave: (label: IdeaLabel) => Promise<IdeaLabel | null>;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(label.name);
  useEffect(() => setName(label.name), [label.name]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          value={name}
          aria-label={`Label ${label.name}`}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (!name.trim()) setName(label.name);
            else if (name !== label.name) void onSave({ ...label, name });
          }}
          className={`min-w-0 flex-1 rounded-md px-2 py-0.5 text-[12px] font-medium outline-none ${LABEL_STYLES[label.color]}`}
        />
        <button
          type="button"
          aria-label={`Delete label ${label.name}`}
          onClick={() => onDelete(label.id)}
          className="grid size-6 place-items-center rounded text-content/40 hover:bg-content/8 hover:text-red-500"
        >
          <Trash2 className="size-3" strokeWidth={1.75} />
        </button>
      </div>
      <ColorPicker
        value={label.color}
        onChange={(color) => void onSave({ ...label, color })}
      />
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: LabelColor;
  onChange: (color: LabelColor) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Label color">
      {LABEL_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className={`size-4 rounded-full ${LABEL_SWATCHES[color]} ${
            value === color ? "ring-2 ring-content/70 ring-offset-1 ring-offset-background-base" : ""
          }`}
        />
      ))}
    </div>
  );
}
