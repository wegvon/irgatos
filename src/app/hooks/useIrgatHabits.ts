import { useEffect, useRef } from "react";
import { notifyHabitApproval } from "../../features/notifications/model/notifications";
import type { ControlOutcome } from "../../features/orchestration/model/orchestration";
import {
  newSession,
  type Block,
  type Session,
} from "../../features/sessions/model/session";
import {
  findIrgat,
  listIrgats,
  irgatLook,
  subscribeIrgats,
} from "../../features/irgats/model/irgat";
import { loadIrgatFiles } from "../../features/irgats/model/irgatFiles";
import {
  artifactCards,
  type ArtifactCard,
} from "../../features/artifacts/artifacts";
import {
  afterRun,
  claimHabit,
  clearHabitRun,
  dueHabits,
  runsWhilePaused,
  HABIT_STOPPED_REASON,
  habitStopRequested,
  readOnlyStepDecision,
  readOnlyUnsupported,
  HABIT_APPROVAL_WAIT_MS,
  HABIT_RUN_TIMEOUT_MS,
  habitReport,
  holdHabitForQuota,
  isRelayed,
  habitRunPrompt,
  loadHabits,
  markHabitRun,
  setHabitRunning,
  subscribeCheckHabitsNow,
  updateHabits,
  type Habit,
} from "../../features/irgats/model/irgatHabits";
import {
  askHabitApproval,
  checkHabitCondition,
  delayHabit,
  habitGuardStage,
  skipHabit,
} from "../../features/irgats/model/habitGuards";
import type { HarnessId } from "../../features/sessions/model/session";
import type { UsageLimitHold } from "../../features/quotas/model/usageLimitRegistry";
import {
  holdAccountId,
  usageLimitRegistry,
} from "../../features/quotas/model/usageLimitStore";

const TICK_MS = 60_000;

/**
 * Only the newest scheduler runs habits. A hot reload in development can
 * leave an older copy of this hook running beside the new one, with its own
 * idea of what is running; the newest claims the window and the rest stop.
 */
const OWNER = "__irgatHabitsScheduler";
type OwnedWindow = Window & { [OWNER]?: symbol };

export type IrgatHabitHost = {
  sessions(): Session[];
  /** Loads a session into the app if it is not open. */
  open(sessionId: string): Promise<Session | undefined>;
  /** Adds a hidden session to the app's state. */
  add(session: Session): void;
  /** Sends a turn and resolves once it settles. */
  run(sessionId: string, prompt: string): Promise<ControlOutcome>;
  /** Stops a session if it is busy, then deletes it. */
  remove(sessionId: string): Promise<void>;
  /** Adds a message to the Irgat's chat and lets the user know. */
  post(
    irgatSessionId: string,
    habit: Habit,
    text: string,
    title: string,
    artifacts?: ArtifactCard[],
  ): void;
  /** Puts an approval the run is waiting on to the user, in the Irgat's chat. */
  askApproval(
    irgatSessionId: string,
    habit: Habit,
    runId: string,
    block: Block,
  ): void;
  /** Withdraws the run's unanswered approvals from the chat once it ends. */
  endApprovals(runId: string): void;
  /** Answers one of the run's approvals without asking the user. */
  respond(runId: string, requestId: number, decision: "allow" | "deny"): void;
};

const POLL_MS = 2_000;

/** The last thing the run said, which is its message to the user. */
function finalReply(session: Session | undefined): string {
  if (!session) return "";
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "user") break;
    if (block.role === "assistant" && !block.tool && block.text.trim())
      return block.text;
  }
  return "";
}

/**
 * Sends the run's turn and waits for it, relaying any approval it asks for to
 * the Irgat's chat. Only time spent working counts toward the timeout; time
 * waiting on the user has its own, much longer limit.
 */
