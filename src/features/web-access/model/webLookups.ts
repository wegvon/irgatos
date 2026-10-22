import { projectName } from "../../../shared/lib/paths";
import { isFreeChatCwd } from "../../freechat/model/freeChat";
import { inboxTrackerDescription } from "../../inbox/model/inboxContext";
import {
  loadInboxDrafts,
  type InboxDrafts,
} from "../../inbox/model/inboxDrafts";
import {
  loadInboxFilters,
  applyInboxFilters,
  inboxFetchState,
  pruneInboxFilters,
} from "../../inbox/model/inboxFilters";
import {
  isInboxEntryUnseen,
  markInboxItemSeen,
  rememberInboxItems,
  seedInboxSeenIfNeeded,
  type InboxSeenEntry,
} from "../../inbox/model/inboxSeen";
import {
  loadInboxSnoozes,
  type InboxSnoozeState,
} from "../../inbox/model/inboxSnooze";
import { inboxTriageFlags } from "../../inbox/model/inboxTriage";
import {
  composeInboxMessage,
  githubWorkItemDetails,
  inboxComposerCard,
  inboxItemKey,
  inboxItemRef,
  inboxItemStatus,
  inboxProjectsForRail,
  listInboxItems,
  peekInboxList,
  sortInboxItems,
  type InboxItem,
  type InboxListResult,
} from "../../inbox/model/githubTasks";
import { loadHiddenJiraProjectIds } from "../../inbox/model/jira";
import { loadHiddenLinearTeamIds } from "../../inbox/model/linear";
import { INBOX_SOURCE_LABELS } from "../../inbox/model/inboxFilters";
import { loadRecents } from "../../projects/model/recents";
import {
  accountStatus,
  type AccountStatus,
} from "../../providers/model/accountUsage";
import {
  providerAccounts,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  DAILY_WINDOW_MINUTES,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "../../providers/model/rateLimits";
import {
  getCachedRateLimits,
  loadRateLimits,
} from "../../providers/model/rateLimitsCache";
import {
  conversationRowsFrom,
  groupHits,
  hitsFromSessionSearch,
  mergeHits,
  searchConversationTitles,
  searchSessionMessages,
  type AppSearchHit,
} from "../../search/model/appSearch";
import {
  hitsFromChatMeaning,
  meaningNotice,
  searchChatsByMeaning,
  type ChatMeaningResult,
} from "../../search/model/meaningSearch";
import {
  listRecentSessions,
  searchSessions,
  type SessionSearchResult,
  type SessionSummary,
} from "../../sessions/data/sessionStore";
import { relatedSessionsForInboxItem } from "../../sessions/model/sessionWorkItem";
import {
  HARNESS_TITLE,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";
import { loadShowRemainingUsage } from "../../settings/model/displayPrefs";
import type {
  WebInbox,
  WebInboxDetail,
  WebInboxItem,
  WebSearch,
  WebSearchHit,
  WebUsage,
  WebUsageAccount,
  WebUsageWindow,
} from "./protocol";

/**
 * The desktop's search, Inbox and usage meters for the browser page. Each
 * reads the same stores the Mac's own views read, so both agree.
 */
export type WebLookupDeps = {
  /** Closed chats too, newest first. */
  history: () => Promise<SessionSummary[]>;
  /** Words anywhere in stored chats. */
  searchWords: (query: string) => Promise<SessionSearchResult>;
  searchMeaning: (query: string) => Promise<ChatMeaningResult>;
  inbox: (force: boolean) => Promise<InboxListResult>;
  /** A GitHub item's description, or a tracker issue's. */
  inboxBody: (item: InboxItem) => Promise<{ body: string; author?: string }>;
  isUnseen: (entry: InboxSeenEntry) => boolean;
  markSeen: (entry: InboxSeenEntry) => void;
  snoozes: () => InboxSnoozeState;
  drafts: () => InboxDrafts;
  /** Every provider account's usage windows, from the Mac's shared cache. */
  usage: (
    providers: readonly HarnessId[],
    fresh: boolean,
  ) => Promise<{ limits: ProviderRateLimits; account?: string }[]>;
  showRemaining: () => boolean;
};

/** What a phone can see without the Mac's open window. */
const SEARCH_LIMIT = 40;
const INBOX_LIMIT = 150;
const USAGE_PROVIDERS: readonly RateLimitProvider[] = [
  "claude",
  "codex",
  "cursor",
  "devin",
  "opencode",
];

/** The Mac answers each call within 20s; slower fetches finish in the background. */
const ANSWER_WITHIN_MS = 12_000;

function within<T>(promise: Promise<T>, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(fallback());
      } catch (error) {
        reject(error);
      }
    }, ANSWER_WITHIN_MS);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

