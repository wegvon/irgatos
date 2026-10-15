import type { ReactNode } from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import { formatInteger } from "../../../shared/lib/numbers";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  File,
  FileDiff,
  MessageMultiple,
  Plus,
  type IconComponent,
} from "../../../shared/ui/icons";
import type { ArtifactCard } from "../../artifacts/artifacts";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import type { IrgatSpawnedSession, Session } from "../../sessions/model/session";
import type { SessionChangeTotals } from "../../sessions/ui/SessionReview";
import type { IrgatLook } from "../model/irgat";
import { HABITS_MAX, type Habit } from "../model/irgatHabits";
import {
  habitsByRecent,
  newestFirst,
  nextPageSize,
  overviewPage,
  type OverviewLimits,
  type OverviewSectionId,
} from "../model/overviewSections";
import { DocumentRow } from "./DocumentRow";
import { HabitRow, type HabitActions } from "./IrgatHabits";
import { IrgatSessionList, type IrgatSessionActions } from "./IrgatSessionList";

export type OverviewAllTab = "sessions" | "documents" | "habits" | "changes";

/**
 * Everything the Irgat has going on in one scroll: the newest of each kind,
 * a page at a time, with a way into each kind's own tab.
 */
export function IrgatOverviewAll({
  agent,
  launches,
  sessions,
  history,
  documents,
  habits,
  habitsError,
  onRetryHabits,
  habitActions,
  changes,
  limits,
  onShowMore,
  onOpenSession,
  sessionActions,
  onOpenDocument,
  onOpenHabit,
  onNewHabit,
  onOpenTab,
}: {
  agent: IrgatLook;
  /** Every session it has started, oldest first. */
  launches: readonly IrgatSpawnedSession[];
  sessions: readonly Session[];
  history?: readonly SessionSummary[];
  /** Documents it has written, oldest first. */
  documents: readonly ArtifactCard[];
  /** Undefined until first read. */
  habits: Habit[] | undefined;
  habitsError: boolean;
  onRetryHabits: () => void;
  habitActions: HabitActions;
  /** Undefined hides the section; null is a conversation without changes. */
  changes?: SessionChangeTotals | null;
  limits: OverviewLimits;
  onShowMore: (section: OverviewSectionId) => void;
  onOpenSession: (sessionId: string) => void | Promise<void>;
  sessionActions?: IrgatSessionActions;
  onOpenDocument: (id: string) => void;
  onOpenHabit: (id: string) => void;
  onNewHabit: () => void;
  onOpenTab: (tab: OverviewAllTab) => void;
}) {
  const sessionPage = overviewPage(newestFirst(launches), limits.sessions);
  const documentPage = overviewPage(newestFirst(documents), limits.documents);
  const habitPage = overviewPage(habitsByRecent(habits ?? []), limits.habits);
  const habitsFull = !habits || habits.length >= HABITS_MAX;
  return (
    <div className="@container" data-overview-all>
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 @2xl:grid-cols-2">
        <OverviewSection
          id="sessions"
          title="Sessions"
          icon={MessageMultiple}
          count={launches.length}
          onViewAll={() => onOpenTab("sessions")}
        >
          {launches.length ? (
            <>
              {/* Only the cards on show look up their saved status. */}
              <div className="-mx-0.5">
                <IrgatSessionList
                  agent={agent}
                  launches={sessionPage.shown}
                  sessions={sessions}
                  history={history}
                  onOpenSession={onOpenSession}
                  actions={sessionActions}
                />
              </div>
              <ShowMore
                section="sessions"
                shown={sessionPage.shown.length}
                remaining={sessionPage.remaining}
                onShowMore={onShowMore}
              />
            </>
          ) : (
            <SectionNote>
              Sessions {agent.name} starts on your projects show up here.
            </SectionNote>
          )}
        </OverviewSection>
        <OverviewSection
          id="documents"
          title="Documents"
          icon={File}
          count={documents.length}
          onViewAll={() => onOpenTab("documents")}
        >
          {documents.length ? (
            <>
              <ul className="flex flex-col gap-px">
                {documentPage.shown.map((card) => (
                  <li key={card.id}>
                    <DocumentRow card={card} onOpen={onOpenDocument} />
                  </li>
                ))}
              </ul>
              <ShowMore
                section="documents"
                shown={documentPage.shown.length}
                remaining={documentPage.remaining}
                onShowMore={onShowMore}
              />
            </>
          ) : (
            <SectionNote>
              Plans, summaries and reports {agent.name} writes show up here.
            </SectionNote>
          )}
        </OverviewSection>
        <OverviewSection
          id="habits"
          title="Habits"
          icon={Clock}
          count={habits?.length}
          onViewAll={() => onOpenTab("habits")}
          action={
            <IconButton
              label={
                habits && habits.length >= HABITS_MAX
                  ? `At most ${HABITS_MAX} habits`
                  : "New habit"
              }
              disabled={habitsFull}
              onClick={onNewHabit}
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          }
        >
          {habitsError && !habits ? (
            <div
              role="alert"
              className="flex items-center gap-2 px-2 py-3 text-[12px] text-content/55"
            >
              <span className="min-w-0 flex-1">Could not read the habits.</span>
              <button
                type="button"
                onClick={onRetryHabits}
                className="rounded px-1.5 py-0.5 text-[11px] text-content/70 hover:bg-content/8 hover:text-content"
              >
                Try again
              </button>
            </div>
          ) : !habits ? (
            <SectionLoading label="Loading habits" />
          ) : habits.length ? (
            <>
              <ul className="flex flex-col gap-px">
                {habitPage.shown.map((habit) => (
                  <HabitRow
                    key={habit.id}
                    habit={habit}
                    actions={habitActions}
                    onOpen={() => onOpenHabit(habit.id)}
                  />
                ))}
              </ul>
              <ShowMore
                section="habits"
                shown={habitPage.shown.length}
                remaining={habitPage.remaining}
                onShowMore={onShowMore}
              />
            </>
          ) : (
            <SectionNote>
              Recurring work {agent.name} runs on a schedule shows up here.
            </SectionNote>
          )}
        </OverviewSection>
        {changes !== undefined ? (
          <OverviewSection
            id="changes"
            title="Changes"
            icon={FileDiff}
            count={changes?.files}
            onViewAll={() => onOpenTab("changes")}
          >
            {changes ? (
              <button
                type="button"
                onClick={() => onOpenTab("changes")}
                data-overview-changes
                className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-content/5"
              >
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-md bg-content/6 text-content/60"
                >
                  <FileDiff className="size-3.5" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] leading-5 text-content/85">
                    {changes.files} {changes.files === 1 ? "file" : "files"}{" "}
                    changed
                  </span>
                  <span className="flex gap-1.5 text-[11px] font-semibold leading-4 tabular-nums">
                    <span className="text-diff-add-fg">
                      +{formatInteger(changes.additions)}
                    </span>
                    <span className="text-diff-del-fg">
                      -{formatInteger(changes.deletions)}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-content/45">
                  Review
                </span>
              </button>
            ) : (
              <SectionNote>
                Files {agent.name} changes in this conversation show up here,
                ready to review and commit.
              </SectionNote>
            )}
          </OverviewSection>
        ) : null}
      </div>
    </div>
  );
}

