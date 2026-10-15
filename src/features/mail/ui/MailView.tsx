import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  LoaderCircle,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Settings,
} from "../../../shared/ui/icons";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import type { RecentProject } from "../../projects/model/recents";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import {
  DEFAULT_MAIL_ASK,
  MAIL_FOLDERS,
  isFromMe,
  listMail,
  loadMailAccounts,
  loadMailSettings,
  loadMailThread,
  mailQuery,
  mailThreadSessions,
  modifyMailThread,
  saveMailDraft,
  saveMailSettings,
  sendMailDraft,
  senderName,
  type MailAccount,
  type MailFolderId,
  type MailRow,
  type MailSettings,
  type MailThread,
  type MailThreadSummary,
} from "../model/mail";

export type MailAskRequest = {
  account: string;
  threadId: string;
  subject: string;
  project: string;
  text: string;
};

export type MailChat = { title: string; busy: boolean };

type Props = {
  besideRail?: boolean;
  compactRail?: boolean;
  /** The project a new chat starts in unless another is picked. */
  cwd?: string;
  recents: RecentProject[];
  /** Title and state of a chat, or undefined when it no longer exists. */
  describeChat: (sessionId: string) => MailChat | undefined;
  onAsk: (request: MailAskRequest) => Promise<void>;
  onOpenSession: (sessionId: string) => void;
  onClose: () => void;
  onToggleSidebar?: () => void;
};

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const time = (ms: number) =>
  ms ? formatRelativeTime(new Date(ms).toISOString()) : "";

/** A thread is only unique within its account. */
type Selection = { account: string; id: string };

const rowKey = (account: string, id: string) => `${account}\n${id}`;

/** `work@x.com` → `work`, short enough for a list row. */
const shortAddress = (email: string) => email.split("@")[0] || email;

let rememberedFolder: MailFolderId = "inbox";
/** "" shows every account. */
let rememberedAccount = "";
let rememberedSelection: Selection | null = null;