function inboxProjects() {
  return inboxProjectsForRail(loadRecents(), "");
}

export const webLookupDefaults: WebLookupDeps = {
  history: () => listRecentSessions(500),
  searchWords: (query) =>
    searchSessions({ query, searchOwner: `web-${crypto.randomUUID()}` }),
  searchMeaning: (query) => searchChatsByMeaning(query, undefined, 12),
  inbox: (force) => {
    const projects = inboxProjects();
    const filters = pruneInboxFilters(
      loadInboxFilters(),
      projects.map((project) => project.path),
    );
    const query = {
      assignedToMe: filters.assignedToMe,
      state: inboxFetchState(filters),
      search: "",
      linearHiddenTeamIds: loadHiddenLinearTeamIds(),
      jiraHiddenProjectIds: loadHiddenJiraProjectIds(),
    };
    return within(listInboxItems(projects, query, { force }), () => {
      const cached = peekInboxList(projects, query);
      if (!cached)
        throw new Error(
          "Your Inbox is still loading on the Mac. Try again in a moment.",
        );
      return cached;
    }).then((result) => ({
      ...result,
      items: applyInboxFilters(result.items, filters, "", Date.now()),
    }));
  },
  inboxBody: async (item) => {
    if (
      item.provider === "github" &&
      (item.kind === "issue" || item.kind === "pr")
    ) {
      const details = await githubWorkItemDetails(
        item.projectPath,
        item.repo,
        item.kind,
        item.number,
        { maxAgeMs: 30_000 },
      );
      return { body: details.body, author: details.author };
    }
    return { body: (await inboxTrackerDescription(item)) ?? "" };
  },
  isUnseen: isInboxEntryUnseen,
  markSeen: markInboxItemSeen,
  snoozes: loadInboxSnoozes,
  drafts: loadInboxDrafts,
  usage: async (providers, fresh) => {
    const wanted = USAGE_PROVIDERS.filter((provider) =>
      providers.includes(provider),
    );
    const jobs = wanted.flatMap((provider) => {
      const accounts = supportsProviderAccounts(provider)
        ? providerAccounts(provider)
        : [];
      const load = (id: string) =>
        within(loadRateLimits(provider, id, fresh), () =>
          getCachedRateLimits(provider, id),
        );
      if (accounts.length < 2)
        return [load("default").then((limits) => ({ limits }))];
      return accounts.map((account) =>
        load(account.id).then((limits) => ({
          limits,
          account: account.label,
        })),
      );
    });
    return Promise.all(jobs);
  },
  showRemaining: loadShowRemainingUsage,
};

function place(cwd: string): string {
  return isFreeChatCwd(cwd) ? "Chat" : projectName(cwd);
}

function searchHit(hit: AppSearchHit): WebSearchHit | null {
  if (
    hit.kind !== "conversation" &&
    hit.kind !== "message" &&
    hit.kind !== "chatMeaning"
  )
    return null;
  return {
    sessionId: hit.sessionId,
    kind:
      hit.kind === "conversation"
        ? "chat"
        : hit.kind === "message"
          ? "message"
          : "meaning",
    title: hit.title,
    place: place(hit.cwd),
    harness: hit.harness,
    updatedAt: hit.updatedAt,
    ...(hit.kind !== "conversation" && hit.preview
      ? { preview: hit.preview }
      : {}),
  };
}

