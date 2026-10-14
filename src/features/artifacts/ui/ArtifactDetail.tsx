import { save } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  basename,
  copyFileToClipboard,
  copyPath,
  readBinaryFile,
  readTextFile,
  renamePath,
  writeTextFile,
} from "../../../platform/tauri/fs";
import { displayPath, parentPath } from "../../../shared/lib/paths";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FolderOpen,
  MessageSquarePlus,
  Pin,
  PinOff,
  RefreshCw,
  SourceCode,
  StickyNote,
  ZoomIn,
  ZoomOut,
} from "../../../shared/ui/icons";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { sniffImageMime } from "../../files/model/filePreview";
import { AgentMarkdown, MarkdownPreview } from "../../sessions/ui/AgentMarkdown";
import { HighlightedCodeBlock } from "../../sessions/ui/HighlightedCodeBlock";
import { getArtifact } from "../artifacts";
import { saveArtifactAsNote } from "../model/artifactActions";
import {
  pinArtifact,
  PinnedArtifactTooLargeError,
  unpinArtifact,
} from "../model/pinnedArtifacts";
import {
  artifactChatText,
  artifactFileName,
  artifactKindLabel,
  fenceFor,
  formatArtifactTime,
  hasVisualPreview,
  type WorkspaceArtifact,
} from "../model/workspaceArtifacts";
import { ArtifactHostContext } from "./artifactContext";
import { ArtifactPreviewFrame } from "./ArtifactPreviewFrame";
import { HtmlArtifactFrame } from "./HtmlArtifactFrame";

type ContentState =
  | { status: "loading" }
  | { status: "ready"; text: string; stale?: string }
  | { status: "error"; message: string };

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The artifact's text: live from disk for a written file, from the store for
 * a Irgat document, else the text it carries. A file that cannot be read
 * falls back to what its tool call showed.
 */