function OverviewSection({
  id,
  title,
  icon: Icon,
  count,
  action,
  onViewAll,
  children,
}: {
  id: OverviewSectionId | "changes";
  title: string;
  icon: IconComponent;
  /** Undefined while it is not known yet. */
  count: number | undefined;
  action?: ReactNode;
  onViewAll: () => void;
  children: ReactNode;
}) {
  const headingId = `overview-section-${id}`;
  return (
    <section
      aria-labelledby={headingId}
      data-overview-section={id}
      className="flex min-w-0 flex-col gap-1"
    >
      <div className="flex h-7 items-center gap-1 pl-2 pr-0.5">
        <Icon
          aria-hidden
          className="size-3.5 shrink-0 text-content/40"
          strokeWidth={1.75}
        />
        <h4
          id={headingId}
          className="min-w-0 flex-1 truncate pl-1 text-[11px] font-medium uppercase tracking-wide text-content/40"
        >
          {title}
          {count != null ? (
            <span
              className="ml-1.5 tabular-nums text-content/30"
              data-overview-count
            >
              {count}
            </span>
          ) : null}
        </h4>
        {action}
        <button
          type="button"
          onClick={onViewAll}
          aria-label={`View all ${title.toLowerCase()}`}
          className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[11px] text-content/45 hover:bg-content/8 hover:text-content"
        >
          View all
          <ChevronRight className="size-3" strokeWidth={1.75} />
        </button>
      </div>
      {children}
    </section>
  );
}

/** The next page of one section, and how far into it the list is. */
function ShowMore({
  section,
  shown,
  remaining,
  onShowMore,
}: {
  section: OverviewSectionId;
  shown: number;
  remaining: number;
  onShowMore: (section: OverviewSectionId) => void;
}) {
  if (remaining <= 0) return null;
  return (
    <button
      type="button"
      data-overview-more={section}
      onClick={() => onShowMore(section)}
      className="flex h-7 w-full items-center justify-center gap-1 rounded-md text-[11px] text-content/50 hover:bg-content/5 hover:text-content"
    >
      <ChevronDown className="size-3" strokeWidth={1.75} />
      Show {nextPageSize(remaining)} more
      <span className="tabular-nums text-content/30">
        · {shown} of {shown + remaining}
      </span>
    </button>
  );
}

function SectionNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-3 text-[12px] leading-4.5 text-content/45">
      {children}
    </p>
  );
}

function SectionLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy
      className="flex flex-col gap-1 px-2 py-1"
    >
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="h-9 rounded-md bg-content/5 motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}
