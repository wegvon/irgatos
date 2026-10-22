import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  WebArtifact,
  WebArtifactRow,
  WebArtifacts,
} from "../../model/protocol";
import { read, usePoll } from "../client";
import { ago, basename } from "../format";
import { navigate } from "../route";
import { Markdown } from "./Markdown";
import { Sheet } from "./Sheet";
import { Empty, Spinner, secondaryButton } from "./parts";
import {
  ChipStrip,
  FilterChip,
  ProjectSelect,
  ScreenFrame,
  SearchField,
  store,
  stored,
} from "./WorkspaceParts";
import {
  Artifacts as ArtifactsIcon,
  Copy,
  File,
  ImageIcon,
  MessageSquare,
  Pin,
  SourceCode,
  StickyNote,
} from "../../../../shared/ui/icons";

const PROJECT_KEY = "irgatos.web.artifacts.project";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "files", label: "Files" },
  { id: "previews", label: "Previews" },
  { id: "docs", label: "Docs" },
  { id: "code", label: "Code" },
  { id: "media", label: "Media" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

function FormatIcon({ format }: { format: WebArtifactRow["format"] }) {
  const className = "size-[18px]";
  if (format === "image") return <ImageIcon className={className} />;
  if (format === "markdown") return <StickyNote className={className} />;
  if (format === "code") return <SourceCode className={className} />;
  if (format === "html" || format === "svg" || format === "mermaid")
    return <ArtifactsIcon className={className} />;
  return <File className={className} />;
}

/**
 * The project's artifacts, as in the Mac's Artifacts tab: pages, pictures,
 * documents and code the chats made, pinned ones first.
 */
export function Artifacts({
  now,
  wide,
  header,
  live,
}: {
  now: number;
  wide: boolean;
  header?: ReactNode;
  /** Chats open on the Mac, which the page can show. */
  live: ReadonlySet<string>;
}) {
  const [project, setProjectState] = useState(() => stored(PROJECT_KEY));
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<WebArtifactRow | null>(null);
  const list = usePoll(
    `artifacts:${project ?? ""}`,
    () => read<WebArtifacts>("artifacts", project ? { project } : {}),
    () => 60_000,
  );
  const data = list.data;
  const lost = !!list.error && !!project && !data;
  useEffect(() => {
    if (!lost) return;
    store(PROJECT_KEY, null);
    setProjectState(null);
  }, [lost]);
  const words = query.trim().toLowerCase();
  const matching = useMemo(
    () =>
      (data?.artifacts ?? []).filter(
        (artifact) =>
          !words ||
          [artifact.title, artifact.path ?? "", artifact.sessionTitle ?? "", artifact.kind].some(
            (field) => field.toLowerCase().includes(words),
          ),
      ),
    [data, words],
  );
  const shown =
    filter === "all"
      ? matching
      : matching.filter((artifact) => artifact.filters.includes(filter));

  return (
    <ScreenFrame
      header={header}
      wide={wide}
      title={data && data.projects.length > 1 ? data.label : "Artifacts"}
      action={
        data ? (
          <ProjectSelect
            projects={data.projects}
            value={data.project}
            onChange={(path) => {
              store(PROJECT_KEY, path);
              setProjectState(path);
            }}
          />
        ) : null
      }
      controls={
        <>
          <SearchField value={query} onChange={setQuery} placeholder="Search artifacts" />
          <ChipStrip>
            {FILTERS.map((entry) => {
              const count =
                entry.id === "all"
                  ? undefined
                  : matching.filter((artifact) => artifact.filters.includes(entry.id)).length;
              return entry.id === "all" || count ? (
                <FilterChip
                  key={entry.id}
                  on={filter === entry.id}
                  count={count}
                  onClick={() => setFilter(entry.id)}
                >
                  {entry.label}
                </FilterChip>
              ) : null;
            })}
          </ChipStrip>
        </>
      }
    >
      {!data ? (
        list.error ? (
          <Empty title="Can't load artifacts">{list.error.message}</Empty>
        ) : (
          <div className="flex flex-col items-center gap-3 py-16 text-[14px] text-(--ink-3)">
            <Spinner className="size-6" />
            Reading the project's chats…
          </div>
        )
      ) : shown.length ? (
        <div className="glass divide-y divide-(--hairline) overflow-hidden rounded-[24px]">
          {shown.map((artifact) => (
            <button
              key={artifact.id}
              onClick={() => setOpen(artifact)}
              className="web-press flex w-full items-center gap-3 px-4 py-3 text-left active:bg-content/6"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-content/8 text-(--ink-2)">
                <FormatIcon format={artifact.format} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[15.5px] font-semibold text-(--ink)">
                    {artifact.title}
                  </span>
                  {artifact.pinned ? (
                    <Pin className="size-3.5 shrink-0 text-(--ink-3)" />
                  ) : null}
                </span>
                <span className="truncate text-[13px] text-(--ink-3)">
                  {artifact.kind}
                  {artifact.sessionTitle ? ` · ${artifact.sessionTitle}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-[12.5px] text-(--ink-3)">
                {ago(artifact.createdAt, now)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          icon={<ArtifactsIcon className="size-12 text-(--ink-3)" />}
          title={data.artifacts.length ? "Nothing matches" : "No artifacts yet"}
        >
          {data.artifacts.length
            ? "Try another filter or other words."
            : "Files, pages and documents the chats in this project make show up here."}
        </Empty>
      )}
      {data && data.failed ? (
        <div className="mt-3 px-1 text-[13px] text-(--ink-3)">
          {data.failed} saved chats could not be read.
        </div>
      ) : null}
      {open && data ? (
        <Sheet title={open.title} wide={wide} onClose={() => setOpen(null)}>
          <ArtifactDetail
            project={data.project}
            row={open}
            live={!!open.sessionId && live.has(open.sessionId)}
            onOpenChat={(id) => {
              setOpen(null);
              navigate({ name: "chat", id });
            }}
          />
        </Sheet>
      ) : null}
    </ScreenFrame>
  );
}

function ArtifactDetail({
  project,
  row,
  live,
  onOpenChat,
}: {
  project: string;
  row: WebArtifactRow;
  live: boolean;
  onOpenChat: (sessionId: string) => void;
}) {
  const visual = row.format === "html" || row.format === "svg";
  const [source, setSource] = useState(!visual);
  const [copied, setCopied] = useState(false);
  const artifact = usePoll(
    !visual || source ? `artifact:${project}:${row.id}` : null,
    () => read<WebArtifact>("artifact", { project, id: row.id }),
    () => 5 * 60_000,
  );
  const frame = `/api/artifactFrame?${new URLSearchParams({ project, id: row.id })}`;
  const data = artifact.data;

  return (
    <div className="flex flex-col gap-4 px-5 pb-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--ink-3)">
        <span className="font-semibold text-(--ink-2)">{row.kind}</span>
        {row.path ? <span className="truncate">{basename(row.path)}</span> : null}
        {row.sessionTitle ? <span className="truncate">From {row.sessionTitle}</span> : null}
      </div>
      <div className="flex gap-2">
        {visual ? (
          <button
            className={`${secondaryButton} h-10 flex-1 px-4`}
            onClick={() => setSource(!source)}
          >
            <SourceCode className="size-4" />
            {source ? "Preview" : "Source"}
          </button>
        ) : null}
        {data?.text && navigator.clipboard ? (
          <button
            className={`${secondaryButton} h-10 flex-1 px-4`}
            onClick={() =>
              void navigator.clipboard.writeText(data.text).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              })
            }
          >
            <Copy className="size-4" />
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
        {live && row.sessionId ? (
          <button
            className={`${secondaryButton} h-10 flex-1 px-4`}
            onClick={() => onOpenChat(row.sessionId!)}
          >
            <MessageSquare className="size-4" />
            Chat
          </button>
        ) : null}
      </div>
      {visual && !source ? (
        <iframe
          title={row.title}
          src={frame}
          sandbox="allow-scripts"
          className="h-[min(70vh,720px)] w-full rounded-[18px] border-0 bg-white shadow-[inset_0_0_0_1px_var(--hairline)]"
        />
      ) : !data ? (
        artifact.error ? (
          <Empty title="Can't open it">{artifact.error.message}</Empty>
        ) : (
          <div className="flex justify-center py-16 text-(--ink-3)">
            <Spinner className="size-6" />
          </div>
        )
      ) : data.image ? (
        <img
          src={data.image}
          alt={row.title}
          className="max-h-[70vh] w-full rounded-[18px] object-contain"
        />
      ) : (
        <>
          {data.stale ? (
            <div className="rounded-[14px] bg-content/6 px-4 py-3 text-[13.5px] text-(--ink-2)">
              The file can't be read now ({data.stale}); this is what the chat
              showed of it.
            </div>
          ) : null}
          <div className="min-w-0 overflow-x-auto">
            <Markdown text={data.markdown || "*Empty*"} />
          </div>
        </>
      )}
    </div>
  );
}