async function watchRun(
  host: IrgatHabitHost,
  irgatId: string,
  habit: Habit,
  runId: string,
  start: () => Promise<ControlOutcome>,
): Promise<ControlOutcome> {
  let settled: ControlOutcome | undefined;
  const turn = start().then(
    (outcome) => (settled = outcome),
    (error: unknown) =>
      (settled = {
        status: "failed",
        text: "",
        error: error instanceof Error ? error.message : String(error),
      }),
  );
  let working = 0;
  let waiting = 0;
  const answered = new Set<number>();
  while (!settled) {
    await Promise.race([turn, new Promise((r) => setTimeout(r, POLL_MS))]);
    if (settled) break;
    if (habitStopRequested(habit.id))
      return { status: "cancelled", text: "", error: HABIT_STOPPED_REASON };
    const pending =
      host
        .sessions()
        .find((session) => session.id === runId)
        ?.blocks.filter((block) => block.approval && !block.approval.decided) ??
      [];
    for (const block of pending) {
      const requestId = block.approval!.requestId;
      // A look-only run never asks: it reads, and anything else is refused.
      if (habit.readOnly) {
        if (answered.has(requestId)) continue;
        answered.add(requestId);
        host.respond(runId, requestId, readOnlyStepDecision(block));
      } else if (!isRelayed(runId, requestId))
        host.askApproval(irgatId, habit, runId, block);
    }
    if (pending.length) waiting += POLL_MS;
    else working += POLL_MS;
    if (working >= HABIT_RUN_TIMEOUT_MS || waiting >= HABIT_APPROVAL_WAIT_MS)
      return {
        status: "failed",
        text: "",
        error:
          waiting >= HABIT_APPROVAL_WAIT_MS
            ? "Nobody answered its approval request."
            : "It took too long and was stopped.",
      };
  }
  return settled;
}

/** Held while its provider's registry hold stands, unless overridden. */
function heldByRegistry(habit: Habit, now: number): boolean {
  const hold = habit.quotaHold;
  if (!hold || hold.override) return false;
  return !!usageLimitRegistry.get(hold.harness as HarnessId, hold.accountId, now);
}

function changeHabit(
  irgatId: string,
  habitId: string,
  change: (habit: Habit) => Habit,
): Promise<void> {
  return updateHabits(irgatId, (habits) => ({
    habits: habits.map((entry) => (entry.id === habitId ? change(entry) : entry)),
    result: undefined,
  }));
}

function parkHabit(
  irgatId: string,
  habitId: string,
  hold: UsageLimitHold,
): Promise<void> {
  return updateHabits(irgatId, (habits) => ({
    habits: habits.map((entry) =>
      entry.id === habitId
        ? holdHabitForQuota(entry, {
            harness: hold.harness,
            accountId: hold.accountId,
            until: hold.resetAt,
          })
        : entry,
    ),
    result: undefined,
  }));
}

/**
 * Runs each Irgat's habits on schedule while the app is open: in a hidden
 * session of its own, posting to the Irgat's chat only when the run has
 * something to say. One run at a time across all Irgats keeps a wake from
 * sleep from starting several agents at once.
 */
