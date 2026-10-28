import { ChevronRight, CircleDot } from "../../../shared/ui/icons";
import { useGoals } from "../model/goalStore";
import { goalForSession } from "../model/goals";

export const OPEN_GOAL_EVENT = "irgatos:open-goal";

/** Ask the app to show a goal in Fleet. */
export function requestOpenGoal(goalId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_GOAL_EVENT, { detail: { goalId } }));
}

/**
 * One quiet line above the composer naming the goal this chat works on, once
 * the goal spans more than this chat. Opens the goal in Fleet.
 */
export function GoalLine({ sessionId }: { sessionId: string }) {
  const goals = useGoals();
  const goal = goalForSession(goals, sessionId);
  if (!goal || goal.links.length < 2) return null;
  const others = goal.links.length - 1;
  return (
    <button
      type="button"
      data-goal-line={goal.id}
      onClick={() => requestOpenGoal(goal.id)}
      title="Show this goal in Fleet"
      className="mx-auto mb-1 flex w-full max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-[11.5px] text-content/45 hover:bg-content/[0.04] hover:text-content/70"
    >
      <CircleDot className="size-3 shrink-0 opacity-70" strokeWidth={1.75} />
      <span className="shrink-0">Goal</span>
      <span className="min-w-0 truncate text-content/70">{goal.title}</span>
      <span className="shrink-0 text-content/35">
        · {others} more {others === 1 ? "chat" : "chats"}
      </span>
      <ChevronRight className="ml-auto size-3 shrink-0 opacity-50" />
    </button>
  );
}
