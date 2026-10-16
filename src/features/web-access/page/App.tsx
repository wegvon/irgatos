import { useEffect, useState, type ReactNode } from "react";
import type { IdeasState } from "../../ideas/model/ideas";
import type { WebOverview, WebServices } from "../model/protocol";
import { SignedOut, onSignedOut, read, usePoll } from "./client";
import { navigate, openSheet, useRoute, type Screen } from "./route";
import { applyAppearance, useMediaQuery } from "./theme";
import { ChatView } from "./ui/ChatView";
import { ChatRow } from "./ui/ChatRow";
import { Chats, allEntries } from "./ui/Chats";
import { IdeaDetail } from "./ui/IdeaDetail";
import { Ideas } from "./ui/Ideas";
import { Login } from "./ui/Login";
import { NewChat } from "./ui/NewChat";
import {
  ServicesChip,
  ServicesSheet,
  macSummary,
  macTone,
} from "./ui/Services";
import { Sheet } from "./ui/Sheet";
import { SwipeBack } from "./ui/SwipeBack";
import { Today } from "./ui/Today";
import {
  Brand,
  IconBadge,
  NeedsYouButton,
  RoundButton,
  TONE,
  primaryButton,
  useNow,
  type Tone,
} from "./ui/parts";
import {
  Idea,
  MessageSquare,
  Monitor,
  PanelLeft,
  Plus,
  Radar,
  WifiOff,
  X,
} from "../../../shared/ui/icons";
import { FLEET_BUCKET_LABEL, FLEET_BUCKETS } from "../../fleet/model/fleet";

/** The last screen under an open chat, filter included, to go back to. */
type Tab = Exclude<Screen, { name: "chat" }>;

const SIDEBAR_KEY = "irgatos.web.sidebar";

function storedSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}

/** Today, then the open approvals and questions on it. */
function showNeedsYou() {
  navigate({ name: "today" });
  window.setTimeout(
    () =>
      document
        .getElementById("needs-you")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    80,
  );
}

/**
 * The browser page: on the phone a floating tab bar under 768px, on the iPad
 * a floating sidebar next to the open screen. Both read the same live data.
 */
