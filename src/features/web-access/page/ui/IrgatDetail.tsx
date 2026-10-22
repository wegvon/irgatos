import { useEffect, useState, type ReactNode } from "react";
import type {
  WebIrgatDetail,
  WebIrgatOptions,
} from "../../model/protocol";
import { read, usePoll, write } from "../client";
import { navigate } from "../route";
import { AgentList } from "./Agents";
import { Switch } from "./Automations";
import { Mascot } from "./Irgats";
import {
  Empty,
  Group,
  Spinner,
  plainButton,
  primaryButton,
  secondaryButton,
  useAction,
} from "./parts";
import {
  ChevronDown,
  FolderTree,
  MessageSquare,
  Plus,
  StickyNote,
  X,
} from "../../../../shared/ui/icons";

type Tab = "settings" | "agents" | "memory";

const TABS: { id: Tab; label: string }[] = [
  { id: "settings", label: "Settings" },
  { id: "agents", label: "Agents" },
  { id: "memory", label: "Memory" },
];

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-1 pb-2 pt-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-(--ink-3)">
      {children}
    </h3>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-(--ink)">{label}</span>
        {hint ? (
          <span className="block text-[12.5px] leading-snug text-(--ink-3)">
            {hint}
          </span>
        ) : null}
      </span>
      {children}
    </div>
  );
}

