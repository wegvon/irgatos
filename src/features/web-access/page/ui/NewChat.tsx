import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { HarnessId } from "../../../sessions/model/session";
import type { WebProjects } from "../../model/protocol";
import { read, write } from "../client";
import { leaveSheetFor } from "../route";
import { Harness, BrandMark, Spinner, useAction } from "./parts";
import {
  ArrowUp,
  ChevronDown,
  FileDiff,
  Folder,
  GitPullRequest,
  Idea,
  MessageSquare,
  Terminal,
} from "../../../../shared/ui/icons";

const SUGGESTIONS: { text: string; icon: ReactNode }[] = [
  {
    text: "Review the open pull requests",
    icon: <GitPullRequest className="size-3.5" />,
  },
  {
    text: "Run the tests and fix what fails",
    icon: <Terminal className="size-3.5" />,
  },
  {
    text: "Summarize what changed today",
    icon: <FileDiff className="size-3.5" />,
  },
  {
    text: "Plan the next feature with me",
    icon: <Idea className="size-3.5" />,
  },
];

/**
 * Start a chat on the Mac, laid out like an assistant: say what to do (or
 * tap a suggestion), pick where it works and which agent, send.
 */
export function NewChat({
  owner,
  header,
}: {
  owner?: string;
  header?: ReactNode;
}) {
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

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [text]);

  const project = projects?.projects.find((entry) => entry.path === cwd);
  const chosen = harness ?? project?.choice.harness ?? null;
  const choice = projects?.harnesses.find((entry) => entry.harness === chosen);
  const model =
    project && project.choice.harness === chosen
      ? project.choice.modelName
      : choice?.modelName;
  const ready = !!text.trim() && !!projects && busy === null;

  const start = async () => {
    if (!ready) return;
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
    <div className="flex h-full flex-col">
      {header}
      <div className="web-scroll flex min-h-0 flex-1 flex-col items-center px-6">
        <div className="my-auto flex w-full max-w-[420px] flex-col items-center py-8 text-center">
          <BrandMark className="size-16 rounded-2xl" />
          <h2 className="mt-6 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-(--ink)">
            Hey{owner ? ` ${owner}` : ""}, I'm Irgatos
          </h2>
          <p className="mt-2 max-w-[30ch] text-[15px] leading-snug text-(--ink-2)">
            Start an agent on your Mac. Say what to do, pick where it works.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.text}
                onClick={() => {
                  setText(suggestion.text);
                  field.current?.focus();
                }}
                className="glass web-press inline-flex h-10 items-center gap-2 rounded-full pl-2 pr-4 text-[14px] font-medium text-(--ink)"
              >
                <span className="flex size-6 items-center justify-center text-(--ink-2)">
                  {suggestion.icon}
                </span>
                {suggestion.text}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-[max(var(--safe-bottom),12px)]">
        <div className="mx-auto w-full max-w-[640px]">
          <div className="mb-2 flex gap-2 px-1">
            <Picker
              icon={
                cwd ? (
                  <Folder className="size-4 text-(--ink-2)" />
                ) : (
                  <MessageSquare className="size-4 text-(--ink-2)" />
                )
              }
              value={project?.label ?? (projects ? "Chat" : "…")}
            >
              <select
                aria-label="Where"
                value={cwd}
                disabled={!projects}
                onChange={(event) => {
                  setCwd(event.target.value);
                  setHarness(null);
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              >
                {projects?.projects.map((entry) => (
                  <option key={entry.path || "chat"} value={entry.path}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Picker>
            {projects?.harnesses.length ? (
              <Picker
                icon={
                  chosen ? (
                    <Harness harness={chosen} className="size-4" />
                  ) : null
                }
                value={model || choice?.title || ""}
              >
                <select
                  aria-label="Agent"
                  value={chosen ?? ""}
                  onChange={(event) =>
                    setHarness(event.target.value as HarnessId)
                  }
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                >
                  {projects.harnesses.map((entry) => (
                    <option key={entry.harness} value={entry.harness}>
                      {entry.title} · {entry.modelName}
                    </option>
                  ))}
                </select>
              </Picker>
            ) : null}
          </div>
          {error ? (
            <div className="mb-2 px-2 text-[14px] font-medium text-(--bad)">
              {error}
            </div>
          ) : null}
          <div className="glass-float flex items-end gap-2 rounded-[28px] p-1.5 pl-4 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
            <div className="flex min-h-11 min-w-0 flex-1 items-center py-2.5">
              <textarea
                ref={field}
                rows={1}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    void start();
                  }
                }}
                placeholder="What should the agent do?"
                className="web-field block max-h-40 w-full resize-none bg-transparent outline-none"
              />
            </div>
            <button
              aria-label="Start chat"
              disabled={!ready}
              onClick={() => void start()}
              className="primary-action web-press flex size-11 shrink-0 items-center justify-center rounded-full"
            >
              {busy ? (
                <Spinner className="size-5" />
              ) : (
                <ArrowUp className="size-5" strokeWidth={2.25} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A pill that opens the system picker: iOS shows its own wheel for it. */
function Picker({
  icon,
  value,
  children,
}: {
  icon: ReactNode;
  value: string;
  children: ReactNode;
}) {
  return (
    <span className="glass relative inline-flex h-10 min-w-0 items-center gap-2 rounded-full pl-3 pr-2.5 text-[14px]">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate font-semibold text-(--ink)">
        {value}
      </span>
      <ChevronDown className="size-3.5 shrink-0 text-(--ink-3)" />
      {children}
    </span>
  );
}
