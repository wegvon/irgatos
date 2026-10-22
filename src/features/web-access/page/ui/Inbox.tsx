import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  WebInbox,
  WebInboxDetail,
  WebInboxItem,
} from "../../model/protocol";
import { read, write } from "../client";
import { ago } from "../format";
import { leaveSheetFor, openSheet } from "../route";
import { Markdown } from "./Markdown";
import {
  Empty,
  Pill,
  Spinner,
  primaryButton,
  secondaryButton,
  useAction,
  type Tone,
} from "./parts";
import {
  CircleDot,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Inbox as InboxIcon,
  RefreshCw,
} from "../../../../shared/ui/icons";

type Filter = "needsAction" | "all" | "snoozed";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "needsAction", label: "Needs action" },
  { id: "all", label: "All" },
  { id: "snoozed", label: "Snoozed" },
];

const PROVIDER: Record<WebInboxItem["provider"], string> = {
  github: "GitHub",
  gitlab: "GitLab",
  azuredevops: "Azure DevOps",
  linear: "Linear",
  jira: "Jira",
};

const STATUS_TONE: Record<string, Tone> = {
  Open: "emerald",
  Draft: "muted",
  Merged: "accent",
  Closed: "rose",
};

/** Needs action, as the Mac's Inbox counts it, for the menu's badge. */
export function inboxBadge(inbox: WebInbox | null): number {
  return inbox?.items.filter((item) => item.needsAction).length ?? 0;
}

function shown(items: WebInboxItem[], filter: Filter) {
  return items.filter((item) =>
    filter === "snoozed"
      ? item.snoozedUntil != null
      : item.snoozedUntil == null &&
        (filter === "all" || item.needsAction),
  );
}

/** The item's kind and state as the desktop draws it. */
function KindIcon({ item }: { item: WebInboxItem }) {
  const className = "size-[18px] shrink-0";
  if (item.kind === "pr") {
    if (item.status === "Merged")
      return <GitMerge className={`${className} text-(--tone-accent)`} />;
    if (item.status === "Closed")
      return <GitPullRequestClosed className={`${className} text-(--tone-rose)`} />;
    if (item.status === "Draft")
      return <GitPullRequestDraft className={`${className} text-(--ink-3)`} />;
    return <GitPullRequest className={`${className} text-(--tone-emerald)`} />;
  }
  return (
    <CircleDot
      className={`${className} ${item.status === "Closed" ? "text-(--tone-rose)" : "text-(--tone-emerald)"}`}
    />
  );
}