/**
 * Chats by title, by their words and by meaning, as ⌘K finds them on the
 * Mac. One row per chat: its best hit, titles first.
 */
export async function webSearch(
  deps: WebLookupDeps,
  sessions: readonly Session[],
  query: string,
): Promise<WebSearch> {
  const trimmed = query.trim();
  if (!trimmed) return { query, hits: [], note: null };
  const [history, words, meaning] = await Promise.all([
    within(deps.history(), () => []).catch(() => []),
    within<SessionSearchResult | null>(
      deps.searchWords(trimmed),
      () => null,
    ).catch(() => null),
    // The embedding service is on another machine and may be slow or away.
    within<ChatMeaningResult | null>(
      deps.searchMeaning(trimmed),
      () => null,
    ).catch(() => null),
  ]);
  const live = sessions.map((session) => ({
    id: session.id,
    cwd: session.cwd,
    harness: session.harness,
    title: session.title,
    updatedAt: Date.now(),
    blocks: session.blocks,
  }));
  const grouped = groupHits(
    mergeHits(
      searchConversationTitles(
        conversationRowsFrom(history, [...sessions]),
        trimmed,
      ),
      searchSessionMessages(live, trimmed),
      hitsFromSessionSearch(words?.hits ?? []),
      hitsFromChatMeaning(meaning?.hits ?? []),
    ),
    "conversations",
  );
  const seen = new Set<string>();
  const hits: WebSearchHit[] = [];
  for (const hit of [
    ...grouped.conversations,
    ...grouped.messages,
    ...grouped.chatMeaning,
  ]) {
    const row = searchHit(hit);
    if (!row || seen.has(row.sessionId)) continue;
    seen.add(row.sessionId);
    hits.push(row);
    if (hits.length >= SEARCH_LIMIT) break;
  }
  return { query, hits, note: meaningNotice(meaning, null) };
}

function seenEntry(item: InboxItem): InboxSeenEntry {
  return { key: inboxItemKey(item), updatedAt: item.updatedAt };
}

function source(item: InboxItem): string {
  if (item.provider === "linear" || item.provider === "jira")
    return item.teamName || item.projectName || item.repo;
  return item.repo;
}

function webInboxItem(
  deps: WebLookupDeps,
  item: InboxItem,
  sessions: readonly Session[],
  context: { now: number; snoozes: InboxSnoozeState; drafts: InboxDrafts },
): WebInboxItem {
  const agentChats = relatedSessionsForInboxItem(item, sessions).length;
  const flags = inboxTriageFlags(item, {
    ...context,
    isUnseen: (entry) => deps.isUnseen(seenEntry(entry)),
    relatedSessionCount: () => agentChats,
  });
  const updatedAt = Date.parse(item.updatedAt);
  return {
    key: flags.key,
    provider: item.provider,
    kind: item.kind,
    ref: inboxItemRef(item),
    title: item.title.trim() || inboxItemRef(item),
    source: source(item),
    place: item.projectPath ? projectName(item.projectPath) : "",
    url: item.url,
    status: inboxItemStatus(item),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    labels: item.labels
      .slice(0, 3)
      .map((label) => ({ name: label.name, color: label.color })),
    unseen: deps.isUnseen(seenEntry(item)),
    needsAction: flags.needsAction,
    ...(flags.snoozedUntil != null ? { snoozedUntil: flags.snoozedUntil } : {}),
    ...(item.attentionReason?.trim()
      ? { attention: item.attentionReason.trim() }
      : {}),
    agentChats,
  };
}

function providerError(provider: string, message: string): string {
  const label =
    INBOX_SOURCE_LABELS[provider as keyof typeof INBOX_SOURCE_LABELS] ??
    provider;
  return `${label}: ${message}`;
}

