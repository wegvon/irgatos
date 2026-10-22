import { useState, type ReactNode } from "react";
import type {
  WebFeed,
  WebFeedInterest,
  WebFeedItem,
  WebFeedTab,
  WebTrending,
} from "../../model/protocol";
import { read, usePoll, write } from "../client";
import { ago, plural } from "../format";
import { Sheet } from "./Sheet";
import {
  Empty,
  Spinner,
  plainButton,
  primaryButton,
  secondaryButton,
  useAction,
  useToast,
} from "./parts";
import {
  ChipStrip,
  FieldLabel,
  FilterChip,
  ScreenFrame,
  TitleButton,
  errorText,
  fieldClass,
  store,
  stored,
} from "./WorkspaceParts";
import {
  CheckCheck,
  ExternalLink,
  Feed as FeedIcon,
  ImageIcon,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "../../../../shared/ui/icons";

type Tab = WebFeedTab | "github";

const TABS: { id: Tab; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "filtered", label: "Filtered" },
  { id: "saved", label: "Saved" },
  { id: "github", label: "GitHub" },
];

const TAB_KEY = "irgatos.web.feed.tab";
const PERIODS = [
  { id: "daily", label: "Today", gained: "today" },
  { id: "weekly", label: "This week", gained: "this week" },
  { id: "monthly", label: "This month", gained: "this month" },
] as const;

function storedTab(): Tab {
  const tab = stored(TAB_KEY);
  return TABS.some((entry) => entry.id === tab) ? (tab as Tab) : "feed";
}

/**
 * The Feed: posts the collecting Irgat found for the user's interests, the
 * ones the filter held back, the saved ones, and GitHub's trending list.
 */
