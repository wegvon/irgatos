import { readStoredJson, writeStoredJson } from "../../../shared/lib/safeStorage";
import { collectRailProjects, loadRecents } from "../../projects/model/recents";
import {
  addIrgatProject,
  createIrgat,
  findIrgat,
  listIrgats,
  reorderIrgats,
  updateIrgat,
} from "./irgat";
import {
  newHabit,
  QUIET_MARKER,
  updateHabits,
  type Habit,
  type HabitDraft,
} from "./irgatHabits";

/**
 * The main Irgat: one the app sets up by itself, first on the rail, that keeps
 * an eye on all of the user's work. It sees every project on the rail, other
 * Irgats and Claude outside Irgatos, and checks on them every hour, only
 * looking, so the user hears what finished, what is stuck and what waits on
 * them without going through each chat.
 */
const MAIN_IRGAT_KEY = "irgatos.mainIrgat.v1";

export const MAIN_IRGAT_NAME = "Asistan";

const SOUL = `You are the user's main assistant in Irgatos. You keep track of all of their work: the chats and agents in every one of your projects, the other Irgats, Claude sessions outside Irgatos, mail and Feed.
- When the user asks how things are going, check with the app actions (projects.list, sessions.list for each project, sessions.read, irgats.list, claude.list) and answer what finished, what is stuck and what waits on their decision, one line per item with its chat's title.
- Answer in Turkish, short and plain.
- You look and report. Start or change work only when the user asks you to.`;

export const MAIN_HABIT: HabitDraft = {
  name: "Tüm işleri takip et",
  instructions: `Check on all of the user's work and report only what is new since your last report.
1. List the work: \`app irgats.list {}\`, \`app claude.list {}\`, and \`app sessions.list {"project":"<path>"}\` for each of your projects. Read a chat with \`app sessions.read\` only when its state needs a closer look.
2. Sort what you find into: finished (done, ready to review), stuck (failed, interrupted, waiting on a usage limit, or unfinished and idle for a long time) and waiting on the user (a question or an approval).
3. Before reporting, search your memory for what you already reported, and add a short note of what you report now, so the same item is not repeated every hour.
4. When nothing is new, answer exactly ${QUIET_MARKER}. Otherwise write a short report in Turkish under the headings "Bitti", "Takıldı" and "Karar bekliyor", leaving out empty ones, one line per item with its chat's title.`,
  schedule: { scheduleKind: "hourly", minute: 0, time: "09:00", dayOfWeek: 1 },
};

type MainIrgatState = {
  id: string;
  /** Rail projects it was given, so one the user takes away stays away. */
  projects: string[];
  /** Whether its habit is in place. */
  habit: boolean;
};

function loadState(): MainIrgatState | undefined {
  const value = readStoredJson(MAIN_IRGAT_KEY);
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string") return undefined;
  return {
    id: entry.id,
    projects: Array.isArray(entry.projects)
      ? entry.projects.filter((path): path is string => typeof path === "string")
      : [],
    habit: entry.habit === true,
  };
}

function saveState(state: MainIrgatState): void {
  try {
    writeStoredJson(MAIN_IRGAT_KEY, state);
  } catch {
    return;
  }
}

/** The main Irgat's id, while it exists. */
export function mainIrgatId(): string | undefined {
  const id = loadState()?.id;
  return id && findIrgat(id) ? id : undefined;
}

function railProjects(cwd: string): string[] {
  return [...collectRailProjects(loadRecents(), cwd).values()].map(
    (project) => project.path,
  );
}

type Deps = {
  updateHabits: typeof updateHabits;
  now: () => number;
};

/**
 * Sets the main Irgat up the first time, then keeps it on every project new
 * to the rail. One the user deleted is not made again.
 */
export async function ensureMainIrgat(
  cwd: string,
  deps: Deps = { updateHabits, now: Date.now },
): Promise<string | undefined> {
  let state = loadState();
  if (!state) {
    const projects = railProjects(cwd);
    const { id } = createIrgat(projects);
    updateIrgat(id, (irgat) => ({
      ...irgat,
      name: MAIN_IRGAT_NAME,
      instructions: SOUL,
    }));
    reorderIrgats([
      id,
      ...listIrgats().flatMap((irgat) => (irgat.id === id ? [] : [irgat.id])),
    ]);
    state = { id, projects, habit: false };
    saveState(state);
  }
  const irgat = findIrgat(state.id);
  if (!irgat) return undefined;

  const given = new Set(state.projects);
  const added = railProjects(cwd).filter((path) => !given.has(path));
  for (const path of added) addIrgatProject(irgat.id, path);
  if (added.length) {
    state = { ...state, projects: [...state.projects, ...added] };
    saveState(state);
  }

  if (!state.habit) {
    await deps.updateHabits(irgat.id, (habits) => {
      if (habits.some((habit) => habit.name === MAIN_HABIT.name))
        return { habits, result: undefined };
      const habit: Habit = {
        ...newHabit(MAIN_HABIT, deps.now()),
        readOnly: true,
      };
      return { habits: [...habits, habit], result: undefined };
    });
    state = { ...state, habit: true };
    saveState(state);
  }
  return irgat.id;
}
