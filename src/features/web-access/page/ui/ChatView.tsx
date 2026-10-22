import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  WebBlock,
  WebImage,
  WebImageData,
  WebSession,
} from "../../model/protocol";
import { SignedOut, read, usePoll, write } from "../client";
import { clock, duration } from "../format";
import { Markdown } from "./Markdown";
import { ChatOptions } from "./ChatOptions";
import {
  AccessSelect,
  EffortSelect,
  ModelSelect,
  PlanToggle,
  useModels,
} from "./ModelControls";
import { Mascot } from "./Irgats";
import { RequestBody } from "./Requests";
import {
  Empty,
  Harness,
  Pill,
  RoundButton,
  BrandMark,
  Spinner,
  primaryButton,
  useAction,
} from "./parts";
import {
  ArrowDownCircle,
  ArrowUp,
  Brain,
  ChevronDown,
  ChevronLeft,
  CircleX,
  File,
  Globe,
  ImageIcon,
  MessageSquare,
  Pencil,
  LoaderCircle,
  MoreHorizontal,
  Search,
  Shield,
  Square,
  Terminal,
  Wrench,
} from "../../../../shared/ui/icons";

/** A chat that only just started may take a moment to show up on the Mac. */
const STARTING_GRACE_MS = 20_000;
/** Matches the Mac's WEB_TRANSCRIPT_LIMIT: one more page per tap. */
const PAGE_BLOCKS = 80;