/** The Mac's Inbox: work items across GitHub and the connected trackers. */
export async function webInbox(
  deps: WebLookupDeps,
  sessions: readonly Session[],
  fresh: boolean,
): Promise<WebInbox> {
  const result = await deps.inbox(fresh);
  const items = sortInboxItems(result.items);
  // The same bookkeeping the Mac's Inbox does, so its badges agree.
  rememberInboxItems(
    items.map((item) => ({
      ...seenEntry(item),
      projectPath: item.projectPath,
    })),
  );
  seedInboxSeenIfNeeded(items.map(seenEntry));
  const context = {
    now: Date.now(),
    snoozes: deps.snoozes(),
    drafts: deps.drafts(),
  };
  return {
    items: items
      .slice(0, INBOX_LIMIT)
      .map((item) => webInboxItem(deps, item, sessions, context)),
    errors: Object.entries(result.errors).flatMap(([provider, message]) =>
      message ? [providerError(provider, message)] : [],
    ),
    at: context.now,
  };
}

async function findInboxItem(deps: WebLookupDeps, key: string) {
  const { items } = await deps.inbox(false);
  const item = items.find((entry) => inboxItemKey(entry) === key);
  if (!item) throw new Error("That item is no longer in your Inbox.");
  return item;
}

/** One item with its description; opening it marks it seen, as on the Mac. */
export async function webInboxDetail(
  deps: WebLookupDeps,
  sessions: readonly Session[],
  key: string,
): Promise<WebInboxDetail> {
  const item = await findInboxItem(deps, key);
  const { body, author } = await deps
    .inboxBody(item)
    .catch(() => ({ body: "", author: undefined }));
  deps.markSeen(seenEntry(item));
  return {
    item: webInboxItem(deps, item, sessions, {
      now: Date.now(),
      snoozes: deps.snoozes(),
      drafts: deps.drafts(),
    }),
    body,
    ...(author ? { author } : {}),
  };
}

/**
 * The text a chat started from an item begins with: the item, as the Mac's
 * Start button puts it above the composer, then the user's own words.
 */
export async function inboxChatPrompt(
  deps: WebLookupDeps,
  key: string,
  note: string,
): Promise<{ prompt: string; cwd: string }> {
  const item = await findInboxItem(deps, key);
  // Like the Mac, only a tracker ticket brings its description along.
  const tracker = item.provider === "linear" || item.provider === "jira";
  const { body } = tracker
    ? await deps.inboxBody(item).catch(() => ({ body: "" }))
    : { body: "" };
  return {
    prompt: composeInboxMessage(
      inboxComposerCard(item, body || undefined),
      note,
    ),
    cwd: item.projectPath,
  };
}

function windows(limits: ProviderRateLimits): WebUsageWindow[] {
  const out: WebUsageWindow[] = [];
  const add = (title: string, window: ProviderRateLimits["session"]) => {
    if (window)
      out.push({
        title,
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt,
      });
  };
  add(
    limits.session?.windowMinutes === DAILY_WINDOW_MINUTES ? "Daily" : "5h",
    limits.session,
  );
  add("Weekly", limits.weekly);
  add("Monthly", limits.monthly);
  return out;
}

function usageAccount(
  entry: { limits: ProviderRateLimits; account?: string },
  now: number,
): WebUsageAccount | null {
  const { limits } = entry;
  // A provider that is not installed has nothing to say on a phone.
  if (limits.status === "unavailable" && limits.reason === "not-installed")
    return null;
  const status: AccountStatus = accountStatus(limits, now);
  return {
    provider: limits.provider,
    title: HARNESS_TITLE[limits.provider] ?? limits.provider,
    ...(entry.account ? { account: entry.account } : {}),
    tone: status.tone,
    status: status.label,
    ...(status.detail ? { detail: status.detail } : {}),
    windows: windows(limits),
    ...(limits.extraUsageBalance != null
      ? { extra: limits.extraUsageBalance }
      : {}),
  };
}

/** The usage limits the Mac's footer and Settings show, per account. */
export async function webUsage(
  deps: WebLookupDeps,
  providers: readonly HarnessId[],
  fresh: boolean,
): Promise<WebUsage> {
  const entries = await deps.usage(providers, fresh);
  const now = Date.now();
  return {
    accounts: entries.flatMap((entry) => {
      const account = usageAccount(entry, now);
      return account ? [account] : [];
    }),
    showRemaining: deps.showRemaining(),
    at: now,
  };
}
