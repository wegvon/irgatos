import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  ExternalLink,
  Feed,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import {
  irgatLook,
  irgatsSnapshot,
  listIrgats,
  subscribeIrgats,
} from "../../irgats/model/irgat";
import type { Habit } from "../../irgats/model/irgatHabits";
import { shellPath } from "../../orchestration/model/orchestration";
import {
  COLLECTOR_SCHEDULES,
  FEED_CHANGED,
  FEED_STRICTNESS,
  FEED_VIEWS,
  collectNow,
  collectorScheduleOf,
  loadCollectorHabit,
  loadFeedItems,
  loadFeedOverview,
  loadSimilarFeedItems,
  markFeedItems,
  markFeedViewRead,
  metricsLine,
  removeCollectorHabit,
  removeFeedInterest,
  saveCollectorHabit,
  saveFeedCollector,
  saveFeedInterest,
  scorePercent,
  setFeedThreshold,
  sourceName,
  strictnessLabel,
  type CollectorSchedule,
  type FeedInterest,
  type FeedItem,
  type FeedOverview,
  type FeedViewId,
} from "../model/feed";
import {
  TrendingControls,
  TrendingList,
  useTrendingChoice,
} from "./TrendingPanel";

type Props = {
  besideRail?: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
};

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const time = (ms: number | null | undefined) =>
  ms ? formatRelativeTime(new Date(ms).toISOString()) : "";

/** The post views, plus GitHub's trending repositories. */
type FeedTab = FeedViewId | "github";

let rememberedView: FeedTab = "feed";
let rememberedInterest: string | null = null;
let rememberedUnread = false;

