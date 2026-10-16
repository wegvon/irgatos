import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HarnessId } from "../../../sessions/model/session";
import type { WebProjects } from "../../model/protocol";
import { read, write } from "../client";
import { leaveSheetFor } from "../route";
import { Harness, Spinner, primaryButton, useAction } from "./parts";
import { Folder, MessageSquare } from "../../../../shared/ui/icons";

/** Start a chat on the Mac: what to do, where, and with which agent. */
export function NewChat() {
  const [projects, setProjects] = useState<WebProjects | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [cwd, setCwd] = useState("");
  const [harness, setHarness] = useState<HarnessId | null>(null);
  const { busy, run } = useAction();
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    read<WebProjects>("projects")
      .then(setProjects)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  useEffect(() => {
    // After the sheet's slide-in, so iOS raises the keyboard reliably.
    const timer = window.setTimeout(() => field.current?.focus(), 350);
    return () => window.clearTimeout(timer);
  }, []);

  const project = projects?.projects.find((entry) => entry.path === cwd);
  const chosen = harness ?? project?.choice.harness ?? null;

  const start = async () => {
    const result = await run("start", () =>
      write<{ sessionId: string }>("newChat", {
        cwd,
        text: text.trim(),
        ...(chosen ? { harness: chosen } : {}),
      }),
    );
    if (result) leaveSheetFor({ name: "chat", id: result.sessionId });
  };

  return (
    <div className="flex flex-col gap-6 px-5 pb-6">
      <textarea
        ref={field}
        rows={5}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="What should it do?"
        className="web-field min-h-36 w-full resize-none rounded-[18px] bg-(--surface) px-4 py-3.5 shadow-[0_0_0_0.5px_var(--color-stroke)] outline-none focus:shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
      />

      <Picker title="Where">
        {projects
          ? projects.projects.map((entry) => (
              <Chip
                key={entry.path || "chat"}
                on={entry.path === cwd}
                onClick={() => {
                  setCwd(entry.path);
                  setHarness(null);
                }}
              >
                {entry.path ? (
                  <Folder className="size-4 shrink-0" />
                ) : (
                  <MessageSquare className="size-4 shrink-0" />
                )}
                <span className="truncate">{entry.label}</span>
              </Chip>
            ))
          : null}
        {!projects && !error ? <Spinner className="m-2 size-5" /> : null}
      </Picker>

      {projects?.harnesses.length ? (
        <Picker title="Agent">
          {projects.harnesses.map((choice) => {
            const model =
              project && project.choice.harness === choice.harness
                ? project.choice.modelName
                : choice.modelName;
            return (
              <Chip
                key={choice.harness}
                on={choice.harness === chosen}
                onClick={() => setHarness(choice.harness)}
              >
                <Harness harness={choice.harness} className="size-4" />
                <span className="flex min-w-0 flex-col items-start leading-tight">
                  <span className="truncate">{choice.title}</span>
                  <span className="truncate text-[12px] font-normal opacity-60">
                    {model}
                  </span>
                </span>
              </Chip>
            );
          })}
        </Picker>
      ) : null}

      {error ? <div className="text-[14px] text-(--bad)">{error}</div> : null}

      <button
        className={`${primaryButton} h-12 w-full text-[16px]`}
        disabled={!text.trim() || !projects || busy !== null}
        onClick={() => void start()}
      >
        {busy ? <Spinner /> : null}
        Start chat
      </button>
    </div>
  );
}

function Picker({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-content/45">
        {title}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`web-press inline-flex min-h-10 max-w-full items-center gap-2 rounded-[12px] px-3 py-1.5 text-[15px] font-medium ${
        on
          ? "bg-(--accent) text-white"
          : "bg-(--surface) text-content/80 shadow-[0_0_0_0.5px_var(--color-stroke)]"
      }`}
    >
      {children}
    </button>
  );
}