export function MailView({
  besideRail = false,
  compactRail = false,
  cwd,
  recents,
  describeChat,
  onAsk,
  onOpenSession,
  onClose,
  onToggleSidebar,
}: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [editingSettings, setEditingSettings] = useState(false);
  const [folder, setFolder] = useState<MailFolderId>(rememberedFolder);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
  const [account, setAccount] = useState(rememberedAccount);
  const [threads, setThreads] = useState<MailRow[]>([]);
  const [nextPages, setNextPages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountErrors, setAccountErrors] = useState<
    { account: string; message: string }[]
  >([]);
  const [selected, setSelected] = useState<Selection | null>(
    rememberedSelection,
  );
  const listRequest = useRef(0);
  const listLock = useLockOverscroll<HTMLDivElement>();

  const connected = !!settings?.endpoint && settings.hasKey;

  useEffect(() => {
    loadMailSettings()
      .then(setSettings)
      .catch((err: unknown) => setError(message(err)));
  }, []);

  useEffect(() => {
    rememberedFolder = folder;
    rememberedAccount = account;
    rememberedSelection = selected;
  }, [folder, account, selected]);

  const loadAccounts = useCallback(async (fresh = false) => {
    try {
      const found = await loadMailAccounts(fresh);
      setAccounts(found);
      // An account removed in Executor falls back to all accounts.
      setAccount((current) =>
        found.some((a) => a.id === current) ? current : "",
      );
    } catch (err: unknown) {
      setAccounts([]);
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    if (connected) void loadAccounts();
    else setAccounts(null);
  }, [connected, loadAccounts]);

  const emailOf = useCallback(
    (id: string) =>
      accounts?.find((a) => a.id === id)?.email ??
      (accounts?.length === 1 ? accounts[0].email : ""),
    [accounts],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea")) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const load = useCallback(
    async (more = false) => {
      const request = ++listRequest.current;
      setLoading(true);
      try {
        const page = await listMail(
          mailQuery(folder, appliedSearch),
          account ? [account] : [],
          more ? nextPages : null,
        );
        if (request !== listRequest.current) return;
        setThreads((current) =>
          more ? [...current, ...page.threads] : page.threads,
        );
        setNextPages(page.nextPageTokens);
        setAccountErrors(page.errors);
        setError(null);
      } catch (err: unknown) {
        if (request === listRequest.current) setError(message(err));
      } finally {
        if (request === listRequest.current) setLoading(false);
      }
    },
    [folder, appliedSearch, account, nextPages],
  );
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (connected && accounts) void loadRef.current();
  }, [connected, accounts, folder, appliedSearch, account]);

  const onThreadChanged = useCallback(
    (target: Selection, change: Partial<MailThreadSummary> | "removed") => {
      const same = (t: MailRow) =>
        t.id === target.id && t.account === target.account;
      setThreads((current) =>
        change === "removed"
          ? current.filter((t) => !same(t))
          : current.map((t) => (same(t) ? { ...t, ...change } : t)),
      );
    },
    [],
  );

  const showAccount = account === "" && (accounts?.length ?? 0) > 1;
  const hasMore = Object.keys(nextPages).length > 0;

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
        <Mail
          className="size-3.5 shrink-0 text-content/45"
          strokeWidth={1.75}
        />
        <span className="min-w-0 truncate text-content">Mail</span>
      </div>
      {connected ? (
        <div className="flex items-center gap-1 px-2">
          <IconAction
            label="Refresh"
            onClick={() => void loadAccounts(true)}
            disabled={loading}
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              strokeWidth={1.75}
            />
          </IconAction>
          <IconAction
            label="Executor connection"
            active={editingSettings}
            onClick={() => setEditingSettings((open) => !open)}
          >
            <Settings className="size-3.5" strokeWidth={1.75} />
          </IconAction>
        </div>
      ) : null}
      {IS_MAC ? null : <WindowControls />}
    </div>
  );

  if (settings === null) {
    return (
      <Shell header={header}>
        <div className="flex flex-1 items-center justify-center text-[12px] text-content/50">
          {error ?? <LoaderCircle className="size-4 animate-spin" />}
        </div>
      </Shell>
    );
  }

  if (!connected || editingSettings) {
    return (
      <Shell header={header}>
        <ConnectionForm
          settings={settings}
          onSaved={(next) => {
            setSettings(next);
            setEditingSettings(false);
            setError(null);
            setSelected(null);
            if (next.endpoint && next.hasKey) void loadAccounts(true);
          }}
          onCancel={connected ? () => setEditingSettings(false) : undefined}
        />
      </Shell>
    );
  }

  return (
    <Shell header={header}>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex w-[340px] shrink-0 flex-col border-r border-stroke">
          <div className="flex shrink-0 gap-3 px-3 pt-2" role="tablist">
            {MAIL_FOLDERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={folder === f.id}
                onClick={() => setFolder(f.id)}
                className={`relative h-8 text-[12px] ${
                  folder === f.id
                    ? "text-content"
                    : "text-content/50 hover:text-content"
                }`}
              >
                {f.label}
                {folder === f.id ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-content" />
                ) : null}
              </button>
            ))}
          </div>
          {accounts && accounts.length > 1 ? (
            <div className="shrink-0 px-3 pt-2">
              <select
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                aria-label="Mail account"
                className="w-full rounded-md border border-stroke bg-transparent px-2 py-1 text-[12px] text-content outline-none focus:border-content/40"
              >
                <option value="">All accounts ({accounts.length})</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <form
            className="flex shrink-0 items-center gap-1.5 border-b border-stroke px-3 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedSearch(search);
            }}
          >
            <Search
              className="size-3.5 shrink-0 text-content/40"
              strokeWidth={1.75}
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search mail (Gmail search, Enter)"
              aria-label="Search mail"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-content/35"
            />
          </form>
          <div
            ref={listLock}
            className="min-h-0 flex-1 overflow-y-auto p-1.5"
            aria-busy={loading}
          >
            {error ? (
              <p className="px-2 py-3 text-[12px] text-red-400">{error}</p>
            ) : null}
            {accountErrors.map((e) => (
              <p
                key={e.account}
                className="px-2 py-1.5 text-[12px] text-red-400"
              >
                {emailOf(e.account) || "An account"}: {e.message}
              </p>
            ))}
            {!loading && !error && threads.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-content/45">
                No mail here.
              </p>
            ) : null}
            {threads.map((thread) => (
              <ThreadRow
                key={rowKey(thread.account, thread.id)}
                thread={thread}
                account={
                  showAccount ? shortAddress(emailOf(thread.account)) : ""
                }
                active={
                  thread.id === selected?.id &&
                  thread.account === selected.account
                }
                onSelect={() =>
                  setSelected({ account: thread.account, id: thread.id })
                }
              />
            ))}
            {hasMore ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => void load(true)}
                className="mt-1 w-full rounded-md py-1.5 text-[12px] text-content/60 hover:bg-content/5 hover:text-content disabled:opacity-50"
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </div>
        </div>
        {selected ? (
          <ThreadDetail
            key={rowKey(selected.account, selected.id)}
            account={selected.account}
            accountEmail={
              (accounts?.length ?? 0) > 1 ? emailOf(selected.account) : ""
            }
            threadId={selected.id}
            cwd={cwd}
            recents={recents}
            describeChat={describeChat}
            onAsk={onAsk}
            onOpenSession={onOpenSession}
            onChanged={(change) => onThreadChanged(selected, change)}
            onArchived={() => {
              onThreadChanged(selected, "removed");
              setSelected(null);
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[12px] text-content/40">
            Choose an email
          </div>
        )}
      </div>
    </Shell>
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
      aria-label="Mail"
      data-app-mail
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
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded-md hover:bg-content/5 disabled:opacity-50 ${
        active
          ? "bg-selection text-content"
          : "text-content/60 hover:text-content"
      }`}
    >
      {children}
    </button>
  );
}

function ConnectionForm({
  settings,
  onSaved,
  onCancel,
}: {
  settings: MailSettings;
  onSaved: (settings: MailSettings) => void;
  onCancel?: () => void;
}) {
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (removeKey = false) => {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await saveMailSettings(
          removeKey ? "" : endpoint,
          removeKey ? "" : key.trim() || undefined,
        ),
      );
    } catch (err: unknown) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="mx-auto mt-10 flex w-full max-w-md flex-col gap-3 px-4 text-[13px]"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <h2 className="text-[15px] font-semibold">
          Connect Gmail through Executor
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-content/55">
          Irgatos reads and answers Gmail through your Executor, so your Google
          sign-in stays there. Connect Gmail in Executor, create an API key
          there, and paste both here. Agents can only read a thread and save a
          reply draft; mail is sent only when you press Send.
        </p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-content/60">Executor URL</span>
        <input
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="https://executor.example.com"
          className="rounded-md border border-stroke bg-transparent px-2 py-1.5 outline-none focus:border-content/40"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-content/60">API key</span>
        <input
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={
            settings.hasKey
              ? "Saved; leave empty to keep it"
              : "Executor API key"
          }
          autoComplete="off"
          className="rounded-md border border-stroke bg-transparent px-2 py-1.5 outline-none focus:border-content/40"
        />
      </label>
      {error ? <p className="text-[12px] text-red-400">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={
            saving || !endpoint.trim() || (!settings.hasKey && !key.trim())
          }
          className="rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base disabled:opacity-40"
        >
          {saving ? "Checking…" : "Save and connect"}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/60 hover:bg-content/5 hover:text-content"
          >
            Cancel
          </button>
        ) : null}
        {settings.hasKey ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (
                window.confirm("Disconnect Mail and forget the Executor key?")
              ) {
                void save(true);
              }
            }}
            className="ml-auto rounded-md px-3 py-1.5 text-[12px] text-red-400 hover:bg-content/5"
          >
            Disconnect
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ThreadRow({
  thread,
  account,
  active,
  onSelect,
}: {
  thread: MailThreadSummary;
  /** Which mailbox, shown when several are listed together. */
  account: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={`flex w-full flex-col rounded-md px-2.5 py-2 text-left ${
        active
          ? "bg-selection text-content"
          : "text-content/80 hover:bg-content/5 hover:text-content"
      }`}
    >
      <span className="flex items-center gap-2">
        {thread.unread ? (
          <span
            aria-label="Unread"
            className="size-1.5 shrink-0 rounded-full bg-accent"
          />
        ) : null}
        <span
          className={`min-w-0 flex-1 truncate text-[12px] ${
            thread.unread ? "font-semibold text-content" : "text-content/70"
          }`}
        >
          {senderName(thread.from) || "(unknown sender)"}
          {thread.messageCount > 1 ? (
            <span className="ml-1 text-content/40">{thread.messageCount}</span>
          ) : null}
        </span>
        {account ? (
          <span className="max-w-[90px] shrink-0 truncate rounded bg-content/5 px-1 text-[10px] text-content/55">
            {account}
          </span>
        ) : null}
        <span className="shrink-0 text-[11px] tabular-nums text-content/45">
          {time(thread.date)}
        </span>
      </span>
      <span
        className={`mt-0.5 line-clamp-1 text-[13px] leading-snug ${
          thread.unread ? "font-semibold" : ""
        }`}
      >
        {thread.subject}
      </span>
      <span className="mt-0.5 line-clamp-1 text-[12px] leading-snug text-content/45">
        {thread.snippet}
      </span>
    </button>
  );
}

function ThreadDetail({
  account,
  accountEmail,
  threadId,
  cwd,
  recents,
  describeChat,
  onAsk,
  onOpenSession,
  onChanged,
  onArchived,
}: {
  account: string;
  /** Shown above the thread when there are several accounts. */
  accountEmail: string;
  threadId: string;
  cwd?: string;
  recents: RecentProject[];
  describeChat: (sessionId: string) => MailChat | undefined;
  onAsk: (request: MailAskRequest) => Promise<void>;
  onOpenSession: (sessionId: string) => void;
  onChanged: (change: Partial<MailThreadSummary>) => void;
  onArchived: () => void;
}) {
  const [thread, setThread] = useState<MailThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<string[]>([]);
  const [reply, setReply] = useState("");
  const [replyDirty, setReplyDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "send" | "archive" | "ask" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [askText, setAskText] = useState(DEFAULT_MAIL_ASK);
  const [project, setProject] = useState(cwd ?? recents[0]?.path ?? "");
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const replyDirtyRef = useRef(replyDirty);
  replyDirtyRef.current = replyDirty;

  const draft = thread?.drafts[thread.drafts.length - 1];

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [next, sessions] = await Promise.all([
        loadMailThread(account, threadId),
        mailThreadSessions(account, threadId),
      ]);
      setThread(next);
      setChats(sessions);
      setError(null);
      if (!replyDirtyRef.current)
        setReply(next.drafts[next.drafts.length - 1]?.body ?? "");
      if (next.unread) {
        modifyMailThread(account, threadId, "read")
          .then(() => onChangedRef.current({ unread: false }))
          .catch(() => undefined);
      }
    } catch (err: unknown) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, [account, threadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A draft an agent saved while the user was in the chat shows on return.
  useEffect(() => {
    const onFocus = () => {
      if (!replyDirty) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, replyDirty]);

  const run = async (
    kind: NonNullable<typeof busy>,
    work: () => Promise<void>,
  ) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err: unknown) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const saveReply = () =>
    run("save", async () => {
      const saved = await saveMailDraft(account, threadId, reply);
      setThread((current) =>
        current
          ? {
              ...current,
              drafts: [
                ...current.drafts.filter((d) => d.id !== saved.id),
                saved,
              ],
            }
          : current,
      );
      setReplyDirty(false);
      setNotice("Draft saved to Gmail.");
    });

  const sendReply = () =>
    run("send", async () => {
      // Whatever is on screen is what goes out.
      const saved =
        replyDirty || !draft
          ? await saveMailDraft(account, threadId, reply)
          : draft;
      if (!window.confirm(`Send this reply to ${saved.to}?`)) {
        setReplyDirty(false);
        setThread((current) =>
          current
            ? {
                ...current,
                drafts: [
                  ...current.drafts.filter((d) => d.id !== saved.id),
                  saved,
                ],
              }
            : current,
        );
        return;
      }
      await sendMailDraft(account, saved.id);
      setReply("");
      setReplyDirty(false);
      await refresh();
      setNotice(`Sent to ${saved.to}.`);
    });

  const archive = () =>
    run("archive", async () => {
      await modifyMailThread(account, threadId, "archive");
      onArchived();
    });

  const ask = () =>
    run("ask", async () => {
      if (!thread) return;
      if (!project) throw new Error("Choose a project for the chat.");
      await onAsk({
        account,
        threadId,
        subject: thread.subject,
        project,
        text: askText.trim() || DEFAULT_MAIL_ASK,
      });
    });

  if (!thread) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-content/50">
        {error ? (
          <span className="text-red-400">{error}</span>
        ) : (
          <LoaderCircle className="size-4 animate-spin" />
        )}
      </div>
    );
  }

  const liveChats = chats
    .map((id) => ({ id, chat: describeChat(id) }))
    .filter((entry): entry is { id: string; chat: MailChat } => !!entry.chat);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-stroke px-4 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-semibold">
            {thread.subject}
          </h2>
          {accountEmail ? (
            <p className="truncate text-[11px] text-content/45">
              {accountEmail}
            </p>
          ) : null}
        </div>
        <IconAction
          label="Reload thread"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw
            className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
        </IconAction>
        {thread.inInbox ? (
          <IconAction
            label="Archive"
            onClick={() => void archive()}
            disabled={busy !== null}
          >
            <Archive className="size-3.5" strokeWidth={1.75} />
          </IconAction>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {thread.messages.map((m) => (
          <article
            key={m.id}
            className={`mb-3 rounded-md border border-stroke px-3 py-2 ${
              isFromMe(m.from, thread.me) ? "bg-content/[0.03]" : ""
            }`}
          >
            <header className="flex items-baseline gap-2 text-[12px]">
              <span
                className="min-w-0 flex-1 truncate font-medium"
                title={m.from}
              >
                {isFromMe(m.from, thread.me) ? "You" : senderName(m.from)}
              </span>
              <span className="shrink-0 tabular-nums text-content/45">
                {time(m.date)}
              </span>
            </header>
            <p className="truncate text-[11px] text-content/45" title={m.to}>
              to {m.to}
              {m.cc ? `, cc ${m.cc}` : ""}
            </p>
            <div className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed">
              {m.body || <span className="text-content/40">(no text)</span>}
            </div>
            {m.attachments.length ? (
              <p className="mt-2 text-[11px] text-content/50">
                Attachments: {m.attachments.join(", ")}
              </p>
            ) : null}
          </article>
        ))}

        <section className="mb-3 rounded-md border border-stroke px-3 py-2">
          <div className="flex items-center gap-2 text-[12px] font-medium">
            <MessageSquare
              className="size-3.5 text-content/50"
              strokeWidth={1.75}
            />
            Ask an agent
          </div>
          {liveChats.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {liveChats.map(({ id, chat }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onOpenSession(id)}
                  className="flex max-w-full items-center gap-1.5 rounded-md bg-content/5 px-2 py-1 text-[12px] hover:bg-content/10"
                >
                  {chat.busy ? (
                    <LoaderCircle className="size-3 animate-spin text-content/50" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-content/30" />
                  )}
                  <span className="truncate">{chat.title}</span>
                  <span className="text-content/45">
                    {chat.busy ? "working" : "open"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            value={askText}
            onChange={(event) => setAskText(event.target.value)}
            rows={2}
            aria-label="What the agent should do"
            className="mt-2 w-full resize-y rounded-md border border-stroke bg-transparent px-2 py-1.5 text-[13px] outline-none focus:border-content/40"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <SearchableProjectPicker
              cwd={project || "~"}
              recents={recents}
              mode="move"
              buttonClassName="px-1.5"
              onSelectProject={setProject}
            />
            <button
              type="button"
              disabled={busy !== null || !project}
              onClick={() => void ask()}
              className="ml-auto rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base disabled:opacity-40"
            >
              {busy === "ask" ? "Starting…" : "Start chat"}
            </button>
          </div>
        </section>

        <section className="rounded-md border border-stroke px-3 py-2">
          <div className="flex items-center gap-2 text-[12px]">
            <Send className="size-3.5 text-content/50" strokeWidth={1.75} />
            <span className="font-medium">Reply</span>
            <span className="min-w-0 flex-1 truncate text-content/45">
              {draft ? `draft to ${draft.to}` : "goes to the latest sender"}
            </span>
          </div>
          <textarea
            value={reply}
            onChange={(event) => {
              setReply(event.target.value);
              setReplyDirty(true);
            }}
            rows={6}
            placeholder="Write a reply, or ask an agent to draft one."
            aria-label="Reply"
            className="mt-2 w-full resize-y rounded-md border border-stroke bg-transparent px-2 py-1.5 text-[13px] leading-relaxed outline-none focus:border-content/40"
          />
          {error ? (
            <p className="mt-1 text-[12px] text-red-400">{error}</p>
          ) : null}
          {notice ? (
            <p className="mt-1 text-[12px] text-content/60">{notice}</p>
          ) : null}
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={busy !== null || !reply.trim() || !replyDirty}
              onClick={() => void saveReply()}
              className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/5 hover:text-content disabled:opacity-40"
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              disabled={busy !== null || !reply.trim()}
              onClick={() => void sendReply()}
              className="flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base disabled:opacity-40"
            >
              <Send className="size-3.5" strokeWidth={1.75} />
              {busy === "send" ? "Sending…" : "Send"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