export function FeedView({
  besideRail = false,
  compactRail = false,
  onClose,
  onToggleSidebar,
}: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [overview, setOverview] = useState<FeedOverview | null>(null);
  const [view, setView] = useState<FeedTab>(rememberedView);
  const trending = useTrendingChoice();
  const [trendingRefresh, setTrendingRefresh] = useState(0);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [interestId, setInterestId] = useState<string | null>(
    rememberedInterest,
  );
  const [unreadOnly, setUnreadOnly] = useState(rememberedUnread);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState(false);
  const listRequest = useRef(0);
  const listLock = useLockOverscroll<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      listLock(node);
    },
    [listLock],
  );

  useEffect(() => {
    rememberedView = view;
    rememberedInterest = interestId;
    rememberedUnread = unreadOnly;
  }, [view, interestId, unreadOnly]);

  const reloadOverview = useCallback(async () => {
    try {
      const next = await loadFeedOverview();
      setOverview(next);
      // A removed interest falls back to all of them.
      setInterestId((current) =>
        current && !next.interests.some((i) => i.id === current)
          ? null
          : current,
      );
    } catch (err: unknown) {
      setError(message(err));
    }
  }, []);

  const load = useCallback(
    async (more = false) => {
      if (view === "github") return;
      const request = ++listRequest.current;
      setLoading(true);
      try {
        const page = await loadFeedItems(
          view,
          interestId,
          unreadOnly,
          more ? items.length : 0,
        );
        if (request !== listRequest.current) return;
        setItems((current) =>
          more ? [...current, ...page.items] : page.items,
        );
        setTotal(page.total);
        setError(null);
        if (!more) setPendingNew(false);
      } catch (err: unknown) {
        if (request === listRequest.current) setError(message(err));
      } finally {
        if (request === listRequest.current) setLoading(false);
      }
    },
    [view, interestId, unreadOnly, items.length],
  );
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void reloadOverview();
  }, [reloadOverview]);

  useEffect(() => {
    void loadRef.current();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [view, interestId, unreadOnly]);

  // Posts arrive while the page is open; scores change as interests are
  // embedded. Refresh in place at the top, otherwise offer it.
  useEffect(() => {
    const unlisten = listen(FEED_CHANGED, () => {
      void reloadOverview();
      if (rememberedView === "github") return;
      const atTop = (scrollRef.current?.scrollTop ?? 0) < 40;
      if (atTop) void loadRef.current();
      else setPendingNew(true);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [reloadOverview]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const interests = overview?.interests ?? [];
  const titleOf = useCallback(
    (id: string | null) => interests.find((i) => i.id === id)?.title ?? "",
    [interests],
  );

  const changeItem = useCallback(
    async (
      item: FeedItem,
      change: { read?: boolean; saved?: boolean; hidden?: boolean },
    ) => {
      // Optimistic: the row updates or leaves the list at once.
      const leaves =
        change.hidden ||
        (view === "saved" && change.saved === false) ||
        (unreadOnly && change.read === true);
      setItems((current) =>
        leaves
          ? current.filter((i) => i.id !== item.id)
          : current.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    ...(change.read === undefined ? {} : { read: change.read }),
                    ...(change.saved === undefined
                      ? {}
                      : { saved: change.saved, read: change.saved || i.read }),
                  }
                : i,
            ),
      );
      if (leaves) setTotal((n) => Math.max(0, n - 1));
      try {
        await markFeedItems([item.id], change);
        void reloadOverview();
      } catch (err: unknown) {
        setError(message(err));
        void loadRef.current();
      }
    },
    [view, unreadOnly, reloadOverview],
  );

  const markAllRead = useCallback(async () => {
    if (view === "github") return;
    try {
      await markFeedViewRead(view, interestId);
      await Promise.all([loadRef.current(), reloadOverview()]);
    } catch (err: unknown) {
      setError(message(err));
    }
  }, [view, interestId, reloadOverview]);

  const counts = overview?.counts;
  const header = (
    <div
      className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
      data-tauri-drag-region="deep"
    >
      {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
      {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
      {besideRail ? null : (
        <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
        <Feed
          className="size-3.5 shrink-0 text-content/45"
          strokeWidth={1.75}
        />
        <span className="min-w-0 truncate text-content">Feed</span>
        {counts?.unread ? (
          <span className="text-[12px] text-content/45">
            {counts.unread} unread
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1 px-2">
        <IconAction
          label="Refresh"
          onClick={() => {
            void reloadOverview();
            if (view === "github") setTrendingRefresh((n) => n + 1);
            else void loadRef.current();
          }}
          disabled={view === "github" ? trendingLoading : loading}
        >
          <RefreshCw
            className={`size-3.5 ${
              (view === "github" ? trendingLoading : loading)
                ? "animate-spin"
                : ""
            }`}
            strokeWidth={1.75}
          />
        </IconAction>
      </div>
      {IS_MAC ? null : <WindowControls />}
    </div>
  );

  if (overview === null) {
    return (
      <Shell header={header}>
        <div className="flex flex-1 items-center justify-center text-[12px] text-content/50">
          {error ?? <LoaderCircle className="size-4 animate-spin" />}
        </div>
      </Shell>
    );
  }

  const hasMore = items.length < total;
  const activeInterest = interests.find((i) => i.id === interestId);

  return (
    <Shell header={header}>
      <div className="flex min-h-0 min-w-0 flex-1">
        <aside
          className={`${view === "github" ? "hidden" : "flex"} w-[300px] shrink-0 flex-col overflow-y-auto border-r border-stroke`}
        >
          <InterestsPanel
            interests={interests}
            selected={interestId}
            onSelect={setInterestId}
            onChanged={reloadOverview}
            onError={setError}
          />
          <CollectorPanel overview={overview} onChanged={reloadOverview} />
          <FilterPanel
            overview={overview}
            onChanged={() => {
              void reloadOverview();
              void loadRef.current();
            }}
          />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-stroke px-4 pt-2">
            <div className="flex gap-3" role="tablist">
              {FEED_VIEWS.map((v) => {
                const badge =
                  v.id === "filtered"
                    ? counts?.filtered
                    : v.id === "saved"
                      ? counts?.saved
                      : undefined;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={view === v.id}
                    onClick={() => setView(v.id)}
                    className={`relative h-8 text-[12px] ${
                      view === v.id
                        ? "text-content"
                        : "text-content/50 hover:text-content"
                    }`}
                  >
                    {v.label}
                    {badge ? (
                      <span className="ml-1 text-content/40">{badge}</span>
                    ) : null}
                    {view === v.id ? (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-content" />
                    ) : null}
                  </button>
                );
              })}
              <button
                type="button"
                role="tab"
                aria-selected={view === "github"}
                onClick={() => setView("github")}
                title="Trending repositories on GitHub"
                className={`relative h-8 text-[12px] ${
                  view === "github"
                    ? "text-content"
                    : "text-content/50 hover:text-content"
                }`}
              >
                GitHub
                {view === "github" ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-content" />
                ) : null}
              </button>
            </div>
            {view === "github" ? (
              <div className="ml-auto flex items-center gap-2 pb-1 text-[12px] text-content/60">
                <TrendingControls
                  period={trending.period}
                  language={trending.language}
                  onPeriod={trending.setPeriod}
                  onLanguage={trending.setLanguage}
                />
              </div>
            ) : (
              <div className="ml-auto flex items-center gap-2 pb-1 text-[12px] text-content/60">
                {activeInterest ? (
                  <button
                    type="button"
                    onClick={() => setInterestId(null)}
                    className="flex items-center gap-1 rounded-md bg-content/5 px-2 py-0.5 text-content/75 hover:text-content"
                    title="Show every interest"
                  >
                    {activeInterest.title}
                    <X className="size-3" strokeWidth={1.75} />
                  </button>
                ) : null}
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(event) => setUnreadOnly(event.target.checked)}
                  />
                  Unread only
                </label>
                <IconAction
                  label="Mark all read"
                  onClick={() => void markAllRead()}
                  disabled={items.length === 0}
                >
                  <CheckCheck className="size-3.5" strokeWidth={1.75} />
                </IconAction>
              </div>
            )}
          </div>
          {pendingNew && view !== "github" ? (
            <button
              type="button"
              onClick={() => {
                scrollRef.current?.scrollTo({ top: 0 });
                void loadRef.current();
              }}
              className="shrink-0 border-b border-stroke bg-selection py-1.5 text-[12px] text-content hover:bg-content/10"
            >
              New posts arrived. Show them
            </button>
          ) : null}
          <div
            ref={scrollerRef}
            className="min-h-0 flex-1 overflow-y-auto"
            aria-busy={loading}
          >
            <div
              className={`mx-auto flex flex-col gap-2 px-4 py-3 ${
                view === "github" ? "max-w-[1400px]" : "max-w-[720px]"
              }`}
            >
              {view === "github" ? (
                <TrendingList
                  period={trending.period}
                  language={trending.language}
                  refreshKey={trendingRefresh}
                  onLoading={setTrendingLoading}
                />
              ) : (
                <>
                  {error ? (
                    <p className="text-[12px] text-red-400">{error}</p>
                  ) : null}
                  {view === "filtered" && items.length > 0 ? (
                    <p className="text-[12px] text-content/45">
                      Posts the agent sent that did not match an interest
                      closely enough. If good posts end up here, loosen the
                      filter or sharpen the interest's description.
                    </p>
                  ) : null}
                  {loading && items.length === 0 ? (
                    <div className="flex justify-center py-8 text-content/45">
                      <LoaderCircle className="size-4 animate-spin" />
                    </div>
                  ) : null}
                  {!loading && items.length === 0 && !error ? (
                    <EmptyState
                      view={view}
                      hasInterests={interests.length > 0}
                      hasCollector={!!overview.collector}
                      unreadOnly={unreadOnly}
                    />
                  ) : null}
                  {items.map((item) => (
                    <PostCard
                      key={item.id}
                      item={item}
                      interest={titleOf(item.interestId)}
                      threshold={overview.threshold}
                      onChange={(change) => void changeItem(item, change)}
                    />
                  ))}
                  {hasMore ? (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void load(true)}
                      className="w-full rounded-md py-1.5 text-[12px] text-content/60 hover:bg-content/5 hover:text-content disabled:opacity-50"
                    >
                      {loading
                        ? "Loading…"
                        : `Load more (${total - items.length})`}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function EmptyState({
  view,
  hasInterests,
  hasCollector,
  unreadOnly,
}: {
  view: FeedViewId;
  hasInterests: boolean;
  hasCollector: boolean;
  unreadOnly: boolean;
}) {
  let text: string;
  if (view === "saved") text = "Star a post to keep it here.";
  else if (view === "filtered")
    text =
      "Nothing was filtered out. Off-topic posts the agent sends land here.";
  else if (unreadOnly) text = "You are all caught up.";
  else if (!hasInterests)
    text =
      "Start by writing down what you want to follow under Interests: a name and a few sentences on what you do and do not want to see.";
  else if (!hasCollector)
    text =
      "Choose which Irgat collects posts under Collector. It reads your interests, searches X with its own tools and hands posts to the Feed.";
  else text = "No posts yet. Press Collect now, or wait for the next run.";
  return (
    <p className="py-8 text-center text-[12px] leading-relaxed text-content/50">
      {text}
    </p>
  );
}

function PostCard({
  item,
  interest,
  threshold,
  onChange,
}: {
  item: FeedItem;
  interest: string;
  threshold: number;
  onChange: (change: {
    read?: boolean;
    saved?: boolean;
    hidden?: boolean;
  }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [similar, setSimilar] = useState<FeedItem[] | null>(null);
  const long = item.text.length > 420 || item.text.split("\n").length > 7;
  const metrics = metricsLine(item.metrics);
  const open = () => {
    if (!item.read) onChange({ read: true });
    void openUrl(item.url);
  };
  const toggleSimilar = async () => {
    if (similar) return setSimilar(null);
    try {
      setSimilar(await loadSimilarFeedItems(item.id));
    } catch {
      setSimilar([]);
    }
  };
  return (
    <article
      className={`group rounded-lg border px-3.5 py-3 ${
        item.read
          ? "border-stroke/60 text-content/75"
          : "border-stroke bg-content/[0.02]"
      }`}
      onClick={() => {
        if (!item.read) onChange({ read: true });
      }}
    >
      <header className="flex items-center gap-1.5 text-[12px]">
        {!item.read ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-sky-400"
            aria-label="Unread"
          />
        ) : null}
        <span className="min-w-0 truncate font-medium text-content">
          {item.authorName ||
            (item.author ? `@${item.author}` : sourceName(item.source))}
        </span>
        {item.author && item.authorName ? (
          <span className="min-w-0 truncate text-content/45">
            @{item.author}
          </span>
        ) : null}
        <span className="shrink-0 text-content/35">·</span>
        <span
          className="shrink-0 text-content/45"
          title={new Date(
            item.publishedAt ?? item.collectedAt,
          ).toLocaleString()}
        >
          {sourceName(item.source)} ·{" "}
          {time(item.publishedAt ?? item.collectedAt)}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
          <IconAction
            label={item.saved ? "Remove from Saved" : "Save"}
            active={item.saved}
            onClick={() => onChange({ saved: !item.saved })}
          >
            <Star
              className={`size-3.5 ${item.saved ? "fill-current text-amber-400" : ""}`}
              strokeWidth={1.75}
            />
          </IconAction>
          <IconAction
            label={item.read ? "Mark unread" : "Mark read"}
            onClick={() => onChange({ read: !item.read })}
          >
            <Check className="size-3.5" strokeWidth={1.75} />
          </IconAction>
          <IconAction label="Hide" onClick={() => onChange({ hidden: true })}>
            <X className="size-3.5" strokeWidth={1.75} />
          </IconAction>
          <IconAction
            label={`Open on ${sourceName(item.source)}`}
            onClick={open}
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </IconAction>
        </div>
      </header>
      <p
        className={`mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed ${
          long && !expanded ? "line-clamp-6" : ""
        }`}
      >
        {item.text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-0.5 text-[12px] text-content/50 hover:text-content"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
      {item.summary ? (
        <p className="mt-1.5 border-l-2 border-stroke pl-2 text-[12px] leading-relaxed text-content/60">
          {item.summary}
        </p>
      ) : null}
      {item.media.length ? (
        <div className="mt-2 flex gap-1.5 overflow-hidden">
          {item.media.map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-28 max-w-[220px] rounded-md border border-stroke object-cover"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ))}
        </div>
      ) : null}
      <footer className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-content/45">
        {item.score !== null ? (
          <span
            className={`rounded px-1.5 py-0.5 ${
              item.score >= threshold
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-content/5"
            }`}
            title="How closely the post matches the interest, by meaning"
          >
            {interest || "No interest"} · {scorePercent(item.score)}%
          </span>
        ) : (
          <span
            className="rounded bg-content/5 px-1.5 py-0.5"
            title="Not scored yet: Smart Search is off or the embedding service was busy"
          >
            {item.agentInterest || "Not scored yet"}
          </span>
        )}
        {metrics ? <span>{metrics}</span> : null}
        {item.similar > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void toggleSimilar();
            }}
            className="hover:text-content"
          >
            {similar ? "Hide" : `+${item.similar}`} similar{" "}
            {item.similar === 1 ? "post" : "posts"}
          </button>
        ) : null}
      </footer>
      {similar?.length ? (
        <ul className="mt-2 flex flex-col gap-1 border-t border-stroke/60 pt-2">
          {similar.map((other) => (
            <li
              key={other.id}
              className="flex items-start gap-1.5 text-[12px] text-content/60"
            >
              <span className="shrink-0 text-content/80">
                {other.authorName || `@${other.author}`}
              </span>
              <span className="min-w-0 flex-1 truncate">{other.text}</span>
              <button
                type="button"
                title="Open"
                aria-label="Open"
                onClick={() => void openUrl(other.url)}
                className="shrink-0 hover:text-content"
              >
                <ExternalLink className="size-3" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

// ---- left column ----

function PanelTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-8 items-center justify-between px-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-content/45">
      <span>{children}</span>
      {action}
    </div>
  );
}

function InterestsPanel({
  interests,
  selected,
  onSelect,
  onChanged,
  onError,
}: {
  interests: FeedInterest[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => Promise<void>;
  onError: (error: string) => void;
}) {
  /** The interest being edited, or "new". */
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    if (interests.length === 0) setEditing((e) => e ?? "new");
  }, [interests.length]);
  return (
    <div className="border-b border-stroke pb-2">
      <PanelTitle
        action={
          <IconAction label="Add interest" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" strokeWidth={1.75} />
          </IconAction>
        }
      >
        Interests
      </PanelTitle>
      <div className="flex flex-col px-1.5">
        {interests.length > 0 ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`rounded-md px-2 py-1.5 text-left text-[12px] ${
              selected === null
                ? "bg-selection text-content"
                : "text-content/70 hover:bg-content/5"
            }`}
          >
            All interests
          </button>
        ) : null}
        {interests.map((interest) =>
          editing === interest.id ? (
            <InterestForm
              key={interest.id}
              interest={interest}
              onDone={() => setEditing(null)}
              onChanged={onChanged}
            />
          ) : (
            <div
              key={interest.id}
              className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] ${
                selected === interest.id
                  ? "bg-selection text-content"
                  : "text-content/70 hover:bg-content/5"
              }`}
            >
              <input
                type="checkbox"
                checked={interest.enabled}
                title={
                  interest.enabled
                    ? "Following; untick to pause"
                    : "Paused; tick to follow"
                }
                aria-label={`Follow ${interest.title}`}
                onChange={(event) => {
                  void saveFeedInterest({
                    ...interest,
                    enabled: event.target.checked,
                  })
                    .then(onChanged)
                    .catch((err: unknown) => onError(message(err)));
                }}
              />
              <button
                type="button"
                onClick={() => onSelect(interest.id)}
                title={interest.description || interest.title}
                className={`min-w-0 flex-1 truncate text-left ${
                  interest.enabled ? "" : "text-content/40 line-through"
                }`}
              >
                {interest.title}
              </button>
              <div className="flex shrink-0 opacity-0 group-hover:opacity-100">
                <IconAction
                  label="Edit"
                  onClick={() => setEditing(interest.id)}
                >
                  <Pencil className="size-3" strokeWidth={1.75} />
                </IconAction>
                <IconAction
                  label="Delete"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Delete the interest “${interest.title}”? Its posts stay in the feed.`,
                      )
                    )
                      return;
                    void removeFeedInterest(interest.id)
                      .then(() => {
                        if (selected === interest.id) onSelect(null);
                        return onChanged();
                      })
                      .catch((err: unknown) => onError(message(err)));
                  }}
                >
                  <Trash2 className="size-3" strokeWidth={1.75} />
                </IconAction>
              </div>
            </div>
          ),
        )}
        {editing === "new" ? (
          <InterestForm
            onDone={() => setEditing(null)}
            onChanged={onChanged}
            cancellable={interests.length > 0}
          />
        ) : null}
      </div>
    </div>
  );
}

function InterestForm({
  interest,
  onDone,
  onChanged,
  cancellable = true,
}: {
  interest?: FeedInterest;
  onDone: () => void;
  onChanged: () => Promise<void>;
  cancellable?: boolean;
}) {
  const [title, setTitle] = useState(interest?.title ?? "");
  const [description, setDescription] = useState(interest?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    try {
      await saveFeedInterest({
        id: interest?.id,
        title,
        description,
        enabled: interest?.enabled ?? true,
      });
      await onChanged();
      if (interest) onDone();
      else {
        setTitle("");
        setDescription("");
        onDone();
      }
    } catch (err: unknown) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="my-1 flex flex-col gap-1.5 rounded-md border border-stroke p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Name, e.g. Local LLMs on Mac"
        aria-label="Interest name"
        maxLength={120}
        className="rounded border border-stroke bg-transparent px-2 py-1 text-[12px] outline-none focus:border-content/40"
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="What you want and do not want, in your own words. e.g. New open-weight models, MLX and llama.cpp releases, benchmarks on Apple Silicon. Not crypto, not hype threads."
        aria-label="What to follow"
        rows={4}
        maxLength={2000}
        className="resize-y rounded border border-stroke bg-transparent px-2 py-1 text-[12px] leading-relaxed outline-none focus:border-content/40"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      <div className="flex justify-end gap-1.5">
        {cancellable ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded px-2 py-1 text-[12px] text-content/60 hover:text-content"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="rounded bg-content px-2.5 py-1 text-[12px] text-background-base disabled:opacity-40"
        >
          {saving ? "Saving…" : interest ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}

function CollectorPanel({
  overview,
  onChanged,
}: {
  overview: FeedOverview;
  onChanged: () => Promise<void>;
}) {
  const irgatsSnap = useSyncExternalStore(subscribeIrgats, irgatsSnapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const irgats = useMemo(() => listIrgats(), [irgatsSnap]);
  const collector = overview.collector;
  const [habit, setHabit] = useState<Habit | undefined>(undefined);
  const [habitLoaded, setHabitLoaded] = useState(false);
  const [irgatId, setIrgatId] = useState(collector?.irgatId ?? "");
  const [schedule, setSchedule] = useState<CollectorSchedule>("every3h");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshHabit = useCallback(async () => {
    try {
      const found = await loadCollectorHabit(collector);
      setHabit(found);
      if (found) setSchedule(collectorScheduleOf(found));
    } catch {
      setHabit(undefined);
    } finally {
      setHabitLoaded(true);
    }
  }, [collector]);

  useEffect(() => {
    setIrgatId((current) => collector?.irgatId ?? current);
    void refreshHabit();
  }, [collector, refreshHabit]);

  // The habit's last run changes while the page is open.
  useEffect(() => {
    if (!collector) return;
    const timer = window.setInterval(() => void refreshHabit(), 15_000);
    return () => window.clearInterval(timer);
  }, [collector, refreshHabit]);

  const irgatExists = irgats.some((i) => i.id === irgatId);
  const configured = !!collector && !!habit;
  const lost = !!collector && habitLoaded && !habit;
  const dirty =
    !configured ||
    collector.irgatId !== irgatId ||
    collectorScheduleOf(habit) !== schedule;

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      setNote(await work());
      await onChanged();
      await refreshHabit();
    } catch (err: unknown) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const cli = `${shellPath(await invoke<string>("app_cli_path"))} app`;
      await saveCollectorHabit(lost ? null : collector, irgatId, schedule, cli);
      return "Saved. It runs as a habit of that Irgat.";
    });

  const name = (id: string) => {
    const irgat = irgats.find((i) => i.id === id);
    return irgat ? irgatLook(irgat).name : "a removed Irgat";
  };

  return (
    <div className="border-b border-stroke pb-3">
      <PanelTitle>Collector</PanelTitle>
      <div className="flex flex-col gap-2 px-3 text-[12px]">
        {irgats.length === 0 ? (
          <p className="text-content/50">
            Create a Irgat first. The collector is one of its habits, and it
            needs X tools (an X MCP server) in its provider.
          </p>
        ) : (
          <>
            <select
              value={irgatExists ? irgatId : ""}
              onChange={(event) => setIrgatId(event.target.value)}
              aria-label="Irgat that collects"
              className="w-full rounded-md border border-stroke bg-transparent px-2 py-1 text-[12px] text-content outline-none focus:border-content/40"
            >
              <option value="" disabled>
                Choose a Irgat…
              </option>
              {irgats.map((irgat) => (
                <option key={irgat.id} value={irgat.id}>
                  {irgatLook(irgat).name}
                </option>
              ))}
            </select>
            <select
              value={schedule}
              onChange={(event) =>
                setSchedule(event.target.value as CollectorSchedule)
              }
              aria-label="How often"
              className="w-full rounded-md border border-stroke bg-transparent px-2 py-1 text-[12px] text-content outline-none focus:border-content/40"
            >
              {COLLECTOR_SCHEDULES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1.5">
              {dirty ? (
                <button
                  type="button"
                  disabled={busy || !irgatExists}
                  onClick={() => void save()}
                  className="rounded bg-content px-2.5 py-1 text-[12px] text-background-base disabled:opacity-40"
                >
                  {configured ? "Save changes" : "Start collecting"}
                </button>
              ) : null}
              {configured ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await collectNow(collector);
                        return `${name(collector.irgatId)} is collecting now. New posts appear here as they arrive.`;
                      })
                    }
                    className="flex items-center gap-1 rounded border border-stroke px-2 py-1 text-[12px] text-content/80 hover:text-content disabled:opacity-40"
                  >
                    <Play className="size-3" strokeWidth={1.75} />
                    Collect now
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await removeCollectorHabit(collector);
                        await saveFeedCollector(null);
                        return "Stopped. The posts you have stay.";
                      })
                    }
                    className="rounded px-2 py-1 text-[12px] text-content/55 hover:text-content disabled:opacity-40"
                  >
                    Stop
                  </button>
                </>
              ) : null}
            </div>
          </>
        )}
        {configured && habit ? (
          <p className="text-content/50">
            {name(collector.irgatId)} ·{" "}
            {habit.lastRunAt
              ? `last ran ${time(habit.lastRunAt)}${
                  habit.lastOutcome === "failed"
                    ? ", failed"
                    : habit.lastOutcome === "skipped"
                      ? ", skipped"
                      : ""
                }`
              : "has not run yet"}
            {habit.nextRunAt
              ? ` · next ${new Date(habit.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </p>
        ) : null}
        {habit?.lastError ? (
          <p className="flex gap-1 text-red-400">
            <AlertCircle
              className="mt-0.5 size-3 shrink-0"
              strokeWidth={1.75}
            />
            {habit.lastError}
          </p>
        ) : null}
        {lost ? (
          <p className="text-amber-400">
            The collector habit was removed from its Irgat. Start it again to
            keep collecting.
          </p>
        ) : null}
        {note ? <p className="text-content/55">{note}</p> : null}
        {error ? <p className="text-red-400">{error}</p> : null}
        {Object.keys(overview.lastCollected).length ? (
          <p className="text-content/40">
            {Object.entries(overview.lastCollected)
              .map(
                ([source, at]) =>
                  `${sourceName(source)}: last post ${time(at)}`,
              )
              .join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FilterPanel({
  overview,
  onChanged,
}: {
  overview: FeedOverview;
  onChanged: () => void;
}) {
  const current = strictnessLabel(overview.threshold);
  return (
    <div className="pb-3">
      <PanelTitle>Relevance filter</PanelTitle>
      <div className="flex flex-col gap-2 px-3 text-[12px]">
        {overview.scoring ? (
          <>
            <div
              className="flex rounded-md border border-stroke p-0.5"
              role="radiogroup"
            >
              {FEED_STRICTNESS.map((step) => (
                <button
                  key={step.label}
                  type="button"
                  role="radio"
                  aria-checked={current === step.label}
                  onClick={() =>
                    void setFeedThreshold(step.threshold).then(onChanged)
                  }
                  className={`flex-1 rounded px-2 py-0.5 ${
                    current === step.label
                      ? "bg-selection text-content"
                      : "text-content/55 hover:text-content"
                  }`}
                >
                  {step.label}
                </button>
              ))}
            </div>
            <p className="leading-relaxed text-content/45">
              Every post is compared with your interests by meaning, using the
              Smart Search model. Posts below {scorePercent(overview.threshold)}
              % go to Filtered.
              {overview.counts.unscored
                ? ` ${overview.counts.unscored} posts are waiting to be scored.`
                : ""}
            </p>
          </>
        ) : (
          <p className="leading-relaxed text-amber-400/90">
            Smart Search is off, so every post the agent sends is shown. Turn it
            on under Settings › Providers › Semantic search to filter posts by
            meaning.
          </p>
        )}
      </div>
    </div>
  );
}

function Shell({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label="Feed"
      data-app-feed
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {header}
      {children}
    </div>
  );
}

function IconAction({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`flex size-6 items-center justify-center rounded-md hover:bg-content/5 disabled:opacity-50 ${
        active ? "text-content" : "text-content/60 hover:text-content"
      }`}
    >
      {children}
    </button>
  );
}