/** The value as text, with the system picker laid invisibly over it. */
function Select({
  label,
  value,
  shown,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  shown: string;
  options: { id: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <span className="relative inline-flex min-w-0 max-w-[60%] items-center gap-1 text-[15px] text-(--ink-2)">
      <span className="min-w-0 truncate">{shown}</span>
      <ChevronDown className="size-3.5 shrink-0 text-(--ink-3)" />
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * An Irgat's own page, as its overview on the Mac: who it is and how it
 * works, what it started, and what it remembers.
 */
export function IrgatDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("settings");
  const detail = usePoll(
    `irgat:${id}`,
    () => read<WebIrgatDetail>("irgat", { irgatId: id }),
    () => (tab === "agents" ? 3000 : 8000),
  );
  const options = usePoll(
    "irgatOptions",
    () => read<WebIrgatOptions>("irgatOptions"),
    () => 120_000,
  ).data;
  const { busy, run } = useAction();
  const [look, setLook] = useState(false);
  const irgat = detail.data;

  if (!irgat)
    return detail.error ? (
      <Empty title="This Irgat is not available">
        {detail.error.message}
      </Empty>
    ) : (
      <div className="flex justify-center py-16 text-(--ink-3)">
        <Spinner className="size-6" />
      </div>
    );

  const update = (
    patch: Record<string, unknown>,
    shown?: Partial<WebIrgatDetail>,
    done?: string,
  ) => {
    if (shown) detail.mutate((current) => ({ ...current, ...shown }));
    return run(
      `update:${Object.keys(patch).join(",")}`,
      () => write("irgatUpdate", { irgatId: id, ...patch }),
      done,
    );
  };
  const openChat = () =>
    void run("open", async () => {
      const opened = await write<{ sessionId: string }>("irgatOpen", {
        irgatId: id,
      });
      onClose();
      window.setTimeout(
        () => navigate({ name: "chat", id: opened.sessionId }),
        60,
      );
    });

  return (
    <div className="flex flex-col gap-5 px-5 pb-6">
      <div className="flex flex-col items-center gap-3 pt-1">
        <button
          aria-label="Change its look"
          aria-expanded={look}
          onClick={() => setLook((value) => !value)}
          className="web-press flex size-20 items-center justify-center rounded-[22px] bg-content/6"
        >
          <Mascot
            mascot={irgat.mascot}
            status={irgat.busy ? "working" : "idle"}
            className="size-12"
          />
        </button>
        <NameField
          key={irgat.id}
          name={irgat.name}
          fallback={irgat.defaultName}
          onSave={(name) =>
            void update({ name }, { name: name || irgat.defaultName })
          }
        />
        {look && options ? (
          <div className="glass w-full rounded-[22px] p-3">
            <div className="grid grid-cols-6 gap-2">
              {options.mascots.map((mascot) => (
                <button
                  key={mascot}
                  aria-label={mascot}
                  aria-pressed={mascot === irgat.mascot.name}
                  onClick={() =>
                    void update(
                      { mascot },
                      { mascot: { ...irgat.mascot, name: mascot } },
                    )
                  }
                  className={`web-press flex aspect-square items-center justify-center rounded-xl ${mascot === irgat.mascot.name ? "bg-selection" : "bg-content/4"}`}
                >
                  <Mascot
                    mascot={{ name: mascot, color: irgat.mascot.color }}
                    className="size-7"
                  />
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2.5">
              {options.colors.map((color) => (
                <button
                  key={color}
                  aria-label="Color"
                  aria-pressed={color === irgat.mascot.color}
                  onClick={() =>
                    void update(
                      { color },
                      { mascot: { ...irgat.mascot, color } },
                    )
                  }
                  style={{ background: color }}
                  className={`web-press size-8 rounded-full ${color === irgat.mascot.color ? "ring-2 ring-(--ink) ring-offset-2 ring-offset-(--sheet)" : ""}`}
                />
              ))}
            </div>
          </div>
        ) : null}
        <button
          className={`${secondaryButton} h-10 px-5 text-[14px]`}
          disabled={busy !== null}
          onClick={openChat}
        >
          {busy === "open" ? (
            <Spinner className="size-4" />
          ) : (
            <MessageSquare className="size-4" />
          )}
          Open chat
        </button>
      </div>

      <div className="flex rounded-full bg-content/6 p-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            aria-pressed={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`web-press h-9 flex-1 rounded-full text-[14px] font-semibold ${
              tab === entry.id
                ? "bg-(--raised) text-(--ink) shadow-[0_1px_3px_rgb(0_0_0/0.15)]"
                : "text-(--ink-2)"
            }`}
          >
            {entry.label}
            {entry.id === "agents" && irgat.agents.length ? (
              <span className="ml-1 tabular-nums text-(--ink-3)">
                {irgat.agents.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "settings" ? (
        <Settings
          irgat={irgat}
          options={options}
          busy={busy}
          update={update}
          onSaved={detail.reload}
        />
      ) : tab === "agents" ? (
        irgat.agents.length ? (
          <AgentList
            agents={irgat.agents}
            onOpen={(sessionId) => {
              onClose();
              window.setTimeout(
                () => navigate({ name: "chat", id: sessionId }),
                60,
              );
            }}
          />
        ) : (
          <Empty
            icon={
              <span className="flex size-14 items-center justify-center rounded-2xl bg-content/6 text-(--ink-3)">
                <FolderTree className="size-7" />
              </span>
            }
            title="Nothing started yet"
          >
            Sessions {irgat.name} starts show up here, with what they start in
            turn.
          </Empty>
        )
      ) : (
        <Memory irgat={irgat} onChanged={detail.reload} />
      )}
    </div>
  );
}

function NameField({
  name,
  fallback,
  onSave,
}: {
  name: string;
  fallback: string;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  // Cleared, it goes back to its own name.
  const save = () => {
    const next = value.trim();
    if (!next) setValue(fallback);
    if (next !== name) onSave(next === fallback ? "" : next);
  };
  return (
    <input
      aria-label="Name"
      value={value}
      placeholder={fallback}
      enterKeyHint="done"
      maxLength={80}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="web-field w-full bg-transparent text-center text-[22px] font-semibold tracking-[-0.02em] text-(--ink) outline-none"
    />
  );
}

function Settings({
  irgat,
  options,
  busy,
  update,
  onSaved,
}: {
  irgat: WebIrgatDetail;
  options: WebIrgatOptions | null;
  busy: string | null;
  update: (
    patch: Record<string, unknown>,
    shown?: Partial<WebIrgatDetail>,
    done?: string,
  ) => Promise<unknown>;
  onSaved: () => void;
}) {
  const harness = options?.harnesses.find((entry) => entry.id === irgat.harness);
  const mode = options?.modes.find((entry) => entry.id === irgat.runtimeMode);
  const addable =
    options?.projects.filter(
      (project) => !irgat.projects.some((own) => own.path === project.path),
    ) ?? [];
  return (
    <div className="flex flex-col gap-5">
      <section>
        <Heading>Model</Heading>
        <Group>
          <Row label="Provider">
            <Select
              label="Provider"
              value={irgat.harness}
              shown={harness?.label ?? irgat.harness}
              options={options?.harnesses ?? []}
              disabled={!options}
              onChange={(next) =>
                void update({ harness: next }, undefined, "Provider changed")
              }
            />
          </Row>
          <Row label="Model" hint="What it thinks and replies with.">
            <Select
              label="Model"
              value={irgat.model}
              shown={irgat.modelName}
              options={harness?.models ?? []}
              disabled={!harness}
              onChange={(model) =>
                void update(
                  { harness: irgat.harness, model },
                  {
                    model,
                    modelName:
                      harness?.models.find((entry) => entry.id === model)
                        ?.label ?? model,
                  },
                  "Model changed",
                )
              }
            />
          </Row>
          <Row
            label="Permissions"
            hint={
              irgat.busy
                ? `${mode?.hint ?? ""} Applies from its next turn.`
                : mode?.hint
            }
          >
            <Select
              label="Permissions"
              value={irgat.runtimeMode}
              shown={mode?.label ?? irgat.runtimeMode}
              options={options?.modes ?? []}
              disabled={!options}
              onChange={(next) =>
                void update(
                  { mode: next },
                  { runtimeMode: next as WebIrgatDetail["runtimeMode"] },
                )
              }
            />
          </Row>
        </Group>
      </section>

      <SoulEditor irgat={irgat} onSaved={onSaved} />

      <section>
        <Heading>Projects</Heading>
        <Group>
          {irgat.projects.map((project) => (
            <Row key={project.path} label={project.label}>
              <button
                aria-label={`Remove ${project.label}`}
                disabled={busy !== null}
                onClick={() => {
                  if (
                    window.confirm(
                      `Stop ${irgat.name} working on ${project.label}?`,
                    )
                  )
                    void update(
                      { removeProject: project.path },
                      {
                        projects: irgat.projects.filter(
                          (own) => own.path !== project.path,
                        ),
                      },
                    );
                }}
                className="web-press flex size-8 items-center justify-center rounded-full bg-content/6 text-(--ink-2)"
              >
                <X className="size-4" />
              </button>
            </Row>
          ))}
          {addable.length ? (
            <div className="relative flex h-[52px] items-center gap-2 px-4 text-[15px] font-semibold text-(--accent)">
              <Plus className="size-4" strokeWidth={2.4} />
              Add a project
              <select
                aria-label="Add a project"
                value=""
                onChange={(event) => {
                  const project = addable.find(
                    (entry) => entry.path === event.target.value,
                  );
                  if (project)
                    void update(
                      { addProject: project.path },
                      { projects: [...irgat.projects, project] },
                    );
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              >
                <option value="" disabled>
                  Add a project
                </option>
                {addable.map((project) => (
                  <option key={project.path} value={project.path}>
                    {project.label}
                  </option>
                ))}
              </select>
            </div>
          ) : !irgat.projects.length ? (
            <div className="px-4 py-3.5 text-[14px] text-(--ink-3)">
              It works on no projects yet.
            </div>
          ) : null}
        </Group>
        <p className="px-1 pt-2 text-[12.5px] leading-snug text-(--ink-3)">
          It can see every session, note and folder in these.
        </p>
      </section>

      <section>
        <Heading>Sessions it starts</Heading>
        <Group>
          <Row
            label="Show in sidebar"
            hint="Hidden ones stay saved and open from its overview."
          >
            <Switch
              on={irgat.showSessions}
              label="Show sessions in sidebar"
              onChange={(on) =>
                void update({ showSessions: on }, { showSessions: on })
              }
            />
          </Row>
          <Row
            label="Group in a folder"
            hint={`In a “${irgat.name}” folder in your project sidebar.`}
          >
            <Switch
              on={irgat.showSessions && irgat.groupInFolder}
              disabled={!irgat.showSessions}
              label="Group in a folder"
              onChange={(on) =>
                void update({ groupInFolder: on }, { groupInFolder: on })
              }
            />
          </Row>
        </Group>
      </section>
    </div>
  );
}

/** SOUL.md: who it is and how it works, edited in place. */
function SoulEditor({
  irgat,
  onSaved,
}: {
  irgat: WebIrgatDetail;
  onSaved: () => void;
}) {
  // The soul as it was when editing began, so a change on the Mac is caught.
  const [base, setBase] = useState(irgat.soul);
  const [draft, setDraft] = useState(irgat.soul);
  const { busy, run } = useAction();
  const dirty = draft !== base;
  useEffect(() => {
    if (!dirty) {
      setBase(irgat.soul);
      setDraft(irgat.soul);
    }
  }, [irgat.soul, dirty]);

  const save = () =>
    void run(
      "soul",
      async () => {
        await write("irgatSoul", { irgatId: irgat.id, soul: draft, was: base });
        setBase(draft);
        onSaved();
      },
      "Soul saved",
    );

  return (
    <section>
      <Heading>Soul</Heading>
      <div className="glass rounded-[22px] p-1.5">
        <textarea
          aria-label="Soul"
          value={draft}
          rows={9}
          onChange={(event) => setDraft(event.target.value)}
          className="web-field block w-full resize-y rounded-[18px] bg-transparent px-3 py-2.5 font-mono text-[13.5px] leading-relaxed text-(--ink) outline-none"
        />
        {dirty ? (
          <div className="flex justify-end gap-2 px-1.5 pb-1.5">
            <button
              className={plainButton}
              onClick={() => setDraft(base)}
              disabled={busy !== null}
            >
              Discard
            </button>
            <button
              className={`${primaryButton} h-10 px-5 text-[14px]`}
              onClick={save}
              disabled={busy !== null}
            >
              {busy === "soul" ? <Spinner className="size-4" /> : null}
              Save
            </button>
          </div>
        ) : null}
      </div>
      <p className="px-1 pt-2 text-[12.5px] leading-snug text-(--ink-3)">
        What it always keeps in mind.
      </p>
    </section>
  );
}

function Memory({
  irgat,
  onChanged,
}: {
  irgat: WebIrgatDetail;
  onChanged: () => void;
}) {
  const { busy, run } = useAction();
  const facts = irgat.memory.filter((fact) => !fact.struck);
  if (!facts.length)
    return (
      <Empty
        icon={
          <span className="flex size-14 items-center justify-center rounded-2xl bg-content/6 text-(--ink-3)">
            <StickyNote className="size-7" />
          </span>
        }
        title="Nothing remembered yet"
      >
        {irgat.name} writes down what it learns as it works.
      </Empty>
    );
  return (
    <Group>
      {facts
        .slice()
        .reverse()
        .map((fact) => (
          <div key={fact.index} className="flex items-start gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="web-selectable block whitespace-pre-wrap break-words text-[14.5px] leading-snug text-(--ink)">
                {fact.text}
              </span>
              {fact.date ? (
                <span className="mt-0.5 block text-[12px] text-(--ink-3)">
                  {fact.date}
                </span>
              ) : null}
            </span>
            <button
              className={`${plainButton} -mr-2 h-8 px-2.5 text-[13.5px] text-(--bad)`}
              disabled={busy !== null}
              onClick={() => {
                if (!window.confirm(`Forget this?\n\n${fact.text}`)) return;
                void run(
                  `forget:${fact.index}`,
                  async () => {
                    await write("irgatForget", {
                      irgatId: irgat.id,
                      index: fact.index,
                      text: fact.text,
                    });
                    onChanged();
                  },
                  "Forgotten",
                );
              }}
            >
              {busy === `forget:${fact.index}` ? (
                <Spinner className="size-4" />
              ) : (
                "Forget"
              )}
            </button>
          </div>
        ))}
    </Group>
  );
}
