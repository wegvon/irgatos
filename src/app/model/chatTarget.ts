/**
 * The session in a workspace tab that takes Add to Chat and the browser's
 * Page to agent captures, if any.
 *
 * Only the active tab's session qualifies, and not while an Irgat covers the
 * workspace: that Irgat's chat takes them, and the session hidden underneath
 * would otherwise race it for every capture.
 */
export function workspaceChatTarget({
  tabId,
  activeTabId,
  activeSessionId,
  irgatViewId,
}: {
  tabId: string;
  activeTabId: string;
  activeSessionId: string | undefined;
  irgatViewId: string | null;
}): string | undefined {
  if (irgatViewId || tabId !== activeTabId) return undefined;
  return activeSessionId;
}
