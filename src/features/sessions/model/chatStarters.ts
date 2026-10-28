/**
 * Starting points shown in an empty chat that has a project selected.
 *
 * A first-time user does not yet know what the agent can do or that it reads
 * the project's files on its own. Each starter fills the composer with an
 * editable first request; nothing is ever sent for them. The list is plain
 * data so later empty-chat entry points can add their own starters.
 */
export type ChatStarterId = "explain" | "fix" | "build";

export type ChatStarter = {
  id: ChatStarterId;
  label: string;
  /** The editable draft the starter puts in the composer. */
  draft: string;
};

export const CHAT_STARTERS: readonly ChatStarter[] = [
  {
    id: "explain",
    label: "Explain this project",
    draft:
      "Explain this project to me: what it does, how it is organized, and where the main parts live. Read the files you need.",
  },
  {
    id: "fix",
    label: "Help me fix a problem",
    draft:
      "Help me fix a problem in this project. Find the cause, fix it, and tell me how you checked the fix.\n\nThe problem: ",
  },
  {
    id: "build",
    label: "Build a feature",
    draft:
      "Build a feature in this project. Look at how similar things are done here first, then make the change and test it.\n\nThe feature: ",
  },
];

export const CHAT_STARTER_FILE_HINT =
  "The agent can read files in your selected project as needed. Use @ to reference a specific file.";

/** The hint for composers without @ file references (the phone). */
export const CHAT_STARTER_FILE_HINT_PLAIN =
  "The agent can read files in your selected project as needed.";

/**
 * The composer text after picking a starter. An empty draft, or one that is
 * still another starter's untouched text, is replaced so switching starters
 * does not stack them; anything the user wrote themselves is kept and the
 * starter goes below it.
 */
export function draftWithStarter(
  current: string,
  starter: ChatStarter,
): string {
  if (!current.trim() || isUntouchedStarterDraft(current)) return starter.draft;
  return `${current.replace(/\s+$/, "")}\n\n${starter.draft}`;
}

export function isUntouchedStarterDraft(text: string): boolean {
  return CHAT_STARTERS.some((starter) => starter.draft.trim() === text.trim());
}
