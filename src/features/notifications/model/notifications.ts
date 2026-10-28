import { invoke } from "@tauri-apps/api/core";
import { HARNESS_TITLE, type Session } from "../../sessions/model/session";
import { loadSoundsEnabled, playCue } from "../../settings/model/sounds";
import {
  allowsProjectNotification,
  type NotificationSubject,
} from "./notificationPreferences";
import { irgatReplyText } from "../../irgats/model/irgatReaction";
import {
  irgatNotificationProject,
  knownNotificationProject,
  type NotificationProject,
} from "./notificationProjects";
import {
  findIrgat,
  irgatForSession,
  irgatLook,
} from "../../irgats/model/irgat";
import {
  decisionKey,
  decisionPlace,
  decisionPlaceLine,
  decisionUrgency,
  urgencyLine,
} from "./decisionNotice";

const KEY = "irgat.notifications";

/**
 * On unless the user switched it off: the app asks the OS for permission at
 * launch, and macOS keeps that answer.
 */
export const NOTIFICATIONS_DEFAULT = true;

export const NOTIFICATIONS_CHANGE_EVENT = "irgat:notifications-change";

/** Rust emits this with the session id when a notification is clicked. */
export const NOTIFICATION_CLICK_EVENT = "irgat:notification-click";

export type NotificationPermission =
  "prompt" | "granted" | "denied" | "unsupported";

export function loadNotificationsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return NOTIFICATIONS_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return NOTIFICATIONS_DEFAULT;
  }
}

export function saveNotificationsEnabled(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(NOTIFICATIONS_CHANGE_EVENT, { detail: value }),
  );
}

let permission: NotificationPermission = "prompt";

/** Last permission the OS reported; refreshed by the probes below. */
export function cachedNotificationPermission(): NotificationPermission {
  return permission;
}

export async function probeNotificationPermission(): Promise<NotificationPermission> {
  try {
    permission = await invoke<NotificationPermission>(
      "notification_permission",
    );
  } catch {
    permission = "unsupported";
  }
  return permission;
}

/** Shows the OS prompt when undecided; otherwise reports the current state. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    permission = await invoke<NotificationPermission>(
      "request_notification_permission",
    );
  } catch {
    permission = "unsupported";
  }
  return permission;
}

/** Launch probe: asks the OS once while undecided, so banners can fire. */
export async function primeNotificationPermission(): Promise<NotificationPermission> {
  const current = await probeNotificationPermission();
  return current === "prompt" ? requestNotificationPermission() : current;
}

export function openNotificationSettings(): Promise<void> {
  return invoke<void>("open_notification_settings");
}

/**
 * Tracked from Tauri's focus event rather than `document.hasFocus()`, which
 * WKWebView keeps reporting true after the window drops to the background.
 */
let windowFocused =
  typeof document !== "undefined" ? document.hasFocus() : true;

export function setWindowFocused(focused: boolean) {
  windowFocused = focused;
}

/**
 * A banner only earns its place while the user is looking elsewhere: another
 * app, or another session. The transcript already shows the change on the
 * session that is on screen.
 */
export function shouldNotify({
  enabled,
  permission,
  windowFocused,
  sessionVisible,
}: {
  enabled: boolean;
  permission: NotificationPermission;
  windowFocused: boolean;
  sessionVisible: boolean;
}): boolean {
  if (!enabled || (windowFocused && sessionVisible)) return false;
  return permission === "granted" || permission === "prompt";
}

export type InputNotificationEvent = {
  kind: "approval" | "question";
  requestId: number;
};
export type NotificationEvent = "finished" | InputNotificationEvent;

type PendingInputNotification = {
  session: Session;
  event: InputNotificationEvent;
};

/** Track each request, including a new request in an already-waiting session. */
export function pendingInputNotifications(
  sessions: Session[],
): Map<string, PendingInputNotification> {
  const pending = new Map<string, PendingInputNotification>();
  for (const session of sessions) {
    if (session.inboxAsk) continue;
    for (const block of session.blocks) {
      if (block.approval && !block.approval.decided) {
        pending.set(
          decisionKey(session.id, "approval", block.approval.requestId),
          {
            session,
            event: { kind: "approval", requestId: block.approval.requestId },
          },
        );
      }
    }
    if (session.pendingQuestion) {
      pending.set(
        decisionKey(session.id, "question", session.pendingQuestion.requestId),
        {
          session,
          event: {
            kind: "question",
            requestId: session.pendingQuestion.requestId,
          },
        },
      );
    }
  }
  return pending;
}

/**
 * Where the banner comes from, then what it asks. A decision leads with
 * "project › chat" and says whether the agent waits for it; a finished turn
 * names the project, then the chat, then the reply itself.
 */
