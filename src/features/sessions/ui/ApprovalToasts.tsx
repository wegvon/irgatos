import { CircleAlert, Clock } from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { allowsProjectNotification } from "../../notifications/model/notificationPreferences";
import { knownNotificationProject } from "../../notifications/model/notificationProjects";
import { useProjectNotificationPreferences } from "../../notifications/hooks/useProjectNotificationPreferences";
import { useDecisionDeferrals } from "../../notifications/hooks/useDecisionDeferrals";
import type { ApprovalDecision } from "../../../integrations/harness";
import type { PendingApprovalNotice } from "../../notifications/model/approvalToast";
import {
  decisionKey,
  decisionPlace,
  decisionUrgency,
  deadlineText,
  formatClock,
  urgencyLabel,
  type DecisionPlace,
  type DecisionUrgency,
} from "../../notifications/model/decisionNotice";
import {
  deferDecision,
  isDecisionDeferred,
  reminderChoices,
} from "../../notifications/model/decisionDeferrals";
import { retireDecisionNotification } from "../../notifications/model/notifications";
import { LAYER } from "../../../shared/lib/layers";
import { HARNESS_TITLE, type Session } from "../model/session";
import { sessionApprovalBrief } from "../model/approvalBrief";
import { ApprovalExplainer } from "./ApprovalExplainer";
import { HarnessIcon } from "./HarnessIcon";

type Notice = PendingApprovalNotice & { session: Session };

/** Cards shown at once; the rest wait behind a link to Fleet. */
export const MAX_VISIBLE_DECISION_CARDS = 3;

type Props = {
  notices: Notice[];
  topOffset?: number;
  onFocusSession: (sessionId: string) => void;
  onApproval: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  /** Fleet lists every pending request, including deferred ones. */
  onOpenFleet?: () => void;
};

type Card = {
  key: string;
  notice: Notice;
  place: DecisionPlace;
  urgency: DecisionUrgency;
  /** Show the worktree too: another card has the same project and chat. */
  showWorkspace: boolean;
};

export function ApprovalToasts({
  notices,
  onFocusSession,
  onApproval,
  onOpenFleet,
  topOffset = 12,
}: Props) {
  useProjectNotificationPreferences();
  const deferrals = useDecisionDeferrals();
  // First time each request was seen. Resuming notifications must not turn a
  // request that arrived while muted into a new popup.
  const firstSeen = useRef(new Map<string, number>());
  const keys = new Set<string>();
  const allowed: Notice[] = [];
  for (const notice of notices) {
    const key = decisionKey(notice.sessionId, notice.kind, notice.requestId);
    keys.add(key);
    let occurredAt = firstSeen.current.get(key);
    if (occurredAt == null) {
      occurredAt = Date.now();
      firstSeen.current.set(key, occurredAt);
    }
    const project = knownNotificationProject(notice.session.cwd);
    if (
      project &&
      allowsProjectNotification({
        projectId: project.id,
        category: "agentInput",
        occurredAt,
      })
    ) {
      allowed.push(notice);
    }
  }
  for (const key of firstSeen.current.keys()) {
    if (!keys.has(key)) firstSeen.current.delete(key);
  }

  const now = useClock(
    allowed.some(
      (notice) =>
        notice.kind === "question" &&
        notice.session.pendingQuestion?.autoResolveAt != null,
    ),
  );
  let deferred = 0;
  const cards: Card[] = [];
  for (const notice of allowed) {
    const key = decisionKey(notice.sessionId, notice.kind, notice.requestId);
    if (isDecisionDeferred(deferrals[key], now)) {
      deferred++;
      continue;
    }
    cards.push({
      key,
      notice,
      place: decisionPlace(notice.session),
      urgency: decisionUrgency(
        notice.kind,
        notice.kind === "question" ? notice.session.pendingQuestion : undefined,
      ),
      showWorkspace: false,
    });
  }
  const visible = cards.slice(0, MAX_VISIBLE_DECISION_CARDS);
  for (const card of visible) {
    card.showWorkspace =
      !!card.place.workspace ||
      visible.some(
        (other) =>
          other !== card &&
          other.place.project === card.place.project &&
          other.place.task === card.place.task,
      );
  }
  const more = cards.length - visible.length;
  if (visible.length === 0 && more === 0) return null;

  return createPortal(
    // Scrolls rather than running off the bottom of a short window.
    <div
      aria-live="polite"
      style={{
        zIndex: LAYER.toast,
        top: topOffset,
        maxHeight: `calc(100vh - ${topOffset + 12}px)`,
      }}
      className="fixed right-3 flex w-[min(360px,calc(100vw-24px))] flex-col gap-2 overflow-y-auto overscroll-contain"
    >
      {visible.map((card) => (
        <ApprovalToastCard
          key={card.key}
          card={card}
          now={now}
          onFocusSession={onFocusSession}
          onApproval={onApproval}
        />
      ))}
      {more > 0 ? (
        <button
          type="button"
          data-decision-overflow
          onClick={onOpenFleet}
          disabled={!onOpenFleet}
          className="sticky bottom-0 shrink-0 self-end rounded-full border border-content/15 bg-background-base/90 px-3 py-1 text-[12px] font-medium text-content/80 shadow-lg backdrop-blur-xl enabled:hover:bg-content/10 enabled:hover:text-content"
        >
          {more === 1 ? "1 more request" : `${more} more requests`}
          {deferred > 0 ? ` · ${deferred} deferred` : ""}
          {onOpenFleet ? " in Fleet" : ""}
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

/** Ticks each second while a deadline counts down, otherwise twice a minute. */
function useClock(countingDown: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Date.now()),
      countingDown ? 1000 : 30_000,
    );
    return () => window.clearInterval(timer);
  }, [countingDown]);
  return now;
}