export function ChatView({
  id,
  wide,
  onBack,
}: {
  id: string;
  wide: boolean;
  onBack: () => void;
}) {
  const opened = useRef(Date.now());
  // How many blocks to read; grows with "Show earlier messages".
  const limit = useRef(PAGE_BLOCKS);
  const { data, error, reload } = usePoll(
    `session:${id}`,
    () =>
      read<WebSession>("session", {
        id,
        ...(limit.current > PAGE_BLOCKS
          ? { limit: String(limit.current) }
          : {}),
      }),
    (session) =>
      !session || session.busy || session.requests.length ? 1500 : 4000,
  );
  const [pending, setPending] = useState<string[]>([]);
  const [options, setOptions] = useState(false);

  useEffect(() => {
    opened.current = Date.now();
    limit.current = PAGE_BLOCKS;
    setPending([]);
    setOptions(false);
  }, [id]);

  // A sent message stays as a ghost bubble until the Mac's copy arrives.
  useEffect(() => {
    if (!data || !pending.length) return;
    const recent = data.blocks
      .slice(-8)
      .filter((block) => block.role === "user")
      .map((block) => block.text.trim());
    setPending((current) => current.filter((text) => !recent.includes(text)));
  }, [data, pending.length]);

  if (!data) {
    const missing =
      error &&
      !(error instanceof SignedOut) &&
      Date.now() - opened.current > STARTING_GRACE_MS;
    return (
      <div className="flex h-full flex-col">
        <ChatHeader wide={wide} onBack={onBack} />
        <div className="flex flex-1 items-center justify-center">
          {missing ? (
            <Empty
              icon={
                <span className="glass flex size-16 items-center justify-center rounded-full text-(--ink-3)">
                  <MessageSquare className="size-7" />
                </span>
              }
              title="This chat is closed"
            >
              It is no longer open in Irgatos on your Mac.
              <div className="mt-5">
                <button className={primaryButton} onClick={onBack}>
                  Go back
                </button>
              </div>
            </Empty>
          ) : (
            <div className="flex flex-col items-center gap-4 text-[15px] font-medium text-(--ink-2)">
              <BrandMark className="size-14 rounded-2xl" />
              {error ? "Starting the chat…" : <Spinner className="size-5" />}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        wide={wide}
        onBack={onBack}
        session={data}
        onOptions={() => setOptions(true)}
      />
      {options ? (
        <ChatOptions
          session={data}
          wide={wide}
          onClose={() => setOptions(false)}
          onDeleted={() => {
            setOptions(false);
            onBack();
          }}
        />
      ) : null}
      <Transcript
        session={data}
        pending={pending}
        wide={wide}
        onEarlier={() => {
          limit.current = data.blocks.length + PAGE_BLOCKS;
          reload();
        }}
      />
      <div className="pb-[max(var(--safe-bottom),12px)]">
        <div
          className={`mx-auto w-full ${wide ? "max-w-[820px] px-6" : "px-3"}`}
        >
          {data.requests.length ? (
            <div className="web-scroll -mx-3 flex max-h-[48vh] flex-col gap-2.5 px-3 pb-3 pt-2 [mask-image:linear-gradient(to_bottom,black_calc(100%-14px),transparent)]">
              {data.requests.map((request) => (
                <div
                  key={request.requestId}
                  className="attention web-pop-in rounded-[24px] bg-(--raised) p-4"
                >
                  <div className="mb-2.5 flex">
                    <Pill tone="amber">
                      {request.kind === "approval"
                        ? "Needs your OK"
                        : "Question"}
                    </Pill>
                  </div>
                  <RequestBody sessionId={data.id} request={request} />
                </div>
              ))}
            </div>
          ) : null}
          <Composer
            session={data}
            wide={wide}
            onSent={(text) => setPending((current) => [...current, text])}
          />
        </div>
      </div>
    </div>
  );
}

function ChatHeader({
  wide,
  onBack,
  session,
  onOptions,
}: {
  wide: boolean;
  onBack: () => void;
  session?: WebSession;
  /** Rename or delete; tapping the title opens the same. */
  onOptions?: () => void;
}) {
  return (
    <header className="glass-bar relative z-10 shrink-0 pt-(--safe-top) shadow-[0_1px_0_var(--hairline)]">
      <div
        className={`flex h-[60px] items-center gap-2 ${wide ? "mx-auto max-w-[820px] px-6" : "px-3"}`}
      >
        {wide ? null : (
          <RoundButton label="Back" onClick={onBack}>
            <ChevronLeft className="size-5" strokeWidth={2.2} />
          </RoundButton>
        )}
        <button
          type="button"
          disabled={!onOptions}
          onClick={onOptions}
          aria-label={session ? `${session.title}, chat options` : undefined}
          className={`min-w-0 flex-1 ${wide ? "text-left" : "text-center"}`}
        >
          <span
            className={`flex min-w-0 items-center gap-1.5 ${wide ? "" : "justify-center"}`}
          >
            {session?.mascot ? (
              <Mascot mascot={session.mascot} className="size-[18px]" />
            ) : null}
            <span className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-(--ink)">
              {session?.title ?? ""}
            </span>
          </span>
          {session ? (
            <span
              className={`mt-0.5 flex items-center gap-1 text-[12px] text-(--ink-2) ${wide ? "" : "justify-center"}`}
            >
              <Harness harness={session.harness} className="size-3" />
              <span className="truncate">
                {[session.model, session.projectLabel, session.branch]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          ) : null}
        </button>
        {onOptions ? (
          <RoundButton label="Chat options" onClick={onOptions}>
            <MoreHorizontal className="size-5" strokeWidth={2.2} />
          </RoundButton>
        ) : wide ? null : (
          <div className="size-10 shrink-0" />
        )}
      </div>
    </header>
  );
}

type Item =
  { kind: "block"; block: WebBlock } | { kind: "tools"; blocks: WebBlock[] };

function isStep(block: WebBlock) {
  return (
    (block.role === "tool" || block.role === "approval") &&
    !(block.approval && !block.approval.decided)
  );
}

/** Consecutive tool calls fold into one row, so the replies stay readable. */
function transcriptItems(blocks: WebBlock[]): Item[] {
  const items: Item[] = [];
  for (const block of blocks) {
    const last = items[items.length - 1];
    if (isStep(block)) {
      if (last?.kind === "tools") last.blocks.push(block);
      else items.push({ kind: "tools", blocks: [block] });
    } else items.push({ kind: "block", block });
  }
  return items;
}

function Transcript({
  session,
  pending,
  wide,
  onEarlier,
}: {
  session: WebSession;
  pending: string[];
  wide: boolean;
  onEarlier: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Earlier messages land above; keep the one being read where it was.
  const anchor = useRef<number | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [away, setAway] = useState(false);
  const items = useMemo(
    () => transcriptItems(session.blocks),
    [session.blocks],
  );
  const lastItem = items[items.length - 1];
  // A running step or an open request already says what is going on.
  const stepRunning =
    lastItem?.kind === "tools" &&
    ["pending", "in_progress"].includes(
      lastItem.blocks[lastItem.blocks.length - 1]?.tool?.status ?? "",
    );
  const showActivity = session.busy && !session.requests.length && !stepRunning;

  const toBottom = (smooth = false) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  };

  useLayoutEffect(() => {
    stick.current = true;
    anchor.current = null;
    setLoadingEarlier(false);
    toBottom();
  }, [session.id]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (anchor.current !== null && element) {
      element.scrollTop += element.scrollHeight - anchor.current;
      anchor.current = null;
      setLoadingEarlier(false);
    } else if (stick.current) toBottom();
  }, [session.blocks, pending, session.busy]);

  // The keyboard or the request dock changes the height; keep the end in view.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (stick.current) toBottom();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        className="chat-text web-scroll web-selectable h-full"
        onScroll={(event) => {
          const element = event.currentTarget;
          const near =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            80;
          stick.current = near;
          setAway(!near);
        }}
      >
        <div
          className={`mx-auto flex w-full flex-col gap-4 py-5 ${wide ? "max-w-[820px] px-6" : "px-4"}`}
        >
          {session.omitted ? (
            <button
              disabled={loadingEarlier}
              onClick={() => {
                anchor.current = scroller.current?.scrollHeight ?? null;
                stick.current = false;
                setLoadingEarlier(true);
                onEarlier();
              }}
              className="web-press inline-flex items-center gap-2 self-center rounded-full bg-content/6 px-3.5 py-1.5 text-[12.5px] font-medium text-(--ink-2) shadow-[inset_0_0_0_1px_var(--hairline)] disabled:opacity-60"
            >
              {loadingEarlier ? <Spinner className="size-3.5" /> : null}
              Show earlier messages ({session.omitted})
            </button>
          ) : null}
          {items.length === 0 && !pending.length ? (
            <div className="flex flex-col items-center gap-4 py-16 text-[15px] font-medium text-(--ink-2)">
              {session.mascot && !session.busy ? (
                <>
                  <span className="flex size-16 items-center justify-center rounded-2xl bg-content/6">
                    <Mascot mascot={session.mascot} className="size-10" />
                  </span>
                  Tell {session.irgat} what to do.
                </>
              ) : (
                <>
                  <BrandMark className="size-14 rounded-2xl" />
                  Starting…
                </>
              )}
            </div>
          ) : null}
          {items.map((item) =>
            item.kind === "tools" ? (
              <ToolGroup
                key={item.blocks[0]!.id}
                blocks={item.blocks}
                live={session.busy && item === lastItem}
              />
            ) : (
              <BlockView
                key={item.block.id}
                block={item.block}
                sessionId={session.id}
              />
            ),
          )}
          {pending.map((text, index) => (
            <UserBubble key={`pending-${index}`} text={text} sending />
          ))}
          {showActivity ? (
            <div className="flex items-center gap-2.5 px-1 text-[14px]">
              <LoaderCircle className="size-4 shrink-0 animate-spin text-(--ink-3)" />
              <span className="web-shimmer min-w-0 truncate font-medium">
                {session.activity ?? "Thinking…"}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      {away ? (
        <button
          aria-label="Jump to latest"
          onClick={() => {
            stick.current = true;
            toBottom(true);
          }}
          className="glass-float web-pop-in absolute bottom-3 left-1/2 flex size-10 -translate-x-1/2 items-center justify-center rounded-full text-(--ink-2)"
        >
          <ArrowDownCircle className="size-5" />
        </button>
      ) : null}
    </div>
  );
}

function UserBubble({
  text,
  files,
  images,
  sending = false,
}: {
  text: string;
  files?: string[];
  images?: ReactNode;
  sending?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-end gap-1.5 ${sending ? "opacity-60" : ""}`}
    >
      {images}
      <div className="user-message-bubble max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] bg-content/10 px-4 py-2.5 text-[16px] leading-snug text-(--ink)">
        {text}
      </div>
      {files?.length ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {files.map((name) => (
            <span
              key={name}
              className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-content/6 px-2.5 py-1 text-[12px] text-(--ink-2) shadow-[inset_0_0_0_1px_var(--hairline)]"
            >
              <File className="size-3 shrink-0" />
              <span className="truncate">{name}</span>
            </span>
          ))}
        </div>
      ) : null}
      {sending ? (
        <span className="text-[11px] text-(--ink-3)">Sending…</span>
      ) : null}
    </div>
  );
}

function BlockView({
  block,
  sessionId,
}: {
  block: WebBlock;
  sessionId: string;
}) {
  const images = block.images?.length ? (
    <Images sessionId={sessionId} block={block} />
  ) : null;
  switch (block.role) {
    case "user":
      return (
        <UserBubble text={block.text} files={block.files} images={images} />
      );
    case "reasoning":
      return block.text.trim() ? <Thought block={block} /> : null;
    case "assistant":
      return (
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <div className="min-w-0 max-w-full px-1">
            <Markdown text={block.text} streaming={block.streaming} />
          </div>
          {block.durationMs && block.at ? (
            <div className="px-1 text-[11.5px] font-medium text-(--ink-3)">
              {duration(block.durationMs)} · {clock(block.at)}
            </div>
          ) : null}
        </div>
      );
    case "plan":
    case "tasks":
      return (
        <div className="glass rounded-[22px] px-4 py-3">
          <div className="mb-1.5 flex">
            <Pill tone="accent">
              {block.role === "plan" ? "Plan" : "Tasks"}
            </Pill>
          </div>
          <Markdown text={block.text} />
        </div>
      );
    case "tool":
    case "approval":
      return (
        <div className="flex items-center gap-2.5 rounded-[18px] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-3.5 py-3 text-[14px]">
          <Shield className="size-4 shrink-0 text-(--warn)" />
          <span className="min-w-0 flex-1 truncate text-(--ink)">
            {block.tool?.label ?? "Permission"}
          </span>
          <span className="shrink-0 text-[12px] font-medium text-(--warn)">
            Waiting for you
          </span>
        </div>
      );
    case "image":
      return images ? (
        <div className="flex">{images}</div>
      ) : (
        <div className="self-end rounded-full bg-content/6 px-3.5 py-2 text-[13px] text-(--ink-2)">
          Image (open on your Mac)
        </div>
      );
    default:
      return block.text ? (
        <div className="line-clamp-3 self-center px-6 text-center text-[13px] text-(--ink-3)">
          {block.text}
        </div>
      ) : null;
  }
}

/** The agent's thinking, folded like the desktop's "Thought" row. */
function Thought({ block }: { block: WebBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-col items-start">
      <button
        className="web-press flex min-h-9 items-center gap-2 rounded-full px-1 text-[14px] text-(--ink-2)"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Brain className="size-4 shrink-0 text-(--ink-3)" />
        <span className={block.streaming ? "web-shimmer" : ""}>
          {block.streaming
            ? "Thinking…"
            : block.durationMs
              ? `Thought for ${duration(block.durationMs)}`
              : "Thought"}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-(--ink-3) transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="mt-1 min-w-0 max-w-full border-l-2 border-(--hairline) pl-3 text-[14.5px] text-(--ink-2)">
          <Markdown text={block.text} streaming={block.streaming} />
        </div>
      ) : null}
    </div>
  );
}

const imageCache = new Map<string, Promise<string>>();

function imageUrl(sessionId: string, blockId: string, image: WebImage) {
  const key = `${sessionId}/${blockId}/${image.index}`;
  let url = imageCache.get(key);
  if (!url) {
    url = read<WebImageData>("image", {
      id: sessionId,
      blockId,
      index: String(image.index),
    }).then((result) => `data:${result.mimeType};base64,${result.data}`);
    imageCache.set(key, url);
    url.catch(() => imageCache.delete(key));
  }
  return url;
}

function Images({ sessionId, block }: { sessionId: string; block: WebBlock }) {
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
      {block.images!.map((image) => (
        <ChatImage
          key={image.index}
          sessionId={sessionId}
          blockId={block.id}
          image={image}
        />
      ))}
    </div>
  );
}

/** Loads when shown; a tap opens it full screen. */
function ChatImage({
  sessionId,
  blockId,
  image,
}: {
  sessionId: string;
  blockId: string;
  image: WebImage;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState("");
  const [full, setFull] = useState(false);
  useEffect(() => {
    let alive = true;
    imageUrl(sessionId, blockId, image).then(
      (value) => alive && setUrl(value),
      (error: unknown) =>
        alive &&
        setFailed(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      alive = false;
    };
  }, [sessionId, blockId, image]);

  if (!url)
    return (
      <span
        title={failed || image.name}
        className="flex h-28 w-36 flex-col items-center justify-center gap-1.5 rounded-[16px] bg-content/6 px-2 text-center text-[12px] text-(--ink-3) shadow-[inset_0_0_0_1px_var(--hairline)]"
      >
        {failed ? <ImageIcon className="size-5" /> : <Spinner />}
        <span className="line-clamp-2 break-all">
          {failed ? image.name : ""}
        </span>
      </span>
    );
  return (
    <>
      <button
        onClick={() => setFull(true)}
        aria-label={`Open ${image.name}`}
        className="web-press overflow-hidden rounded-[16px] shadow-[inset_0_0_0_1px_var(--hairline)]"
      >
        <img
          src={url}
          alt={image.name}
          className="block max-h-60 max-w-full object-contain"
        />
      </button>
      {full ? (
        <button
          aria-label="Close image"
          onClick={() => setFull(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 pb-(--safe-bottom) pt-(--safe-top)"
        >
          <img
            src={url}
            alt={image.name}
            className="max-h-full max-w-full object-contain"
          />
        </button>
      ) : null}
    </>
  );
}

function ToolIcon({ block }: { block: WebBlock }) {
  const status = block.tool?.status;
  if (status === "failed") return <CircleX className="size-4 text-(--bad)" />;
  if (status === "pending" || status === "in_progress")
    return <Spinner className="size-4 text-(--accent)" />;
  if (block.approval) return <Shield className="size-4 text-(--ink-3)" />;
  const icon: Record<string, ReactNode> = {
    read: <File className="size-4" />,
    edit: <Pencil className="size-4" />,
    delete: <Pencil className="size-4" />,
    move: <Pencil className="size-4" />,
    execute: <Terminal className="size-4" />,
    search: <Search className="size-4" />,
    fetch: <Globe className="size-4" />,
  };
  return (
    <span className="text-(--ink-3)">
      {icon[block.tool?.kind ?? ""] ?? <Wrench className="size-4" />}
    </span>
  );
}

function stepLabel(block: WebBlock) {
  const label = block.tool?.label ?? "Step";
  if (block.approval?.decided === "deny") return `Denied: ${label}`;
  if (block.approval?.decided === "cancelled") return `Cancelled: ${label}`;
  return label;
}

function ToolGroup({ blocks, live }: { blocks: WebBlock[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const last = blocks[blocks.length - 1]!;
  const failed = blocks.filter(
    (block) => block.tool?.status === "failed",
  ).length;
  return (
    <div className="overflow-hidden rounded-[18px] bg-content/6 shadow-[inset_0_0_0_1px_var(--card-edge)]">
      <button
        className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <ToolIcon block={last} />
        <span
          className={`min-w-0 flex-1 truncate text-[14px] text-(--ink-2) ${live ? "web-shimmer" : ""}`}
        >
          {stepLabel(last)}
        </span>
        {failed ? (
          <span className="shrink-0 text-[12px] font-medium text-(--bad)">
            {failed} failed
          </span>
        ) : null}
        {blocks.length > 1 ? (
          <span className="shrink-0 rounded-full bg-content/6 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-(--ink-2)">
            {blocks.length} steps
          </span>
        ) : null}
        <ChevronDown
          className={`size-4 shrink-0 text-(--ink-3) transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="border-t border-(--hairline) py-1">
          {blocks.map((block) => (
            <ToolRow key={block.id} block={block} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolRow({ block }: { block: WebBlock }) {
  const [open, setOpen] = useState(false);
  const detail = block.tool?.detail;
  const output = block.tool?.output;
  return (
    <div>
      <button
        className="flex min-h-10 w-full items-center gap-2.5 px-3 py-1.5 text-left disabled:cursor-default"
        disabled={!detail && !output}
        onClick={() => setOpen((value) => !value)}
      >
        <ToolIcon block={block} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-(--ink-2)">
          {stepLabel(block)}
        </span>
      </button>
      {open && detail ? (
        <pre className="mx-3 mb-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-[12px] bg-content/6 px-3 py-2 font-mono text-[12px] leading-relaxed text-(--ink)">
          {detail}
        </pre>
      ) : null}
      {open && output ? (
        <pre
          aria-label="Output"
          className="mx-3 mb-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-[12px] bg-black/80 px-3 py-2 font-mono text-[12px] leading-relaxed text-white/90"
        >
          {output}
        </pre>
      ) : null}
    </div>
  );
}

function Composer({
  session,
  wide,
  onSent,
}: {
  session: WebSession;
  wide: boolean;
  onSent: (text: string) => void;
}) {
  const key = `irgatos.web.draft.${session.id}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const field = useRef<HTMLTextAreaElement>(null);
  const { busy, run } = useAction();
  const [plan, setPlan] = useState(false);
  const catalog = useModels();

  useEffect(() => {
    try {
      if (text) localStorage.setItem(key, text);
      else localStorage.removeItem(key);
    } catch {
      // private mode
    }
  }, [key, text]);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [text]);

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setText("");
    onSent(message);
    const sent = await run("send", () =>
      write("send", {
        sessionId: session.id,
        text: message,
        ...(plan ? { plan: true } : {}),
      }),
    );
    if (!sent) setText(message);
    else setPlan(false);
  };
  const change = (action: string, body: Record<string, unknown>) =>
    void run(action, () => write(action, { sessionId: session.id, ...body }));

  const stop = () =>
    run("stop", () => write("stop", { sessionId: session.id }), "Stopped");

  const empty = !text.trim();
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5 px-1">
        <ModelSelect
          catalog={catalog}
          harness={session.harness}
          model={session.modelId}
          name={session.model}
          disabled={busy !== null}
          onChange={(harness, model) => change("setModel", { harness, model })}
        />
        {session.effort ? (
          <EffortSelect
            effort={session.effort}
            disabled={busy !== null}
            onChange={(value) => change("setEffort", { value })}
          />
        ) : null}
        {session.runtimeMode ? (
          <AccessSelect
            mode={session.runtimeMode}
            disabled={busy !== null}
            onChange={(mode) => change("setMode", { mode })}
          />
        ) : null}
      </div>
      <div className="glass-float mt-2 flex items-end gap-2 rounded-[28px] p-1.5 pl-4 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
        <div className="flex min-h-11 min-w-0 flex-1 items-center py-2.5">
          <textarea
            ref={field}
            rows={1}
            value={text}
            enterKeyHint={wide ? "send" : "enter"}
            placeholder={
              session.irgat
                ? `Message ${session.irgat}…`
                : `Ask anything about ${session.projectLabel}…`
            }
            className="web-field block max-h-[180px] w-full resize-none bg-transparent outline-none"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              const submit =
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                (event.metaKey || event.ctrlKey || (wide && !event.shiftKey));
              if (submit) {
                event.preventDefault();
                void send();
              }
            }}
          />
        </div>
        {session.irgat ? null : (
          <span className="mb-1 shrink-0">
            <PlanToggle on={plan} onChange={setPlan} />
          </span>
        )}
        {session.busy && empty ? (
          <button
            aria-label="Stop"
            onClick={() => void stop()}
            disabled={busy !== null}
            className="web-press flex size-11 shrink-0 items-center justify-center rounded-full bg-(--ink) text-(--color-background-base) disabled:opacity-50"
          >
            {busy === "stop" ? (
              <Spinner />
            ) : (
              <Square className="size-4 fill-current" strokeWidth={0} />
            )}
          </button>
        ) : (
          <button
            aria-label="Send"
            onClick={() => void send()}
            disabled={empty || busy !== null}
            className="primary-action web-press flex size-11 shrink-0 items-center justify-center rounded-full"
          >
            <ArrowUp className="size-5" strokeWidth={2.25} />
          </button>
        )}
      </div>
    </>
  );
}