export type NotificationText = {
  title: string;
  subtitle: string;
  body: string;
};

const BODY_MAX = 240;

export function notificationText(
  session: Session,
  event: NotificationEvent,
  now = Date.now(),
): NotificationText {
  const place = decisionPlace(session);
  const harness = HARNESS_TITLE[session.harness];
  if (event !== "finished") {
    const title = decisionPlaceLine(place);
    if (event.kind === "question") {
      const question =
        session.pendingQuestion?.requestId === event.requestId
          ? session.pendingQuestion
          : undefined;
      const prompt = question?.title || question?.questions[0]?.prompt;
      return {
        title,
        subtitle: urgencyLine(decisionUrgency("question", question), now),
        body: clip(prompt || `${harness} has a question for you`),
      };
    }
    const pending = session.blocks.find(
      (block) =>
        block.approval?.requestId === event.requestId &&
        !block.approval.decided,
    );
    const what = pending?.tool?.title || pending?.text;
    return {
      title,
      subtitle: urgencyLine(decisionUrgency("approval"), now),
      body: clip(what ? `Approve: ${what}` : `${harness} needs your approval`),
    };
  }
  const reply = [...session.blocks]
    .reverse()
    .find((block) => block.role === "assistant" && block.text.trim());
  return {
    title: place.workspace
      ? `${place.project} (${place.workspace})`
      : place.project,
    subtitle: place.task,
    body: clip((reply && irgatReplyText(reply.text)) || `${harness} finished`),
  };
}