export function Feed({
  now,
  wide,
  header,
}: {
  now: number;
  wide: boolean;
  header?: ReactNode;
}) {
  const [tab, setTabState] = useState<Tab>(storedTab);
  const [interestId, setInterestId] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);
  const [pages, setPages] = useState(1);
  const [managing, setManaging] = useState(false);
  const { busy, run } = useAction();
  const setTab = (next: Tab) => {
    store(TAB_KEY, next);
    setTabState(next);
    setPages(1);
  };
  const posts = tab !== "github";
  const offset = (pages - 1) * 30;
  const key = posts
    ? `feed:${tab}:${interestId ?? ""}:${unread ? 1 : 0}:${offset}`
    : "feed:counts";
  const feed = usePoll(
    key,
    () =>
      read<WebFeed>("feed", {
        view: posts ? tab : "feed",
        ...(interestId && posts ? { interestId } : {}),
        ...(unread && posts ? { unread: "1" } : {}),
        offset: String(posts ? offset : 0),
      }),
    () => 20_000,
  );
  const data = feed.data;
  const counts = data?.counts;

  const mark = (
    item: WebFeedItem,
    change: { read?: boolean; saved?: boolean; hidden?: boolean },
    done?: string,
  ) => {
    feed.mutate((current) => ({
      ...current,
      items: change.hidden
        ? current.items.filter((entry) => entry.id !== item.id)
        : current.items.map((entry) =>
            entry.id === item.id ? { ...entry, ...change } : entry,
          ),
    }));
    void run(
      `mark:${item.id}`,
      () => write("feedMark", { ids: [item.id], ...change }),
      done,
    );
  };

  return (
    <ScreenFrame
      header={header}
      wide={wide}
      title="Feed"
      action={
        <>
          {data?.collector ? (
            <TitleButton
              label={`Collect now with ${data.collector}`}
              disabled={busy === "collect"}
              onClick={() =>
                void run(
                  "collect",
                  () => write("feedCollect", {}),
                  `${data.collector} is collecting`,
                )
              }
            >
              {busy === "collect" ? (
                <Spinner />
              ) : (
                <RefreshCw className="size-[18px]" />
              )}
            </TitleButton>
          ) : null}
          <TitleButton label="Interests" onClick={() => setManaging(true)}>
            <SlidersHorizontal className="size-[18px]" />
          </TitleButton>
        </>
      }
      controls={
        <>
          <div className="glass -mx-1 flex gap-1 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none]">
            {TABS.map((entry) => {
              const count =
                entry.id === "feed"
                  ? counts?.unread
                  : entry.id === "filtered"
                    ? counts?.filtered
                    : entry.id === "saved"
                      ? counts?.saved
                      : undefined;
              return (
                <button
                  key={entry.id}
                  onClick={() => setTab(entry.id)}
                  aria-pressed={tab === entry.id}
                  className={`web-press inline-flex h-9 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold ${
                    tab === entry.id
                      ? "bg-selection text-(--ink)"
                      : "text-(--ink-2)"
                  }`}
                >
                  {entry.label}
                  {count ? (
                    <span className="font-medium tabular-nums text-(--ink-3)">
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {posts && data && data.interests.length ? (
            <ChipStrip>
              <FilterChip
                on={interestId === null}
                onClick={() => {
                  setInterestId(null);
                  setPages(1);
                }}
              >
                All
              </FilterChip>
              {data.interests.map((interest) => (
                <FilterChip
                  key={interest.id}
                  on={interestId === interest.id}
                  onClick={() => {
                    setInterestId(
                      interestId === interest.id ? null : interest.id,
                    );
                    setPages(1);
                  }}
                >
                  {interest.title}
                </FilterChip>
              ))}
            </ChipStrip>
          ) : null}
        </>
      }
    >
      {!posts ? (
        <Trending now={now} />
      ) : !data ? (
        feed.error ? (
          <Empty title="Can't load the Feed">{feed.error.message}</Empty>
        ) : (
          <div className="flex justify-center py-16 text-(--ink-3)">
            <Spinner className="size-6" />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 px-1 text-[13px] text-(--ink-3)">
            <span>
              {plural(data.total, "post")}
              {data.lastCollected
                ? ` · collected ${ago(data.lastCollected, now)} ago`
                : ""}
            </span>
            <span className="flex items-center gap-1">
              <button
                aria-pressed={unread}
                onClick={() => {
                  setUnread(!unread);
                  setPages(1);
                }}
                className={`web-press h-8 rounded-full px-3 text-[13px] font-semibold ${unread ? "bg-(--ink) text-(--color-background-base)" : "bg-content/6 text-(--ink-2)"}`}
              >
                Unread
              </button>
              {tab !== "saved" && data.items.some((item) => !item.read) ? (
                <button
                  aria-label="Mark all read"
                  title="Mark all read"
                  onClick={() => {
                    feed.mutate((current) => ({
                      ...current,
                      items: current.items.map((item) => ({
                        ...item,
                        read: true,
                      })),
                    }));
                    void run(
                      "all",
                      () =>
                        write("feedMarkAll", {
                          view: tab,
                          ...(interestId ? { interestId } : {}),
                        }),
                      "All read",
                    );
                  }}
                  className="web-press flex size-8 items-center justify-center rounded-full bg-content/6 text-(--ink-2)"
                >
                  <CheckCheck className="size-4" />
                </button>
              ) : null}
            </span>
          </div>
          {data.items.length ? (
            data.items.map((item) => (
              <Post
                key={item.id}
                item={item}
                now={now}
                onMark={(change, done) => mark(item, change, done)}
              />
            ))
          ) : (
            <Empty icon={<FeedIcon className="size-12 text-(--ink-3)" />} title={emptyTitle(tab, data)}>
              {emptyText(tab, data)}
            </Empty>
          )}
          {data.items.length < data.total ? (
            <button
              className={`${secondaryButton} mx-auto mt-1`}
              onClick={() => setPages(pages + 1)}
            >
              Show more
            </button>
          ) : null}
        </div>
      )}
      {managing ? (
        <Sheet title="Interests" wide={wide} onClose={() => setManaging(false)}>
          <Interests
            interests={data?.interests ?? []}
            scoring={!!data?.scoring}
            onChanged={feed.reload}
          />
        </Sheet>
      ) : null}
    </ScreenFrame>
  );
}

function emptyTitle(tab: WebFeedTab | "github", data: WebFeed) {
  if (!data.interests.length) return "No interests yet";
  if (tab === "saved") return "Nothing saved";
  if (tab === "filtered") return "Nothing filtered";
  return "All caught up";
}

function emptyText(tab: WebFeedTab | "github", data: WebFeed) {
  if (!data.interests.length)
    return "Tell the Feed what to look for: tap the sliders above.";
  if (tab === "saved") return "Star a post to keep it here.";
  if (tab === "filtered")
    return "Posts that matched none of your interests closely enough land here.";
  return data.collector
    ? `${data.collector} adds new posts as it finds them.`
    : "Pick an Irgat to collect the Feed in Feed on your Mac.";
}

function Post({
  item,
  now,
  onMark,
}: {
  item: WebFeedItem;
  now: number;
  onMark: (
    change: { read?: boolean; saved?: boolean; hidden?: boolean },
    done?: string,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const long = item.text.length > 280;
  return (
    <article
      className={`glass flex flex-col gap-2 rounded-[22px] p-4 ${item.read ? "" : "shadow-[inset_3px_0_0_var(--accent)]"}`}
    >
      <div className="flex min-w-0 items-baseline gap-1.5 text-[14px]">
        <span className="truncate font-semibold text-(--ink)">
          {item.authorName || item.author}
        </span>
        {item.author ? (
          <span className="truncate text-(--ink-3)">@{item.author.replace(/^@/, "")}</span>
        ) : null}
        <span className="ml-auto shrink-0 text-[12.5px] text-(--ink-3)">
          {ago(item.at, now)}
        </span>
      </div>
      {item.summary ? (
        <div className="text-[15px] font-medium leading-snug text-(--ink)">
          {item.summary}
        </div>
      ) : null}
      <button
        onClick={() => {
          setOpen(!open);
          if (!item.read) onMark({ read: true });
        }}
        className={`whitespace-pre-wrap break-words text-left text-[14.5px] leading-snug text-(--ink-2) ${open || !long ? "" : "line-clamp-5"}`}
      >
        {item.text}
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-(--ink-3)">
        {item.interest ? (
          <span className="rounded-full bg-content/6 px-2 py-0.5 font-medium text-(--ink-2)">
            {item.interest}
            {item.score != null ? ` · ${item.score}%` : ""}
          </span>
        ) : null}
        {item.metrics ? <span>{item.metrics}</span> : null}
        {item.media ? (
          <span className="inline-flex items-center gap-1">
            <ImageIcon className="size-3.5" />
            {plural(item.media, "picture")}
          </span>
        ) : null}
        {item.similar ? <span>+{plural(item.similar, "similar post")}</span> : null}
      </div>
      <div className="-mx-1.5 -mb-1 flex items-center gap-1">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => {
              if (!item.read) onMark({ read: true });
            }}
            className={`${plainButton} h-9 px-2.5 text-[14px]`}
          >
            <ExternalLink className="size-4" />
            Open
          </a>
        ) : null}
        <button
          aria-pressed={item.saved}
          onClick={() =>
            onMark({ saved: !item.saved }, item.saved ? "Removed from Saved" : "Saved")
          }
          className={`${plainButton} h-9 px-2.5 text-[14px] ${item.saved ? "" : "text-(--ink-2)"}`}
        >
          <Star className={`size-4 ${item.saved ? "fill-current" : ""}`} />
          {item.saved ? "Saved" : "Save"}
        </button>
        <button
          onClick={() => onMark({ read: !item.read })}
          className={`${plainButton} h-9 px-2.5 text-[14px] text-(--ink-2)`}
        >
          {item.read ? "Unread" : "Read"}
        </button>
        <button
          aria-label="Hide"
          title="Hide this post"
          onClick={() => onMark({ hidden: true }, "Hidden")}
          className={`${plainButton} ml-auto h-9 px-2.5 text-(--ink-3)`}
        >
          <X className="size-4" />
        </button>
      </div>
    </article>
  );
}

function Trending({ now }: { now: number }) {
  const [since, setSince] = useState<(typeof PERIODS)[number]["id"]>("daily");
  const [refresh, setRefresh] = useState(0);
  const trending = usePoll(
    `trending:${since}:${refresh}`,
    () =>
      read<WebTrending>("feedTrending", {
        since,
        ...(refresh ? { refresh: "1" } : {}),
      }),
    () => 10 * 60_000,
  );
  const gained = PERIODS.find((period) => period.id === since)!.gained;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        {PERIODS.map((period) => (
          <FilterChip
            key={period.id}
            on={since === period.id}
            onClick={() => setSince(period.id)}
          >
            {period.label}
          </FilterChip>
        ))}
        <button
          aria-label="Refresh"
          onClick={() => setRefresh(refresh + 1)}
          className="web-press ml-auto flex size-8 items-center justify-center rounded-full bg-content/6 text-(--ink-2)"
        >
          {trending.ready ? <RefreshCw className="size-4" /> : <Spinner />}
        </button>
      </div>
      {!trending.data ? (
        trending.error ? (
          <Empty title="Can't load GitHub">{trending.error.message}</Empty>
        ) : (
          <div className="flex justify-center py-16 text-(--ink-3)">
            <Spinner className="size-6" />
          </div>
        )
      ) : (
        <>
          <div className="px-1 text-[13px] text-(--ink-3)">
            Trending on GitHub · {ago(trending.data.fetchedAt, now) || "now"}
          </div>
          {trending.data.repos.map((repo) => {
            const slash = repo.fullName.indexOf("/");
            return (
              <a
                key={repo.fullName}
                href={repo.url || undefined}
                target="_blank"
                rel="noreferrer noopener"
                className="glass web-press flex flex-col gap-1.5 rounded-[22px] p-4"
              >
                <span className="truncate text-[15.5px] text-(--ink)">
                  <span className="text-(--ink-2)">
                    {repo.fullName.slice(0, slash + 1)}
                  </span>
                  <span className="font-semibold">
                    {repo.fullName.slice(slash + 1)}
                  </span>
                </span>
                {repo.description ? (
                  <span className="line-clamp-3 text-[14px] leading-snug text-(--ink-2)">
                    {repo.description}
                  </span>
                ) : null}
                <span className="flex flex-wrap items-center gap-x-3 text-[12.5px] text-(--ink-3)">
                  {repo.language ? (
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: repo.languageColor || "currentColor" }}
                      />
                      {repo.language}
                    </span>
                  ) : null}
                  <span>★ {repo.stars.toLocaleString()}</span>
                  {repo.periodStars ? (
                    <span className="font-medium text-(--ink-2)">
                      +{repo.periodStars.toLocaleString()} {gained}
                    </span>
                  ) : null}
                </span>
              </a>
            );
          })}
        </>
      )}
    </div>
  );
}

/** Add, rename, pause or remove what the Feed looks for. */
function Interests({
  interests,
  scoring,
  onChanged,
}: {
  interests: WebFeedInterest[];
  scoring: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<WebFeedInterest | "new" | null>(
    interests.length ? null : "new",
  );
  const toast = useToast();
  const toggle = (interest: WebFeedInterest) =>
    write("feedInterest", { ...interest, enabled: !interest.enabled })
      .then(onChanged)
      .catch((error: unknown) => toast(errorText(error), "error"));

  if (editing)
    return (
      <InterestForm
        interest={editing === "new" ? null : editing}
        onDone={() => {
          setEditing(null);
          onChanged();
        }}
      />
    );
  return (
    <div className="flex flex-col gap-3 px-5 pb-8">
      {!scoring ? (
        <div className="rounded-[16px] bg-content/6 px-4 py-3 text-[13.5px] leading-snug text-(--ink-2)">
          Turn on Smart Search on your Mac to sort posts by meaning; until
          then every post reaches the Feed.
        </div>
      ) : null}
      {interests.map((interest) => (
        <div
          key={interest.id}
          className="glass flex items-center gap-3 rounded-[18px] py-3 pl-4 pr-2"
        >
          <button
            className="min-w-0 flex-1 text-left"
            onClick={() => setEditing(interest)}
          >
            <div className={`truncate text-[15.5px] font-semibold ${interest.enabled ? "text-(--ink)" : "text-(--ink-3)"}`}>
              {interest.title}
            </div>
            {interest.description ? (
              <div className="line-clamp-2 text-[13px] text-(--ink-2)">
                {interest.description}
              </div>
            ) : null}
          </button>
          <button
            role="switch"
            aria-checked={interest.enabled}
            aria-label={interest.enabled ? "Pause" : "Resume"}
            onClick={() => void toggle(interest)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${interest.enabled ? "bg-(--accent)" : "bg-content/15"}`}
          >
            <span
              className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-[left] ${interest.enabled ? "left-[22px]" : "left-0.5"}`}
            />
          </button>
        </div>
      ))}
      <button className={`${primaryButton} mt-2`} onClick={() => setEditing("new")}>
        Add an interest
      </button>
    </div>
  );
}

function InterestForm({
  interest,
  onDone,
}: {
  interest: WebFeedInterest | null;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(interest?.title ?? "");
  const [description, setDescription] = useState(interest?.description ?? "");
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useAction();
  const save = async () => {
    const saved = await run(
      "save",
      () =>
        write("feedInterest", {
          ...(interest ? { id: interest.id } : {}),
          title,
          description,
          enabled: interest?.enabled ?? true,
        }),
      interest ? "Saved" : "Added",
    );
    if (saved) onDone();
  };
  return (
    <form
      className="flex flex-col gap-4 px-5 pb-8"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <FieldLabel>Name</FieldLabel>
        <input
          className={fieldClass}
          value={title}
          placeholder="Local-first apps"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div>
        <FieldLabel>What to look for</FieldLabel>
        <textarea
          className={`${fieldClass} min-h-[120px] resize-none`}
          value={description}
          placeholder="New releases, how people sync data offline, CRDTs…"
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <button
        className={primaryButton}
        disabled={!title.trim() || busy !== null}
      >
        {busy === "save" ? <Spinner /> : null}
        {interest ? "Save" : "Add interest"}
      </button>
      <button type="button" className={secondaryButton} onClick={onDone}>
        Cancel
      </button>
      {interest ? (
        <button
          type="button"
          onClick={() =>
            confirm
              ? void run(
                  "delete",
                  () => write("feedInterestDelete", { id: interest.id }),
                  "Interest removed",
                ).then((done) => done && onDone())
              : setConfirm(true)
          }
          className={`${plainButton} mt-6 self-center text-(--bad)`}
        >
          <Trash2 className="size-4" />
          {confirm ? "Tap again to remove it" : "Remove interest"}
        </button>
      ) : null}
    </form>
  );
}