export function useIrgatHabits(host: IrgatHabitHost, enabled = true) {
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    if (!enabled) return;
    const owner = Symbol("irgat-habits");
    (window as OwnedWindow)[OWNER] = owner;
    let stopped = false;
    let running = false;
    // A check asked for mid-run happens as soon as that run ends.
    let checkAgain = false;
    // Wake-ups for delays ending between ticks, by when they end.
    const wakes = new Map<number, number>();
    const wakeAt = (at: number) => {
      if (wakes.has(at)) return;
      const timer = window.setTimeout(
        () => {
          wakes.delete(at);
          void tick();
        },
        Math.max(0, at - Date.now()) + 50,
      );
      wakes.set(at, timer);
    };

    /**
     * Takes the habit through its delay, condition and approval. True when it
     * should run now; otherwise what happened is saved on the habit.
     */
    const passGuards = async (
      irgatId: string,
      habitId: string,
      cwd: string,
    ): Promise<boolean> => {
      const latest = (await loadHabits(irgatId)).find(
        (entry) => entry.id === habitId,
      );
      if (!latest) return false;
      let stage = habitGuardStage(latest, Date.now());
      if (stage.stage === "check") {
        const checkedAt = Date.now();
        const result = await checkHabitCondition(
          latest,
          stage.condition,
          cwd,
          checkedAt,
        );
        if (stopped) return false;
        if (result.kind === "skip") {
          await changeHabit(irgatId, habitId, (entry) =>
            skipHabit(entry, Date.now(), result.reason),
          );
          return false;
        }
        if (result.kind === "fail") {
          await changeHabit(irgatId, habitId, (entry) =>
            afterRun(entry, Date.now(), {
              kind: "failed",
              error: result.error,
              startedAt: checkedAt,
            }),
          );
          return false;
        }
        stage = habitGuardStage(latest, Date.now(), true);
      }
      switch (stage.stage) {
        case "run":
          return true;
        case "wait":
          return false;
        case "expired":
          await changeHabit(irgatId, habitId, (entry) =>
            skipHabit(entry, Date.now(), "Nobody approved it in time."),
          );
          return false;
        case "delay": {
          const until = stage.until;
          await changeHabit(irgatId, habitId, (entry) =>
            delayHabit(entry, until),
          );
          wakeAt(until);
          return false;
        }
        case "ask":
          await changeHabit(irgatId, habitId, (entry) =>
            askHabitApproval(entry, Date.now()),
          );
          void notifyHabitApproval(irgatId, latest.name).catch(() => false);
          return false;
        case "check":
          return false;
      }
    };

    const runHabit = async (
      irgatId: string,
      irgatSessionId: string,
      habitId: string,
    ) => {
      const host = hostRef.current;
      const irgat = await host.open(irgatSessionId);
      if (!irgat || stopped || !findIrgat(irgatId)) return;
      const unsupported = readOnlyUnsupported(irgat.harness);
      if (unsupported) {
        const planned = (await loadHabits(irgatId)).find((entry) => entry.id === habitId);
        if (planned?.readOnly) {
          await changeHabit(irgatId, habitId, (entry) =>
            skipHabit(entry, Date.now(), unsupported),
          );
          return;
        }
      }
      if (!(await passGuards(irgatId, habitId, irgat.cwd)) || stopped) return;
      const files = await loadIrgatFiles(irgatId);
      if (stopped || !findIrgat(irgatId)) return;
      // Out of quota: wait for the reset instead of failing the run.
      const accountId = holdAccountId(irgat.harness, undefined, irgat.cwd);
      const quotaHold = usageLimitRegistry.get(irgat.harness, accountId);
      if (quotaHold) {
        const latest = (await loadHabits(irgatId)).find(
          (entry) => entry.id === habitId,
        );
        if (!latest?.quotaHold?.override) {
          await parkHabit(irgatId, habitId, quotaHold);
          return;
        }
      }
      const now = Date.now();
      // Claim after preparation, from the latest definition. A queued habit
      // may have been removed, paused, rescheduled or claimed in another window.
      const habit = await claimHabit(irgatId, habitId, now);
      const record = findIrgat(irgatId);
      if (!habit || stopped || !record) return;
      const look = irgatLook(record);
      const run: Session = {
        // Nobody is watching a habit's run, so it cannot stop to ask before
        // each step. Anything the harness still asks goes to the user below.
        ...newSession(
          irgat.harness,
          irgat.cwd,
          irgat.model,
          // A look-only run asks before each step so the app can refuse
          // what is not reading; other habits run with full access.
          habit.readOnly ? "supervised" : "full-access",
          irgat.modelSettings,
        ),
        title: `${look.name} · ${habit.name}`,
        ephemeral: true,
      };
      markHabitRun(run.id, irgatId, habit.readOnly === true);
      setHabitRunning(habit.id, now, run.id);
      host.add(run);
      let outcome: ControlOutcome;
      try {
        // /operator gives the run the same app access the Irgat has.
        const prompt = `/operator ${habitRunPrompt(look, files, habit, now)}`;
        outcome = await watchRun(host, irgat.id, habit, run.id, () =>
          host.run(run.id, prompt),
        );
      } catch (error) {
        outcome = {
          status: "failed",
          text: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const ranSession = host.sessions().find((s) => s.id === run.id);
      const reply = finalReply(ranSession) || outcome.text;
      const artifacts = artifactCards(ranSession?.blocks ?? []);
      const hitLimit =
        outcome.status !== "completed" ? ranSession?.usageLimit : undefined;
      host.endApprovals(run.id);
      await host.remove(run.id).catch(() => undefined);
      clearHabitRun(run.id);
      setHabitRunning(habit.id);

      // The run itself ran into the limit: run it again at the reset.
      if (hitLimit) {
        const hold =
          usageLimitRegistry.hold({
            harness: irgat.harness,
            accountId,
            resetAt: hitLimit.resetsAt,
            source: "session",
          }) ?? usageLimitRegistry.get(irgat.harness, accountId);
        if (hold) {
          await parkHabit(irgatId, habit.id, hold);
          return;
        }
      }

      const report =
        outcome.status === "completed" ? habitReport(reply) : undefined;
      if (report) host.post(irgatSessionId, habit, report, look.name, artifacts);
      // Stopped by the user: not a failure, just a run that did not go on.
      const stoppedByUser =
        outcome.status === "cancelled" &&
        outcome.error === HABIT_STOPPED_REASON;
      await updateHabits(irgatId, (habits) => ({
        habits: habits.map((entry) =>
          entry.id === habit.id
            ? afterRun(entry, Date.now(), {
                kind: stoppedByUser
                  ? "skipped"
                  : outcome.status !== "completed"
                    ? "failed"
                    : report
                      ? "posted"
                      : "quiet",
                ...(stoppedByUser
                  ? { reason: HABIT_STOPPED_REASON }
                  : outcome.status !== "completed"
                    ? { error: outcome.error ?? "The run did not finish." }
                    : {}),
                ...(report ? { report } : {}),
                startedAt: now,
              })
            : entry,
        ),
        result: undefined,
      }));
    };

    const tick = async () => {
      if ((window as OwnedWindow)[OWNER] !== owner) stopped = true;
      if (stopped) return;
      if (running) {
        checkAgain = true;
        return;
      }
      running = true;
      checkAgain = false;
      try {
        for (const { id, sessionId, paused } of listIrgats()) {
          if (stopped) return;
          // Habits are set up in its chat, so one never opened has none.
          if (!sessionId) continue;
          const now = Date.now();
          const habits = await loadHabits(id);
          // A delay saved before a restart still ends on time.
          for (const habit of habits)
            if (habit.delayedUntil != null && habit.delayedUntil > now)
              wakeAt(habit.delayedUntil);
          const due = dueHabits(habits, now, heldByRegistry);
          // A paused Irgat leaves its due habits waiting for the resume.
          const run = paused ? runsWhilePaused(due.run) : due.run;
          const skipped = paused ? [] : due.skipped;
          if (!run.length && !skipped.length) continue;
          if (skipped.length) {
            await updateHabits(id, (habits) => {
              const stale = new Set(
                dueHabits(habits, Date.now(), heldByRegistry).skipped.map(
                  (habit) => habit.id,
                ),
              );
              return {
                habits: habits.map((habit) =>
                  stale.has(habit.id) ? afterRun(habit, Date.now()) : habit,
                ),
                result: undefined,
              };
            });
          }
          for (const habit of run) {
            if (stopped) return;
            // The user may pause the Irgat while an earlier habit runs.
            if (findIrgat(id)?.paused && !runsWhilePaused([habit]).length)
              continue;
            await runHabit(id, sessionId, habit.id).catch((error) =>
              console.warn(`Habit "${habit.name}" could not run`, error),
            );
          }
        }
      } catch (error) {
        console.warn("Could not check Irgat habits", error);
      } finally {
        running = false;
        if (checkAgain && !stopped) void tick();
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), TICK_MS);
    const stopChecks = subscribeCheckHabitsNow(() => void tick());
    // A resumed Irgat's waiting habits run now, not at the next minute.
    const pausedIds = () =>
      new Set(listIrgats().filter(({ paused }) => paused).map(({ id }) => id));
    let paused = pausedIds();
    const stopPauses = subscribeIrgats(() => {
      const before = paused;
      paused = pausedIds();
      if ([...before].some((id) => !paused.has(id))) void tick();
    });
    // A hold that ends or is lifted lets held habits run right away.
    const holdsSignature = () =>
      usageLimitRegistry
        .snapshot()
        .holds.map((hold) => `${hold.key}@${hold.resetAt}`)
        .join("|");
    let lastHolds = holdsSignature();
    const stopHolds = usageLimitRegistry.subscribe(() => {
      const next = holdsSignature();
      if (next === lastHolds) return;
      lastHolds = next;
      void tick();
    });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      for (const wake of wakes.values()) window.clearTimeout(wake);
      stopChecks();
      stopPauses();
      stopHolds();
      if ((window as OwnedWindow)[OWNER] === owner)
        delete (window as OwnedWindow)[OWNER];
    };
  }, [enabled]);
}