/** First paragraph, whitespace collapsed; macOS wraps and truncates the rest. */
function clip(text: string): string {
  const paragraph =
    text
      .split(/\n\s*\n/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .find((part) => part.length > 0) ?? "";
  return paragraph.length > BODY_MAX
    ? `${paragraph.slice(0, BODY_MAX - 1)}…`
    : paragraph;
}

/**
 * Irgat chats run in the home folder, which is not a project, so they are
 * filed under their Irgat instead of being dropped.
 */
export function sessionNotificationProject(
  session: Session,
): NotificationProject | undefined {
  const irgat = irgatForSession(session.id);
  if (irgat) return irgatNotificationProject(irgat.id, irgatLook(irgat).name);
  return knownNotificationProject(session.cwd);
}

/**
 * Sends the banner when policy allows. Resolves true once the OS accepted it
 * so callers can skip the in-app cue: the OS sound stands in for it. A
 * rejected dispatch resolves false so the cue still plays.
 *
 * A decision's banner is tagged with its request, so it can be taken back
 * once the request is answered, expires or is deferred.
 */
export async function notifySession(
  session: Session,
  event: NotificationEvent,
  sessionVisible: boolean,
  options: { reminder?: boolean } = {},
): Promise<boolean> {
  if (session.inboxAsk) return false;
  const occurredAt = Date.now();
  const project = sessionNotificationProject(session);
  if (!project) return false;
  const subject: NotificationSubject = {
    projectId: project.id,
    category: event === "finished" ? "agentFinished" : "agentInput",
    occurredAt,
  };
  if (event === "finished") {
    return notifyProjectSession(session, event, sessionVisible, subject);
  }
  return deliverNotification(
    session.id,
    () => {
      const text = notificationText(session, event);
      return options.reminder
        ? { ...text, subtitle: `Reminder · ${text.subtitle}` }
        : text;
    },
    sessionVisible,
    subject,
    decisionKey(session.id, event.kind, event.requestId),
  );
}

/** Decisions answered, expired or deferred since the last push to the phone. */
const retiredForDevices = new Set<string>();
const RETIRE_MAX = 12;

/**
 * Takes a decision's banner back from Notification Center, and from phones
 * with the next push (a push of its own would have to show a banner).
 */
export function retireDecisionNotification(tag: string) {
  void invoke("retire_notification", { tag }).catch(() => {});
  retiredForDevices.add(tag);
  // Old phone banners are also cleared when the page opens; keep the push small.
  for (const old of retiredForDevices) {
    if (retiredForDevices.size <= RETIRE_MAX) break;
    retiredForDevices.delete(old);
  }
}

/**
 * A habit waits for the user's go-ahead before it runs: a decision only they
 * can make, so it gets a banner like any other approval. A tap opens the
 * Irgat's chat, where the habit's card holds Approve and Skip.
 */
export async function notifyHabitApproval(
  irgatId: string,
  habitName: string,
): Promise<boolean> {
  const irgat = findIrgat(irgatId);
  if (!irgat?.sessionId) return false;
  const name = irgatLook(irgat).name;
  const project = irgatNotificationProject(irgat.id, name);
  return deliverNotification(
    irgat.sessionId,
    () => ({
      title: `${name} › ${habitName}`,
      subtitle: urgencyLine(decisionUrgency("approval")),
      body: clip(`Approve: run the habit “${habitName}”`),
    }),
    false,
    { projectId: project.id, category: "agentInput", occurredAt: Date.now() },
    `habit:${irgat.id}:${habitName}`,
  );
}

/** One policy decision covers both the OS banner and its in-app sound fallback. */
export async function announceSessionFinished(
  session: Session,
  sessionVisible: boolean,
): Promise<void> {
  if (session.inboxAsk) return;
  const occurredAt = Date.now();
  const project = sessionNotificationProject(session);
  if (!project) return;
  const subject: NotificationSubject = {
    projectId: project.id,
    category: "agentFinished",
    occurredAt,
  };
  const sent = await notifyProjectSession(
    session,
    "finished",
    sessionVisible,
    subject,
  );
  if (!sent) playCue("turnFinished", subject);
}

async function notifyProjectSession(
  session: Session,
  event: NotificationEvent,
  sessionVisible: boolean,
  subject: NotificationSubject,
): Promise<boolean> {
  return deliverNotification(
    session.id,
    () => notificationText(session, event),
    sessionVisible,
    subject,
  );
}

async function deliverNotification(
  targetId: string,
  text: () => NotificationText,
  visible: boolean,
  subject: NotificationSubject,
  tag?: string,
): Promise<boolean> {
  if (!allowsProjectNotification(subject)) return false;
  const enabled = loadNotificationsEnabled();
  if (tag) retiredForDevices.delete(tag);
  if (enabled && !(windowFocused && visible))
    pushToDevices(targetId, text(), tag);
  const decision = shouldNotify({
    enabled,
    permission,
    windowFocused,
    sessionVisible: visible,
  });
  if (!decision) return false;
  const { title, subtitle, body } = text();
  try {
    await invoke("show_notification", {
      sessionId: targetId,
      title,
      subtitle,
      body,
      sound: loadSoundsEnabled(),
      tag: tag ?? null,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * A phone banner has a title and a body only. A decision keeps its
 * "project › chat" title and leads the body with its urgency; anything else
 * folds the chat into the title.
 */
export function deviceNotificationText(
  text: NotificationText,
  decision: boolean,
): { title: string; body: string } {
  if (decision) {
    return {
      title: text.title,
      body: text.subtitle ? `${text.subtitle} · ${text.body}` : text.body,
    };
  }
  return {
    title: text.subtitle ? `${text.title} › ${text.subtitle}` : text.title,
    body: text.body,
  };
}

/** Where a tap on a phone banner lands on the browser-access page. */
export function webPushUrl(targetId: string): string {
  return targetId.startsWith("terminal:")
    ? "/"
    : `/#/chat/${encodeURIComponent(targetId)}`;
}

/**
 * Phones and tablets that turned on notifications on the browser-access page
 * get the same banner; the Mac skips this when none subscribed.
 */
function pushToDevices(targetId: string, text: NotificationText, tag?: string) {
  const retire = [...retiredForDevices];
  retiredForDevices.clear();
  void invoke("web_push_send", {
    ...deviceNotificationText(text, !!tag),
    url: webPushUrl(targetId),
    tag: tag ?? targetId,
    retire,
  }).catch(() => {});
}

/** A coding agent running in a raw terminal changed state. */
export type TerminalAgentNotice = {
  /** Click target; the app routes `terminal:` ids to the terminal tab. */
  targetId: string;
  cwd: string;
  tabLabel: string;
  agentLabel: string;
  event: "blocked" | "done";
};

export function terminalAgentNotificationText(
  notice: TerminalAgentNotice,
  projectName = "Irgatos",
): NotificationText {
  return {
    title: projectName,
    subtitle: `${notice.agentLabel} · ${notice.tabLabel}`,
    body:
      notice.event === "blocked"
        ? `${notice.agentLabel} is waiting for your approval or answer in the terminal`
        : `${notice.agentLabel} finished in the terminal`,
  };
}

/** Banner for a terminal agent, under the same project rules as sessions. */
export async function notifyTerminalAgent(
  notice: TerminalAgentNotice,
  visible: boolean,
): Promise<boolean> {
  const project = knownNotificationProject(notice.cwd);
  if (!project) return false;
  const subject: NotificationSubject = {
    projectId: project.id,
    category: notice.event === "done" ? "agentFinished" : "agentInput",
    occurredAt: Date.now(),
  };
  const sent = await deliverNotification(
    notice.targetId,
    () => terminalAgentNotificationText(notice, project.name),
    visible,
    subject,
  );
  if (!sent && notice.event === "done" && !visible) playCue("turnFinished", subject);
  return sent;
}
