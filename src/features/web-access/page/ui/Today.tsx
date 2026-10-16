import { useState, type ReactNode } from "react";
import type { FleetEntry } from "../../../fleet/model/fleet";
import type { WebOverview } from "../../model/protocol";
import { ago, greeting, today } from "../format";
import { navigate, openSheet } from "../route";
import { ChatRow, place } from "./ChatRow";
import { RequestBody } from "./Requests";
import {
  Empty,
  Group,
  Harness,
  SectionTitle,
  Spinner,
  primaryButton,
} from "./parts";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Plus,
  Sparkles,
  Zap,
} from "../../../../shared/ui/icons";

/** Home: what blocks on you first, then what is moving, then what finished. */
export function Today({
  overview,
  now,
  header,
  wide,
}: {
  overview: WebOverview | null;
  now: number;
  header: ReactNode;
  wide: boolean;
}) {
  const [showIdle, setShowIdle] = useState(false);
  const total = overview
    ? overview.needsYou.length +
      overview.running.length +
      overview.review.length +
      overview.interrupted.length +
      overview.idle.length
    : 0;

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-7 px-4 ${wide ? "max-w-[1100px] px-8 pt-[calc(var(--safe-top)+20px)] pb-12" : "pb-8"}`}
    >
      <header className={wide ? "" : "pt-[calc(var(--safe-top)+10px)]"}>
        <div className="flex h-9 items-center justify-between gap-3">
          <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-content/45">
            {today(now)}
          </span>
          {header}
        </div>
        <h1 className="mt-0.5 text-[34px] font-bold leading-tight tracking-[-0.02em]">
          {greeting(now)}
        </h1>
      </header>

      {!overview ? (
        <div className="flex justify-center py-20 text-content/40">
          <Spinner className="size-6" />
        </div>
      ) : total === 0 ? (
        <Empty icon={<Sparkles className="size-6" />} title="All quiet">
          No chats are open on your Mac. Start one and follow it from here.
          <div className="mt-5">
            <button
              className={primaryButton}
              onClick={() => openSheet({ name: "new" })}
            >
              <Plus className="size-4" />
              New chat
            </button>
          </div>
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <Stat
              target="needs-you"
              count={overview.needsYou.length}
              label="Need you"
              tone="text-(--warn)"
              icon={<CircleAlert className="size-[18px]" />}
            />
            <Stat
              target="running"
              count={overview.running.length}
              label="Running"
              tone="text-(--accent)"
              icon={<Zap className="size-[18px]" />}
            />
            <Stat
              target="review"
              count={overview.review.length}
              label="To review"
              tone="text-(--ok)"
              icon={<CheckCircle className="size-[18px]" />}
            />
          </div>

          <div className={`grid gap-7 ${wide ? "@container" : ""}`}>
            <div
              className={
                wide
                  ? "grid items-start gap-7 @[680px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
                  : "contents"
              }
            >
              <section id="needs-you" className="scroll-mt-4">
                <SectionTitle count={overview.needsYou.length}>
                  Needs you
                </SectionTitle>
                {overview.needsYou.length ? (
                  <div className="flex flex-col gap-3">
                    {overview.needsYou.flatMap((entry) =>
                      entry.requests.map((request) => (
                        <RequestCard
                          key={`${entry.sessionId}:${request.requestId}`}
                          entry={entry}
                          now={now}
                        >
                          <RequestBody
                            sessionId={entry.sessionId}
                            request={request}
                          />
                        </RequestCard>
                      )),
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-[18px] bg-(--surface) px-4 py-4 text-[15px] text-content/55 shadow-[0_0_0_0.5px_var(--color-stroke)]">
                    <CheckCircle className="size-5 text-(--ok)" />
                    Nothing is waiting on you.
                  </div>
                )}
              </section>

              <div className="flex flex-col gap-7">
                <Bucket
                  id="running"
                  title="Running"
                  entries={overview.running}
                  now={now}
                />
                <Bucket
                  id="review"
                  title="Ready to review"
                  entries={overview.review}
                  now={now}
                  showFiles
                />
                <Bucket
                  id="interrupted"
                  title="Interrupted"
                  entries={overview.interrupted}
                  now={now}
                />
                {overview.idle.length ? (
                  <section>
                    <SectionTitle
                      count={overview.idle.length}
                      action={
                        <button
                          className="inline-flex items-center gap-1 text-[14px] font-medium text-(--accent)"
                          onClick={() => setShowIdle((value) => !value)}
                        >
                          {showIdle ? "Hide" : "Show"}
                          <ChevronDown
                            className={`size-4 transition-transform ${showIdle ? "rotate-180" : ""}`}
                          />
                        </button>
                      }
                    >
                      Idle
                    </SectionTitle>
                    {showIdle ? (
                      <Group>
                        {overview.idle.map((entry) => (
                          <ChatRow
                            key={entry.sessionId}
                            entry={entry}
                            now={now}
                          />
                        ))}
                      </Group>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  target,
  count,
  label,
  tone,
  icon,
}: {
  target: string;
  count: number;
  label: string;
  tone: string;
  icon: ReactNode;
}) {
  return (
    <button
      className="web-press flex flex-col items-start gap-2 rounded-[18px] bg-(--surface) p-3.5 text-left shadow-[0_0_0_0.5px_var(--color-stroke)] disabled:opacity-100"
      disabled={count === 0}
      onClick={() =>
        document
          .getElementById(target)
          ?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    >
      <span className={count ? tone : "text-content/25"}>{icon}</span>
      <span>
        <span
          className={`block text-[28px] font-bold leading-none tabular-nums ${count ? "" : "text-content/30"}`}
        >
          {count}
        </span>
        <span className="mt-1 block text-[13px] font-medium text-content/55">
          {label}
        </span>
      </span>
    </button>
  );
}

function RequestCard({
  entry,
  now,
  children,
}: {
  entry: FleetEntry;
  now: number;
  children: ReactNode;
}) {
  return (
    <article className="rounded-[20px] bg-(--surface) p-4 shadow-[0_0_0_1px_color-mix(in_srgb,var(--warn)_28%,transparent)]">
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => navigate({ name: "chat", id: entry.sessionId })}
      >
        <Harness harness={entry.harness} />
        <span className="min-w-0 truncate text-[13px] font-medium text-content/55">
          {place(entry)}
          {entry.branch ? (
            <span className="font-normal text-content/40">
              {" "}
              · {entry.branch}
            </span>
          ) : null}
        </span>
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-content/40">
          {ago(entry.at, now)}
        </span>
        <ChevronRight className="size-4 shrink-0 text-content/30" />
      </button>
      <div className="mb-3 mt-1.5 text-[17px] font-semibold leading-snug">
        {entry.title}
      </div>
      {children}
    </article>
  );
}

function Bucket({
  id,
  title,
  entries,
  now,
  showFiles = false,
}: {
  id: string;
  title: string;
  entries: FleetEntry[];
  now: number;
  showFiles?: boolean;
}) {
  if (!entries.length) return null;
  return (
    <section id={id} className="scroll-mt-4">
      <SectionTitle count={entries.length}>{title}</SectionTitle>
      <Group>
        {entries.map((entry) => (
          <ChatRow
            key={entry.sessionId}
            entry={entry}
            now={now}
            showFiles={showFiles}
          />
        ))}
      </Group>
    </section>
  );
}
