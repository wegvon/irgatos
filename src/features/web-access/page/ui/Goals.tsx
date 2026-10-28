import { useState, type ReactNode } from "react";
import type { WebGoal, WebGoalItem, WebGoals } from "../../model/protocol";
import { read, usePoll, write } from "../client";
import { ago } from "../format";
import { navigate } from "../route";
import { Markdown } from "./Markdown";
import { RequestBody } from "./Requests";
import {
  Empty,
  Pill,
  SectionTitle,
  Spinner,
  plainButton,
  primaryButton,
  secondaryButton,
  useAction,
  type Tone,
} from "./parts";
import { ChevronDown, ChevronRight, CircleDot } from "../../../../shared/ui/icons";

type GoalState = WebGoal["state"];

const STATE_TONE: Record<GoalState, Tone> = {
  needsYou: "amber",
  interrupted: "rose",
  failed: "rose",
  working: "muted",
  review: "accent",
  idle: "muted",
  done: "emerald",
};

/** As on the desktop: what needs you first, finished goals folded away. */
const SECTIONS: { id: string; label: string; states: GoalState[] }[] = [
  { id: "attention", label: "Needs you", states: ["needsYou", "interrupted", "failed"] },
  { id: "working", label: "Working", states: ["working"] },
  { id: "review", label: "Ready to review", states: ["review"] },
  { id: "idle", label: "Idle", states: ["idle"] },
  { id: "done", label: "Done", states: ["done"] },
];

const VERDICT: Record<string, { mark: string; className: string; label: string }> = {
  met: { mark: "✓", className: "text-(--ok)", label: "Met" },
  unmet: { mark: "✗", className: "text-(--bad)", label: "Not met" },
  unverified: { mark: "?", className: "text-(--tone-amber)", label: "Not verified" },
};

const CHECK: Record<string, { mark: string; className: string }> = {
  passed: { mark: "✓", className: "text-(--ok)" },
  failed: { mark: "✗", className: "text-(--bad)" },
  running: { mark: "…", className: "text-(--ink-3)" },
};

function criteriaLine(goal: WebGoal): string | undefined {
  if (!goal.criteria.some((criterion) => criterion.verdict)) return undefined;
  const met = goal.criteria.filter((criterion) => criterion.verdict === "met").length;
  return `${met} of ${goal.criteria.length} criteria met`;
}

/**
 * The desktop's Goals on the phone: every request as one card with where it
 * stands, the decisions waiting on you (answered in place), what stopped and
 * how to pick it up, and the delivered result to review.
 */
