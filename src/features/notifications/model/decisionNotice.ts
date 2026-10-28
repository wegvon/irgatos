import { projectKey, projectName } from "../../../shared/lib/paths";
import { basename } from "../../../platform/tauri/fs";
import { irgatForSession, irgatLook } from "../../irgats/model/irgat";
import { isFreeChatCwd } from "../../freechat/model/freeChatPath";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
} from "../../workspace/model/tabGroups";
import {
  sessionDisplayTitle,
  sessionWorkCwd,
  type Session,
} from "../../sessions/model/session";
import { knownNotificationProject } from "./notificationProjects";

/**
 * Where a decision comes from, named the way Fleet names it: the project
 * (or Irgat), the chat inside it, and the worktree when the chat has one.
 */
export type DecisionPlace = {
  project: string;
  task: string;
  /** Branch or worktree folder; set when the chat does not run in the project folder. */
  workspace?: string;
};

export function decisionPlace(session: Session): DecisionPlace {
  const task = sessionDisplayTitle(session.title, session.harness);
  const irgat = irgatForSession(session.id);
  if (irgat) return { project: irgatLook(irgat).name, task };
  if (isFreeChatCwd(session.cwd)) return { project: "Chat", task };
  const fallback =
    knownNotificationProject(session.cwd)?.name ?? projectName(session.cwd);
  const project = resolveTabGroupLabel(
    projectKey(session.cwd),
    loadTabGroupLabels(),
    fallback,
  );
  const workCwd = sessionWorkCwd(session);
  const workspace =
    projectKey(workCwd) !== projectKey(session.cwd)
      ? session.branch || basename(workCwd)
      : undefined;
  return { project, task, ...(workspace ? { workspace } : {}) };
}

/** "irgatos (feature-x) › Fix login", for one-line surfaces such as banners. */
export function decisionPlaceLine(
  place: DecisionPlace,
  withWorkspace = !!place.workspace,
): string {
  const project =
    withWorkspace && place.workspace
      ? `${place.project} (${place.workspace})`
      : place.project;
  return `${project} › ${place.task}`;
}

export * from "./decisionUrgency";
