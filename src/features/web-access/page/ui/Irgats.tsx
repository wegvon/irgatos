import type { ReactNode } from "react";
import {
  IRGAT_STATUS_LABEL,
  type IrgatStatus,
} from "../../../irgats/model/irgat";
import { PixelMascot } from "../../../projects/ui/PixelMascot";
import type { WebIrgat, WebIrgats, WebMascot } from "../../model/protocol";
import { write } from "../client";
import { navigate, openSheet } from "../route";
import { Empty, Pill, Spinner, TONE, plainButton, useAction } from "./parts";
import {
  Bot,
  ChevronRight,
  LoaderCircle,
  Plus,
  Settings,
} from "../../../../shared/ui/icons";

/** An Irgat's pixel mascot, moving as it does on the desktop rail. */
export function Mascot({
  mascot,
  status = "idle",
  className = "size-7",
}: {
  mascot: WebMascot;
  status?: IrgatStatus;
  className?: string;
}) {
  return (
    <PixelMascot
      name={mascot.name}
      color={mascot.color}
      status={status}
      still={status === "idle"}
      className={`shrink-0 ${className}`}
    />
  );
}

/** Waiting on you in amber, a spinner while working, else a quiet dot. */
function StatusMark({ status }: { status: IrgatStatus }) {
  if (status === "working")
    return (
      <LoaderCircle
        aria-hidden
        className="size-3 shrink-0 animate-spin text-(--ink-3)"
      />
    );
  return (
    <span
      aria-hidden
      className={`${TONE[status === "needs-you" ? "amber" : "muted"]} tone-dot inline-flex size-2 shrink-0 rounded-full ${status === "idle" ? "opacity-50" : ""}`}
    />
  );
}

/**
 * The Mac's Irgats, as on its sidebar: each opens its own conversation, and
 * its other chats sit underneath.
 */