function ApprovalToastCard({
  card,
  now,
  onFocusSession,
  onApproval,
}: {
  card: Card;
  now: number;
  onFocusSession: (sessionId: string) => void;
  onApproval: Props["onApproval"];
}) {
  const { notice, place, urgency, key } = card;
  const { session, label, requestId } = notice;
  const harness = HARNESS_TITLE[session.harness];
  const brief =
    notice.kind === "approval" && notice.block
      ? sessionApprovalBrief(session, notice.block)
      : undefined;
  const [deferOpen, setDeferOpen] = useState(false);

  const openSession = () => onFocusSession(session.id);
  const defer = (remindAt: number | null) => {
    retireDecisionNotification(key);
    deferDecision(key, remindAt);
  };

  return (
    <article
      className="approval-toast shrink-0 overflow-hidden rounded-xl border border-content/20 border-dashed bg-content/10 shadow-xl backdrop-blur-xl"
      role="status"
      data-decision={urgency.blocking ? "blocking" : "optional"}
    >
      <button
        type="button"
        onClick={openSession}
        className="flex w-full flex-col gap-1.5 px-3.5 py-3 text-left hover:bg-content/5"
      >
        <span className="flex min-w-0 items-center gap-2" title={harness}>
          <HarnessIcon harness={session.harness} className="size-4 shrink-0" />
          <span
            className="min-w-0 flex-1 truncate text-[11px] font-medium text-content/55"
            title={`${place.project}${place.workspace ? ` (${place.workspace})` : ""}`}
          >
            {place.project}
            {card.showWorkspace && place.workspace ? (
              <span className="text-content/40"> · {place.workspace}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-[11px] text-content/40">
            {notice.kind === "question" ? "Your decision" : "Permission"}
          </span>
        </span>
        <span className="min-w-0 truncate text-[13px] font-semibold leading-snug text-content">
          {place.task}
        </span>
        <UrgencyLine urgency={urgency} now={now} />
        <span className="line-clamp-3 text-[12px] leading-relaxed text-content/70">
          {brief?.what ?? label}
        </span>
        {brief ? (
          <ApprovalExplainer
            brief={brief}
            showWhat={false}
            showTechnical={false}
            className="text-[11.5px]"
          />
        ) : null}
      </button>
      <div className="flex gap-2 border-t border-stroke px-3.5 py-2.5">
        {notice.kind === "question" ? (
          <button
            type="button"
            className="flex-1 rounded-md bg-content px-2.5 py-1 text-[11px] font-medium text-background-base hover:bg-content/80"
            onClick={openSession}
          >
            Answer
          </button>
        ) : (
          <>
            <button
              type="button"
              className="flex-1 rounded-md bg-content px-2.5 py-1 text-[11px] font-medium text-background-base hover:bg-content/80"
              onClick={() => onApproval(session.id, requestId, "allow")}
            >
              Allow
            </button>
            <button
              type="button"
              className="flex-1 rounded-md bg-content/10 px-2.5 py-1 text-[11px] font-medium text-content/70 hover:bg-content/20"
              onClick={() => onApproval(session.id, requestId, "deny")}
            >
              Deny
            </button>
          </>
        )}
        <button
          type="button"
          aria-expanded={deferOpen}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium hover:bg-content/20 ${deferOpen ? "bg-content/20 text-content" : "bg-content/5 text-content/60"}`}
          onClick={() => setDeferOpen((open) => !open)}
        >
          Later
        </button>
      </div>
      {deferOpen ? (
        <DeferPanel urgency={urgency} now={now} onDefer={defer} />
      ) : null}
    </article>
  );
}

function UrgencyLine({
  urgency,
  now,
}: {
  urgency: DecisionUrgency;
  now: number;
}) {
  if (urgency.blocking) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400">
        <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span>{urgencyLabel(urgency)}</span>
      </span>
    );
  }
  return (
    <span className="flex items-start gap-1 text-[11px] text-content/55">
      <Clock className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
      <span>
        {urgencyLabel(urgency)}{" "}
        <span className="tabular-nums text-content/70">
          {deadlineText(urgency.deadline, now)}
        </span>
      </span>
    </span>
  );
}

/**
 * Putting a request off answers nothing. The panel says what keeps going:
 * a waiting agent stays blocked, and a timed question keeps its deadline.
 */
function DeferPanel({
  urgency,
  now,
  onDefer,
}: {
  urgency: DecisionUrgency;
  now: number;
  onDefer: (remindAt: number | null) => void;
}) {
  const choices = reminderChoices(
    urgency.blocking ? undefined : urgency.deadline,
    now,
  );
  return (
    <div
      data-decision-defer
      className="flex flex-col gap-2 border-t border-stroke px-3.5 py-2.5"
    >
      <p className="text-[11px] leading-relaxed text-content/60">
        {urgency.blocking
          ? "Nothing is answered. The agent stays blocked until you decide; the request waits in Fleet."
          : `Nothing is answered. The deadline stays at ${formatClock(urgency.deadline)}: after it the agent continues without your answer.`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            className="rounded-md bg-content/10 px-2 py-1 text-[11px] text-content/75 hover:bg-content/20 hover:text-content"
            onClick={() => onDefer(choice.remindAt)}
          >
            {choice.label}
          </button>
        ))}
        <button
          type="button"
          className="rounded-md bg-content/10 px-2 py-1 text-[11px] text-content/75 hover:bg-content/20 hover:text-content"
          onClick={() => onDefer(null)}
        >
          Later, no reminder
        </button>
      </div>
    </div>
  );
}
