import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { displayPath } from "../../../shared/lib/paths";
import {
  Artifacts,
  Pin,
  Plus,
  RefreshCw,
  Search,
} from "../../../shared/ui/icons";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import {
  ARTIFACT_FILTERS,
  artifactFileName,
  filterArtifacts,
  formatArtifactTime,
  type ArtifactFilter,
  type ArtifactScope,
  type WorkspaceArtifact,
} from "../model/workspaceArtifacts";
import { ArtifactKindBadge } from "./ArtifactDetail";
import { NewArtifactDialog } from "./NewArtifactDialog";

type Props = {
  artifacts: readonly WorkspaceArtifact[];
  selectedId?: string;
  /** Single click previews; double click or Enter keeps the tab open. */
  onOpen: (artifact: WorkspaceArtifact, pin: boolean) => void;
  /** Omit to hide the scope switch, for a list that has only one scope. */
  scope?: ArtifactScope;
  onScopeChange?: (scope: ArtifactScope) => void;
  hasActiveSession?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Pin list for New artifact; omit to hide the button. */
  createScope?: string;
  /** Hide the session line when every item comes from one session. */
  showSession?: boolean;
  className?: string;
};

const SCOPES: { id: ArtifactScope; label: string; title: string }[] = [
  { id: "session", label: "This session", title: "Artifacts of the chat in front" },
  { id: "project", label: "All sessions", title: "Artifacts of every session in this project" },
];

/**
 * The master list of the Artifacts view: scope, kind and search narrow it;
 * arrows move and preview, Enter keeps the artifact open.
 */