export function WebApp({ triedToken }: { triedToken: boolean }) {
  const [signedOut, setSignedOut] = useState(false);
  const wide = useMediaQuery("(min-width: 768px)");
  const { screen, sheet, closeSheet } = useRoute();
  const [last, setLast] = useState<Tab>(() =>
    screen.name === "chat" ? { name: "today" } : screen,
  );
  const tab = last.name;
  const [sidebar, setSidebar] = useState(storedSidebar);
  const toggleSidebar = () =>
    setSidebar((open) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, open ? "closed" : "open");
      } catch {
        // private mode
      }
      return !open;
    });

  useEffect(() => onSignedOut(() => setSignedOut(true)), []);
  useEffect(() => {
    if (screen.name !== "chat") setLast(screen);
  }, [screen]);

  const live = !signedOut;
  const overview = usePoll(
    live ? "overview" : null,
    () => read<WebOverview>("overview"),
    () => 3000,
  );
  const services = usePoll(
    live ? "services" : null,
    () => read<WebServices>("services"),
    () => 60_000,
  );
  // Today counts ideas too, so the board stays loaded, just polled slower.
  const ideasOpen = screen.name === "ideas" || sheet?.name === "idea";
  const ideas = usePoll(
    live ? "ideas" : null,
    () => read<IdeasState>("ideas"),
    () => (ideasOpen ? 10_000 : 30_000),
  );
  const now = useNow(overview.data?.at);
  const connected = !overview.error;
  const needsYou = overview.data?.needsYou.length ?? 0;
  const mac = macTone(services.data?.services, connected);

  const appearance = overview.data?.appearance;
  const appearanceKey = JSON.stringify(appearance ?? null);
  useEffect(() => {
    if (!appearance) return;
    applyAppearance(appearance);
    const scheme = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => applyAppearance(appearance);
    scheme.addEventListener("change", follow);
    return () => scheme.removeEventListener("change", follow);
    // Only when the Mac's theme actually changes, not on every poll.
  }, [appearanceKey]);

  useEffect(() => {
    document.title = needsYou ? `(${needsYou}) Irgatos` : "Irgatos";
    const badge = navigator as Navigator & {
      setAppBadge?: (count: number) => Promise<void>;
    };
    void badge.setAppBadge?.(needsYou).catch(() => {});
  }, [needsYou]);

  if (signedOut || overview.error instanceof SignedOut)
    return <Login invalid={triedToken} />;

  const bell = <NeedsYouButton count={needsYou} onClick={showNeedsYou} />;
  const header = wide ? (
    <>
      <span />
      <span className="flex items-center gap-2">
        <ServicesChip
          services={services.data?.services}
          connected={connected}
        />
        {bell}
      </span>
    </>
  ) : (
    <>
      <Brand />
      {bell}
    </>
  );

  const newChatHere = sheet?.name === "new" && !wide;
  const sheetTitle =
    sheet?.name === "new"
      ? "New chat"
      : sheet?.name === "services"
        ? "Your Mac"
        : "Idea";
  const sheetView =
    sheet && !newChatHere ? (
      <Sheet title={sheetTitle} wide={wide} onClose={closeSheet}>
        {sheet.name === "new" ? (
          <div className="h-[min(640px,calc(var(--app-height,100dvh)-200px))]">
            <NewChat owner={overview.data?.owner} />
          </div>
        ) : sheet.name === "services" ? (
          <ServicesSheet
            services={services.data?.services}
            connected={connected}
            onChecked={(next) => services.mutate(() => ({ services: next }))}
          />
        ) : (
          <IdeaDetail
            ideas={ideas.data}
            id={sheet.id}
            now={now}
            mutate={ideas.mutate}
            onClose={closeSheet}
          />
        )}
      </Sheet>
    ) : null;

  const tabView = (name: Tab["name"]) =>
    name === "ideas" ? (
      <Ideas
        ideas={ideas.data}
        mutate={ideas.mutate}
        now={now}
        wide={wide}
        header={header}
      />
    ) : (
      <div
        className={`web-scroll h-full ${wide ? "" : "pb-[calc(var(--tab-height)+max(var(--safe-bottom),14px)+20px)]"}`}
      >
        {name === "today" ? (
          <Today
            overview={overview.data}
            ideas={ideas.data}
            now={now}
            header={header}
            wide={wide}
          />
        ) : (
          <Chats
            overview={overview.data}
            filter={last.name === "chats" ? last.filter : undefined}
            now={now}
            header={header}
            wide={wide}
          />
        )}
      </div>
    );

  const banner =
    overview.error && overview.data ? (
      <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top)+10px)] z-40 flex justify-center px-4">
        <div className="glass-float web-pop-in inline-flex max-w-md items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-[13.5px] font-semibold text-(--ink)">
          <IconBadge tone="amber" size="size-7">
            <WifiOff className="size-4" />
          </IconBadge>
          <span className="truncate">{overview.error.message} Retrying…</span>
        </div>
      </div>
    ) : null;

  if (overview.error && !overview.data)
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="glass web-pop-in flex max-w-[400px] flex-col items-center gap-3 rounded-[32px] px-7 py-9 text-center">
          <IconBadge tone="rose" size="size-14">
            <WifiOff className="size-7" />
          </IconBadge>
          <div className="mt-2 text-[21px] font-semibold tracking-[-0.02em] text-(--ink)">
            Can't reach your Mac
          </div>
          <div className="max-w-[34ch] text-[15px] leading-snug text-(--ink-2)">
            {overview.error.message} Check that Irgatos is open on the Mac and
            that this device is on your Tailscale network.
          </div>
          <button className={`${primaryButton} mt-3`} onClick={overview.reload}>
            Try again
          </button>
        </div>
      </div>
    );

  if (wide)
    return (
      <div className="flex h-full pl-(--safe-left) pr-(--safe-right)">
        <div className="contents" inert={!!sheet}>
          {sidebar ? (
            <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-(--hairline) bg-content/[0.03] pb-(--safe-bottom) pt-(--safe-top) min-[1200px]:w-[330px]">
              <div className="flex h-16 shrink-0 items-center gap-2 pl-5 pr-3">
                <Brand />
                <button
                  aria-label="Hide sidebar"
                  onClick={toggleSidebar}
                  className="web-press ml-auto flex size-10 items-center justify-center rounded-full text-(--ink-2) active:bg-content/8"
                >
                  <PanelLeft className="size-5" />
                </button>
              </div>
              <nav className="flex shrink-0 flex-col gap-1 px-3">
                <NavItem
                  icon={<Radar className="size-5" />}
                  label="Today"
                  on={screen.name === "today"}
                  count={needsYou}
                  onClick={() => navigate({ name: "today" })}
                />
                <NavItem
                  icon={<MessageSquare className="size-5" />}
                  label="Chats"
                  on={screen.name === "chats"}
                  onClick={() => navigate({ name: "chats" })}
                />
                <NavItem
                  icon={<Idea className="size-5" />}
                  label="Ideas"
                  on={screen.name === "ideas"}
                  onClick={() => navigate({ name: "ideas" })}
                />
              </nav>
              <div className="shrink-0 px-3 pb-2 pt-4">
                <button
                  className={`${primaryButton} w-full`}
                  onClick={() => openSheet({ name: "new" })}
                >
                  <Plus className="size-[18px]" strokeWidth={2.4} />
                  New chat
                </button>
              </div>
              <div className="web-scroll min-h-0 flex-1 px-2 pb-4 pt-2">
                {overview.data
                  ? FLEET_BUCKETS.map((bucket) =>
                      overview.data![bucket].length ? (
                        <div key={bucket} className="mt-3 first:mt-0">
                          <div className="px-3 pb-1 text-[12.5px] font-semibold text-(--ink-3)">
                            {FLEET_BUCKET_LABEL[bucket]}
                          </div>
                          {overview.data![bucket].map((entry) => (
                            <ChatRow
                              key={entry.sessionId}
                              entry={entry}
                              now={now}
                              selected={
                                screen.name === "chat" &&
                                screen.id === entry.sessionId
                              }
                            />
                          ))}
                        </div>
                      ) : null,
                    )
                  : null}
                {overview.data && !allEntries(overview.data).length ? (
                  <div className="px-3 py-6 text-[14px] text-(--ink-3)">
                    No chats are open on your Mac.
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 border-t border-(--hairline) p-2">
                <button
                  onClick={() => openSheet({ name: "services" })}
                  className="web-press flex h-11 w-full items-center gap-3 rounded-[12px] px-3.5 text-[15px] font-medium text-(--ink-2) active:bg-content/8"
                >
                  <MacIcon tone={mac} />
                  Your Mac
                  <span className="ml-auto truncate text-[13px] text-(--ink-3)">
                    {macSummary(services.data?.services, connected)}
                  </span>
                </button>
              </div>
            </aside>
          ) : (
            <aside className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 border-r border-(--hairline) bg-content/[0.03] pb-[calc(var(--safe-bottom)+12px)] pt-[calc(var(--safe-top)+12px)]">
              <button
                aria-label="Show sidebar"
                onClick={toggleSidebar}
                className="web-press mb-1 flex size-11 items-center justify-center rounded-full text-(--ink-2) active:bg-content/8"
              >
                <PanelLeft className="size-5" />
              </button>
              <RailItem
                label="Today"
                on={screen.name === "today"}
                badge={needsYou}
                onClick={() => navigate({ name: "today" })}
              >
                <Radar className="size-[22px]" />
              </RailItem>
              <RailItem
                label="Chats"
                on={screen.name === "chats"}
                onClick={() => navigate({ name: "chats" })}
              >
                <MessageSquare className="size-[22px]" />
              </RailItem>
              <RailItem
                label="Ideas"
                on={screen.name === "ideas"}
                onClick={() => navigate({ name: "ideas" })}
              >
                <Idea className="size-[22px]" />
              </RailItem>
              <button
                aria-label="New chat"
                onClick={() => openSheet({ name: "new" })}
                className="primary-action web-press mt-2 flex size-12 items-center justify-center rounded-full"
              >
                <Plus className="size-[22px]" strokeWidth={2.2} />
              </button>
              <button
                aria-label="Your Mac"
                onClick={() => openSheet({ name: "services" })}
                className="web-press mt-auto flex size-11 items-center justify-center rounded-full text-(--ink-2) active:bg-content/8"
              >
                <MacIcon tone={mac} />
              </button>
            </aside>
          )}
          <main className="relative min-w-0 flex-1">
            {screen.name === "chat" ? (
              <ChatView
                key={screen.id}
                id={screen.id}
                wide
                onBack={() => navigate(last)}
              />
            ) : (
              tabView(screen.name)
            )}
          </main>
        </div>
        {banner}
        {sheetView}
      </div>
    );

  const chatOpen = screen.name === "chat";
  return (
    <div className="relative h-full overflow-hidden pl-(--safe-left) pr-(--safe-right)">
      <div className="h-full" inert={chatOpen || !!sheet}>
        {tabView(tab)}
        <nav className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-5 pb-[max(var(--safe-bottom),14px)]">
          {/* Content fades out under the bar instead of running into it. */}
          <div className="absolute inset-x-0 bottom-0 h-[calc(var(--tab-height)+max(var(--safe-bottom),14px)+28px)] bg-[linear-gradient(to_top,var(--color-background-base)_35%,transparent)]" />
          <div className="relative glass-float pointer-events-auto flex h-(--tab-height) items-center gap-1 rounded-full px-2">
            <TabButton
              label="Today"
              on={tab === "today"}
              badge={needsYou}
              onClick={() => navigate({ name: "today" })}
            >
              <Radar className="size-[22px]" />
            </TabButton>
            <TabButton
              label="Chats"
              on={tab === "chats"}
              onClick={() => navigate({ name: "chats" })}
            >
              <MessageSquare className="size-[22px]" />
            </TabButton>
            <button
              aria-label="New chat"
              onClick={() => openSheet({ name: "new" })}
              className="primary-action web-press mx-1.5 flex size-[48px] items-center justify-center rounded-full"
            >
              <Plus className="size-6" strokeWidth={2.2} />
            </button>
            <TabButton
              label="Ideas"
              on={tab === "ideas"}
              onClick={() => navigate({ name: "ideas" })}
            >
              <Idea className="size-[22px]" />
            </TabButton>
            <TabButton
              label="Your Mac"
              on={false}
              onClick={() => openSheet({ name: "services" })}
            >
              <MacIcon tone={mac} />
            </TabButton>
          </div>
        </nav>
      </div>
      {chatOpen ? (
        <SwipeBack onBack={() => navigate(last)}>
          <ChatView
            key={screen.id}
            id={screen.id}
            wide={false}
            onBack={() => navigate(last)}
          />
        </SwipeBack>
      ) : null}
      {newChatHere ? (
        <div className="web-page web-push-in absolute inset-0 z-30">
          <NewChat
            owner={overview.data?.owner}
            header={
              <header className="flex h-[60px] shrink-0 items-center gap-2 px-3 pt-(--safe-top) [box-sizing:content-box]">
                <RoundButton label="Close" onClick={closeSheet}>
                  <X className="size-5" strokeWidth={2.2} />
                </RoundButton>
                <div className="flex-1 text-center text-[16px] font-semibold tracking-[-0.01em] text-(--ink)">
                  New chat
                </div>
                <div className="size-10 shrink-0" />
              </header>
            }
          />
        </div>
      ) : null}
      {banner}
      {sheetView}
    </div>
  );
}

/** The Mac's icon with a dot in its worst service color. */
function MacIcon({ tone }: { tone: Tone }) {
  return (
    <span className="relative">
      <Monitor className="size-[22px]" />
      <span
        className={`${TONE[tone]} tone-dot absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-(--color-background-base)`}
      />
    </span>
  );
}

function TabButton({
  label,
  on,
  badge = 0,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={`web-press relative flex size-12 items-center justify-center rounded-full ${
        on ? "bg-selection text-(--ink)" : "text-(--ink-2)"
      }`}
    >
      {children}
      {badge ? <Badge>{badge}</Badge> : null}
    </button>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold tabular-nums text-black ring-2 ring-(--color-background-base)">
      {children}
    </span>
  );
}

function NavItem({
  icon,
  label,
  on,
  count = 0,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={`web-press flex h-11 items-center gap-3 rounded-[12px] px-3.5 text-[16px] font-medium ${
        on ? "bg-selection text-(--ink)" : "text-(--ink-2) active:bg-content/8"
      }`}
    >
      <span className={on ? "text-(--ink)" : "text-(--ink-3)"}>{icon}</span>
      {label}
      {count ? (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[12px] font-semibold tabular-nums text-black">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function RailItem({
  label,
  on,
  badge = 0,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      aria-current={on ? "page" : undefined}
      onClick={onClick}
      className={`web-press relative flex size-12 items-center justify-center rounded-full ${
        on ? "bg-selection text-(--ink)" : "text-(--ink-2) active:bg-content/8"
      }`}
    >
      {children}
      {badge ? <Badge>{badge}</Badge> : null}
    </button>
  );
}
