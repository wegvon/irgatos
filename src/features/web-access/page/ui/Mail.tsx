import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  WebMail,
  WebMailMessage,
  WebMailRow,
  WebMailThread,
} from "../../model/protocol";
import { SignedOut, read, usePoll, write } from "../client";
import { ago } from "../format";
import { mailThreadId, navigate, parseMailThreadId } from "../route";
import {
  Empty,
  RoundButton,
  Spinner,
  primaryButton,
  secondaryButton,
} from "./parts";
import {
  ChevronDown,
  ChevronLeft,
  Mail as MailIcon,
  Search,
  Shield,
  X,
} from "../../../../shared/ui/icons";

/** The Mac's Mail searches; it maps each to its Gmail query. */
const FOLDERS = [
  { id: "unread", label: "Unread" },
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "all", label: "All mail" },
] as const;

type Folder = (typeof FOLDERS)[number]["id"];

const FOLDER_KEY = "irgatos.web.mailFolder";

function storedFolder(): Folder {
  try {
    const value = localStorage.getItem(FOLDER_KEY);
    return FOLDERS.find((f) => f.id === value)?.id ?? "unread";
  } catch {
    return "unread";
  }
}

/** The address, or the connection's name when Executor could not read it. */
const accountName = (email: string, id: string) =>
  email || id.split(".").filter(Boolean).pop() || id;

