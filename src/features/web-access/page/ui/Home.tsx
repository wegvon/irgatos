import type { ReactNode } from "react";
import type { FleetEntry, FleetRequest } from "../../../fleet/model/fleet";
import type { WebOverview } from "../../model/protocol";
import { ago } from "../format";
import { navigate } from "../route";
import { ChatRow, place } from "./ChatRow";
import { NewChat } from "./NewChat";
import { RequestBody } from "./Requests";
import { Harness, Pill } from "./parts";
import { ChevronRight } from "../../../../shared/ui/icons";

/**
 * The phone's start screen, chat first: the composer at the bottom, and
 * above it whatever waits on you (answerable in place), then what is
 * running or ready to review. With nothing open it is just the greeting.
 */
export function Home({
  overview,
  now,
  header,
}: {
  overview: WebOverview | null;
  now: number;
  header: ReactNode;
}) {
  const stopped = overview?.interrupted ?? [];
  const running = overview?.running ?? [];
  const review = overview?.review ?? [];
  const needsYou = overview?.needsYou ?? [];
  const busy =
    needsYou.length + stopped.length + running.length + review.length > 0;

  return (
    <NewChat owner={overview?.owner} header={header} inline>
      {busy ? (
        <div className="flex flex-col gap-1 px-3 pb-4 pt-1">
          {needsYou.length ? (
            <section id="needs-you" className="flex flex-col gap-2">
              <Group count={needsYou.length} dot>
                Needs you
              </Group>
              {needsYou.flatMap((entry) =>
                entry.requests.map((request) => (
                  <Waiting
                    key={`${entry.sessionId}:${request.requestId}`}
                    entry={entry}
                    request={request}
                    now={now}
                  />
                )),
              )}
            </section>
          ) : null}
          {stopped.length ? (
            <section>
              <Group count={stopped.length}>Stopped</Group>
              {stopped.map((entry) => (
                <ChatRow key={entry.sessionId} entry={entry} now={now} />
              ))}
            </section>
          ) : null}
          {running.length ? (
            <section>
              <Group count={running.length}>Running</Group>
              {running.map((entry) => (
                <ChatRow key={entry.sessionId} entry={entry} now={now} />
              ))}
            </section>
          ) : null}
          {review.length ? (
            <section>
              <Group count={review.length}>Ready to review</Group>
              {review.map((entry) => (
                <ChatRow key={entry.sessionId} entry={entry} now={now} />
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
    </NewChat>
  );
}

function Group({
  count,
  dot = false,
  children,
}: {
  count: number;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 px-3 pb-1 pt-4 text-[13px] font-semibold uppercase tracking-[0.05em] text-(--ink-3)">
      {dot ? <span className="size-2 rounded-full bg-(--tone-amber)" /> : null}
      {children}
      <span className="tabular-nums">· {count}</span>
    </h2>
  );
}

/** One approval or question, with the chat it belongs to as its title. */
function Waiting({
  entry,
  request,
  now,
}: {
  entry: FleetEntry;
  request: FleetRequest;
  now: number;
}) {
  return (
    <article className="attention web-rise flex flex-col gap-3 rounded-[22px] p-4">
      <button
        className="flex w-full flex-col gap-1.5 text-left"
        onClick={() => navigate({ name: "chat", id: entry.sessionId })}
      >
        <span className="flex w-full items-center gap-2 text-[13.5px] text-(--ink-2)">
          <Pill tone="amber">
            {request.kind === "approval" ? "Permission" : "Your decision"}
          </Pill>
          <Harness harness={entry.harness} className="size-3.5" />
          <span className="min-w-0 truncate font-medium">{place(entry)}</span>
          <span className="ml-auto shrink-0 tabular-nums text-(--ink-3)">
            {ago(entry.at, now) || "now"}
          </span>
          <ChevronRight className="size-4 shrink-0 text-(--ink-3)" />
        </span>
        <span className="line-clamp-2 text-[16.5px] font-semibold leading-snug tracking-[-0.01em] text-(--ink)">
          {entry.title}
        </span>
      </button>
      <RequestBody sessionId={entry.sessionId} request={request} />
    </article>
  );
}