export function Irgats({
  irgats,
  header,
  wide,
}: {
  irgats: WebIrgats | null;
  header: ReactNode;
  wide: boolean;
}) {
  const { busy, run } = useAction();
  const open = (irgat: WebIrgat, sessionId?: string) =>
    void run(`${irgat.id}:${sessionId ?? ""}`, async () => {
      const opened = await write<{ sessionId: string }>("irgatOpen", {
        irgatId: irgat.id,
        ...(sessionId ? { sessionId } : {}),
      });
      navigate({ name: "chat", id: opened.sessionId });
    });
  const create = () =>
    void run("create", async () => {
      const created = await write<{ irgatId: string }>("irgatCreate", {});
      openSheet({ name: "irgat", id: created.irgatId });
    });
  const newChat = (irgat: WebIrgat) =>
    void run(`${irgat.id}:new`, async () => {
      const created = await write<{ sessionId: string }>("irgatNewChat", {
        irgatId: irgat.id,
      });
      navigate({ name: "chat", id: created.sessionId });
    });

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-5 ${wide ? "max-w-[1120px] px-8 pb-12 pt-[calc(var(--safe-top)+22px)]" : "px-4 pb-8 pt-[calc(var(--safe-top)+10px)]"}`}
    >
      <header className="flex flex-col gap-4">
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
            Irgats
          </h1>
          {irgats?.enabled ? (
            <button
              className={`${plainButton} gap-1.5`}
              disabled={busy !== null}
              onClick={create}
            >
              {busy === "create" ? (
                <Spinner className="size-4" />
              ) : (
                <Plus className="size-4" strokeWidth={2.4} />
              )}
              New Irgat
            </button>
          ) : null}
        </div>
      </header>

      {!irgats ? (
        <div className="flex justify-center py-20 text-(--ink-3)">
          <Spinner className="size-6" />
        </div>
      ) : !irgats.enabled || !irgats.irgats.length ? (
        <div className="glass rounded-[28px]">
          <Empty
            icon={
              <span className="flex size-16 items-center justify-center rounded-2xl bg-content/6 text-(--ink-3)">
                <Bot className="size-8" />
              </span>
            }
            title={irgats.enabled ? "No Irgats yet" : "Irgats are turned off"}
          >
            {irgats.enabled
              ? "Tap New Irgat to add one, then tell it what to work on."
              : "Turn them on in Irgatos settings on your Mac."}
          </Empty>
        </div>
      ) : (
        <div className={wide ? "@container" : ""}>
          <div
            className={
              wide
                ? "grid items-start gap-4 @[720px]:grid-cols-2"
                : "flex flex-col gap-3"
            }
          >
            {irgats.irgats.map((irgat) => (
              <IrgatCard
                key={irgat.id}
                irgat={irgat}
                busy={busy}
                onOpen={(sessionId) => open(irgat, sessionId)}
                onNewChat={() => newChat(irgat)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IrgatCard({
  irgat,
  busy,
  onOpen,
  onNewChat,
}: {
  irgat: WebIrgat;
  busy: string | null;
  onOpen: (sessionId?: string) => void;
  onNewChat: () => void;
}) {
  const waiting = irgat.status === "needs-you";
  const opening = (sessionId = "") => busy === `${irgat.id}:${sessionId}`;
  return (
    <article
      className={`${waiting ? "attention" : "glass"} overflow-hidden rounded-[24px]`}
    >
      <button
        onClick={() => onOpen()}
        disabled={busy !== null}
        className="web-press flex w-full items-center gap-3.5 p-4 text-left"
      >
        <span className="flex size-14 shrink-0 items-center justify-center rounded-[16px] bg-content/6">
          <Mascot
            mascot={irgat.mascot}
            status={irgat.status}
            className="size-9"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[17px] font-semibold tracking-[-0.01em] text-(--ink)">
              {irgat.name}
            </span>
            {waiting ? <Pill tone="amber">Needs you</Pill> : null}
          </span>
          <span
            className={`mt-0.5 block truncate text-[13.5px] ${
              irgat.status === "working"
                ? "web-shimmer font-medium"
                : waiting
                  ? "font-medium text-(--tone-amber)"
                  : "text-(--ink-2)"
            }`}
          >
            {irgat.activity ??
              (irgat.status === "idle"
                ? irgat.projects.join(", ") || IRGAT_STATUS_LABEL.idle
                : IRGAT_STATUS_LABEL[irgat.status])}
          </span>
        </span>
        {opening() ? (
          <Spinner className="size-5 shrink-0 text-(--ink-3)" />
        ) : (
          <ChevronRight className="size-5 shrink-0 text-(--ink-3)" />
        )}
      </button>
      {irgat.chats.length ? (
        <div className="flex flex-col border-t border-(--hairline) px-2 py-1.5">
          {irgat.chats.map((chat) => (
            <button
              key={chat.sessionId}
              onClick={() => onOpen(chat.sessionId)}
              disabled={busy !== null}
              className="web-press flex h-11 items-center gap-3 rounded-[12px] px-3 text-left active:bg-content/8"
            >
              <StatusMark status={chat.status} />
              <span className="min-w-0 flex-1 truncate text-[15px] text-(--ink)">
                {chat.title}
              </span>
              {opening(chat.sessionId) ? (
                <Spinner className="size-4 shrink-0 text-(--ink-3)" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-(--ink-3)" />
              )}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex border-t border-(--hairline) px-2 py-1.5">
        <button
          className={`${plainButton} h-10 gap-2 px-3 text-[14px]`}
          disabled={busy !== null}
          onClick={onNewChat}
        >
          {busy === `${irgat.id}:new` ? (
            <Spinner className="size-4" />
          ) : (
            <Plus className="size-4" strokeWidth={2.4} />
          )}
          New chat
        </button>
        <button
          className={`${plainButton} ml-auto h-10 gap-2 px-3 text-[14px] text-(--ink-2)`}
          onClick={() => openSheet({ name: "irgat", id: irgat.id })}
        >
          <Settings className="size-4" />
          Settings
        </button>
      </div>
    </article>
  );
}