function fullDate(at: number): string {
  return new Date(at).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The Mac's Mail, to read on the go: the same accounts and searches, newest
 * first. Replying and sending stay on the Mac.
 */
export function MailList({
  header,
  wide,
  now,
}: {
  header: ReactNode;
  wide: boolean;
  now: number;
}) {
  const [folder, setFolder] = useState<Folder>(storedFolder);
  const [account, setAccount] = useState("");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const key = `mail:${folder}:${account}:${search}`;
  const mail = usePoll(
    key,
    () => read<WebMail>("mail", { folder, account, search }),
    () => 60_000,
  );
  // Older pages, kept under the first page as it refreshes.
  const [older, setOlder] = useState<{
    key: string;
    rows: WebMailRow[];
    more: string;
  }>({ key, rows: [], more: "" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const pages = older.key === key ? older : { key, rows: [], more: "" };
  const more = pages.rows.length ? pages.more : (mail.data?.more ?? "");

  const pick = (next: Folder) => {
    setFolder(next);
    try {
      localStorage.setItem(FOLDER_KEY, next);
    } catch {
      // private mode
    }
  };

  const loadMore = async () => {
    if (!more || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await read<WebMail>("mail", {
        folder,
        account,
        search,
        more,
      });
      setOlder({
        key,
        rows: [...pages.rows, ...page.threads],
        more: page.more,
      });
    } catch (error) {
      setMoreError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingMore(false);
    }
  };

  const data = mail.data;
  const seen = new Set<string>();
  const rows = [...(data?.threads ?? []), ...pages.rows].filter((row) => {
    const id = mailThreadId(row.account, row.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const accounts = data?.accounts ?? [];
  const showAccount = !account && accounts.length > 1;
  const emailOf = (id: string) => {
    const found = accounts.find((a) => a.id === id);
    return found ? accountName(found.email, found.id) : "";
  };

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-4 ${wide ? "max-w-[820px] px-8 pb-12 pt-[calc(var(--safe-top)+22px)]" : "px-4 pb-8 pt-[calc(var(--safe-top)+10px)]"}`}
    >
      <header className="flex flex-col gap-4">
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
          Mail
        </h1>
      </header>

      {data && !data.configured ? (
        <div className="glass rounded-[28px]">
          <Empty
            icon={
              <span className="flex size-16 items-center justify-center rounded-2xl bg-content/6 text-(--ink-3)">
                <MailIcon className="size-8" />
              </span>
            }
            title="Mail is not set up"
          >
            Connect your Executor in Mail on your Mac, then read your mail from
            here.
          </Empty>
        </div>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(typed.trim());
              (document.activeElement as HTMLElement | null)?.blur();
            }}
            className="flex h-11 items-center gap-2.5 rounded-[14px] bg-content/6 px-3.5 text-(--ink-3) focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]"
          >
            <Search className="size-[18px] shrink-0" />
            <input
              className="web-field min-w-0 flex-1 bg-transparent text-(--ink) outline-none"
              placeholder="Search mail"
              type="search"
              value={typed}
              enterKeyHint="search"
              onChange={(event) => setTyped(event.target.value)}
            />
            {typed || search ? (
              <button
                type="button"
                aria-label="Clear search"
                className="flex size-6 items-center justify-center rounded-full bg-(--ink-3) text-(--color-background-base)"
                onClick={() => {
                  setTyped("");
                  setSearch("");
                }}
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            ) : null}
          </form>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
            {FOLDERS.map((f) => (
              <Chip key={f.id} on={folder === f.id} onClick={() => pick(f.id)}>
                {f.label}
              </Chip>
            ))}
            {accounts.length > 1 ? (
              <>
                <span className="mx-1 w-px shrink-0 self-stretch bg-(--hairline)" />
                <Chip on={!account} onClick={() => setAccount("")}>
                  All accounts
                </Chip>
                {accounts.map((a) => (
                  <Chip
                    key={a.id}
                    on={account === a.id}
                    onClick={() => setAccount(account === a.id ? "" : a.id)}
                  >
                    {accountName(a.email, a.id)}
                  </Chip>
                ))}
              </>
            ) : null}
          </div>

          {data?.errors.length ? (
            <div className="rounded-[16px] bg-amber-500/10 px-4 py-3 text-[14px] leading-snug text-(--ink-2)">
              {data.errors.map((e) => (
                <div key={e.account}>
                  <span className="font-semibold text-(--ink)">
                    {emailOf(e.account) || "An account"}:
                  </span>{" "}
                  {e.message}
                </div>
              ))}
            </div>
          ) : null}

          {!data ? (
            mail.error && !(mail.error instanceof SignedOut) ? (
              <div className="glass rounded-[28px]">
                <Empty title="Couldn't load mail">
                  {mail.error.message}
                  <div className="mt-5">
                    <button className={primaryButton} onClick={mail.reload}>
                      Try again
                    </button>
                  </div>
                </Empty>
              </div>
            ) : (
              <div className="flex justify-center py-20 text-(--ink-3)">
                <Spinner className="size-6" />
              </div>
            )
          ) : rows.length ? (
            <div className="glass overflow-hidden rounded-[24px]">
              {rows.map((row) => (
                <MailRowButton
                  key={mailThreadId(row.account, row.id)}
                  row={row}
                  now={now}
                  account={showAccount ? emailOf(row.account) : ""}
                />
              ))}
            </div>
          ) : (
            <div className="px-1 py-6 text-[15px] text-(--ink-3)">
              {search
                ? "No mail matches."
                : folder === "unread"
                  ? "No unread mail."
                  : "No mail here."}
            </div>
          )}

          {data && more ? (
            <div className="flex flex-col items-center gap-2">
              <button
                className={secondaryButton}
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? <Spinner /> : null}
                Load more
              </button>
              {moreError ? (
                <div className="text-[13.5px] text-(--tone-rose)">
                  {moreError}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function MailRowButton({
  row,
  now,
  account,
}: {
  row: WebMailRow;
  now: number;
  /** Which account it came to, when several are shown together. */
  account: string;
}) {
  return (
    <button
      onClick={() =>
        navigate({ name: "mailThread", id: mailThreadId(row.account, row.id) })
      }
      className="web-press flex w-full gap-3 border-b border-(--hairline) px-4 py-3 text-left last:border-b-0 active:bg-content/6"
    >
      <span
        aria-label={row.unread ? "Unread" : undefined}
        className={`mt-[7px] size-2 shrink-0 rounded-full ${row.unread ? "bg-(--accent)" : ""}`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[16px] ${row.unread ? "font-semibold text-(--ink)" : "font-medium text-(--ink-2)"}`}
          >
            {row.sender || row.from}
            {row.messageCount > 1 ? (
              <span className="ml-1.5 text-[13px] font-normal text-(--ink-3)">
                {row.messageCount}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[13px] tabular-nums text-(--ink-3)">
            {ago(row.date, now)}
          </span>
        </span>
        <span
          className={`truncate text-[15px] ${row.unread ? "font-medium text-(--ink)" : "text-(--ink-2)"}`}
        >
          {row.subject || "(no subject)"}
        </span>
        <span className="line-clamp-2 text-[14px] leading-snug text-(--ink-3)">
          {account ? (
            <span className="font-medium text-(--ink-2)">{account} · </span>
          ) : null}
          {row.snippet}
        </span>
      </span>
    </button>
  );
}

/** One thread, message by message, as the Mac's Mail shows it. */
export function MailThreadView({
  id,
  wide,
  onBack,
}: {
  id: string;
  wide: boolean;
  onBack: () => void;
}) {
  const { account, thread: threadId } = parseMailThreadId(id);
  const { data, error, reload } = usePoll(
    `mailThread:${id}`,
    () => read<WebMailThread>("mailThread", { account, id: threadId }),
    () => 60_000,
  );
  // Opening it reads it, as on the Mac; once, so a failure doesn't loop.
  const marked = useRef(false);
  useEffect(() => {
    if (!data?.unread || marked.current) return;
    marked.current = true;
    void write("mailMarkRead", { account, id: threadId }).catch(() => {});
  }, [data?.unread, account, threadId]);

  return (
    <div className="flex h-full flex-col">
      <header className="glass-bar relative z-10 shrink-0 pt-(--safe-top) shadow-[0_1px_0_var(--hairline)]">
        <div
          className={`flex h-[60px] items-center gap-2 ${wide ? "mx-auto max-w-[820px] px-6" : "px-3"}`}
        >
          <RoundButton label="Back" onClick={onBack}>
            <ChevronLeft className="size-5" strokeWidth={2.2} />
          </RoundButton>
          <div
            className={`min-w-0 flex-1 truncate text-[16px] font-semibold tracking-[-0.01em] text-(--ink) ${wide ? "" : "text-center"}`}
          >
            {data?.subject || (data ? "(no subject)" : "")}
          </div>
          {wide ? null : <div className="size-10 shrink-0" />}
        </div>
      </header>
      <div className="web-scroll min-h-0 flex-1">
        <div
          className={`mx-auto flex w-full flex-col gap-3 pb-[calc(var(--safe-bottom)+20px)] pt-4 ${wide ? "max-w-[820px] px-6" : "px-3"}`}
        >
          {!data ? (
            error && !(error instanceof SignedOut) ? (
              <Empty title="Couldn't open this mail">
                {error.message}
                <div className="mt-5">
                  <button className={primaryButton} onClick={reload}>
                    Try again
                  </button>
                </div>
              </Empty>
            ) : (
              <div className="flex justify-center py-20 text-(--ink-3)">
                <Spinner className="size-6" />
              </div>
            )
          ) : (
            <>
              {data.messages.map((message) => (
                <MessageCard key={message.id} message={message} />
              ))}
              {data.draft ? (
                <article className="rounded-[20px] border border-dashed border-(--hairline) px-4 py-3">
                  <div className="text-[13px] font-semibold text-(--ink-3)">
                    Reply draft
                  </div>
                  <div className="mt-1.5 select-text whitespace-pre-wrap break-words text-[15px] leading-relaxed text-(--ink-2)">
                    {data.draft}
                  </div>
                  <div className="mt-2 text-[13px] text-(--ink-3)">
                    Send it from Mail on your Mac.
                  </div>
                </article>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageCard({ message: m }: { message: WebMailMessage }) {
  const [quoted, setQuoted] = useState(false);
  return (
    <article
      className={`rounded-[20px] px-4 py-3 ${
        m.mine ? "ml-8 bg-(--accent)/12" : "mr-8 bg-content/[0.05]"
      }`}
    >
      <header className="flex items-baseline gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[15px] font-semibold ${m.mine ? "text-(--accent)" : "text-(--ink)"}`}
        >
          {m.mine ? "You" : m.sender}
        </span>
        <span className="shrink-0 text-[13px] tabular-nums text-(--ink-3)">
          {m.date ? fullDate(m.date) : ""}
        </span>
      </header>
      <div className="truncate text-[13px] text-(--ink-3)">
        to {m.to}
        {m.cc ? `, cc ${m.cc}` : ""}
      </div>
      {m.hidden ? (
        <div
          className={`mt-2 flex items-start gap-1.5 rounded-[12px] px-2.5 py-2 text-[13px] leading-snug ${m.hidden.warning ? "bg-amber-500/12 text-(--ink)" : "bg-content/6 text-(--ink-3)"}`}
        >
          <Shield
            className={`mt-px size-3.5 shrink-0 ${m.hidden.warning ? "text-amber-500" : ""}`}
          />
          {m.hidden.text}
        </div>
      ) : null}
      <div className="mt-2 select-text whitespace-pre-wrap break-words text-[15.5px] leading-relaxed text-(--ink)">
        {m.body || <span className="text-(--ink-3)">(no text)</span>}
      </div>
      {m.quoted ? (
        <div className="mt-2">
          <button
            onClick={() => setQuoted((open) => !open)}
            aria-expanded={quoted}
            className="web-press -ml-1 flex items-center gap-1 rounded-full px-1.5 py-1 text-[13px] font-medium text-(--ink-3)"
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${quoted ? "rotate-180" : ""}`}
            />
            {quoted ? "Hide quoted text" : "Show quoted text"}
          </button>
          {quoted ? (
            <div className="mt-1.5 select-text whitespace-pre-wrap break-words border-l-2 border-(--hairline) pl-3 text-[14px] leading-relaxed text-(--ink-3)">
              {m.quoted}
            </div>
          ) : null}
        </div>
      ) : null}
      {m.attachments.length ? (
        <div className="mt-2 text-[13px] text-(--ink-3)">
          Attachments: {m.attachments.join(", ")}
        </div>
      ) : null}
    </article>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`web-press flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium ${
        on
          ? "bg-(--ink) text-(--color-background-base)"
          : "bg-content/6 text-(--ink-2)"
      }`}
    >
      {children}
    </button>
  );
}
