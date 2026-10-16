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
import { ServicesChip, ServicesSheet } from "./ui/Services";
import { Sheet } from "./ui/Sheet";
import { SwipeBack } from "./ui/SwipeBack";
import { Today } from "./ui/Today";
import { primaryButton, useNow } from "./ui/parts";
import {
  DashboardSquare,
  Gauge,
  Idea,
  MessageMultiple,
  PanelLeft,
  Plus,
  WifiOff,
} from "../../../shared/ui/icons";
import { FLEET_BUCKET_LABEL, FLEET_BUCKETS } from "../../fleet/model/fleet";

type Tab = Exclude<Screen["name"], "chat">;

const SIDEBAR_KEY = "irgatos.web.sidebar";

function storedSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}

/**
 * The browser page: a phone layout with a tab bar under 768px, and a
 * sidebar-and-detail layout on the iPad. Both read the same live data.
 */
export function WebApp({ triedToken }: { triedToken: boolean }) {
  const [signedOut, setSignedOut] = useState(false);
  const wide = useMediaQuery("(min-width: 768px)");
  const { screen, sheet, closeSheet } = useRoute();
  const [tab, setTab] = useState<Tab>(() =>
    screen.name === "chat" ? "today" : screen.name,
  );
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
    if (screen.name !== "chat") setTab(screen.name);
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
  const wantsIdeas = screen.name === "ideas" || sheet?.name === "idea";
  const ideas = usePoll(
    live && wantsIdeas ? "ideas" : null,
    () => read<IdeasState>("ideas"),
    () => 10_000,
  );
  const now = useNow(overview.data?.at);
  const connected = !overview.error;
  const needsYou = overview.data?.needsYou.length ?? 0;
  const serviceStates = services.data?.services.map((service) => service.state);
  const macDot =
    !connected || serviceStates?.includes("offline")
      ? "bg-(--bad)"
      : serviceStates?.includes("slow")
        ? "bg-(--warn)"
        : "bg-(--ok)";

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

  const chip = (
    <ServicesChip services={services.data?.services} connected={connected} />
  );
  const sheetTitle =
    sheet?.name === "new"
      ? "New chat"
      : sheet?.name === "services"
        ? "Your Mac"
        : "Idea";
  const sheetView = sheet ? (
    <Sheet title={sheetTitle} wide={wide} onClose={closeSheet}>
      {sheet.name === "new" ? (
        <NewChat />
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

  const tabView = (name: Tab, header?: ReactNode) =>
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
        className={`web-scroll h-full ${wide ? "" : "pb-[calc(var(--tab-height)+var(--safe-bottom)+20px)]"}`}
      >
        {name === "today" ? (
          <Today
            overview={overview.data}
            now={now}
            header={header}
            wide={wide}
          />
        ) : (
          <Chats
            overview={overview.data}
            now={now}
            header={header}
            wide={wide}
          />
        )}
      </div>
    );

  const banner =
    overview.error && overview.data ? (
      <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top)+8px)] z-40 flex justify-center px-4">
        <div className="web-pop-in inline-flex max-w-md items-center gap-2 rounded-full bg-(--warn) px-4 py-2 text-[13.5px] font-semibold text-(--on-warn) shadow-lg shadow-black/25">
          <WifiOff className="size-4 shrink-0" />
          <span className="truncate">{overview.error.message} Retrying…</span>
        </div>
      </div>
    ) : null;

  if (overview.error && !overview.data)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <WifiOff className="size-8 text-content/35" />
        <div className="text-[19px] font-semibold">Can't reach your Mac</div>
        <div className="max-w-[34ch] text-[15px] leading-snug text-content/50">
          {overview.error.message} Check that Irgatos is open on the Mac and
          that this device is on your Tailscale network.
        </div>
        <button className={`${primaryButton} mt-3`} onClick={overview.reload}>
          Try again
        </button>
      </div>
    );

  if (wide)
    return (
      <div className="flex h-full pl-(--safe-left) pr-(--safe-right)">
        <div className="contents" inert={!!sheet}>
          {sidebar ? null : (
            <aside className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-stroke bg-(--surface)/40 pb-[calc(var(--safe-bottom)+12px)] pt-(--safe-top)">
              <button
                aria-label="Show sidebar"
                onClick={toggleSidebar}
                className="web-press mb-2 mt-3 flex size-11 items-center justify-center rounded-[12px] text-content/55 active:bg-selection"
              >
                <PanelLeft className="size-5" />
              </button>
              <RailItem
                label="Today"
                on={screen.name === "today"}
                badge={needsYou}
                onClick={() => navigate({ name: "today" })}
              >
                <DashboardSquare className="size-[22px]" />
              </RailItem>
              <RailItem
                label="Chats"
                on={screen.name === "chats"}
                onClick={() => navigate({ name: "chats" })}
              >
                <MessageMultiple className="size-[22px]" />
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
                className="web-press mt-2 flex size-11 items-center justify-center rounded-full bg-(--accent) text-white"
              >
                <Plus className="size-5" strokeWidth={2.4} />
              </button>
              <button
                aria-label="Your Mac"
                onClick={() => openSheet({ name: "services" })}
                className="web-press mt-auto flex size-11 items-center justify-center rounded-[12px] text-content/55 active:bg-selection"
              >
                <span className="relative">
                  <Gauge className="size-[22px]" />
                  <span
                    className={`absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-(--color-background-base) ${macDot}`}
                  />
                </span>
              </button>
            </aside>
          )}
          <aside
            className={`flex w-[300px] shrink-0 flex-col border-r border-stroke bg-(--surface)/40 pt-(--safe-top) min-[1200px]:w-[340px] ${sidebar ? "" : "hidden"}`}
          >
            <div className="flex h-16 shrink-0 items-center gap-2 pl-3 pr-4">
              <button
                aria-label="Hide sidebar"
                onClick={toggleSidebar}
                className="web-press flex size-10 shrink-0 items-center justify-center rounded-[12px] text-content/55 active:bg-selection"
              >
                <PanelLeft className="size-5" />
              </button>
              <img src="/irgat.png" alt="" className="size-7 rounded-[8px]" />
              <span className="text-[18px] font-bold tracking-[-0.01em]">
                Irgatos
              </span>
              <span className="ml-auto">{chip}</span>
            </div>
            <nav className="flex shrink-0 flex-col gap-0.5 px-3">
              <NavItem
                icon={<DashboardSquare className="size-5" />}
                label="Today"
                on={screen.name === "today"}
                count={needsYou}
                warn
                onClick={() => navigate({ name: "today" })}
              />
              <NavItem
                icon={<MessageMultiple className="size-5" />}
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
            <div className="shrink-0 px-3 pb-2 pt-3">
              <button
                className={`${primaryButton} w-full`}
                onClick={() => openSheet({ name: "new" })}
              >
                <Plus className="size-[18px]" strokeWidth={2.2} />
                New chat
              </button>
            </div>
            <div className="web-scroll min-h-0 flex-1 px-3 pb-[calc(var(--safe-bottom)+16px)] pt-2">
              {overview.data
                ? FLEET_BUCKETS.map((bucket) =>
                    overview.data![bucket].length ? (
                      <div key={bucket} className="mt-3 first:mt-0">
                        <div className="px-3 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-content/40">
                          {FLEET_BUCKET_LABEL[bucket]}
                        </div>
                        {overview.data![bucket].map((entry) => (
                          <ChatRow
                            key={entry.sessionId}
                            entry={entry}
                            now={now}
                            compact
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
                <div className="px-3 py-6 text-[14px] text-content/40">
                  No chats are open on your Mac.
                </div>
              ) : null}
            </div>
          </aside>
          <main className="relative min-w-0 flex-1">
            {screen.name === "chat" ? (
              <ChatView
                key={screen.id}
                id={screen.id}
                wide
                onBack={() => navigate({ name: tab })}
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
        <nav className="web-bar absolute inset-x-0 bottom-0 z-10 border-t border-stroke pb-(--safe-bottom)">
          <div className="grid h-(--tab-height) grid-cols-5">
            <TabButton
              icon={<DashboardSquare className="size-6" />}
              label="Today"
              on={tab === "today"}
              badge={needsYou}
              onClick={() => navigate({ name: "today" })}
            />
            <TabButton
              icon={<MessageMultiple className="size-6" />}
              label="Chats"
              on={tab === "chats"}
              onClick={() => navigate({ name: "chats" })}
            />
            <div className="flex items-center justify-center">
              <button
                aria-label="New chat"
                onClick={() => openSheet({ name: "new" })}
                className="web-press flex size-12 items-center justify-center rounded-full bg-(--accent) text-white shadow-lg shadow-black/25"
              >
                <Plus className="size-6" strokeWidth={2.4} />
              </button>
            </div>
            <TabButton
              icon={<Idea className="size-6" />}
              label="Ideas"
              on={tab === "ideas"}
              onClick={() => navigate({ name: "ideas" })}
            />
            <TabButton
              icon={
                <span className="relative">
                  <Gauge className="size-6" />
                  <span
                    className={`absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-(--color-background-base) ${macDot}`}
                  />
                </span>
              }
              label="Mac"
              on={false}
              onClick={() => openSheet({ name: "services" })}
            />
          </div>
        </nav>
      </div>
      {chatOpen ? (
        <SwipeBack onBack={() => navigate({ name: tab })}>
          <ChatView
            key={screen.id}
            id={screen.id}
            wide={false}
            onBack={() => navigate({ name: tab })}
          />
        </SwipeBack>
      ) : null}
      {banner}
      {sheetView}
    </div>
  );
}

function TabButton({
  icon,
  label,
  on,
  badge = 0,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={`relative flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold ${
        on ? "text-(--accent)" : "text-content/45"
      }`}
    >
      <span className="relative">
        {icon}
        {badge ? (
          <span className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-(--warn) px-1 text-[11px] font-bold tabular-nums text-(--on-warn) ring-2 ring-(--color-background-base)">
            {badge}
          </span>
        ) : null}
      </span>
      {label}
    </button>
  );
}

function NavItem({
  icon,
  label,
  on,
  count = 0,
  warn = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
  count?: number;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={`flex h-11 items-center gap-3 rounded-[12px] px-3 text-[16px] font-medium transition-colors ${
        on
          ? "bg-selection-strong text-content"
          : "text-content/70 active:bg-selection"
      }`}
    >
      <span className={on ? "text-(--accent)" : "text-content/50"}>{icon}</span>
      {label}
      {count ? (
        <span
          className={`ml-auto flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[13px] font-bold tabular-nums ${
            warn
              ? "bg-(--warn) text-(--on-warn)"
              : "bg-content/10 text-content/60"
          }`}
        >
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
      className={`web-press relative flex size-11 items-center justify-center rounded-[12px] ${
        on
          ? "bg-selection-strong text-(--accent)"
          : "text-content/55 active:bg-selection"
      }`}
    >
      {children}
      {badge ? (
        <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-(--warn) px-1 text-[11px] font-bold tabular-nums text-(--on-warn) ring-2 ring-(--color-background-base)">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