export function useArtifactContent(
  artifact: WorkspaceArtifact,
): { state: ContentState; reload: () => void } {
  const [state, setState] = useState<ContentState>(() =>
    artifact.path || artifact.documentId
      ? { status: "loading" }
      : { status: "ready", text: artifact.content ?? "" },
  );
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const { path, documentId, content, format, excerpt } = artifact;
  useEffect(() => {
    if (format === "image") {
      setState({ status: "ready", text: "" });
      return;
    }
    if (!path && !documentId) {
      setState({ status: "ready", text: content ?? "" });
      return;
    }
    let live = true;
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" },
    );
    const load = path
      ? readTextFile(path)
      : getArtifact(documentId!).then((saved) => {
          if (!saved) throw new Error("This document is no longer available.");
          return saved.body;
        });
    void load.then(
      (text) => {
        if (live) setState({ status: "ready", text });
      },
      (cause: unknown) => {
        if (!live) return;
        const fallback = content ?? (excerpt?.length ? excerpt.join("\n") : undefined);
        setState(
          fallback != null
            ? { status: "ready", text: fallback, stale: errorText(cause) }
            : { status: "error", message: errorText(cause) },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [path, documentId, content, format, excerpt, tick]);
  useEffect(() => {
    if (!path) return;
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [path, reload]);
  return { state, reload };
}

type Feedback = { tone: "ok" | "error"; text: string } | null;

function useFeedback(): [Feedback, (next: Feedback) => void] {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback((next: Feedback) => {
    if (timer.current != null) window.clearTimeout(timer.current);
    setFeedback(next);
    if (next?.tone === "ok")
      timer.current = window.setTimeout(() => setFeedback(null), 2200);
  }, []);
  return [feedback, show];
}

/** Image bytes as an object URL, so the app's CSP never sees a file URL. */
function useImageUrl(artifact: WorkspaceArtifact) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; url: string } | { status: "error"; message: string }
  >(() =>
    artifact.imageData
      ? { status: "ready", url: artifact.imageData }
      : { status: "loading" },
  );
  useEffect(() => {
    if (artifact.imageData) {
      setState({ status: "ready", url: artifact.imageData });
      return;
    }
    if (!artifact.path) {
      setState({ status: "error", message: "This image is not on disk." });
      return;
    }
    let live = true;
    let created: string | null = null;
    setState({ status: "loading" });
    void readBinaryFile(artifact.path).then(
      (bytes) => {
        if (!live) return;
        const mime = sniffImageMime(bytes);
        if (!mime) {
          setState({ status: "error", message: "This file is not an image the app can show." });
          return;
        }
        created = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        setState({ status: "ready", url: created });
      },
      (cause: unknown) => {
        if (live) setState({ status: "error", message: errorText(cause) });
      },
    );
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [artifact.imageData, artifact.path]);
  return state;
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function ImagePreview({ artifact }: { artifact: WorkspaceArtifact }) {
  const image = useImageUrl(artifact);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setZoom("fit"), [artifact.id]);
  const step = (direction: 1 | -1) =>
    setZoom((current) => {
      const value = current === "fit" ? 1 : current;
      return direction > 0
        ? (ZOOM_STEPS.find((entry) => entry > value) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
        : ([...ZOOM_STEPS].reverse().find((entry) => entry < value) ?? ZOOM_STEPS[0]);
    });
  if (image.status === "loading")
    return <CenteredStatus>Loading image…</CenteredStatus>;
  if (image.status === "error")
    return <CenteredStatus alert>{image.message}</CenteredStatus>;
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      tabIndex={0}
      aria-label={`${artifact.title}, image preview`}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          step(1);
        } else if (event.key === "-") {
          event.preventDefault();
          step(-1);
        } else if (event.key === "0") {
          event.preventDefault();
          setZoom("fit");
        }
      }}
    >
      <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-stroke px-2 text-[11px] text-content/55">
        {natural ? (
          <span className="mr-auto tabular-nums">
            {natural.w} × {natural.h}
          </span>
        ) : null}
        <ToolbarButton label="Zoom out" onClick={() => step(-1)}>
          <ZoomOut className="size-3.5" />
        </ToolbarButton>
        <button
          type="button"
          onClick={() => setZoom((current) => (current === "fit" ? 1 : "fit"))}
          title={zoom === "fit" ? "Show actual size" : "Fit to pane"}
          className="h-6 min-w-12 rounded-md px-1.5 tabular-nums hover:bg-content/10 hover:text-content"
        >
          {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <ToolbarButton label="Zoom in" onClick={() => step(1)}>
          <ZoomIn className="size-3.5" />
        </ToolbarButton>
      </div>
      <div className="artifact-image-stage min-h-0 flex-1 overflow-auto">
        <div
          className={`flex min-h-full min-w-full p-4 ${zoom === "fit" ? "h-full items-center justify-center" : "items-start justify-start"}`}
        >
          <img
            src={image.url}
            alt={artifact.title}
            draggable={false}
            onLoad={(event) =>
              setNatural({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
            className={zoom === "fit" ? "max-h-full max-w-full object-contain" : "max-w-none"}
            style={
              zoom === "fit" || !natural
                ? { imageRendering: "auto" }
                : { width: natural.w * zoom, height: natural.h * zoom, imageRendering: zoom >= 2 ? "pixelated" : "auto" }
            }
          />
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-content/55 hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

function CenteredStatus({
  children,
  alert = false,
}: {
  children: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className="flex h-full min-h-32 items-center justify-center px-6 text-center">
      <p
        role={alert ? "alert" : "status"}
        className={`max-w-80 text-[12px] leading-4.5 ${alert ? "text-content/70" : "text-content/50"}`}
      >
        {children}
      </p>
    </div>
  );
}

export function ArtifactSource({
  text,
  language,
}: {
  text: string;
  language?: string;
}) {
  return (
    <div className="agent-markdown artifact-source px-4 pb-4" data-artifact-source>
      <div className="markdown-code-shell">
        <HighlightedCodeBlock
          code={text}
          language={!language || language === "text" ? "js" : language}
          isIncomplete={false}
          lineNumbers
        />
      </div>
    </div>
  );
}

type Mode = "preview" | "source";

function ArtifactBody({
  artifact,
  text,
  mode,
  onOpenFile,
}: {
  artifact: WorkspaceArtifact;
  text: string;
  mode: Mode;
  onOpenFile?: (path: string) => void;
}) {
  if (artifact.format === "image") return <ImagePreview artifact={artifact} />;
  if (mode === "source" || !hasVisualPreview(artifact))
    return (
      <div className="h-full overflow-auto overscroll-none">
        {text ? (
          <ArtifactSource text={text} language={artifact.language} />
        ) : (
          <CenteredStatus>This artifact is empty.</CenteredStatus>
        )}
      </div>
    );
  switch (artifact.format) {
    case "html":
      return artifact.documentId && !artifact.content ? (
        <div className="h-full overflow-auto">
          <HtmlArtifactFrame
            id={artifact.documentId}
            title={artifact.title}
            version={artifact.createdAt}
          />
        </div>
      ) : (
        <ArtifactPreviewFrame format="html" source={text} title={artifact.title} />
      );
    case "svg":
      return <ArtifactPreviewFrame format="svg" source={text} title={artifact.title} />;
    case "markdown":
      return (
        <MarkdownPreview
          text={text}
          cwd={artifact.cwd}
          onOpenFile={onOpenFile ? (path) => onOpenFile(path) : undefined}
        />
      );
    case "mermaid": {
      const fence = fenceFor(text);
      return (
        <div className="h-full overflow-auto overscroll-none px-6 py-4">
          <AgentMarkdown text={`${fence}mermaid\n${text}\n${fence}`} />
        </div>
      );
    }
    default:
      return null;
  }
}

export function ArtifactKindBadge({ artifact }: { artifact: WorkspaceArtifact }) {
  return (
    <span
      data-artifact-kind={artifact.format}
      className="shrink-0 rounded bg-content/8 px-1.5 text-[10px] font-medium leading-4 tracking-wide text-content/60"
    >
      {artifactKindLabel(artifact)}
    </span>
  );
}

/**
 * One artifact: its preview or source, and the actions that take it
 * elsewhere. Fills a workspace tab, or a page in a Irgat's overview.
 */
export function ArtifactDetail({
  artifact,
  header,
}: {
  artifact: WorkspaceArtifact;
  /** Replaces the title row, for hosts that bring their own. */
  header?: ReactNode;
}) {
  const host = useContext(ArtifactHostContext);
  const { state, reload } = useArtifactContent(artifact);
  const visual = hasVisualPreview(artifact);
  const [mode, setMode] = useState<Mode>(visual ? "preview" : "source");
  useEffect(() => setMode(hasVisualPreview(artifact) ? "preview" : "source"), [artifact.id, artifact.format]);
  const [feedback, showFeedback] = useFeedback();
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">("idle");
  const noteBusy = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [chatMenu, setChatMenu] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNoteState("idle");
    noteBusy.current = false;
  }, [artifact.id]);

  const text = state.status === "ready" ? state.text : "";
  const ready = state.status === "ready" || artifact.format === "image";
  const scope = artifact.scope ?? host.defaultScope;
  const isImage = artifact.format === "image";
  const shownPath = artifact.path ? displayPath(artifact.path, artifact.cwd) : undefined;

  const copy = async () => {
    try {
      if (isImage) {
        if (!artifact.path) throw new Error("This image is not on disk.");
        await copyFileToClipboard(artifact.path).catch(() => copyText(artifact.path!));
      } else {
        await copyText(text);
      }
      showFeedback({ tone: "ok", text: isImage ? "Image copied" : "Copied to clipboard" });
    } catch (cause) {
      showFeedback({ tone: "error", text: `Could not copy: ${errorText(cause)}` });
    }
  };

  const addToChat = (sessionId?: string) => {
    host.addToChat(artifactChatText(artifact, text), sessionId);
    showFeedback({ tone: "ok", text: "Added to chat" });
  };

  const saveNote = async () => {
    if (noteState === "saved") {
      host.openNotes?.();
      return;
    }
    if (noteBusy.current || !ready || isImage) return;
    noteBusy.current = true;
    setNoteState("saving");
    try {
      const saved = await saveArtifactAsNote(artifact, text);
      setNoteState("saved");
      showFeedback({
        tone: "ok",
        text: saved.created ? "Saved to Notes" : "Already in Notes",
      });
    } catch (cause) {
      setNoteState("idle");
      showFeedback({ tone: "error", text: `Could not save the note: ${errorText(cause)}` });
    } finally {
      noteBusy.current = false;
    }
  };

  const exportFile = async () => {
    if (exporting || !ready) return;
    setExporting(true);
    try {
      const name = artifactFileName(artifact);
      const dest = await save({ defaultPath: name, title: "Save artifact" });
      if (!dest) return;
      if (isImage) {
        if (!artifact.path) throw new Error("This image is not on disk.");
        const copied = await copyPath(artifact.path, parentPath(dest));
        if (basename(copied) !== basename(dest))
          await renamePath(copied, basename(dest));
      } else {
        await writeTextFile(dest, text);
      }
      showFeedback({ tone: "ok", text: `Saved ${basename(dest)}` });
    } catch (cause) {
      showFeedback({ tone: "error", text: `Could not save: ${errorText(cause)}` });
    } finally {
      setExporting(false);
    }
  };

  const togglePin = () => {
    if (!scope) return;
    try {
      if (artifact.pinned) {
        unpinArtifact(scope, artifact.id);
        showFeedback({ tone: "ok", text: "Unpinned" });
      } else {
        pinArtifact(scope, artifact, artifact.path ? undefined : text);
        showFeedback({ tone: "ok", text: "Pinned to this project's artifacts" });
      }
    } catch (cause) {
      showFeedback({
        tone: "error",
        text:
          cause instanceof PinnedArtifactTooLargeError
            ? cause.message
            : `Could not pin: ${errorText(cause)}`,
      });
    }
  };

  const targets = chatMenu ? host.chatTargets() : [];
  const meta = [
    artifact.change === "created" ? "Created" : artifact.change === "modified" ? "Modified" : null,
    artifact.sessionTitle ? `in “${artifact.sessionTitle}”` : null,
    formatArtifactTime(artifact.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-artifact-detail={artifact.id}
    >
      {header ?? (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-stroke px-3">
          <FileTypeIcon name={artifactFileName(artifact)} isDir={false} />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-content" title={shownPath ?? artifact.title}>
            {artifact.title}
          </h2>
          <ArtifactKindBadge artifact={artifact} />
          {visual && !isImage ? <ModeToggle mode={mode} onChange={setMode} /> : null}
        </div>
      )}
      {header && visual && !isImage ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-stroke px-3">
          <ArtifactKindBadge artifact={artifact} />
          <span className="min-w-0 flex-1" />
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      ) : null}
      <div
        role="toolbar"
        aria-label="Artifact actions"
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-stroke px-3 py-1.5"
      >
        <div className="mr-auto flex min-w-0 max-w-full flex-col py-0.5">
          {shownPath ? (
            <span className="truncate font-mono text-[11px] text-content/60" title={artifact.path}>
              {shownPath}
            </span>
          ) : null}
          {meta ? (
            <span className="truncate text-[11px] text-content/45">{meta}</span>
          ) : null}
        </div>
        <SecondaryButton onClick={() => void copy()} disabled={!ready} title={isImage ? "Copy image" : "Copy contents"}>
          <Copy className="size-3.5" />
          Copy
        </SecondaryButton>
        <div className="flex shrink-0 items-stretch">
          <SecondaryButton
            onClick={() => addToChat()}
            disabled={!ready}
            title="Add to the active chat's composer"
          >
            <MessageSquarePlus className="size-3.5" />
            Add to Chat
          </SecondaryButton>
          <button
            type="button"
            aria-label="Pick a chat"
            aria-haspopup="menu"
            aria-expanded={!!chatMenu}
            disabled={!ready}
            onClick={(event) => setChatMenu(chatMenu ? null : event.currentTarget)}
            className="-ml-px grid w-6 place-items-center rounded-r-md border border-content/10 text-content/60 hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
          >
            <ChevronDown className="size-3" />
          </button>
        </div>
        <SecondaryButton
          onClick={() => void saveNote()}
          disabled={!ready || isImage || noteState === "saving"}
          aria-busy={noteState === "saving"}
          title={noteState === "saved" ? "Open Notes" : "Save as a note in this project"}
        >
          {noteState === "saved" ? <Check className="size-3.5" /> : <StickyNote className="size-3.5" />}
          {noteState === "saving" ? "Saving…" : noteState === "saved" ? "Saved to Notes" : "Save as Note"}
        </SecondaryButton>
        <SecondaryButton
          onClick={() => void exportFile()}
          disabled={!ready || exporting || (isImage && !artifact.path)}
          title="Save a copy to a file"
        >
          <Download className="size-3.5" />
          Save to File…
        </SecondaryButton>
        {scope ? (
          <SecondaryButton
            onClick={togglePin}
            disabled={!ready}
            aria-pressed={!!artifact.pinned}
            title={artifact.pinned ? "Unpin" : "Pin to keep it in Artifacts"}
          >
            {artifact.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            {artifact.pinned ? "Unpin" : "Pin"}
          </SecondaryButton>
        ) : null}
        {artifact.path && host.openFile ? (
          <SecondaryButton onClick={() => host.openFile?.(artifact.path!)} title="Open in the editor">
            <SourceCode className="size-3.5" />
            Open
          </SecondaryButton>
        ) : null}
        {artifact.path && host.revealInExplorer ? (
          <SecondaryButton onClick={() => host.revealInExplorer?.(artifact.path!)} title="Show in Explorer">
            <FolderOpen className="size-3.5" />
            Explorer
          </SecondaryButton>
        ) : null}
        <span
          role={feedback?.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`basis-full text-[11px] empty:hidden ${feedback?.tone === "error" ? "text-red-400" : "text-content/55"}`}
        >
          {feedback?.text ?? ""}
        </span>
      </div>
      {state.status === "ready" && state.stale ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-stroke bg-content/[0.03] px-3 py-1.5 text-[11px] text-content/60">
          <span className="min-w-0 flex-1">
            Could not read the file ({state.stale}). Showing what the tool call captured.
          </span>
          <button type="button" onClick={reload} className="flex items-center gap-1 rounded px-1 hover:bg-content/10 hover:text-content">
            <RefreshCw className="size-3" />
            Retry
          </button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1" data-artifact-body={mode}>
        {state.status === "loading" && !isImage ? (
          <CenteredStatus>Loading…</CenteredStatus>
        ) : state.status === "error" && !isImage ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p role="alert" className="max-w-80 text-[12px] text-content/70">
              {artifact.path ? "This file could not be read" : "This artifact could not be loaded"}: {state.message}
            </p>
            <SecondaryButton onClick={reload}>
              <RefreshCw className="size-3.5" />
              Try again
            </SecondaryButton>
          </div>
        ) : (
          <ArtifactBody artifact={artifact} text={text} mode={mode} onOpenFile={host.openFile} />
        )}
      </div>
      {chatMenu ? (
        <ExplorerMenu
          anchor={chatMenu}
          ariaLabel="Add to chat"
          width={260}
          items={
            targets.length
              ? targets.map((target) => ({
                  kind: "item" as const,
                  id: target.sessionId,
                  label: target.title,
                  checked: !!target.active,
                }))
              : [{ kind: "item" as const, id: "", label: "No open chats", disabled: true }]
          }
          onPick={(id) => {
            setChatMenu(null);
            if (id) addToChat(id);
          }}
          onClose={() => setChatMenu(null)}
        />
      ) : null}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const options: { id: Mode; label: string; icon: typeof Eye }[] = [
    { id: "preview", label: "Preview", icon: Eye },
    { id: "source", label: "Source", icon: SourceCode },
  ];
  return (
    <div role="tablist" aria-label="View" className="flex shrink-0 items-center gap-px rounded-md bg-content/5 p-0.5">
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mode === id}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            onChange(mode === "preview" ? "source" : "preview");
          }}
          className={`flex h-5.5 items-center gap-1 rounded px-2 text-[11px] ${
            mode === id ? "bg-selection text-content" : "text-content/50 hover:text-content/80"
          }`}
        >
          <Icon className="size-3" />
          {label}
        </button>
      ))}
    </div>
  );
}