function ItemRow({ item, now }: { item: WebInboxItem; now: number }) {
  return (
    <button
      onClick={() => openSheet({ name: "inboxItem", id: item.key })}
      className="web-press flex w-full items-start gap-3 px-4 py-3.5 text-left active:bg-content/6"
    >
      <span className="pt-0.5">
        <KindIcon item={item} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`line-clamp-2 min-w-0 flex-1 text-[15.5px] leading-snug text-(--ink) ${item.unseen ? "font-semibold" : "font-medium"}`}
          >
            {item.title}
          </span>
          {item.unseen ? (
            <span
              aria-label="Updated"
              className="size-2 shrink-0 rounded-full bg-(--accent)"
            />
          ) : null}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-(--ink-2)">
          <span className="shrink-0 font-medium tabular-nums">{item.ref}</span>
          <span className="text-(--ink-3)">·</span>
          <span className="min-w-0 truncate">{item.source}</span>
          <span className="ml-auto shrink-0 tabular-nums text-(--ink-3)">
            {ago(item.updatedAt, now)}
          </span>
        </span>
        {item.attention || item.agentChats ? (
          <span className="mt-1 flex flex-wrap gap-1.5 text-[12px] font-medium">
            {item.attention ? (
              <span className="text-(--tone-amber)">{item.attention}</span>
            ) : null}
            {item.agentChats ? (
              <span className="text-(--ink-3)">
                {item.agentChats === 1
                  ? "1 agent chat"
                  : `${item.agentChats} agent chats`}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * The Mac's Inbox: pull requests, issues and tracker tickets from the
 * projects on its sidebar, with what changed since you last looked first.
 */
export function Inbox({
  inbox,
  error,
  reload,
  header,
  wide,
  now,
}: {
  inbox: WebInbox | null;
  error: Error | null;
  reload: () => void;
  header: ReactNode;
  wide: boolean;
  now: number;
}) {
  const [filter, setFilter] = useState<Filter>("needsAction");
  const [refreshing, setRefreshing] = useState(false);
  const items = useMemo(
    () => (inbox ? shown(inbox.items, filter) : []),
    [inbox, filter],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map(({ id }) => [id, inbox ? shown(inbox.items, id).length : 0]),
      ) as Record<Filter, number>,
    [inbox],
  );
  const refresh = () => {
    setRefreshing(true);
    read<WebInbox>("inbox", { fresh: "1" })
      .catch(() => null)
      .finally(() => {
        setRefreshing(false);
        reload();
      });
  };

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-5 ${wide ? "max-w-[920px] px-8 pb-12 pt-[calc(var(--safe-top)+22px)]" : "px-4 pb-8 pt-[calc(var(--safe-top)+10px)]"}`}
    >
      <header className="flex flex-col gap-4">
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
            Inbox
          </h1>
          <button
            aria-label="Refresh Inbox"
            disabled={refreshing}
            onClick={refresh}
            className="web-press flex size-10 items-center justify-center rounded-full text-(--ink-2) active:bg-content/8 disabled:opacity-50"
          >
            <RefreshCw className={`size-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`web-press flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-medium ${
                filter === id
                  ? "bg-(--ink) text-(--color-background-base)"
                  : id === "needsAction" && counts.needsAction
                    ? "bg-content/6 text-(--tone-amber)"
                    : "bg-content/6 text-(--ink-2)"
              }`}
            >
              {label}
              {inbox ? (
                <span className="tabular-nums">{counts[id]}</span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      {inbox?.errors.length ? (
        <div className="rounded-[18px] bg-content/6 px-4 py-3 text-[13.5px] leading-snug text-(--ink-2)">
          {inbox.errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}

      {!inbox ? (
        error ? (
          <div className="glass rounded-[28px]">
            <Empty title="Inbox didn't load">{error.message}</Empty>
          </div>
        ) : (
          <div className="flex justify-center py-20 text-(--ink-3)">
            <Spinner className="size-6" />
          </div>
        )
      ) : items.length ? (
        <div className="glass divide-y divide-(--hairline) overflow-hidden rounded-[24px]">
          {items.map((item) => (
            <ItemRow key={item.key} item={item} now={now} />
          ))}
        </div>
      ) : (
        <div className="glass rounded-[28px]">
          <Empty
            icon={
              <span className="flex size-16 items-center justify-center rounded-2xl bg-content/6 text-(--ink-3)">
                <InboxIcon className="size-8" />
              </span>
            }
            title={
              !inbox.items.length
                ? "Inbox is empty"
                : filter === "needsAction"
                  ? "All caught up"
                  : filter === "snoozed"
                    ? "Nothing snoozed"
                    : "Nothing here"
            }
          >
            {!inbox.items.length
              ? "Connect GitHub, GitLab, Linear or Jira in the Inbox on your Mac to see pull requests and issues here."
              : filter === "needsAction"
                ? "Nothing changed since you last looked."
                : null}
          </Empty>
        </div>
      )}
    </div>
  );
}

/**
 * One item: what it says, a link to it, and a chat to start from it, as the
 * Mac's Start button does. Opening it marks it seen on the Mac too.
 */
export function InboxItemSheet({
  id,
  now,
  onSeen,
}: {
  id: string;
  now: number;
  onSeen: () => void;
}) {
  const [detail, setDetail] = useState<WebInboxDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { busy, run } = useAction();

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    read<WebInboxDetail>("inboxItem", { key: id })
      .then((next) => {
        if (!alive) return;
        setDetail(next);
        onSeen();
      })
      .catch((reason: unknown) => {
        if (alive)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      alive = false;
    };
    // onSeen only refreshes the list underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error)
    return <div className="px-5 pb-8 text-[15px] text-(--ink-2)">{error}</div>;
  if (!detail)
    return (
      <div className="flex justify-center py-16 text-(--ink-3)">
        <Spinner className="size-6" />
      </div>
    );

  const { item } = detail;
  const start = () =>
    void run("start", async () => {
      const started = await write<{ sessionId: string }>("inboxStart", {
        key: item.key,
        text: note,
      });
      leaveSheetFor({ name: "chat", id: started.sessionId });
    });

  return (
    <div className="flex flex-col gap-4 px-5 pb-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-(--ink-2)">
          <KindIcon item={item} />
          <span className="font-semibold tabular-nums">{item.ref}</span>
          <span className="text-(--ink-3)">·</span>
          <span className="min-w-0 truncate">{item.source}</span>
          <Pill tone={STATUS_TONE[item.status] ?? "muted"} className="ml-auto">
            {item.status}
          </Pill>
        </div>
        <div className="text-[20px] font-semibold leading-snug tracking-[-0.015em] text-(--ink)">
          {item.title}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-(--ink-3)">
          {detail.author ? <span>{detail.author}</span> : null}
          {detail.author ? <span>·</span> : null}
          <span>
            {PROVIDER[item.provider]} · updated {ago(item.updatedAt, now)}
          </span>
          {item.labels.map((label) => (
            <span
              key={label.name}
              className="rounded-md bg-content/8 px-1.5 py-0.5 text-[11.5px] font-medium text-(--ink-2)"
            >
              {label.name}
            </span>
          ))}
        </div>
      </div>
      {detail.body.trim() ? (
        <div className="glass max-h-[42vh] overflow-y-auto rounded-[20px] px-4 py-3 text-[15px]">
          <Markdown text={detail.body} />
        </div>
      ) : (
        <div className="text-[14px] text-(--ink-3)">No description.</div>
      )}
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className={`${secondaryButton} self-start`}
        >
          <ExternalLink className="size-4" />
          Open in {PROVIDER[item.provider]}
        </a>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-(--hairline) pt-4">
        <div className="text-[13px] font-semibold text-(--ink-2)">
          Start a chat from this
        </div>
        <textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What should the agent do? (optional)"
          className="web-field min-h-[64px] resize-none rounded-[16px] bg-content/6 px-3.5 py-3 text-(--ink) outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
        />
        <button
          className={primaryButton}
          disabled={busy === "start"}
          onClick={start}
        >
          {busy === "start" ? <Spinner /> : null}
          Start chat
        </button>
        {item.place ? (
          <div className="text-center text-[12.5px] text-(--ink-3)">
            Runs in {item.place} on your Mac
          </div>
        ) : null}
      </div>
    </div>
  );
}