export function ArtifactsList({
  artifacts,
  selectedId,
  onOpen,
  scope,
  onScopeChange,
  hasActiveSession = true,
  loading = false,
  error = null,
  onRetry,
  createScope,
  showSession = true,
  className = "",
}: Props) {
  const [filter, setFilter] = useState<ArtifactFilter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [focusedId, setFocusedId] = useState<string | undefined>(selectedId);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(
    () => filterArtifacts(artifacts, { filter, query }),
    [artifacts, filter, query],
  );
  const counts = useMemo(() => {
    const byFilter = new Map<ArtifactFilter, number>();
    for (const { id } of ARTIFACT_FILTERS)
      byFilter.set(id, filterArtifacts(artifacts, { filter: id, query }).length);
    return byFilter;
  }, [artifacts, query]);

  useEffect(() => {
    if (selectedId) setFocusedId(selectedId);
  }, [selectedId]);

  const now = Date.now();
  const activeId = shown.some((item) => item.id === focusedId)
    ? focusedId
    : (shown.find((item) => item.id === selectedId) ?? shown[0])?.id;

  const focusItem = (index: number, preview: boolean) => {
    const item = shown[Math.max(0, Math.min(shown.length - 1, index))];
    if (!item) return;
    setFocusedId(item.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-artifact-id="${CSS.escape(item.id)}"]`)
      ?.focus();
    if (preview) onOpen(item, false);
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const index = shown.findIndex((item) => item.id === activeId);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(index + 1, true);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (index <= 0) {
          listRef.current
            ?.closest("[data-artifacts-list]")
            ?.querySelector<HTMLInputElement>("input[type=search]")
            ?.focus();
          break;
        }
        focusItem(index - 1, true);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0, true);
        break;
      case "End":
        event.preventDefault();
        focusItem(shown.length - 1, true);
        break;
      case "Enter":
      case " ": {
        const item = shown[index];
        if (!item) return;
        event.preventDefault();
        onOpen(item, event.key === "Enter");
        break;
      }
    }
  };

  const emptyMessage = (() => {
    if (artifacts.length && !shown.length)
      return query.trim()
        ? `No artifacts match “${query.trim()}”.`
        : "No artifacts of this kind yet.";
    if (scope === "session" && !hasActiveSession)
      return "Open a chat to see what it made, or switch to All sessions.";
    return scope === "session"
      ? "Nothing yet. Files the agent writes, pages, diagrams, documents and long snippets show up here."
      : "Nothing yet in this project. Files the agent writes, pages, diagrams, documents and long snippets show up here.";
  })();

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${className}`}
      data-artifacts-list
    >
      {scope && onScopeChange ? (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2">
          <div
            role="radiogroup"
            aria-label="Artifact scope"
            className="flex min-w-0 flex-1 items-center gap-px rounded-md bg-content/5 p-0.5"
          >
            {SCOPES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={scope === option.id}
                title={option.title}
                onClick={() => onScopeChange(option.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  onScopeChange(scope === "session" ? "project" : "session");
                }}
                className={`h-5.5 min-w-0 flex-1 truncate rounded px-2 text-[11px] ${
                  scope === option.id
                    ? "bg-selection text-content"
                    : "text-content/50 hover:text-content/80"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {createScope ? (
            <NewArtifactButton onClick={() => setCreating(true)} />
          ) : null}
        </div>
      ) : null}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2">
        <div className="relative flex h-7 min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
          <input
            type="search"
            value={query}
            placeholder="Search artifacts..."
            aria-label="Search artifacts"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              } else if (event.key === "ArrowDown" && shown.length) {
                event.preventDefault();
                focusItem(
                  Math.max(0, shown.findIndex((item) => item.id === activeId)),
                  false,
                );
              }
            }}
            className="h-full w-full min-w-0 rounded-md bg-transparent py-0 pl-7 pr-2 text-[12px] text-content outline-none placeholder:text-content/35 [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        {createScope && !(scope && onScopeChange) ? (
          <NewArtifactButton onClick={() => setCreating(true)} />
        ) : null}
      </div>
      <div
        role="group"
        aria-label="Artifact kind"
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-stroke px-2 py-1.5"
      >
        {ARTIFACT_FILTERS.map((option) => {
          const count = counts.get(option.id) ?? 0;
          const active = filter === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(option.id)}
              disabled={!active && option.id !== "all" && count === 0}
              className={`flex h-5.5 items-center gap-1 rounded-md px-1.5 text-[11px] disabled:opacity-35 ${
                active
                  ? "bg-selection text-content"
                  : "text-content/55 hover:bg-content/8 hover:text-content"
              }`}
            >
              {option.label}
              {count > 0 ? (
                <span className="tabular-nums text-content/40">{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {error ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-stroke px-3 py-1.5 text-[11px] text-content/65"
        >
          <span className="min-w-0 flex-1">{error}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1 rounded px-1 hover:bg-content/10 hover:text-content"
            >
              <RefreshCw className="size-3" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Artifacts"
        aria-busy={loading}
        tabIndex={shown.length ? -1 : undefined}
        onKeyDown={onListKeyDown}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none py-1"
      >
        {shown.map((artifact) => {
          const selected = artifact.id === selectedId;
          const where = artifact.path
            ? displayPath(artifact.path, artifact.cwd)
            : undefined;
          return (
            <div
              key={artifact.id}
              role="option"
              aria-selected={selected}
              data-artifact-id={artifact.id}
              tabIndex={artifact.id === activeId ? 0 : -1}
              title={where ?? artifact.title}
              onFocus={() => setFocusedId(artifact.id)}
              onClick={() => onOpen(artifact, false)}
              onDoubleClick={() => onOpen(artifact, true)}
              className={`mx-1 flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-accent/70 ${
                selected ? "bg-selection" : "hover:bg-content/5"
              }`}
            >
              <span className="mt-0.5 shrink-0">
                <FileTypeIcon name={artifactFileName(artifact)} isDir={false} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`min-w-0 flex-1 truncate text-[12px] leading-4 ${
                      selected ? "text-content" : "text-content/85"
                    }`}
                  >
                    {artifact.title}
                  </span>
                  {artifact.pinned ? (
                    <Pin
                      aria-label="Pinned"
                      className="size-3 shrink-0 text-content/45"
                    />
                  ) : null}
                  <ArtifactKindBadge artifact={artifact} />
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-content/45">
                  <span className="min-w-0 flex-1 truncate">
                    {artifact.change ? (
                      <span className={artifact.change === "created" ? "text-emerald-500/80" : "text-amber-500/80"}>
                        {artifact.change === "created" ? "Created" : "Modified"}
                        {showSession && artifact.sessionTitle ? " · " : ""}
                      </span>
                    ) : null}
                    {showSession
                      ? (artifact.sessionTitle ??
                        (artifact.origin === "manual" ? "Added by you" : ""))
                      : null}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatArtifactTime(artifact.createdAt, now)}
                  </span>
                </span>
              </span>
            </div>
          );
        })}
        {!shown.length && loading ? (
          <p role="status" className="px-3 py-2 text-[12px] text-content/50">
            Reading this project's sessions…
          </p>
        ) : null}
        {!shown.length && !loading ? (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <Artifacts className="size-5 text-content/30" />
            <p className="max-w-64 text-[12px] leading-4.5 text-content/50">
              {emptyMessage}
            </p>
            {artifacts.length && !shown.length ? (
              <SecondaryButton
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
              >
                Clear filters
              </SecondaryButton>
            ) : scope === "session" && onScopeChange ? (
              <SecondaryButton onClick={() => onScopeChange("project")}>
                Show all sessions
              </SecondaryButton>
            ) : null}
          </div>
        ) : null}
        {shown.length && loading ? (
          <p role="status" className="px-3 py-1.5 text-[11px] text-content/40">
            Reading older sessions…
          </p>
        ) : null}
      </div>
      {creating && createScope ? (
        <NewArtifactDialog
          scope={createScope}
          onCancel={() => setCreating(false)}
          onCreated={(artifact) => {
            setCreating(false);
            setFilter("all");
            setQuery("");
            onOpen(artifact, true);
          }}
        />
      ) : null}
    </div>
  );
}

function NewArtifactButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="New artifact"
      aria-label="New artifact"
      onClick={onClick}
      className="grid size-6 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
    >
      <Plus className="size-3.5" />
    </button>
  );
}