export function Goals({
  header,
  wide,
  now,
}: {
  header: ReactNode;
  wide: boolean;
  now: number;
}) {
  const { data } = usePoll(
    "goals",
    () => read<WebGoals>("goals"),
    (current) =>
      current?.goals.some((goal) => goal.state === "working" || goal.state === "needsYou")
        ? 3000
        : 8000,
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(["idle", "done"]));
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-5 ${wide ? "max-w-[820px] px-8 pb-12 pt-[calc(var(--safe-top)+22px)]" : "px-4 pb-8 pt-[calc(var(--safe-top)+10px)]"}`}
    >
      <header className="flex flex-col gap-4">
        <div className="flex h-10 items-center justify-between gap-3">{header}</div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
          Goals
        </h1>
      </header>
      {!data ? (
        <div className="flex justify-center py-20 text-(--ink-3)">
          <Spinner className="size-6" />
        </div>
      ) : data.goals.length === 0 ? (
        <div className="glass rounded-[28px]">
          <Empty
            icon={
              <span className="flex size-16 items-center justify-center rounded-2xl bg-content/6 text-(--ink-3)">
                <CircleDot className="size-8" />
              </span>
            }
            title="No goals yet"
          >
            Every request you start becomes a goal here. Its chats, the agents
            working on it and their results stay together.
          </Empty>
        </div>
      ) : (
        SECTIONS.map((section) => {
          const goals = data.goals.filter((goal) => section.states.includes(goal.state));
          if (!goals.length) return null;
          const open = !collapsed.has(section.id);
          return (
            <section key={section.id} data-goal-section={section.id}>
              <SectionTitle
                count={goals.length}
                action={
                  <button
                    aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Show"} ${section.label}`}
                    onClick={() => toggle(section.id)}
                    className="web-press flex size-8 items-center justify-center rounded-full text-(--ink-3)"
                  >
                    {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>
                }
              >
                {section.label}
              </SectionTitle>
              {open ? (
                <div className="flex flex-col gap-3">
                  {goals.map((goal) => (
                    <GoalCard key={goal.id} goal={goal} now={now} />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}

function GoalCard({ goal, now }: { goal: WebGoal; now: number }) {
  const [open, setOpen] = useState(false);
  const { busy, run } = useAction();
  const criteria = criteriaLine(goal);
  const meta = [
    goal.progress,
    criteria,
    goal.files ? `${goal.files} ${goal.files === 1 ? "file" : "files"}` : "",
    goal.agents ? `${goal.chats} chat · ${goal.agents} ${goal.agents === 1 ? "agent" : "agents"}` : "",
  ].filter(Boolean);
  const review = goal.state === "review";
  return (
    <article
      data-goal={goal.id}
      className={`${goal.requests.length ? "attention" : "glass"} web-rise flex flex-col gap-3 rounded-[22px] p-4`}
    >
      <button
        className="flex w-full flex-col gap-1.5 text-left"
        onClick={() => (goal.sessionId ? navigate({ name: "chat", id: goal.sessionId }) : setOpen(!open))}
      >
        <span className="flex w-full items-center gap-2 text-[13.5px] text-(--ink-2)">
          <Pill tone={STATE_TONE[goal.state]} live={goal.state === "working"}>
            {goal.stateLabel}
          </Pill>
          <span className="min-w-0 truncate font-medium">
            {goal.project}
            {goal.branch ? ` · ${goal.branch}` : ""}
          </span>
          <span className="ml-auto shrink-0 tabular-nums text-(--ink-3)">{ago(goal.at, now)}</span>
          {goal.sessionId ? <ChevronRight className="size-4 shrink-0 text-(--ink-3)" /> : null}
        </span>
        <span className="line-clamp-2 text-[16.5px] font-semibold leading-snug tracking-[-0.01em] text-(--ink)">
          {goal.title}
        </span>
        {meta.length ? <span className="text-[13.5px] text-(--ink-2)">{meta.join(" · ")}</span> : null}
        {goal.activity && goal.state === "working" ? (
          <span className="web-shimmer truncate text-[13.5px] font-medium">{goal.activity}</span>
        ) : null}
      </button>

      {goal.requests.map((entry) => (
        <div key={`${entry.sessionId}:${entry.request.requestId}`} className="flex flex-col gap-2 border-t border-(--hairline) pt-3">
          <span className="text-[12.5px] font-medium text-(--ink-3)">
            {entry.request.kind === "question" ? "Your decision" : "Permission"} · {entry.sessionTitle}
          </span>
          <RequestBody sessionId={entry.sessionId} request={entry.request} />
        </div>
      ))}

      {goal.recovery ? (
        <div className="flex flex-col gap-2 border-t border-(--hairline) pt-3" data-goal-recovery>
          <Lines label="Done" items={goal.recovery.done} />
          <Lines label="Kept" items={goal.recovery.kept} />
          <Lines label="Left" items={goal.recovery.left} />
          <p className="text-[14px] leading-snug text-(--ink)">{goal.recovery.next}</p>
          <button
            className={primaryButton}
            disabled={busy !== null}
            onClick={() =>
              void run(
                "resume",
                () =>
                  write("goalResume", {
                    sessionId: goal.recovery!.sessionId,
                    cause: goal.recovery!.cause,
                  }),
                "Resumed on the Mac",
              )
            }
          >
            {busy === "resume" ? <Spinner /> : null}
            Resume
          </button>
        </div>
      ) : null}

      <button
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`${review && !open ? secondaryButton : plainButton} self-start`}
      >
        {open ? "Hide details" : review ? "Review" : "Details"}
      </button>
      {open ? <GoalDetail goal={goal} /> : null}
    </article>
  );
}

function Lines({ label, items }: { label: string; items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex gap-3 text-[14px] leading-snug">
      <span className="w-10 shrink-0 text-(--ink-3)">{label}</span>
      <span className="min-w-0 text-(--ink-2)">{items.join(" · ")}</span>
    </div>
  );
}

function Detail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-(--ink-3)">{title}</h3>
      {children}
    </section>
  );
}

function ItemList({ items, tone }: { items: readonly WebGoalItem[]; tone?: string }) {
  return (
    <ul className="flex flex-col gap-1 text-[14.5px] leading-snug">
      {items.map((item, index) => (
        <li key={`${item.text}:${index}`} className="flex flex-col">
          <span className={tone ?? "text-(--ink)"}>
            {item.active ? <span className="web-shimmer font-medium">{item.text}</span> : item.text}
          </span>
          {item.detail ? <span className="text-[13px] text-(--ink-3)">{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** What the card unfolds: the delivered result first, then where it stands. */
function GoalDetail({ goal }: { goal: WebGoal }) {
  const { busy, run } = useAction();
  const result = goal.result;
  return (
    <div className="flex flex-col gap-4 border-t border-(--hairline) pt-3" data-goal-detail>
      {result?.summary ? (
        <Detail title="Delivered">
          <div className="text-[15px]">
            <Markdown text={result.summary} />
          </div>
        </Detail>
      ) : null}
      {goal.criteria.length ? (
        <Detail title="Done when">
          <ul className="flex flex-col gap-1 text-[14.5px] leading-snug">
            {goal.criteria.map((criterion) => {
              const verdict = criterion.verdict ? VERDICT[criterion.verdict] : undefined;
              return (
                <li key={criterion.text} className="flex gap-2">
                  <span
                    aria-label={verdict?.label ?? "Not checked yet"}
                    className={`w-4 shrink-0 text-center ${verdict?.className ?? "text-(--ink-3)"}`}
                  >
                    {verdict?.mark ?? "·"}
                  </span>
                  <span className="text-(--ink)">{criterion.text}</span>
                </li>
              );
            })}
          </ul>
        </Detail>
      ) : null}
      {result?.checks.length ? (
        <Detail title="Checks">
          <ul className="flex flex-col gap-1 text-[14.5px]">
            {result.checks.map((check) => (
              <li key={check.label} className="flex gap-2">
                <span className={`w-4 shrink-0 text-center ${CHECK[check.state].className}`}>
                  {CHECK[check.state].mark}
                </span>
                <span className="text-(--ink)">
                  {check.label}
                  {check.gate ? <span className="text-(--ink-3)"> · Completion Gate</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Detail>
      ) : null}
      {result?.links.length || result?.artifacts.length ? (
        <Detail title="Previews">
          <div className="flex flex-wrap gap-2">
            {result.links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="web-press rounded-full bg-content/8 px-3 py-1.5 text-[14px] font-medium text-(--accent)"
              >
                {link.title}
              </a>
            ))}
            {result.artifacts.map((title) => (
              <span key={title} className="rounded-full bg-content/6 px-3 py-1.5 text-[14px] text-(--ink-2)">
                {title}
              </span>
            ))}
          </div>
          {result.artifacts.length ? (
            <span className="text-[12.5px] text-(--ink-3)">Saved artifacts open on the Mac.</span>
          ) : null}
        </Detail>
      ) : null}
      {result?.limitations.length ? (
        <Detail title="Known limitations">
          <ul className="list-disc pl-5 text-[14.5px] leading-snug text-(--ink)">
            {result.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Detail>
      ) : null}
      {goal.blocked.length ? (
        <Detail title="Stuck">
          <ItemList items={goal.blocked} tone="text-(--bad)" />
        </Detail>
      ) : null}
      {goal.remaining.length ? (
        <Detail title="Left">
          <ItemList items={goal.remaining} />
        </Detail>
      ) : null}
      {goal.done.length ? (
        <Detail title="Done">
          <ItemList items={goal.done} tone="text-(--ink-2)" />
        </Detail>
      ) : null}
      <Detail title="Request">
        <p className="whitespace-pre-wrap text-[14.5px] leading-snug text-(--ink-2)">{goal.request}</p>
      </Detail>
      <div className="flex flex-wrap gap-2">
        {goal.sessionId ? (
          <button className={secondaryButton} onClick={() => navigate({ name: "chat", id: goal.sessionId! })}>
            Open chat
          </button>
        ) : null}
        <button
          className={goal.finished ? secondaryButton : primaryButton}
          disabled={busy !== null}
          onClick={() =>
            void run(
              "done",
              () => write("goalDone", { goalId: goal.id, done: !goal.finished }),
              goal.finished ? "Reopened" : "Marked done",
            )
          }
        >
          {busy === "done" ? <Spinner /> : null}
          {goal.finished ? "Reopen" : "Mark done"}
        </button>
      </div>
    </div>
  );
}
