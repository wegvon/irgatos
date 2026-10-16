import { useState, type ReactNode } from "react";
import type { FleetEntry } from "../../../fleet/model/fleet";
import type { IdeasState } from "../../../ideas/model/ideas";
import type { WebOverview } from "../../model/protocol";
import { ago, greeting, plural, today } from "../format";
import { navigate, openSheet } from "../route";
import { ChatCard, ChatRow, place } from "./ChatRow";
import { RequestBody } from "./Requests";
import {
  Empty,
  Harness,
  IconBadge,
  Pill,
  SectionTitle,
  Spinner,
  plainButton,
  primaryButton,
  type Tone,
} from "./parts";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileDiff,
  Idea,
  LoaderCircle,
  Plus,
} from "../../../../shared/ui/icons";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Home: a greeting, four numbers, what waits on you, then what is moving. */
export function Today({
  overview,
  ideas,
  now,
  header,
  wide,
}: {
  overview: WebOverview | null;
  ideas: IdeasState | null;
  now: number;
  header: ReactNode;
  wide: boolean;
}) {
  const [showIdle, setShowIdle] = useState(false);
  const owner = overview?.owner;
  const moving = overview
    ? [...overview.interrupted, ...overview.review, ...overview.running]
    : [];
  const total = overview
    ? moving.length + overview.needsYou.length + overview.idle.length
    : 0;
  const changed = overview
    ? overview.review.reduce((sum, entry) => sum + entry.editedPaths.length, 0)
    : 0;
  const artifacts = overview
    ? overview.review.reduce((sum, entry) => sum + entry.artifacts, 0)
    : 0;
  const cards = ideas?.boards.flatMap((board) =>
    board.lists.flatMap((list) => list.cards),
  );
  const fresh =
    cards?.filter((card) => now - card.createdAt < WEEK).length ?? 0;

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-6 ${wide ? "max-w-[1120px] px-8 pb-12 pt-[calc(var(--safe-top)+22px)]" : "px-4 pb-8 pt-[calc(var(--safe-top)+10px)]"}`}
    >
      <header className="flex flex-col gap-5">
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <div>
          <h1
            className={`font-semibold leading-[1.12] tracking-[-0.025em] text-(--ink) ${wide ? "text-[38px]" : "text-[33px]"}`}
          >
            {greeting(now)}
            {owner ? (
              <>
                ,
                <br />
                {owner}
              </>
            ) : null}
          </h1>
          <p className="mt-2 text-[15px] font-medium text-(--ink-2)">
            {today(now)}
          </p>
        </div>
      </header>

      {!overview ? (
        <div className="flex justify-center py-20 text-(--ink-3)">
          <Spinner className="size-6" />
        </div>
      ) : (
        <>
          <div
            className={`web-rise grid gap-3 ${wide ? "grid-cols-4" : "grid-cols-2"}`}
          >
            <Stat
              tone="amber"
              icon={<CircleAlert className="size-[18px]" />}
              label="Needs you"
              value={overview.needsYou.length}
              caption={
                overview.needsYou.length
                  ? "Waiting for your answer"
                  : "Nothing waiting"
              }
              onClick={() => navigate({ name: "chats", filter: "needsYou" })}
            />
            <Stat
              tone="muted"
              icon={
                <LoaderCircle
                  className={`size-[18px] ${overview.running.length ? "animate-spin" : ""}`}
                />
              }
              label="Running"
              value={overview.running.length}
              caption={
                overview.running.length
                  ? "Agents at work now"
                  : "All agents idle"
              }
              onClick={() => navigate({ name: "chats", filter: "running" })}
            />
            <Stat
              tone="accent"
              icon={<FileDiff className="size-[18px]" />}
              label="To review"
              value={overview.review.length}
              caption={
                changed
                  ? `${plural(changed, "file")} changed`
                  : artifacts
                    ? plural(artifacts, "artifact")
                    : overview.review.length
                      ? "Finished"
                      : "Nothing new"
              }
              onClick={() => navigate({ name: "chats", filter: "review" })}
            />
            <Stat
              tone="muted"
              icon={<Idea className="size-[18px]" />}
              label="Ideas"
              value={cards?.length ?? null}
              caption={fresh ? `+${fresh} this week` : "On your boards"}
              onClick={() => navigate({ name: "ideas" })}
            />
          </div>

          {total === 0 ? (
            <div className="glass rounded-[28px]">
              <Empty title="All quiet">
                No chats are open on your Mac. Start one and follow it from
                here.
                <div className="mt-5">
                  <button
                    className={primaryButton}
                    onClick={() => openSheet({ name: "new" })}
                  >
                    <Plus className="size-4" strokeWidth={2.4} />
                    New chat
                  </button>
                </div>
              </Empty>
            </div>
          ) : (
            <div className={wide ? "@container" : ""}>
              <div
                className={
                  wide
                    ? "grid items-start gap-6 @[700px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
                    : "flex flex-col gap-6"
                }
              >
                <NeedsYou entries={overview.needsYou} now={now} />
                <div className="flex flex-col gap-6">
                  {moving.length ? (
                    <section>
                      <SectionTitle count={moving.length}>
                        In progress
                      </SectionTitle>
                      <div className="flex flex-col gap-3">
                        {moving.map((entry) => (
                          <ChatCard
                            key={entry.sessionId}
                            entry={entry}
                            now={now}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {overview.idle.length ? (
                    <section>
                      <button
                        className="glass web-press flex h-14 w-full items-center gap-3 rounded-[20px] px-4 text-left"
                        aria-expanded={showIdle}
                        onClick={() => setShowIdle((value) => !value)}
                      >
                        <span className="size-2 rounded-full bg-(--tone-muted)" />
                        <span className="flex-1 text-[15px] font-semibold text-(--ink)">
                          Idle
                          <span className="ml-2 font-medium text-(--ink-3)">
                            {overview.idle.length}
                          </span>
                        </span>
                        <ChevronDown
                          className={`size-4 text-(--ink-3) transition-transform ${showIdle ? "rotate-180" : ""}`}
                        />
                      </button>
                      {showIdle ? (
                        <div className="glass web-pop-in mt-2 flex flex-col gap-0.5 rounded-[22px] p-1.5">
                          {overview.idle.map((entry) => (
                            <ChatRow
                              key={entry.sessionId}
                              entry={entry}
                              now={now}
                            />
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  tone,
  icon,
  label,
  value,
  caption,
  onClick,
}: {
  tone: Tone;
  icon: ReactNode;
  label: string;
  value: number | null;
  caption: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="glass web-press flex min-h-[132px] flex-col items-start rounded-[24px] p-4 text-left"
    >
      <span className="flex w-full items-center gap-2.5">
        <IconBadge tone={tone} size="size-8">
          {icon}
        </IconBadge>
        <span className="min-w-0 truncate text-[14px] font-medium text-(--ink)">
          {label}
        </span>
      </span>
      <span
        className={`mt-auto pt-4 text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${value ? "text-(--ink)" : "text-(--ink-3)"}`}
      >
        {value === null ? "–" : String(value).padStart(2, "0")}
      </span>
      <span className="mt-1.5 truncate text-[12px] font-medium text-(--ink-2)">
        {caption}
      </span>
    </button>
  );
}

/** Every open approval and question, answerable right on its card. */
function NeedsYou({ entries, now }: { entries: FleetEntry[]; now: number }) {
  return (
    <section id="needs-you" className="scroll-mt-4">
      <div
        className={`${entries.length ? "attention" : "glass"} rounded-[28px] p-4`}
      >
        <SectionTitle
          count={entries.length || undefined}
          action={
            entries.length > 1 ? (
              <button
                className={`${plainButton} -my-2 -mr-2 h-9 text-[14px]`}
                onClick={() => navigate({ name: "chats", filter: "needsYou" })}
              >
                See all
              </button>
            ) : null
          }
        >
          Needs you
        </SectionTitle>
        {entries.length ? (
          <div className="flex flex-col divide-y divide-(--hairline)">
            {entries.flatMap((entry) =>
              entry.requests.map((request) => (
                <article
                  key={`${entry.sessionId}:${request.requestId}`}
                  className="flex flex-col gap-3.5 py-4 first:pt-1 last:pb-1"
                >
                  <button
                    className="flex w-full items-center gap-3 text-left"
                    onClick={() =>
                      navigate({ name: "chat", id: entry.sessionId })
                    }
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-content/6">
                      <Harness harness={entry.harness} className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-(--ink)">
                        {entry.title}
                      </span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-(--ink-3)" />
                  </button>
                  <div className="grid grid-cols-3 gap-2">
                    <Meta label={entry.irgat ? "Irgat" : "Project"}>
                      {place(entry)}
                    </Meta>
                    <Meta label="Type">
                      <Pill tone="amber">
                        {request.kind === "approval" ? "Approval" : "Question"}
                      </Pill>
                    </Meta>
                    <Meta label="Waiting">{ago(entry.at, now) || "now"}</Meta>
                  </div>
                  <RequestBody sessionId={entry.sessionId} request={request} />
                </article>
              )),
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-[20px] bg-content/4 px-4 py-4">
            <IconBadge tone="emerald">
              <Check className="size-[18px]" />
            </IconBadge>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-(--ink)">
                You're all caught up
              </div>
              <div className="text-[13px] text-(--ink-2)">
                Nothing is waiting on you.
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11.5px] font-medium text-(--ink-3)">{label}</span>
      <span className="min-w-0 truncate text-[14px] font-semibold text-(--ink)">
        {children}
      </span>
    </div>
  );
}
