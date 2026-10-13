import { useEffect, useRef } from "react";
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
  HABIT_APPROVAL_WAIT_MS,
  HABIT_RUN_TIMEOUT_MS,
  habitReport,
  isRelayed,
  habitRunPrompt,
  loadHabits,
  markHabitRun,
  setHabitRunning,
  subscribeCheckHabitsNow,
  updateHabits,
  type Habit,
} from "../../features/irgats/model/irgatHabits";

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
  while (!settled) {
    await Promise.race([turn, new Promise((r) => setTimeout(r, POLL_MS))]);
    if (settled) break;
    const pending =
      host
        .sessions()
        .find((session) => session.id === runId)
        ?.blocks.filter((block) => block.approval && !block.approval.decided) ??
      [];
    for (const block of pending)
      if (!isRelayed(runId, block.approval!.requestId))
        host.askApproval(irgatId, habit, runId, block);
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

    const runHabit = async (
      irgatId: string,
      irgatSessionId: string,
      habitId: string,
    ) => {
      const host = hostRef.current;
      const irgat = await host.open(irgatSessionId);
      if (!irgat || stopped || !findIrgat(irgatId)) return;
      const files = await loadIrgatFiles(irgatId);
      if (stopped || !findIrgat(irgatId)) return;
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
          "full-access",
          irgat.modelSettings,
        ),
        title: `${look.name} · ${habit.name}`,
        ephemeral: true,
      };
      markHabitRun(run.id, irgatId);
      setHabitRunning(habit.id, now);
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
      const reply =
        finalReply(host.sessions().find((s) => s.id === run.id)) ||
        outcome.text;
      const artifacts = artifactCards(
        host.sessions().find((s) => s.id === run.id)?.blocks ?? [],
      );
      host.endApprovals(run.id);
      await host.remove(run.id).catch(() => undefined);
      clearHabitRun(run.id);
      setHabitRunning(habit.id);

      const report =
        outcome.status === "completed" ? habitReport(reply) : undefined;
      if (report) host.post(irgatSessionId, habit, report, look.name, artifacts);
      await updateHabits(irgatId, (habits) => ({
        habits: habits.map((entry) =>
          entry.id === habit.id
            ? afterRun(entry, Date.now(), {
                kind:
                  outcome.status !== "completed"
                    ? "failed"
                    : report
                      ? "posted"
                      : "quiet",
                ...(outcome.status !== "completed"
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
        for (const { id, sessionId } of listIrgats()) {
          if (stopped) return;
          // Habits are set up in its chat, so one never opened has none.
          if (!sessionId) continue;
          const now = Date.now();
          const { run, skipped } = dueHabits(await loadHabits(id), now);
          if (!run.length && !skipped.length) continue;
          if (skipped.length) {
            await updateHabits(id, (habits) => {
              const stale = new Set(
                dueHabits(habits, Date.now()).skipped.map((habit) => habit.id),
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
    return () => {
      stopped = true;
      window.clearInterval(timer);
      stopChecks();
      if ((window as OwnedWindow)[OWNER] === owner)
        delete (window as OwnedWindow)[OWNER];
    };
  }, [enabled]);
}
