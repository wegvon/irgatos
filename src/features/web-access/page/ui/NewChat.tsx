import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { HarnessId, RuntimeMode } from "../../../sessions/model/session";
import type { WebBranches, WebProjects } from "../../model/protocol";
import { read, write } from "../client";
import { leaveSheetFor, navigate } from "../route";
import {
  AccessSelect,
  ModelSelect,
  PickerPill,
  PlanToggle,
  useModels,
} from "./ModelControls";
import { AttachButton, UploadChips, pastedFiles, useUploads } from "./Attach";
import { BrandMark, Spinner, useAction } from "./parts";
import {
  ArrowUp,
  FileDiff,
  Folder,
  GitBranch,
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
 * The unsent chat. It lives outside the component because rotating the phone
 * past the iPad width swaps the full-screen page for a sheet, which mounts a
 * fresh NewChat. Cleared once the chat starts.
 */
type Draft = {
  text: string;
  cwd: string;
  /** Null keeps the project's own provider and model. */
  pick: { harness: HarnessId; model: string } | null;
  mode: RuntimeMode;
  /** The branch a new worktree starts from; empty works in the folder. */
  worktree: string;
  plan: boolean;
};

const EMPTY: Draft = {
  text: "",
  cwd: "",
  pick: null,
  mode: "supervised",
  worktree: "",
  plan: false,
};

const draft: Draft = { ...EMPTY };

/** The composer's field, so a "New chat" button elsewhere can focus it. */
export const NEW_CHAT_FIELD = "new-chat-field";

/**
 * Start a chat on the Mac, laid out like an assistant: say what to do (or
 * tap a suggestion), pick where it works and which agent, send. `children`
 * takes the greeting's place above the composer, e.g. the phone's inbox.
 */
export function NewChat({
  owner,
  header,
  inline = false,
  children,
}: {
  owner?: string;
  header?: ReactNode;
  /** A screen of its own rather than a sheet over one. */
  inline?: boolean;
  children?: ReactNode;
}) {
  const [projects, setProjects] = useState<WebProjects | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState(draft.text);
  const [cwd, setCwd] = useState(draft.cwd);
  const [pick, setPick] = useState(draft.pick);
  const [mode, setMode] = useState(draft.mode);
  const [worktree, setWorktree] = useState(draft.worktree);
  const [plan, setPlan] = useState(draft.plan);
  const [branches, setBranches] = useState<WebBranches | null>(null);
  const catalog = useModels();
  const { busy, run } = useAction();
  const files = useUploads();
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    read<WebProjects>("projects")
      .then(setProjects)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  useEffect(() => {
    Object.assign(draft, { text, cwd, pick, mode, worktree, plan });
  }, [text, cwd, pick, mode, worktree, plan]);

  useEffect(() => {
    setBranches(null);
    if (!cwd) return;
    let alive = true;
    read<WebBranches>("branches", { cwd }).then(
      (result) => alive && setBranches(result),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [cwd]);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [text]);

  const project = projects?.projects.find((entry) => entry.path === cwd);
  const choice = pick ?? project?.choice ?? null;
  const ready =
    (!!text.trim() || files.ids.length > 0) &&
    !files.blocked &&
    !!projects &&
    busy === null;

  const start = async () => {
    if (!ready) return;
    const result = await run("start", () =>
      write<{ sessionId: string }>("newChat", {
        cwd,
        text: text.trim(),
        ...(files.ids.length ? { files: files.ids } : {}),
        ...(pick ? { harness: pick.harness, model: pick.model } : {}),
        mode,
        ...(cwd && worktree ? { worktree } : {}),
        ...(plan ? { plan: true } : {}),
      }),
    );
    if (!result) return;
    files.clear();
    Object.assign(draft, EMPTY);
    const chat = { name: "chat", id: result.sessionId } as const;
    if (inline) {
      // The phone's start screen stays mounted under the chat: clear it,
      // and keep it in the history so Back returns to it.
      setText(EMPTY.text);
      setCwd(EMPTY.cwd);
      setPick(EMPTY.pick);
      setMode(EMPTY.mode);
      setWorktree(EMPTY.worktree);
      setPlan(EMPTY.plan);
      navigate(chat);
    } else leaveSheetFor(chat);
  };

  return (
    <div className="flex h-full flex-col">
      {header}
      {children ? (
        <div className="web-scroll min-h-0 flex-1">{children}</div>
      ) : (
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
      )}

      <div className="shrink-0 px-3 pb-[max(var(--safe-bottom),12px)]">
        <div className="mx-auto w-full max-w-[640px]">
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            <PickerPill
              label="Where"
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
                  setPick(null);
                  setWorktree("");
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              >
                {projects?.projects.map((entry) => (
                  <option key={entry.path || "chat"} value={entry.path}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </PickerPill>
            {cwd && branches?.branches.length ? (
              <PickerPill
                label="Workspace"
                icon={<GitBranch className="size-4 text-(--ink-2)" />}
                value={worktree ? `New worktree · ${worktree}` : "This folder"}
              >
                <select
                  aria-label="Workspace"
                  value={worktree}
                  onChange={(event) => setWorktree(event.target.value)}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                >
                  <option value="">
                    This folder
                    {branches.current ? ` (${branches.current})` : ""}
                  </option>
                  <optgroup label="New worktree from">
                    {branches.branches.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </PickerPill>
            ) : null}
            {choice ? (
              <ModelSelect
                catalog={catalog}
                harness={choice.harness}
                model={choice.model}
                name={
                  pick
                    ? pick.model
                    : (project?.choice.modelName ?? choice.model)
                }
                onChange={(harness, model) => setPick({ harness, model })}
              />
            ) : null}
            {choice?.harness === "fx" ? null : (
              <AccessSelect mode={mode} onChange={setMode} />
            )}
            <PlanToggle on={plan} onChange={setPlan} />
          </div>
          {error ? (
            <div className="mb-2 px-2 text-[14px] font-medium text-(--bad)">
              {error}
            </div>
          ) : null}
          <div className="glass-float rounded-[28px] p-1.5 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
            <UploadChips uploads={files.uploads} onRemove={files.remove} />
            <div className="flex items-end gap-1">
              <AttachButton onFiles={files.add} disabled={busy !== null} />
              <div className="flex min-h-11 min-w-0 flex-1 items-center py-2.5">
                <textarea
                  ref={field}
                  id={NEW_CHAT_FIELD}
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
                  onPaste={(event) => {
                    const pasted = pastedFiles(event);
                    if (pasted.length) {
                      event.preventDefault();
                      files.add(pasted);
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
    </div>
  );
}
