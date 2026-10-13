import { useEffect, useState } from "react";
import { LAYER } from "../../../shared/lib/layers";
import { Play, X } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { listSessionsByProject } from "../../sessions/data/sessionStore";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  CARD_SESSION_LABEL,
  cardSessionView,
  type CardSessionState,
  type CardSessionView,
  type LiveCardSession,
} from "../model/cardSession";
import type { KanbanCard } from "../model/kanban";
import { formatCardTime } from "./cardTime";

const TONE: Record<CardSessionState, { chip: string; dot: string }> = {
  running: { chip: "bg-accent/12 text-accent", dot: "animate-pulse bg-accent" },
  "needs-input": { chip: "bg-amber-500/12 text-amber-400", dot: "bg-amber-400" },
  finished: { chip: "bg-emerald-500/12 text-emerald-400", dot: "bg-emerald-400" },
  failed: { chip: "bg-red-500/12 text-red-400", dot: "bg-red-400" },
  stopped: { chip: "bg-content/8 text-content/55", dot: "bg-content/40" },
  interrupted: { chip: "bg-content/8 text-content/55", dot: "bg-amber-400/70" },
  draft: { chip: "bg-content/8 text-content/50", dot: "bg-content/30" },
  missing: { chip: "bg-content/5 text-content/40", dot: "bg-content/20" },
};

export function SessionStateBadge({
  view,
  className = "",
}: {
  view: CardSessionView;
  className?: string;
}) {
  const tone = TONE[view.state];
  return (
    <span
      data-card-session-state={view.state}
      className={`inline-flex h-4.5 shrink-0 items-center gap-1 rounded px-1.5 text-[10.5px] font-medium ${tone.chip} ${className}`}
    >
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} />
      {CARD_SESSION_LABEL[view.state]}
    </span>
  );
}

/** The card's session state, which opens the session when clicked. */
export function SessionChip({
  card,
  live,
  onOpen,
}: {
  card: KanbanCard;
  live: LiveCardSession | undefined;
  onOpen?: (sessionId: string) => void;
}) {
  if (!card.session) return null;
  const view = cardSessionView(card.session, live);
  const sessionId = card.session.id;
  const canOpen = !!onOpen && view.state !== "missing";
  return (
    <button
      type="button"
      tabIndex={-1}
      data-no-drag
      disabled={!canOpen}
      title={canOpen ? `Open session: ${view.title}` : view.title}
      aria-label={`${CARD_SESSION_LABEL[view.state]} session${canOpen ? ", open it" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        if (canOpen) onOpen(sessionId);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="inline-flex min-w-0 items-center gap-1 rounded hover:brightness-125 disabled:cursor-default"
    >
      {view.harness ? (
        <HarnessIcon harness={view.harness} className="size-3 shrink-0 text-content/55" />
      ) : null}
      <SessionStateBadge view={view} />
    </button>
  );
}

type Choice = { id: string; title: string; updatedAt: number };

export function CardSessionSection({
  card,
  project,
  live,
  onStart,
  onOpen,
  onLink,
}: {
  card: KanbanCard;
  project: string;
  live: LiveCardSession | undefined;
  onStart?: () => void;
  onOpen?: (sessionId: string) => void;
  onLink: (session: { id: string; title: string } | null) => void;
}) {
  const link = card.session;
  const view = link ? cardSessionView(link, live) : null;
  return (
    <section
      aria-label="Session"
      data-card-session
      className="flex flex-col gap-2 rounded-lg border border-content/10 px-3 py-2.5"
    >
      <span className="text-[11px] text-content/45">Session</span>
      {link && view ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            {view.harness ? (
              <HarnessIcon harness={view.harness} className="size-3.5 shrink-0 text-content/60" />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[13px] text-content/90" title={view.title}>
              {view.state === "missing" ? "Linked session is unavailable" : view.title}
            </span>
            <SessionStateBadge view={view} />
            {view.state !== "missing" && onOpen ? (
              <SecondaryButton onClick={() => onOpen(link.id)}>Open session</SecondaryButton>
            ) : null}
            <button
              type="button"
              title="Unlink session"
              aria-label="Unlink session"
              onClick={() => onLink(null)}
              className="grid size-6 shrink-0 place-items-center rounded-md text-content/40 hover:bg-content/10 hover:text-content"
            >
              <X className="size-3" strokeWidth={1.75} />
            </button>
          </div>
          {view.state === "missing" ? (
            <div className="flex items-center gap-2 text-[12px] text-content/50">
              <span className="min-w-0 flex-1">
                It was never sent, or it has been deleted.
              </span>
              {onStart ? <StartButton onStart={onStart} label="Start a new one" /> : null}
            </div>
          ) : view.state === "interrupted" ? (
            <p className="text-[12px] text-content/50">
              It was still working when Irgat last closed. Open it to pick up where it stopped.
            </p>
          ) : null}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-[12px] text-content/50">
            Start an agent on this card, or link a session you already have.
          </span>
          {onStart ? <StartButton onStart={onStart} label="Start session" /> : null}
          <LinkExisting project={project} onLink={onLink} />
        </div>
      )}
    </section>
  );
}

function StartButton({ onStart, label }: { onStart: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-md bg-content px-2.5 text-[12px] font-medium text-background-base hover:bg-content/80"
    >
      <Play className="size-3" strokeWidth={2} />
      {label}
    </button>
  );
}

function LinkExisting({
  project,
  onLink,
}: {
  project: string;
  onLink: (session: { id: string; title: string }) => void;
}) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listSessionsByProject(project)
      .then((rows) => {
        if (cancelled) return;
        setChoices(
          rows
            .filter((row) => !row.sidebarHidden && !row.orchestrationLeadId && !row.archived)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt })),
        );
      })
      .catch(() => {
        if (!cancelled) setChoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project]);
  return (
    <SearchableSelect
      label="Link existing session"
      value=""
      placeholder={choices === null ? "Loading sessions…" : "Link existing…"}
      searchPlaceholder="Find a session"
      emptyLabel="No saved sessions in this project yet"
      disabled={choices === null}
      layer={LAYER.dialogPopover}
      variant="pill"
      align="end"
      options={(choices ?? []).map((choice) => ({
        value: choice.id,
        label: `${choice.title} · ${formatCardTime(choice.updatedAt)}`,
        keywords: choice.title,
      }))}
      onChange={(id) => {
        const choice = choices?.find((item) => item.id === id);
        if (choice) onLink({ id: choice.id, title: choice.title });
      }}
    />
  );
}
