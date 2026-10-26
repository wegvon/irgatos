/**
 * Next-message suggestions: once a reply is finished, a cheap model guesses
 * what the user will type next, and the empty composer shows it in grey.
 * Tab (or a tap on the phone) puts it in the box as an editable draft; it is
 * never sent on its own.
 *
 * One guess per reply, shared by every composer showing that chat and by the
 * phone, so switching panes or polling never pays twice.
 */

import { useEffect, useState } from "react";
import { suggestNextPrompt } from "../../../platform/tauri/voice";
import {
  loadNextPromptSuggestions,
  useNextPromptSuggestions,
} from "../../settings/model/displayPrefs";
import type { Reply } from "../../voice/model/spokenReply";

/** Lets a reply settle (and a quick follow-up land) before asking. */
const ASK_DELAY_MS = 500;
const CACHE_LIMIT = 100;

type Suggest = typeof suggestNextPrompt;

const guesses = new Map<string, Promise<string | null>>();
const dismissed = new Set<string>();

function remember<T>(store: Map<string, T> | Set<string>, key: string) {
  if (store.size < CACHE_LIMIT) return;
  const oldest = store.keys().next().value;
  if (oldest !== undefined && oldest !== key) store.delete(oldest);
}

/** The suggestion for this reply, asked for once and then shared. */
export function nextPromptFor(
  reply: Reply,
  sessionId?: string,
  suggest: Suggest = suggestNextPrompt,
): Promise<string | null> {
  if (!loadNextPromptSuggestions()) return Promise.resolve(null);
  const cached = guesses.get(reply.id);
  if (cached) return cached;
  remember(guesses, reply.id);
  const guess = suggest(reply.text, reply.prompts ?? [], sessionId).catch(
    () => null,
  );
  guesses.set(reply.id, guess);
  return guess;
}

/** Hidden for good: taken, or waved off with Escape. */
export function dismissNextPrompt(replyId: string) {
  remember(dismissed, replyId);
  dismissed.add(replyId);
}

export function isNextPromptDismissed(replyId: string): boolean {
  return dismissed.has(replyId);
}

/** For tests. */
export function resetNextPrompts() {
  guesses.clear();
  dismissed.clear();
}

/**
 * The grey suggestion for a composer, or null. `active` is false while the
 * agent works or waits on the user; the composer also hides it while the
 * draft has text.
 */
export function useNextPrompt({
  reply,
  sessionId,
  active,
}: {
  reply: Reply | null | undefined;
  sessionId?: string;
  active: boolean;
}): { suggestion: string | null; dismiss: () => void } {
  const enabled = useNextPromptSuggestions();
  const [guess, setGuess] = useState<{ id: string; text: string } | null>(null);
  const [, setDismissals] = useState(0);
  const replyId = reply?.id;
  const wanted = enabled && active && !!reply && !dismissed.has(reply.id);

  useEffect(() => {
    if (!wanted || !reply) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void nextPromptFor(reply, sessionId).then((text) => {
        if (!cancelled && text) setGuess({ id: reply.id, text });
      });
    }, ASK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // The reply's id names its text; a new object for the same reply is no change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, replyId, sessionId]);

  const suggestion =
    wanted && guess && guess.id === replyId ? guess.text : null;
  return {
    suggestion,
    dismiss: () => {
      if (!replyId) return;
      dismissNextPrompt(replyId);
      setDismissals((count) => count + 1);
    },
  };
}
